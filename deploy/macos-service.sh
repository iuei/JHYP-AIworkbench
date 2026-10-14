#!/bin/bash
#
# JHYP 智能工作台 — macOS 常驻服务管理（launchd）
#
# 为什么需要它：项目此前靠 `nohup pnpm run dev:all &` 手动启动，问题有三：
#   1. 进程崩溃不会自愈（keep-alive 只活在父 shell 里）；
#   2. 机器重启/休眠后无人拉起，服务静默停摆；
#   3. 日志写在 /private/tmp，会被系统清理，出问题查不到历史。
# 改用 launchd 后：RunAtLoad 开机自启，KeepAlive 崩溃自动重启，日志固定落 logs/。
#
# 两个服务分开守护的原因：`node server/dev.mjs` 只是把 API 与 Vite 拉起来，
# 子进程挂掉时它自己不退出，KeepAlive 便永远不触发；拆成两个 Label 才能各自自愈。
#
# 用法：
#   bash deploy/macos-service.sh install     # 安装并启动（幂等，可重复执行）
#   bash deploy/macos-service.sh restart     # 重启前后端（改完后端代码必须执行）
#   bash deploy/macos-service.sh status      # 查看服务与端口状态
#   bash deploy/macos-service.sh logs        # 实时查看前后端日志
#   bash deploy/macos-service.sh rotate      # 立即执行一次日志轮转
#   bash deploy/macos-service.sh uninstall   # 停止并卸载（不会删日志）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_DIR="$HOME/Library/LaunchAgents"
UID_NUM="$(id -u)"
DOMAIN="gui/$UID_NUM"
LABELS=(com.jhyp.api com.jhyp.web com.jhyp.logrotate)

is_loaded() { launchctl print "$DOMAIN/$1" >/dev/null 2>&1; }

# 端口是否已被监听（用于安装前确认旧进程真的退干净了）
port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# 取本机对外内网 IP。
# ⚠️ 不能写死 en0：这台机器的 IPv4 实际挂在 en1 上（默认路由也走 en1），
# en0 存在但没有地址，写死会永远取到空值。这里先问默认路由，再兜底遍历。
primary_ip() {
  local iface ip
  iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
  if [ -n "$iface" ]; then
    ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    if [ -n "$ip" ]; then
      echo "$ip"
      return 0
    fi
  fi
  ifconfig 2>/dev/null | awk '/inet /{if ($2 != "127.0.0.1") {print $2; exit}}'
}

load_label() {
  local label="$1"
  if is_loaded "$label"; then
    launchctl kickstart -k "$DOMAIN/$label" >/dev/null 2>&1 || true
    echo "   ↻ $label 已在运行，已重启"
  else
    launchctl bootstrap "$DOMAIN" "$AGENT_DIR/$label.plist" 2>/dev/null \
      || launchctl load -w "$AGENT_DIR/$label.plist"
    echo "   ✔ $label 已加载"
  fi
}

unload_label() {
  local label="$1"
  if is_loaded "$label"; then
    launchctl bootout "$DOMAIN/$label" 2>/dev/null \
      || launchctl unload -w "$AGENT_DIR/$label.plist" 2>/dev/null || true
    echo "   ⏹ $label 已停止"
  else
    echo "   – $label 未运行"
  fi
}

