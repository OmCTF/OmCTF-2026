#!/usr/bin/env bash
set -euo pipefail
pidfile=/run/onec-gui/license-activate.pid
[[ -s $pidfile ]] || exit 0
pid=$(cat "$pidfile")
[[ $pid =~ ^[0-9]+$ ]] || exit 1
if [[ -r /proc/$pid/cmdline ]]; then
    command_line=$(tr '\0' ' ' < "/proc/$pid/cmdline")
    [[ $command_line == *'/license-activate-once.sh'* ||
       $command_line == *'/vdk-license-activate-once'* ]] || exit 1
    kill -TERM "$pid"
    for attempt in $(seq 1 15); do
        if ! kill -0 "$pid" 2>/dev/null; then break; fi
        sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid"; fi
fi
rm -f -- "$pidfile"
echo 'LICENSE_ACTIVATION_CANCELLED'
