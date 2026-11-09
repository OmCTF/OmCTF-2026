#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root" >&2
  exit 2
fi

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
origin=${1:?usage: configure.sh HTTPS_ORIGIN CERT_FILE KEY_FILE VOICE_IP [WEB_PORT] [WEB_BIND_IP]}
cert=${2:?certificate file required}
key=${3:?private key file required}
voice_ip=${4:?WebRTC announce IPv4 required}
port=${5:-18080}
bind_ip=${6:-0.0.0.0}

host=$(python3 -c '
import ipaddress
import re
import sys
from urllib.parse import urlsplit

origin = sys.argv[1]
url = urlsplit(origin)
host = url.hostname or ""
try:
    port = url.port
except ValueError:
    raise SystemExit("invalid HTTPS origin port")
labels = host.split(".")
valid = (
    url.scheme == "https"
    and url.username is None
    and url.password is None
    and not url.path
    and not url.query
    and not url.fragment
    and len(labels) >= 2
    and all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", x) for x in labels)
    and origin == "https://" + host + ((":" + str(port)) if port and port != 443 else "")
)
try:
    ipaddress.ip_address(host)
    valid = False
except ValueError:
    pass
if not valid:
    raise SystemExit("APP_ORIGIN must be a canonical HTTPS domain origin")
print(host)
' "$origin")

python3 -c '
import ipaddress
import sys
voice = ipaddress.IPv4Address(sys.argv[1])
bind = ipaddress.IPv4Address(sys.argv[2])
if voice.is_unspecified or voice.is_loopback or voice.is_multicast or voice.is_link_local:
    raise SystemExit("VOICE_IP must be a routable IPv4 address")
if bind.is_multicast:
    raise SystemExit("WEB_BIND_IP must be a bindable IPv4 address")
' "$voice_ip" "$bind_ip"
case "$port" in
  *[!0-9]*|'') echo "invalid WEB_PORT" >&2; exit 2 ;;
esac
if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
  echo "invalid WEB_PORT" >&2
  exit 2
fi
if [ ! -f "$cert" ] || [ ! -f "$key" ]; then
  echo "certificate and key files are required" >&2
  exit 2
fi
if ! openssl x509 -in "$cert" -noout -checkend 300 >/dev/null; then
  echo "certificate is expired or about to expire" >&2
  exit 2
fi
case "$(openssl x509 -in "$cert" -noout -checkhost "$host")" in
  *"does match certificate"*) ;;
  *) echo "certificate does not cover $host" >&2; exit 2 ;;
esac
cert_pub=$(openssl x509 -in "$cert" -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256)
key_pub=$(openssl pkey -in "$key" -pubout -outform DER | openssl dgst -sha256)
if [ "$cert_pub" != "$key_pub" ]; then
  echo "certificate and private key do not match" >&2
  exit 2
fi

sh deploy/init-secrets.sh
umask 077
if [ -L tls ] || [ -L tls/runtime ]; then
  echo "TLS runtime path must not be a symlink" >&2
  exit 2
fi
install -d -o 101 -g 101 -m 700 tls/runtime
tmp_cert="tls/runtime/.fullchain.pem.$$"
tmp_key="tls/runtime/.privkey.pem.$$"
trap 'rm -f "$tmp_cert" "$tmp_key"' 0 1 2 3 15
install -o 101 -g 101 -m 600 "$cert" "$tmp_cert"
install -o 101 -g 101 -m 600 "$key" "$tmp_key"
mv -f "$tmp_cert" tls/runtime/fullchain.pem
mv -f "$tmp_key" tls/runtime/privkey.pem
trap - 0 1 2 3 15

set_env() {
  setting=$1
  value=$2
  count=$(grep -c "^${setting}=" .env || :)
  case "$count" in
    0) printf '%s=%s\n' "$setting" "$value" >> .env ;;
    1) sed -i "s|^${setting}=.*|${setting}=${value}|" .env ;;
    *) echo "$setting appears more than once in .env" >&2; exit 2 ;;
  esac
}
set_env APP_ENV production
set_env APP_ORIGIN "$origin"
set_env ALLOW_PUBLIC_HTTP 0
set_env COMPOSE_FILE compose.yaml:compose.tls.yaml
set_env WEB_PORT "$port"
set_env WEB_BIND_IP "$bind_ip"
set_env VOICE_BIND_IP 0.0.0.0
set_env VOICE_ANNOUNCE_IP "$voice_ip"
sed -i '/^TLS_PUBLIC_IP=/d' .env
chmod 600 .env

if [ "${TLS_RELOAD:-0}" = "1" ]; then
  docker compose -f compose.yaml -f compose.tls.yaml exec -T web nginx -c /tmp/nginx.conf -s reload
fi
printf 'Configured HTTPS origin %s; start with sh deploy/start.sh\n' "$origin"
