#!/usr/bin/env sh
# Przykład kopii poza serwerem (cron: 0 */6 * * *). Kopiuje najnowszą kopię bazy z data/backups.
# Klucz główny (MASTER_KEY / data/master.key) przechowuj OSOBNO, nie razem z kopiami bazy.
set -eu
SRC="${SOLDESK_DATA:-/opt/soldesk/data}/backups"
DEST="${1:?Podaj cel, np. user@backup-host:/backups/soldesk/}"
LATEST=$(ls -1t "$SRC"/*.db | head -n 1)
rsync -a "$LATEST" "$DEST"
