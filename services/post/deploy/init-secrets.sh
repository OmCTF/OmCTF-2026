#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
umask 077

if [ -L .env ] || { [ -e .env ] && [ ! -f .env ]; }; then
  echo '.env must be a regular file' >&2
  exit 1
fi

tmp=$(mktemp "$root/.env.tmp.XXXXXX")
trap 'rm -f "$tmp"' 0 1 2 3 15
if [ -f .env ]; then
  cp .env "$tmp"
fi

for key in POSTGRES_PASSWORD API_DB_PASSWORD REALTIME_DB_PASSWORD MEDIA_DB_PASSWORD VOICE_DB_PASSWORD REDIS_PASSWORD S3_ROOT_PASSWORD S3_MEDIA_PASSWORD; do
  count=$(grep -c "^$key=" "$tmp" || :)
  case "$count" in
    0)
      value=$(openssl rand -hex 32)
      if [ "${#value}" -ne 64 ]; then
        echo "failed to generate $key" >&2
        exit 1
      fi
      printf '%s=%s\n' "$key" "$value" >> "$tmp"
      ;;
    1)
      value=$(sed -n "s/^$key=//p" "$tmp")
      case "$value" in
        local-*|'') echo "$key contains an unsafe existing value" >&2; exit 1 ;;
      esac
      if [ "${#value}" -lt 24 ]; then
        echo "$key must be at least 24 characters" >&2
        exit 1
      fi
      ;;
    *) echo "$key appears more than once in .env" >&2; exit 1 ;;
  esac
done

chmod 600 "$tmp"
mv -f "$tmp" .env
trap - 0 1 2 3 15
