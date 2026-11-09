#!/bin/bash
set -euo pipefail
umask 077
export HOME=/home/usr1cv8 DISPLAY=:99 XAUTHORITY=/run/onec-gui/Xauthority
children=()
cleanup() {
    trap - EXIT TERM INT
    if [[ -s /run/onec-gui/client.pid ]]; then
        pid="$(cat /run/onec-gui/client.pid)"
        if [[ -r "/proc/$pid/cmdline" ]] && tr '\0' ' ' <"/proc/$pid/cmdline" | grep -q '/opt/onec/1cv8'; then
            kill -TERM "$pid" 2>/dev/null || true
        fi
    fi
    for pid in "${children[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
    wait || true
    rm -f /run/onec-gui/session.pid
}
trap cleanup EXIT
trap 'exit 0' TERM INT
touch "$XAUTHORITY"
xauth -f "$XAUTHORITY" add :99 . "$(openssl rand -hex 16)"
Xvfb :99 -screen 0 1440x900x24 -nolisten tcp -noreset -auth "$XAUTHORITY" &
children+=("$!")
ready=0
for attempt in $(seq 1 50); do
    if xdpyinfo -display :99 >/dev/null 2>&1; then ready=1; break; fi
    sleep 0.1
done
test "$ready" = 1
openbox --sm-disable &
children+=("$!")
if [[ ${ONEC_GUI_HEADLESS:-0} != 1 ]]; then
    x11vnc -display :99 -auth "$XAUTHORITY" -rfbauth /run/onec-gui/vnc.pass \
        -rfbport 5900 -listen 127.0.0.1 -localhost -forever -shared \
        -noxdamage -nolookup -o /run/onec-gui/vnc.log &
    children+=("$!")
    /opt/onec-gui-venv/bin/websockify --web=/opt/novnc --heartbeat=30 \
        0.0.0.0:6080 127.0.0.1:5900 &
    children+=("$!")
fi
(
    for attempt in $(seq 1 90); do
        if timeout 1 bash -c '</dev/tcp/127.0.0.1/1541' 2>/dev/null; then
            /usr/local/bin/onec-gui-open server
            exit $?
        fi
        sleep 1
    done
) &
wait -n "${children[@]}"
