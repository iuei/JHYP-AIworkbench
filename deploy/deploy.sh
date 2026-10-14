#!/usr/bin/env bash
# ============================================================================
# JHYP 智能工作台 —— 一键更新脚本
#
# 用法（在服务器上执行）：
#   bash /srv/jhyp/deploy.sh
#
# 它会依次做四件事：
#   1. 备份数据库（可选，默认开；失败也会继续，不会卡住上线）
#   2. 拉取最新代码（只做快进合并，绝不覆盖你在服务器上的改动）
#   3. 安装依赖 + 构建前端
#   4. 跑数据库迁移并重启服务，最后做一次存活检查
#
# 如果只想更新不备份：SKIP_BACKUP=1 bash /srv/jhyp/deploy.sh
# ============================================================================
set -euo pipefail

# ★改这里：部署路径与分支（与部署文档一致就不用改）
APP_DIR="${APP_DIR:-/srv/jhyp/app}"
BRANCH="${DEPLOY_BRANCH:-main}"
BACKUP_DIR="${BACKUP_DIR:-/srv/jhyp/backup}"
SERVICE="${SERVICE:-jhyp}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$1" >&2; exit 1; }

[ -d "$APP_DIR/.git" ] || die "没找到代码目录 $APP_DIR（先按 docs/部署与运维.md 第 4 步克隆代码）"
cd "$APP_DIR"

# ---------------------------------------------------------------- 1. 备份
if [ "${SKIP_BACKUP:-0}" != "1" ]; then
  say "备份数据库到 $BACKUP_DIR"
  mkdir -p "$BACKUP_DIR"
  # .env 里的 PG 变量由 pg_dump 自己读取（PGPASSWORD/PGHOST/...）
  # 注意：密码含 $ 等特殊字符时，.env 里必须加单引号（PGPASSWORD='Abc$123!'），否则这里会读错
  set -a; . "$APP_DIR/.env"; set +a
  STAMP="$(date +%Y%m%d-%H%M%S)"
  if pg_dump -Fc -f "$BACKUP_DIR/${PGDATABASE:-jhyp_workbench}-$STAMP.dump" 2>"$BACKUP_DIR/last-error.log"; then
    echo "✔ 备份完成：$BACKUP_DIR/${PGDATABASE:-jhyp_workbench}-$STAMP.dump"
    # 只保留最近 14 份，避免磁盘被备份占满
    ls -1t "$BACKUP_DIR"/*.dump 2>/dev/null | tail -n +15 | xargs -r rm -f
  else
    echo "⚠ 备份失败（继续更新，详情见 $BACKUP_DIR/last-error.log）—— 若本次升级涉及数据库结构，请先修好备份再重跑"
  fi
fi

# ------------------------------------------------------------ 2. 拉最新代码
say "拉取 $BRANCH 分支最新代码"
git fetch --prune origin
# 只允许快进：服务器上有未提交改动时会停下来提示，而不是把它冲掉
git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH"
BEFORE="$(git rev-parse --short HEAD)"
git merge --ff-only "origin/$BRANCH" || die "无法快进合并（服务器本地有改动？）请先处理：git status"
AFTER="$(git rev-parse --short HEAD)"
echo "✔ $BEFORE → $AFTER"
if [ "$BEFORE" = "$AFTER" ]; then
  echo "（代码没有变化，仍会继续重建与重启，保证配置改动生效）"
fi

# --------------------------------------------------- 3. 安装依赖 + 构建前端
say "安装依赖（严格按 pnpm-lock.yaml，保证和本机一致）"
pnpm install --frozen-lockfile

say "构建前端（产物在 dist/）"
# 前端用相对路径 /api 请求后端 —— 必须和 Nginx 把 /api 反代到 8787 配套
VITE_API_BASE_URL=/api pnpm build

# ------------------------------------------------------- 4. 迁移 + 重启服务
say "执行数据库迁移（可重复执行，不会重复建表）"
pnpm db:setup

say "重启后端服务"
if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl restart "$SERVICE"
  sleep 3
  if systemctl is-active --quiet "$SERVICE"; then
    echo "✔ $SERVICE 已在运行"
  else
    sudo journalctl -u "$SERVICE" -n 40 --no-pager || true
    die "$SERVICE 启动失败，上面是最近 40 行日志"
  fi
else
  echo "⚠ 没有 systemd，请自行重启 node 进程"
fi

# ---------------------------------------------------------------- 5. 自检
say "自检：后端是否响应"
CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/api/ai/tools || echo 000)"
if [ "$CODE" = "401" ] || [ "$CODE" = "200" ]; then
  echo "✔ 后端正常（HTTP $CODE；401 表示需要登录，属于预期）"
else
  echo "⚠ 后端返回 HTTP $CODE，请检查：sudo journalctl -u $SERVICE -n 60"
fi

# 前端产物自检
[ -f "$APP_DIR/dist/index.html" ] && echo "✔ 前端产物存在：$APP_DIR/dist/index.html" || echo "⚠ 没找到 dist/index.html，构建可能失败"

say "更新完成"
echo "刷新一下浏览器（如果样式没变，按 Ctrl+Shift+R 强制刷新）"
