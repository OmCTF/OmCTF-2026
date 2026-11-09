#!/bin/bash
set -euo pipefail

cluster="${1:-}"
if [[ ! "$cluster" =~ ^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$ ]]; then
    echo 'Usage: create-infobase CLUSTER_UUID' >&2
    exit 2
fi
if [[ ! -s /run/secrets/pg_password ]]; then
    echo 'Missing PostgreSQL bootstrap password secret.' >&2
    exit 1
fi
password="$(cat /run/secrets/pg_password)"
exec /opt/onec/rac infobase --cluster="$cluster" create \
    --create-database --name=vodokanal --dbms=PostgreSQL \
    --db-server=db --db-name=vodokanal --db-user=postgres \
    --db-pwd="$password" --locale=ru --license-distribution=allow \
    localhost:1545
