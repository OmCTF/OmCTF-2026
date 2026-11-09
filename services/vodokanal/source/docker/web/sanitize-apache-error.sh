#!/bin/bash
set +x
exec 2>/dev/null
set -eu
export LC_ALL=C
while IFS= read -r -n 4096 chunk || [[ -n $chunk ]]; do
    unset chunk
    printf '%s\n' 'apache_error [message withheld]' || exit 0
done
