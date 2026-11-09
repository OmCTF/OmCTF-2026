#!/usr/bin/env bash
set -euo pipefail
umask 077

dir=/run/secrets
mkdir -p "$dir"
names=(pg_password operator_password identity_gateway_password public_lab_password
    public_hydrology_password public_portal_password public_dispatch_password dispatch_source_key)

validate() {
    [[ -f "$dir/.complete" && ! -L "$dir/.complete" && $(cat "$dir/.complete") == 1 ]] || exit 1
    for name in "${names[@]}"; do
        file="$dir/$name"
        [[ -f "$file" && ! -L "$file" ]] || exit 1
        [[ $(stat -c '%u:%g:%a' "$file") == 10001:10001:600 ]] || exit 1
        expected=64
        [[ $name == operator_password ]] && expected=43
        [[ $(stat -c %s "$file") == "$expected" ]] || exit 1
        value=$(cat "$file")
        if [[ $name == pg_password || $name == dispatch_source_key ]]; then
            [[ $value =~ ^[0-9a-f]{64}$ ]] || exit 1
        else
            [[ $value =~ ^[A-Za-z0-9_-]+$ && $value =~ [A-Z] && $value =~ [a-z] && $value =~ [0-9] ]] || exit 1
        fi
    done
}

if [[ -e "$dir/.complete" ]]; then
    validate
    echo 'Существующие секреты проверены.'
    exit 0
fi
if [[ -n $(find "$dir" -mindepth 1 -maxdepth 1 -print -quit) ]]; then
    echo 'Неполная предыдущая генерация секретов; повторная запись запрещена.' >&2
    exit 1
fi

tmp=$(mktemp -d "$dir/.seed.XXXXXXXX")
hex64() { od -An -tx1 -N32 /dev/urandom | tr -d '[:space:]'; }
url64() {
    local value
    while true; do
        value=$(head -c 48 /dev/urandom | base64 -w0 | tr '+/' '-_')
        if [[ $value =~ ^[A-Za-z0-9_-]{64}$ && $value =~ [A-Z] && $value =~ [a-z] && $value =~ [0-9] ]]; then
            printf '%s' "$value"
            return
        fi
    done
}
url43() {
    local value
    while true; do
        value=$(head -c 32 /dev/urandom | base64 -w0 | tr '+/' '-_' | tr -d '=')
        if [[ $value =~ ^[A-Za-z0-9_-]{43}$ && $value =~ [A-Z] && $value =~ [a-z] && $value =~ [0-9] ]]; then
            printf '%s' "$value"
            return
        fi
    done
}
write_secret() {
    local name=$1 value=$2
    printf '%s' "$value" > "$tmp/$name"
    chown 10001:10001 "$tmp/$name"
    chmod 0600 "$tmp/$name"
}

write_secret pg_password "$(hex64)"
write_secret operator_password "$(url43)"
for name in identity_gateway_password public_lab_password public_hydrology_password \
    public_portal_password public_dispatch_password; do
    write_secret "$name" "$(url64)"
done
write_secret dispatch_source_key "$(hex64)"
for name in "${names[@]}"; do mv -- "$tmp/$name" "$dir/$name"; done
rmdir -- "$tmp"
printf '1' > "$dir/.complete"
chown 10001:10001 "$dir/.complete"
chmod 0600 "$dir/.complete"
validate
echo 'Секреты экземпляра созданы в Docker-томе.'
