#!/bin/bash
#
# JHYP 智能工作台 — 日志轮转（macOS launchd 每日触发）。
#
# 背景：launchd 的 StandardOutPath 只会无限追加，不会切分文件；
# 长期常驻后 api.log / web.log 会一直涨。这里每天检查一次，超过阈值就改名归档。
#
# ⚠️ launchd 在进程启动时打开日志文件并持有 fd，改名（mv）不会让它写新文件，
# 因此轮转后必须 kickstart 对应服务，把它的 fd 重新指到新文件上。
# 这也是本脚本只在「确实超过阈值」时才重启服务的原因——不超就不动，避免无谓中断。
#
# 用法：bash deploy/rotate-logs.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT/logs"
MAX_BYTES=$((10 * 1024 * 1024))   # 单文件 10MB 触发轮转
KEEP=7                            # 每个服务保留最近 7 份归档
UID_NUM="$(id -u)"

mkdir -p "$LOG_DIR"

rotate() {
  local name="$1" label="$2" file="$LOG_DIR/$1"
  [ -f "$file" ] || return 0

  local size
  size=$(stat -f%z "$file" 2>/dev/null || echo 0)
  if [ "$size" -lt "$MAX_BYTES" ]; then
    echo "[rotate] $name 未超阈值（$(du -h "$file" | cut -f1)），跳过"
  else
    local stamp
    stamp="$(date +%Y%m%d-%H%M%S)"
    mv "$file" "$file.$stamp"
    # ${stamp} 的花括号不能省：macOS 自带 bash 3.2 会把紧跟变量的全角括号字节并进变量名
    echo "[rotate] $name 已归档为 $(basename "$file").${stamp}（$(du -h "$file.$stamp" | cut -f1)）"

    # 让 launchd 用新 fd 重新打开日志文件
    if launchctl print "gui/$UID_NUM/$label" >/dev/null 2>&1; then
      launchctl kickstart -k "gui/$UID_NUM/$label" >/dev/null 2>&1 || true
      echo "[rotate] 已重启 $label 以重新挂接日志"
    fi
  fi

  # 清理超期归档：按文件名里的时间戳倒序，保留最新 KEEP 份。
  # ⚠️ 不能用 ls -t 按修改时间排序：mv 会保留原日志的 mtime，归档文件的 mtime 是
  #    「日志最后写入时间」而不是「归档时间」，同秒产生的归档顺序不稳定，
  #    实测会先删掉刚归档的最新文件、留下最旧的（隔离测试已复现）。
  # ⚠️ 末尾必须带 || true：没有归档时 ls 返回非 0，脚本开了 set -e + pipefail，
  #    会让整个函数失败并中断，导致第二个日志（web.log）根本没被轮到。
  ls -1 "$file".* 2>/dev/null | LC_ALL=C sort -r | tail -n "+$((KEEP + 1))" | while read -r old; do
    rm -f "$old"
    echo "[rotate] 已删除过期归档 $(basename "$old")"
  done || true
}

rotate api.log com.jhyp.api
rotate web.log com.jhyp.web
echo "[rotate] 完成 $(date '+%Y-%m-%d %H:%M:%S')"
