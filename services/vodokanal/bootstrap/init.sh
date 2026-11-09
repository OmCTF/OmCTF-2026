#!/usr/bin/env bash
set -euo pipefail
test -s /run/secrets/pg_password
test -f /src/Configuration.xml
mkdir -p /state /tmp/ibcmd-data
if [[ -e /state/complete ]]; then
    echo 'Current configuration was already initialized.'
    exit 0
fi
if [[ -e /state/started ]]; then
    echo 'Prior bootstrap did not finish; refusing to replay against a possibly changed database.' >&2
    exit 1
fi

cluster=''
for attempt in $(seq 1 60); do
    listing=$(rac cluster list ras:1545 2>/dev/null || true)
    cluster=$(printf '%s\n' "$listing" | sed -nE 's/^cluster[[:space:]]*:[[:space:]]*([0-9a-fA-F-]{36}).*/\1/p' | head -1)
    [[ -n "$cluster" ]] && break
    sleep 2
done
[[ "$cluster" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo 'RAS cluster unavailable.' >&2; exit 1; }
if rac infobase summary list --cluster="$cluster" ras:1545 | grep -Eq '^name[[:space:]]*:[[:space:]]*vodokanal$'; then
    echo 'Infobase already exists without a completion marker; refusing to overwrite it.' >&2
    exit 1
fi
touch /state/started
password=$(cat /run/secrets/pg_password)
rac infobase --cluster="$cluster" create \
    --create-database --name=vodokanal --dbms=PostgreSQL \
    --db-server=db --db-name=vodokanal --db-user=postgres \
    --db-pwd="$password" --locale=ru --license-distribution=allow ras:1545

common=(infobase --dbms=PostgreSQL --database-server=db \
    --database-name=vodokanal --database-user=postgres \
    --database-password="$password" --data=/tmp/ibcmd-data)
ibcmd "${common[@]}" config import /src
ibcmd "${common[@]}" config apply --force
ibcmd "${common[@]}" config generation-id
touch /state/complete
echo 'Current configuration imported into an empty PostgreSQL infobase.'
