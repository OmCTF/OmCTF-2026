#!/bin/bash
set -euo pipefail
if [[ "${1:-}" == ragent && "${ONEC_GUI_START:-0}" == 1 && ! -e /home/usr1cv8/.local/state/onec-gui/disabled ]]; then
    mkdir -p /var/lib/1c/srvinfo /var/1C/licenses /home/usr1cv8
    chown -R usr1cv8:grp1cv8 /var/lib/1c /var/1C/licenses /home/usr1cv8
    if ! /usr/local/bin/onec-gui-control start; then
        echo 'GUI startup failed; the native 1C server will still be started.' >&2
    fi
fi
exec /usr/local/bin/onec-entrypoint "$@"
