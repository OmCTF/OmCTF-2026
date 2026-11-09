#!/usr/bin/env bash
set -euo pipefail
for attempt in $(seq 1 600); do
    if [[ -f /state/operational ]]; then
        echo 'Operational bootstrap completed; web may start.'
        exit 0
    fi
    if [[ -f /state/license-input-error ]]; then
        echo 'License file activation failed; replace the removed credential file and restart onec.' >&2
        exit 1
    fi
    sleep 2
done
echo 'Operational bootstrap did not complete.' >&2
exit 1
