#!/bin/bash
set -euo pipefail
umask 027
mkdir -p /artifacts /var/lib/1c/build /home/usr1cv8 /var/1C/licenses
chown usr1cv8:grp1cv8 /artifacts /var/lib/1c/build /home/usr1cv8 /var/1C/licenses
export HOME=/home/usr1cv8
export LIBGL_ALWAYS_SOFTWARE=1
exec gosu usr1cv8:grp1cv8 timeout --kill-after=10 "${ONEC_BATCH_TIMEOUT:-180}" \
    xvfb-run -a /opt/onec/1cv8 "$@"