cmd_install() {
  echo "▶ 安装 JHYP 常驻服务"
  mkdir -p "$AGENT_DIR" "$ROOT/logs"

  # 清理历史遗留的临时守护：早期用 `launchctl submit` 提交过名为 jhyp-dev-all 的服务
  # （它不在 LaunchAgents 目录里，没有 plist 文件，只能按服务名移除）。
  # 不清掉它会和 com.jhyp.* 抢同一组端口：实测它的 API 子进程因 8787 被占静默退出，
  # 而 Vite 会漂移到 5174 空转，留下一条僵尸进程链。
  if launchctl print "$DOMAIN/jhyp-dev-all" >/dev/null 2>&1; then
    echo "   ⏹ 移除历史遗留的 jhyp-dev-all 临时守护"
    launchctl remove jhyp-dev-all 2>/dev/null || launchctl bootout "$DOMAIN/jhyp-dev-all" 2>/dev/null || true
    sleep 1
  fi

  # 先卸载自己已加载的服务，让 8787/5173 空出来。
  # 少了这一步，下面的等待循环会把「自己的进程」当成端口占用者强杀
  # （KeepAlive 会立刻把它们拉回来，于是永远等不到端口释放，必然走到强杀分支）。
  for label in com.jhyp.api com.jhyp.web; do
    if is_loaded "$label"; then
      launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
    fi
  done

  # 每次安装前先停掉旧进程，避免 8787/5173 被占导致新进程 EADDRINUSE 反复重启。
  # 只杀 dev.mjs 是刻意为之：它是父进程且注册了 SIGTERM 处理，会带着自己的两个子进程一起退出，
  # 比按 "server/index.mjs" 这类通用 pattern 去 pkill 安全得多（不会误伤其他项目的同名脚本）。
  if pgrep -f "node server/dev.mjs" >/dev/null 2>&1; then
    echo "   ⏹ 停止旧的 pnpm dev:all 进程"
    pkill -f "node server/dev.mjs" || true
  fi

  # 等端口真正释放；超时后按端口占用者兜底（8787/5173 在本机只归本项目使用）
  for _ in $(seq 1 15); do
    if ! port_busy 8787 && ! port_busy 5173; then
      break
    fi
    sleep 1
  done
  if port_busy 8787 || port_busy 5173; then
    echo "   ⚠ 端口仍被占用，强制结束占用进程"
    for p in $(lsof -ti tcp:8787 2>/dev/null) $(lsof -ti tcp:5173 2>/dev/null); do
      kill "$p" 2>/dev/null || true
    done
    sleep 2
  fi

  for label in "${LABELS[@]}"; do
    cp "$ROOT/deploy/$label.plist" "$AGENT_DIR/$label.plist"
    load_label "$label"
  done

  echo "✔ 安装完成。内网访问：http://$(primary_ip || echo '<本机内网IP>'):5173"
}

cmd_restart() {
  echo "▶ 重启前后端"
  for label in com.jhyp.api com.jhyp.web; do
    if is_loaded "$label"; then
      launchctl kickstart -k "$DOMAIN/$label"
      echo "   ↻ $label"
    else
      echo "   ⚠ $label 未安装，请先执行 install"
    fi
  done
  sleep 2
  cmd_status
}

cmd_status() {
  echo "▶ 服务状态"
  for label in "${LABELS[@]}"; do
    if is_loaded "$label"; then
      local pid
      pid="$(launchctl print "$DOMAIN/$label" 2>/dev/null | awk '/^\tpid = /{print $3; exit}')"
      # 变量后必须用 ${} 收边界：macOS 自带 bash 3.2 会把紧跟变量的全角括号字节
      # 误当成变量名的一部分，写成 $pid）会直接报 unbound variable。
      echo "   ✔ ${label}${pid:+（pid ${pid}）}"
    else
      echo "   ✘ ${label}（未加载）"
    fi
  done

  echo "▶ 端口探测"
  for p in 8787 5173; do
    local code
    code="$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$p/" 2>/dev/null || echo 000)"
    case "$code" in
      000) echo "   ✘ $p 无响应" ;;
      *)   echo "   ✔ $p 已监听（HTTP ${code}）" ;;
    esac
  done

  local ip
  ip="$(primary_ip)"
  echo "▶ 内网地址"
  if [ -n "$ip" ]; then
    local code
    code="$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://$ip:5173/" 2>/dev/null || echo 000)"
    echo "   http://$ip:5173（HTTP ${code}）"
  else
    echo "   ⚠ 未取到内网 IP，请检查网络接口"
  fi
}

cmd_logs() {
  touch "$ROOT/logs/api.log" "$ROOT/logs/web.log"
  tail -f "$ROOT/logs/api.log" "$ROOT/logs/web.log"
}

cmd_rotate() { bash "$ROOT/deploy/rotate-logs.sh"; }

cmd_uninstall() {
  echo "▶ 卸载 JHYP 常驻服务（日志保留在 logs/）"
  for label in "${LABELS[@]}"; do
    unload_label "$label"
    rm -f "$AGENT_DIR/$label.plist"
  done
  echo "✔ 已卸载"
}

case "${1:-status}" in
  install)   cmd_install ;;
  restart)   cmd_restart ;;
  status)    cmd_status ;;
  logs)      cmd_logs ;;
  rotate)    cmd_rotate ;;
  uninstall) cmd_uninstall ;;
  *)
    echo "用法：bash deploy/macos-service.sh {install|restart|status|logs|rotate|uninstall}" >&2
    exit 1
    ;;
esac
