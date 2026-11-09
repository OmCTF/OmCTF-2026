#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
container=$(docker compose ps -q onec)
[[ -n $container ]]
docker exec "$container" test -f /state/complete
docker exec "$container" test ! -f /state/activation-started
docker exec "$container" test ! -f /state/operational
docker exec "$container" onec-gui-control stop
docker compose restart onec
docker compose up -d --no-recreate --wait --wait-timeout 1200
echo SERVICE_READY_AFTER_LICENSE
