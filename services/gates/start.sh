#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -f .env ]; then
    umask 077
    db_password="$(openssl rand -hex 32)"
    master_key="$(openssl rand -hex 32)"
    printf 'KPP_DATABASE_PASSWORD=%s\nKPP_MASTER_KEY=%s\n' "$db_password" "$master_key" > .env
fi
docker compose up -d --build
