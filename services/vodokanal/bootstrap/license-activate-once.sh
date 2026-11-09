#!/usr/bin/env bash
set -euo pipefail
umask 077
run_dir=/run/onec-gui
pidfile=$run_dir/license-activate.pid
exec 9>"$run_dir/license-activate.lock"
flock -n 9 || { echo 'LICENSE_ACTIVATION_BUSY'; exit 48; }
printf '%s\n' "$$" > "$pidfile"
cleanup() {
    unset login password
    if [[ -f $pidfile && $(cat "$pidfile") == "$$" ]]; then rm -f -- "$pidfile"; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

mode=${1:---submit}
accept_eula=${2:-}
[[ $mode == --submit || $mode == --dry-run || $mode == --detect-eula-only ]] || exit 2
[[ -z $accept_eula || $accept_eula == --accept-eula ]] || exit 2
[[ $mode == --submit || -z $accept_eula ]] || exit 2
license_state() {
    find /var/1C/licenses -maxdepth 1 -type f -name '*.lic' -printf '%f %s %T@\n' |
        sort | sha256sum | cut -d' ' -f1
}
before=$(license_state)
display=${DISPLAY:-:99}
authority=${XAUTHORITY:-/run/onec-gui/Xauthority}
xd() {
    gosu usr1cv8:grp1cv8 env DISPLAY="$display" XAUTHORITY="$authority" xdotool "$@"
}
ocr_full() {
    timeout --kill-after=2 8 gosu usr1cv8:grp1cv8 env DISPLAY="$display" XAUTHORITY="$authority" \
        import -window "$window" ppm:- |
        timeout --kill-after=2 8 tesseract stdin stdout -l rus+eng --psm 11 2>/dev/null
}
ocr_button() {
    timeout --kill-after=2 8 gosu usr1cv8:grp1cv8 env DISPLAY="$display" XAUTHORITY="$authority" \
        import -window "$window" ppm:- |
        timeout --kill-after=2 8 convert ppm:- -crop 124x14+282+623 +repage -resize 800% png:- |
        timeout --kill-after=2 8 tesseract stdin stdout -l rus+eng --psm 7 2>/dev/null
}

window=
for attempt in $(seq 1 90); do
    candidate=$(xd getactivewindow 2>/dev/null || true)
    if [[ -n $candidate && $(xd getwindowname "$candidate" 2>/dev/null || true) == 'Получение лицензии' ]]; then
        window=$candidate
        break
    fi
    sleep 1
done
[[ -n $window ]] || {
    echo 'Expected 1C license dialog is not active.' >&2
    exit 1
}
geometry=$(xd getwindowgeometry --shell "$window")
width=$(printf '%s\n' "$geometry" | sed -n 's/^WIDTH=//p')
height=$(printf '%s\n' "$geometry" | sed -n 's/^HEIGHT=//p')
[[ $width =~ ^[0-9]+$ && $height =~ ^[0-9]+$ ]] || exit 1
(( width >= 610 && width <= 622 && height >= 670 && height <= 690 )) || {
    echo 'Unexpected 1C license dialog geometry.' >&2
    exit 1
}
if [[ $mode == --detect-eula-only ]]; then
    xd mousemove --window "$window" 500 600
    body=$(ocr_full)
    button=$(ocr_button)
    if [[ $body == *'Комьюнити-лицензия'* && $body == *'Специальное лицензионное'* &&
          $button == *'Принимаю соглашение'* ]]; then
        echo 'KNOWN_EULA_DETECTED'
        exit 0
    fi
    echo 'Expected Community License agreement not detected.' >&2
    exit 1
fi

login_form=0
link_clicked=0
for attempt in $(seq 1 60); do
    page=$(ocr_full || true)
    if [[ $page == *'Авторизация на портале'* && $page == *'Логин'* && $page == *'Пароль'* ]]; then
        login_form=1
        break
    fi
    if [[ $link_clicked == 0 && $page == *'Лицензия не обнаружена'* &&
          $page == *'Активировать комьюнити'* ]]; then
        xd mousemove --window "$window" 250 377 click 1
        link_clicked=1
    fi
    if [[ $page == *'Специальное лицензионное'* || $page == *'Incorrect login or password'* ]]; then
        echo 'GUI_RESET_REQUIRED'
        exit 47
    fi
    sleep 1
done
[[ $login_form == 1 ]] || { echo 'Expected developer login form not found.' >&2; exit 1; }

IFS= read -r login || { echo 'Missing developer login on stdin.' >&2; exit 1; }
IFS= read -r password || { echo 'Missing developer password on stdin.' >&2; exit 1; }
[[ -n $login && -n $password ]] || { echo 'Empty developer credential.' >&2; exit 1; }
xd mousemove --window "$window" 240 266 click 1 key --clearmodifiers ctrl+a key BackSpace
printf '%s' "$login" | gosu usr1cv8:grp1cv8 env DISPLAY="$display" XAUTHORITY="$authority" \
    xdotool type --clearmodifiers --delay 40 --file -
xd mousemove --window "$window" 240 340 click 1 key --clearmodifiers ctrl+a key BackSpace
printf '%s' "$password" | gosu usr1cv8:grp1cv8 env DISPLAY="$display" XAUTHORITY="$authority" \
    xdotool type --clearmodifiers --delay 40 --file -
unset login password

if [[ $mode == --dry-run ]]; then
    xd mousemove --window "$window" 240 340 click 1 key --clearmodifiers ctrl+a key BackSpace
    xd mousemove --window "$window" 240 266 click 1 key --clearmodifiers ctrl+a key BackSpace
    echo 'LICENSE_INPUT_DRY_RUN_OK'
    exit 0
fi

xd mousemove --window "$window" 290 630 click 1
xd mousemove --window "$window" 500 600
agreement_seen=0
for attempt in $(seq 1 60); do
    if [[ $(license_state) != "$before" ]]; then
        echo 'LICENSE_FILE_CHANGED'
        exit 0
    fi
    body=$(ocr_full || true)
    button=$(ocr_button || true)
    if [[ $body == *'Комьюнити-лицензия'* && $body == *'Специальное лицензионное'* &&
          $button == *'Принимаю соглашение'* ]]; then
        agreement_seen=1
        if [[ $accept_eula != --accept-eula ]]; then
            echo 'EULA_REVIEW_REQUIRED'
            exit 45
        fi
        xd mousemove --window "$window" 340 630 click 1
        xd mousemove --window "$window" 500 600
        break
    fi
    if [[ $body == *'Incorrect login or password'* ]]; then
        echo 'LICENSE_CREDENTIAL_REJECTED'
        exit 46
    fi
    sleep 1
done
if [[ $accept_eula == --accept-eula && $agreement_seen == 0 ]]; then
    echo 'Expected Community License agreement was not displayed.' >&2
    exit 1
fi
for attempt in $(seq 1 180); do
    if [[ $(license_state) != "$before" ]]; then
        echo 'LICENSE_FILE_CHANGED'
        exit 0
    fi
    body=$(ocr_full || true)
    if [[ $body == *'Incorrect login or password'* ]]; then
        echo 'LICENSE_CREDENTIAL_REJECTED'
        exit 46
    fi
    sleep 1
done
echo '1C did not create a new license file; inspect the GUI.' >&2
exit 1
