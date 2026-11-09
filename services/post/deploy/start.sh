#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
sh "$root/deploy/init-secrets.sh"
cd "$root"
exec docker compose up -d --build "$@"
