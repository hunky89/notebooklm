#!/bin/sh
set -eu

data_dir="${NOTA_DATA_DIR:-/opt/nota-data}"
backup_dir="${NOTA_BACKUP_DIR:-/opt/nota-backups}"
retention_days="${NOTA_BACKUP_RETENTION_DAYS:-14}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$backup_dir"
archive="$backup_dir/nota-$timestamp.tar.gz"
tar -C "$data_dir" -czf "$archive" .
chmod 600 "$archive"
find "$backup_dir" -type f -name 'nota-*.tar.gz' -mtime "+$retention_days" -delete
printf '%s\n' "$archive"
