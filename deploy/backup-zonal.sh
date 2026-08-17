#!/usr/bin/env bash
#
# Nightly backup of the database and the uploaded evidence.
#
#   sudo cp deploy/backup-zonal.sh /usr/local/bin/
#   sudo chmod +x /usr/local/bin/backup-zonal.sh
#   sudo crontab -e
#     15 2 * * *  /usr/local/bin/backup-zonal.sh >> /var/log/zonal-backup.log 2>&1
#
# The photos matter as much as the database: a complaint without its evidence
# cannot be verified, and they are the part no migration can regenerate.

set -euo pipefail

BACKUP_ROOT=/var/backups/zonal
UPLOAD_DIR=/var/lib/zonal/uploads
KEEP_DAYS=30
STAMP=$(date +%Y-%m-%d_%H%M)

mkdir -p "$BACKUP_ROOT"

# --- database --------------------------------------------------------------
# Custom format so it can be restored selectively with pg_restore.
sudo -u postgres pg_dump -Fc zonal > "$BACKUP_ROOT/zonal-db-$STAMP.dump"
echo "database  -> zonal-db-$STAMP.dump ($(du -h "$BACKUP_ROOT/zonal-db-$STAMP.dump" | cut -f1))"

# --- uploads ---------------------------------------------------------------
if [ -d "$UPLOAD_DIR" ]; then
  tar -czf "$BACKUP_ROOT/zonal-uploads-$STAMP.tar.gz" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
  echo "uploads   -> zonal-uploads-$STAMP.tar.gz ($(du -h "$BACKUP_ROOT/zonal-uploads-$STAMP.tar.gz" | cut -f1))"
else
  echo "uploads   -> SKIPPED, $UPLOAD_DIR does not exist"
fi

# --- retention -------------------------------------------------------------
find "$BACKUP_ROOT" -name 'zonal-*' -mtime +$KEEP_DAYS -delete
echo "pruned backups older than $KEEP_DAYS days"

# A backup nobody has restored is a guess, not a backup. Verify quarterly:
#   createdb zonal_restore_test
#   pg_restore -d zonal_restore_test /var/backups/zonal/zonal-db-YYYY-MM-DD_HHMM.dump
#   dropdb zonal_restore_test
echo "done"
