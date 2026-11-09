#!/bin/bash
set -euo pipefail
umask 077
if [[ "$(id -u)" = 0 ]]; then exec gosu usr1cv8:grp1cv8 "$0" "$@"; fi
export HOME=/home/usr1cv8 DISPLAY=:99 XAUTHORITY=/run/onec-gui/Xauthority
exec 9>/run/onec-gui/client.lock
if ! flock -n 9; then echo 'Close the existing Designer window before opening another.' >&2; exit 1; fi
case "${1:-server}" in
    server) target=(/S 'onec:1541\vodokanal') ;;
    activation)
        base="$HOME/.local/share/onec-activation"
        if [[ ! -s "$base/db/1Cv8.1CD" ]]; then
            mkdir -p "$base"
            ibcmd infobase create --database-path="$base/db" --data="$base/admin" --locale=ru_RU >/dev/null
        fi
        target=(/F "$base/db")
        ;;
    *) echo 'Usage: onec-gui-open server|activation' >&2; exit 2 ;;
esac
echo "$$" >/run/onec-gui/client.pid
exec env LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libstdc++.so.6 \
    /opt/onec/1cv8 DESIGNER "${target[@]}" /L ru >/dev/null 2>&1
