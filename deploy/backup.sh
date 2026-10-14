#!/usr/bin/env bash
# ============================================================================
# JHYP 智能工作台 —— 数据库定时备份脚本
#
# 用法（先手动跑一次确认没问题，再交给 cron 每天自动跑）：
#   bash /srv/jhyp/backup.sh
#
# 定时任务（每天凌晨 3 点）：
#   sudo crontab -e
#   0 3 * * * /bin/bash /srv/jhyp/backup.sh >> /srv/jhyp/backup/cron.log 2>&1
#
# 备份内容：PostgreSQL 全库（自定义格式，恢复用 pg_restore）
# 保留策略：本地最多留 14 份（约两周）
# 进阶：装 ossutil 后打开下面的上传段，把备份同步到阿里云 OSS（防服务器整机故障）
# ============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/jhyp/app}"
BACKUP_DIR="${BACKUP_DIR:-/srv/jhyp/backup}"
KEEP="${KEEP:-14}"

mkdir -p "$BACKUP_DIR"

# 数据库连接参数来自代码目录的 .env
# 注意：这里用 shell 直接读取 .env，因此密码含 $ 等特殊字符时必须在 .env 里加单引号，
# 例如 PGPASSWORD='Abc$123!' —— 否则会被 shell 当变量展开，连不上数据库。
set -a; . "$APP_DIR/.env"; set +a

STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/${PGDATABASE:-jhyp_workbench}-$STAMP.dump"

echo "[$(date '+%F %T')] 开始备份 → $FILE"
pg_dump -Fc -f "$FILE"

SIZE="$(du -h "$FILE" | cut -f1)"
echo "[$(date '+%F %T')] 备份完成，大小 $SIZE"

# 清理旧备份
ls -1t "$BACKUP_DIR"/*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

# ---------------------------------------------------------------- OSS 上传
# 想在服务器整机故障时也能恢复，就把备份同步到 OSS（需要先装 ossutil 并配置 AK）：
#   ossutil cp -f "$FILE" oss://你的Bucket名/jhyp-backup/
# 对应的 cron 需要带上 ossutil 的配置路径，例如：
#   ossutil cp -f "$FILE" oss://你的Bucket名/jhyp-backup/ --config-file /root/.ossutilconfig
# ---------------------------------------------------------------------------

echo "[$(date '+%F %T')] 完成（本地保留最近 $KEEP 份）"
