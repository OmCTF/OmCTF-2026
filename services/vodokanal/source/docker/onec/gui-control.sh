#!/bin/bash
set -euo pipefail
umask 077
run=/run/onec-gui
case "${1:-status}" in
    start)
        rm -f /home/usr1cv8/.local/state/onec-gui/disabled
        if [[ -s "$run/session.pid" ]] && kill -0 "$(cat "$run/session.pid")" 2>/dev/null; then
            echo 'GUI is already running.'; exit 0
        fi
        test "$(id -u)" = 0
        install -d -o usr1cv8 -g grp1cv8 -m 0700 "$run"
        if [[ ${ONEC_GUI_HEADLESS:-0} != 1 ]]; then
            secret=/run/secrets/gui_password
            if [[ -s "$secret" ]]; then
                password="$(cat "$secret")"
            else
                password="$(openssl rand -hex 4)"
            fi
            if [[ ${#password} != 8 ]]; then echo 'GUI secret must contain exactly 8 characters.' >&2; exit 1; fi
            gosu usr1cv8:grp1cv8 x11vnc -storepasswd "$password" "$run/vnc.pass" >/dev/null 2>&1
            unset password
        fi
        gosu usr1cv8:grp1cv8 /usr/local/bin/onec-gui-session >"$run/session.log" 2>&1 &
        echo "$!" >"$run/session.pid"
        chown usr1cv8:grp1cv8 "$run/session.pid"
        for attempt in $(seq 1 60); do
            if [[ ${ONEC_GUI_HEADLESS:-0} == 1 ]] && gosu usr1cv8:grp1cv8 env DISPLAY=:99 XAUTHORITY="$run/Xauthority" xdpyinfo >/dev/null 2>&1; then
                echo 'GUI display is ready for local license activation.'; exit 0
            fi
            if [[ ${ONEC_GUI_HEADLESS:-0} != 1 ]] && curl --fail --silent --max-time 1 http://127.0.0.1:6080/vnc.html >/dev/null; then
                echo 'GUI is listening on container port 6080 (VNC itself is loopback-only).'; exit 0
            fi
            if ! kill -0 "$(cat "$run/session.pid")" 2>/dev/null; then echo 'GUI startup failed; inspect /run/onec-gui/session.log.' >&2; exit 1; fi
            sleep 1
        done
        echo 'GUI startup timed out.' >&2; exit 1
        ;;
    stop)
        install -d -o usr1cv8 -g grp1cv8 -m 0700 /home/usr1cv8/.local/state/onec-gui
        touch /home/usr1cv8/.local/state/onec-gui/disabled
        chown usr1cv8:grp1cv8 /home/usr1cv8/.local/state/onec-gui/disabled
        if [[ -s "$run/session.pid" ]]; then
            pid="$(cat "$run/session.pid")"
            if [[ -r "/proc/$pid/cmdline" ]] && tr '\0' ' ' <"/proc/$pid/cmdline" | grep -q '/usr/local/bin/onec-gui-session'; then
                kill -TERM "$pid"
                for attempt in $(seq 1 30); do
                    if ! kill -0 "$pid" 2>/dev/null; then break; fi
                    sleep 0.2
                done
            fi
        fi
        echo 'GUI stop requested; the 1C server container was not recreated.'
        ;;
    status)
        if [[ -s "$run/session.pid" ]] && kill -0 "$(cat "$run/session.pid")" 2>/dev/null; then
            echo 'GUI running'
        else echo 'GUI stopped'; fi
        ;;
    *) echo 'Usage: onec-gui-control start|stop|status' >&2; exit 2 ;;
esac
