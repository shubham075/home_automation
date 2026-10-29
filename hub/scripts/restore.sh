#!/usr/bin/env bash
# Restore the pilot hub database from a nightly backup.
# Usage: bash hub/scripts/restore.sh hub/data/backups/hub-2026-11-02T21-00-00.db
set -euo pipefail
HUB="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:?give the backup file, e.g. hub/data/backups/hub-<date>.db}"
[[ -f "$SRC" ]] || { echo "No such file: $SRC"; exit 1; }

compose() { docker compose -f "$HUB/docker-compose.prod.yml" "$@"; }
compose stop backend
# Keep the current database next to it, just in case.
[[ -f "$HUB/data/db/hub.db" ]] && cp "$HUB/data/db/hub.db" "$HUB/data/db/hub.db.before-restore-$(date +%Y%m%d%H%M%S)"
rm -f "$HUB/data/db/hub.db-wal" "$HUB/data/db/hub.db-shm"
cp "$SRC" "$HUB/data/db/hub.db"
compose start backend
echo "Restored $SRC. Previous database kept as hub.db.before-restore-*."
