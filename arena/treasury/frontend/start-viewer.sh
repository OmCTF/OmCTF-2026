#!/bin/sh
set -eu
case "$ARENA_TASK" in
  ''|*[!a-zA-Z0-9_-]*) printf 'Invalid ARENA_TASK\n' >&2; exit 1;;
esac
printf "window.ARENA_TASK = '%s';\n" "$ARENA_TASK" > /usr/share/nginx/html/arena-config.js
envsubst '${JURY_UPSTREAM} ${ARENA_TASK}' < /etc/nginx/kazna.conf.in > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
