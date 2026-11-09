#!/usr/bin/env bash
set -euo pipefail
umask 077

[[ -f /state/complete ]] || { echo 'Configuration import is incomplete.' >&2; exit 1; }
if [[ -f /state/operational ]]; then
    echo 'Operational bootstrap was already completed.'
    exit 0
fi
if [[ -e /state/activation-started ]]; then
    echo 'Previous operational bootstrap is incomplete; refusing to replay native writes.' >&2
    exit 1
fi
[[ ${VDK_HTTP_PORT:-} == 8080 ]] || exit 1
for name in quota-migration identity-gateway portal-reader public-reader hydrology-reader dispatch-gateway; do
    [[ -d /bootstrap-data/$name && ! -e /bootstrap-data/$name/input.json ]] || exit 1
done
for name in operator_password identity_gateway_password public_lab_password public_hydrology_password public_portal_password public_dispatch_password dispatch_source_key; do
    [[ -s /run/secrets/$name ]] || { echo "Missing secret $name" >&2; exit 1; }
done
touch /state/activation-started
scratch=$(mktemp -d /tmp/vdk-activate.XXXXXXXX)
cleanup_scratch() {
    if [[ -n ${scratch:-} && -d $scratch && $scratch == /tmp/vdk-activate.* ]]; then
        rm -f -- "$scratch/startup.txt" "$scratch/result.log" "$scratch/client.log"
        rmdir -- "$scratch" 2>/dev/null || true
    fi
}
trap cleanup_scratch EXIT
chown usr1cv8:grp1cv8 "$scratch"
chmod 0700 "$scratch"
operator_password=$(cat /run/secrets/operator_password)
[[ ${#operator_password} == 43 ]] || exit 1

uuid() { cat /proc/sys/kernel/random/uuid; }
put_input() {
    local name=$1 body=$2 path="/bootstrap-data/$1/${3:-input.json}"
    [[ ! -e $path && ! -L $path ]] || exit 1
    printf '%s' "$body" > "$path"
    chown usr1cv8:grp1cv8 "$path"
    chmod 0600 "$path"
}
run_client() {
    local stage=$1 token=$2 expected=$3 mode=${4:-authenticated}
    rm -f -- "$scratch/startup.txt" "$scratch/result.log" "$scratch/client.log"
    if [[ $mode == unauthenticated ]]; then
        printf 'ENTERPRISE /S "onec:1541\\vodokanal" /WA- /C %s /DisableStartupDialogs /DisableStartupMessages /Out "%s/result.log"\n' \
            "$token" "$scratch" > "$scratch/startup.txt"
    else
        printf 'ENTERPRISE /S "onec:1541\\vodokanal" /N "administrator" /P "%s" /WA- /C %s /DisableStartupDialogs /DisableStartupMessages /Out "%s/result.log"\n' \
            "$operator_password" "$token" "$scratch" > "$scratch/startup.txt"
    fi
    chown usr1cv8:grp1cv8 "$scratch/startup.txt"
    chmod 0400 "$scratch/startup.txt"
    echo "Activating $stage..."
    if ! gosu usr1cv8:grp1cv8 env HOME=/home/usr1cv8 LC_ALL=C.UTF-8 \
        LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libstdc++.so.6 \
        timeout --kill-after=10 240 xvfb-run -a -s '-screen 0 1280x800x24 -nolisten tcp' \
        /opt/onec/1cv8 /@ "$scratch/startup.txt" > "$scratch/client.log" 2>&1; then
        if [[ $stage == first-operator && -f $scratch/result.log ]] &&
            grep -Fq 'Не обнаружен ключ защиты программы или полученная программная лицензия!' "$scratch/result.log"; then
            rm -f -- /state/activation-started
            echo 'License activation is required before first-operator provisioning.' >&2
            exit 43
        fi
        echo "Native client failed at $stage." >&2
        exit 1
    fi
    if [[ ! -f $scratch/result.log ]] || ! grep -Fq "$expected" "$scratch/result.log"; then
        echo "Native completion was not confirmed at $stage." >&2
        exit 1
    fi
    rm -f -- "$scratch/startup.txt"
}
check_result() {
    local name=$1 token=$2 input_name=${3:-input.json} path="/bootstrap-data/$1/result.json"
    [[ -s $path && $(stat -c '%u' "$path") == 10001 ]] || { echo "No native receipt for $name." >&2; exit 1; }
    grep -Fq "$token" "$path" || { echo "Unexpected native receipt for $name." >&2; exit 1; }
    rm -f -- "/bootstrap-data/$name/$input_name"
}

run_client first-operator VodokanalFirstOperatorCreate first_operator_created unauthenticated

request_id=$(uuid)
binding=$(sha256sum /bootstrap/activate.sh | cut -d' ' -f1)
put_input quota-migration "$(printf '{"schema":"vodokanal.quota-migration-intent.v1","requestId":"%s","action":"Bootstrap","expectedVersion":"1.0","expectedPolicy":"root-objects-v1","implementation":"adm08-production-migration-v1","controllerBindingSha256":"%s"}' "$request_id" "$binding")" intent.json
run_client quota-migration VodokanalQuotaMigration quota_migration_completed
check_result quota-migration '"complete"' intent.json
grep -Eq '"complete"[[:space:]]*:[[:space:]]*true' /bootstrap-data/quota-migration/result.json || exit 1

target='"target":{"server":"onec:1541","ref":"vodokanal"}'
pw=$(cat /run/secrets/identity_gateway_password)
put_input identity-gateway "$(printf '{"schema":1,"mode":"create","operationId":"%s","password":"%s","expectedNativeId":""}' "$(uuid)" "$pw")"
unset pw
run_client identity-gateway VodokanalIdentityGatewayProvision identity_gateway_provision_completed
check_result identity-gateway '"nativeUserId"'

pw=$(cat /run/secrets/public_lab_password)
put_input public-reader "$(printf '{"schema":1,"purpose":"public_lab_native_principal","mode":"create","operationId":"%s",%s,"password":"%s","currentVersion":"1.0"}' "$(uuid)" "$target" "$pw")"
unset pw
run_client public-lab VodokanalPublicReaderCreate public_reader_create_completed
check_result public-reader '"nativeUserId"'

pw=$(cat /run/secrets/public_hydrology_password)
put_input hydrology-reader "$(printf '{"schema":1,"purpose":"public_hydrology_native_principal","mode":"create","operationId":"%s",%s,"currentVersion":"1.0","password":"%s"}' "$(uuid)" "$target" "$pw")"
unset pw
run_client public-hydrology VodokanalHydrologyReaderCreate hydrology_reader_create_completed
check_result hydrology-reader '"nativeUserId"'

pw=$(cat /run/secrets/public_portal_password)
put_input portal-reader "$(printf '{"schema":1,"purpose":"public_portal_native_principal","mode":"create","operationId":"%s","currentVersion":"1.0",%s,"password":"%s"}' "$(uuid)" "$target" "$pw")"
unset pw
run_client public-portal VodokanalPortalReaderCreate portal_reader_create_completed
check_result portal-reader '"nativeUserId"'

pw=$(cat /run/secrets/public_dispatch_password)
source_key=$(cat /run/secrets/dispatch_source_key)
put_input dispatch-gateway "$(printf '{"schema":1,"purpose":"dispatch_gateway_native_principal","mode":"create","operationId":"%s","currentVersion":"1.0",%s,"password":"%s","sourceKey":"%s","expectedNativeId":"","publicOrigin":"http://127.0.0.1:%s","readsPerMinute":60,"writesPerMinute":20}' "$(uuid)" "$target" "$pw" "$source_key" "$VDK_HTTP_PORT")"
unset pw source_key
run_client public-dispatch VodokanalDispatchGatewayProvision dispatch_gateway_provision_completed
check_result dispatch-gateway '"protectedSettingsBound"'

unset operator_password
rm -f -- "$scratch/client.log" "$scratch/result.log"
rmdir -- "$scratch"
touch /state/operational
echo 'Operational service principals and empty-database migration are complete.'
