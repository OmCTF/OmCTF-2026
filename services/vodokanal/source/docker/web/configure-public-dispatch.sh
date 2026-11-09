#!/bin/bash
set +x
set -euo pipefail
config=/etc/apache2/conf-enabled/vodokanal-public-dispatch.conf
directory=/var/lib/vodokanal-public-dispatch
descriptor=$directory/default.vrd
marker=$directory/.runtime-owner
owner_tag=vodokanal-public-dispatch-runtime-v1
descriptor_tmp=''; config_tmp=''; owned=0
fail() { echo "$1" >&2; exit 1; }
[[ $EUID == 0 ]] || fail 'Public dispatch renderer must run as root.'
if [[ -s /var/run/apache2/apache2.pid ]]; then
    apache_pid=$(cat /var/run/apache2/apache2.pid)
    if [[ $apache_pid =~ ^[0-9]+$ ]] && kill -0 "$apache_pid" 2>/dev/null; then
        fail 'Public dispatch renderer is cold-start only.'
    fi
fi
if [[ -e "$directory" || -L "$directory" ]]; then
    [[ -d "$directory" && ! -L "$directory" && $(stat -c '%u:%a' "$directory") == '0:750' ]] || fail 'Unknown dispatch runtime directory.'
    [[ -f "$marker" && ! -L "$marker" && $(stat -c '%u:%a' "$marker") == '0:600' && $(cat "$marker") == "$owner_tag" ]] || fail 'Unknown dispatch runtime owner.'
    owned=1
fi
for file in "$config" "$descriptor"; do
    if [[ -e "$file" || -L "$file" ]]; then
        [[ $owned == 1 && -f "$file" && ! -L "$file" && $(stat -c '%u' "$file") == 0 ]] || fail 'Unknown dispatch runtime file.'
    fi
done
if [[ $owned == 1 ]]; then rm -f -- "$config" "$descriptor"; fi
if [[ ${PUBLIC_DISPATCH_ENABLE:-0} != 1 ]]; then exit 0; fi
cleanup() {
    code=$?
    unset password body
    [[ -z $descriptor_tmp ]] || rm -f -- "$descriptor_tmp"
    [[ -z $config_tmp ]] || rm -f -- "$config_tmp"
    if [[ $code != 0 && $owned == 1 ]]; then rm -f -- "$config" "$descriptor"; fi
}
trap cleanup EXIT
secret=/run/secrets/public_dispatch_password
template=/opt/vodokanal-public-dispatch/public-dispatch.vrd.template
[[ -f "$secret" && ! -L "$secret" && -r "$secret" && $(wc -c < "$secret") -eq 64 ]] || fail 'Public dispatch secret is missing or invalid.'
password=$(cat "$secret")
[[ $password =~ ^[A-Za-z0-9_-]{64}$ && $password =~ [A-Z] && $password =~ [a-z] && $password =~ [0-9] ]] || fail 'Public dispatch secret format is invalid.'
umask 077
if [[ $owned == 0 ]]; then
    mkdir "$directory"
    chown root:www-data "$directory"
    chmod 0750 "$directory"
    printf '%s\n' "$owner_tag" > "$marker"
    chmod 0600 "$marker"
    owned=1
fi
body=$(cat "$template")
[[ $body == *'__DISPATCH_GATEWAY_PASSWORD__'* ]] || fail 'Public dispatch descriptor template is invalid.'
descriptor_tmp=$(mktemp "$directory/.descriptor.XXXXXXXX")
printf '%s\n' "${body//__DISPATCH_GATEWAY_PASSWORD__/$password}" > "$descriptor_tmp"
unset password body
chown root:www-data "$descriptor_tmp"
chmod 0640 "$descriptor_tmp"
mv -T "$descriptor_tmp" "$descriptor"
descriptor_tmp=''
config_tmp=$(mktemp /etc/apache2/conf-enabled/.vodokanal-public-dispatch.XXXXXXXX)
install -m 0644 /opt/vodokanal-public-dispatch/public-dispatch.conf "$config_tmp"
mv -T "$config_tmp" "$config"
config_tmp=''
