#!/usr/bin/env bash
set -euo pipefail
umask 077
credential_file=/run/vdk-license-input/developer-credentials.txt
if [[ -e $credential_file || -L $credential_file ]]; then
    rm -f -- /state/license-input-error
fi
discard_credential_file() {
    if [[ -f $credential_file || -L $credential_file ]]; then
        rm -f -- "$credential_file"
    fi
}
for name in quota-migration identity-gateway portal-reader public-reader hydrology-reader dispatch-gateway; do
    mkdir -p "/bootstrap-data/$name"
    chown usr1cv8:grp1cv8 "/bootstrap-data/$name"
    chmod 0700 "/bootstrap-data/$name"
    link="/run/vodokanal-$name"
    target="/bootstrap-data/$name"
    if [[ -e "$link" || -L "$link" ]]; then
        [[ -L "$link" && "$(readlink -- "$link")" == "$target" ]] || {
            echo "Unexpected bootstrap path: $link" >&2; exit 1;
        }
    else
        ln -s -- "$target" "$link"
    fi
done
link=/run/vodokanal-identity-gateway.json
target=/bootstrap-data/identity-gateway/input.json
if [[ -e "$link" || -L "$link" ]]; then
    [[ -L "$link" && "$(readlink -- "$link")" == "$target" ]] || exit 1
else
    ln -s -- "$target" "$link"
fi
/usr/local/bin/onec-entrypoint "$@" &
server_pid=$!
trap 'kill -TERM "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true' TERM INT
restart_server_for_license() {
    local closed=0
    kill -TERM "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
    pkill -TERM -u usr1cv8 2>/dev/null || true
    for attempt in $(seq 1 60); do
        if ! timeout 1 bash -c '</dev/tcp/127.0.0.1/1541' 2>/dev/null; then closed=1; break; fi
        sleep 1
    done
    [[ $closed == 1 ]] || { echo '1C listener remained active after stop.' >&2; return 1; }
    /usr/local/bin/onec-entrypoint "$@" &
    server_pid=$!
    for attempt in $(seq 1 90); do
        kill -0 "$server_pid" 2>/dev/null || { echo '1C server stopped after license creation.' >&2; return 1; }
        if timeout 1 bash -c '</dev/tcp/127.0.0.1/1540' 2>/dev/null &&
            timeout 1 bash -c '</dev/tcp/127.0.0.1/1541' 2>/dev/null; then return 0; fi
        sleep 1
    done
    echo '1C server did not restart after license creation.' >&2
    return 1
}
for attempt in $(seq 1 300); do
    if [[ -f /state/complete ]]; then break; fi
    kill -0 "$server_pid" 2>/dev/null || { echo '1C server stopped during configuration import.' >&2; exit 1; }
    sleep 2
done
[[ -f /state/complete ]] || { echo 'Configuration import timeout.' >&2; exit 1; }
if [[ -f /state/operational ]]; then
    discard_credential_file
else
    if /bin/bash /bootstrap/activate.sh; then
        rm -f -- /state/license-input-error
        discard_credential_file
    else
        result=$?
        if [[ $result == 43 ]]; then
            if [[ -e $credential_file || -L $credential_file ]]; then
                rm -f -- /state/license-input-error
                if /bin/bash /bootstrap/auto-license-from-file.sh; then
                    if ! restart_server_for_license "$@"; then
                        touch /state/license-input-error
                        exit 1
                    fi
                    if /bin/bash /bootstrap/activate.sh; then
                        rm -f -- /state/license-input-error
                    else
                        result=$?
                        if [[ $result == 43 ]]; then
                            touch /state/license-input-error
                            echo 'New license did not pass the native client check.' >&2
                        else
                            echo 'Operational activation failed after license creation.' >&2
                            kill -TERM "$server_pid" 2>/dev/null || true
                            wait "$server_pid" 2>/dev/null || true
                            exit "$result"
                        fi
                    fi
                else
                    touch /state/license-input-error
                    echo 'Credential file was consumed without a usable license.' >&2
                fi
            else
                echo 'License activation required; 1C server remains available for provisioning.'
            fi
        else
            echo 'Operational activation failed; web publication remains blocked.' >&2
            kill -TERM "$server_pid" 2>/dev/null || true
            wait "$server_pid" 2>/dev/null || true
            exit "$result"
        fi
    fi
fi
wait "$server_pid"
