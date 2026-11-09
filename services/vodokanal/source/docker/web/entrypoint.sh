#!/bin/bash
set +x
set -e
. /etc/apache2/envvars
mkdir -p "$APACHE_RUN_DIR" "$APACHE_LOCK_DIR"
prepare_apache_cold_start() {
    local comm_file comm pid_file=/var/run/apache2/apache2.pid pid owner
    for comm_file in /proc/[0-9]*/comm; do
        [[ -e $comm_file ]] || continue
        if ! IFS= read -r comm < "$comm_file"; then
            [[ ! -e $comm_file ]] && continue
            echo 'Apache process inspection failed; startup refused.' >&2
            return 1
        fi
        if [[ $comm == apache2 || $comm == httpd ]]; then
            echo 'Apache is already running; cold start refused.' >&2
            return 1
        fi
    done
    [[ -e $pid_file || -L $pid_file ]] || return 0
    [[ -d /var/run/apache2 && ! -L /var/run/apache2 && $(stat -c '%u:%a' /var/run/apache2) == '0:755' ]] || return 1
    [[ -f $pid_file && ! -L $pid_file ]] || return 1
    owner=$(stat -c '%u:%a' "$pid_file") || return 1
    [[ $owner == '0:644' || $owner == '0:600' ]] || return 1
    [[ $(stat -c '%s' "$pid_file") -le 16 ]] || return 1
    pid=$(cat -- "$pid_file") || return 1
    [[ $pid =~ ^[0-9]{1,10}$ ]] || return 1
    rm -- /var/run/apache2/apache2.pid
}
prepare_apache_cold_start
/usr/local/bin/configure-public-lab
/usr/local/bin/configure-public-hydrology
/usr/local/bin/configure-identity-gateway
/usr/local/bin/configure-public-portal
/usr/local/bin/configure-public-dispatch
if ! /usr/sbin/apache2 -t >/dev/null 2>&1; then
    echo 'Apache configuration validation failed; Apache was not started.' >&2
    exit 1
fi
exec /usr/sbin/apache2 "$@" 2>/dev/null
