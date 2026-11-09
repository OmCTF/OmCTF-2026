#!/bin/bash
set -euo pipefail
umask 077

if [[ "${1:-}" != postgres ]]; then
    exec "$@"
fi

mkdir -p "$PGDATA" /run/postgresql
chown postgres:postgres "$PGDATA" /run/postgresql
chmod 0700 "$PGDATA"

if [[ ! -s "$PGDATA/PG_VERSION" ]]; then
    if [[ -n "$(find "$PGDATA" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
        echo 'PGDATA is not empty but has no PG_VERSION; refusing to overwrite it.' >&2
        exit 1
    fi
    secret="${POSTGRES_PASSWORD_FILE:-/run/secrets/pg_password}"
    if [[ ! -s "$secret" ]]; then
        echo 'Missing or empty PostgreSQL password secret.' >&2
        exit 1
    fi
    install -o postgres -g postgres -m 0600 "$secret" /run/postgresql/init-password
    trap 'rm -f /run/postgresql/init-password' EXIT
    gosu postgres initdb --pgdata="$PGDATA" --username=postgres \
        --pwfile=/run/postgresql/init-password --encoding=UTF8 \
        --locale=ru_RU.UTF-8 --auth-local=peer --auth-host=scram-sha-256
    rm /run/postgresql/init-password
    trap - EXIT
    printf '\nhost all all 0.0.0.0/0 scram-sha-256\nhost all all ::/0 scram-sha-256\n' >> "$PGDATA/pg_hba.conf"
fi

if [[ "$(cat "$PGDATA/PG_VERSION")" != "$PG_MAJOR" ]]; then
    echo "PGDATA major version does not match image PG_MAJOR=$PG_MAJOR; migration is required." >&2
    exit 1
fi

exec gosu postgres "$@" -D "$PGDATA"
