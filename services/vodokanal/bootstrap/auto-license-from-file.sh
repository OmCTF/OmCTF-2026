#!/usr/bin/env bash
set -euo pipefail
umask 077

credential_file=${VDK_LICENSE_INPUT_FILE:-/run/vdk-license-input/developer-credentials.txt}
activator=${VDK_LICENSE_ACTIVATOR:-/bootstrap/license-activate-once.sh}
gui_control=${VDK_GUI_CONTROL:-/usr/local/bin/onec-gui-control}

cleanup() {
    local result=$?
    trap - EXIT
    unset login password fields
    "$gui_control" stop >/dev/null 2>&1 || true
    if [[ -e $credential_file || -L $credential_file ]]; then
        if ! rm -f -- "$credential_file"; then
            echo 'Credential input could not be removed.' >&2
            result=1
        fi
    fi
    exit "$result"
}
trap cleanup EXIT

[[ -f $credential_file && ! -L $credential_file ]] || {
    echo 'Expected a regular credential file.' >&2
    exit 1
}
size=$(stat -c '%s' -- "$credential_file")
[[ $size =~ ^[0-9]+$ ]] && (( size > 2 && size <= 2048 )) || {
    echo 'Credential file size is invalid.' >&2
    exit 1
}
chmod 0600 -- "$credential_file" 2>/dev/null || true
mapfile -t fields < "$credential_file"
(( ${#fields[@]} == 2 )) || {
    echo 'Credential file must contain exactly two lines.' >&2
    exit 1
}
login=${fields[0]%$'\r'}
password=${fields[1]%$'\r'}
unset fields
[[ -n $login && -n $password && ${#login} -le 256 && ${#password} -le 1024 &&
   $login != *$'\r'* && $password != *$'\r'* ]] || {
    echo 'Credential values are invalid.' >&2
    exit 1
}

"$gui_control" stop >/dev/null 2>&1 || true
ONEC_GUI_HEADLESS=1 "$gui_control" start
if printf '%s\n%s\n' "$login" "$password" |
    timeout --kill-after=10 600 bash "$activator" --submit --accept-eula; then
    unset login password
    echo 'License file was created; credential input will be removed.'
else
    unset login password
    echo 'Automatic license activation failed; credential input will be removed.' >&2
    exit 1
fi
