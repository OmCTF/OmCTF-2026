#!/bin/bash
set -euo pipefail
umask 027

if [[ "${1:-}" == ragent ]]; then
    mkdir -p /var/lib/1c/srvinfo /var/1C/licenses /home/usr1cv8
    chown -R usr1cv8:grp1cv8 /var/lib/1c/srvinfo /var/1C/licenses /home/usr1cv8
    key_file=/home/usr1cv8/.vdk-seal-key
    if [[ ! -e "$key_file" ]]; then
        key_tmp=$(mktemp /home/usr1cv8/.vdk-seal-key.XXXXXX)
        dd if=/dev/urandom bs=32 count=1 status=none | base64 -w0 > "$key_tmp"
        chmod 0600 "$key_tmp"
        chown usr1cv8:grp1cv8 "$key_tmp"
        mv "$key_tmp" "$key_file"
    fi
    if [[ ! -s "$key_file" ]]; then
        echo 'Invalid sealed-summary key file' >&2
        exit 1
    fi
fi

export HOME=/home/usr1cv8
exec gosu usr1cv8:grp1cv8 "$@"
