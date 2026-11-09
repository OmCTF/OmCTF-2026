"""Small, public-API-only helpers shared by the Svyaz attack scripts."""

import hashlib
import ipaddress
import io
import os
import re
import secrets
import time
import uuid
from functools import lru_cache
from urllib.parse import quote

import requests
from PIL import Image, ImageDraw

try:
    import checklib
except ImportError:
    checklib = None


FLAG = re.compile(r"[A-Z0-9]{31}=")
FORCAD = os.getenv("SVYAZ_FORCAD_URL", "http://forcad.example:18080").rstrip("/")
PNG_WIDTH, PNG_HEIGHT, PNG_CONTENT_ROWS = 1056, 200, 150
PNG_CELL_WIDTH = 32
PNG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789="
PNG_ATLAS = os.path.join(os.path.dirname(__file__), "assets", "signal-glyphs.png")


def fresh_id():
    return str(uuid.uuid4())


def target_url(ip):
    host = ip
    template = os.getenv("SVYAZ_HOST_TEMPLATE")
    if template:
        host = template.format(host=ip, octet=int(ipaddress.IPv4Address(ip)) & 255)
    scheme = os.getenv("SVYAZ_SCHEME") or (
        "http" if ipaddress.ip_address(ip).is_private else "https"
    )
    port = int(os.getenv("SVYAZ_PORT", "18080"))
    suffix = "" if (scheme, port) in (("http", 80), ("https", 443)) else f":{port}"
    return f"{scheme}://{host}{suffix}"


def invitations(ip):
    override = os.getenv("SVYAZ_INVITES")
    if override is not None:
        return list(dict.fromkeys(code.strip() for code in override.split(",") if code.strip()))
    response = requests.get(f"{FORCAD}/api/client/attack_data/", timeout=5)
    response.raise_for_status()
    codes = response.json().get("post", {}).get(ip, [])
    return list(dict.fromkeys(code for code in codes if isinstance(code, str)))


def credentials():
    username = (
        checklib.rnd_username() if checklib and hasattr(checklib, "rnd_username")
        else secrets.token_hex(10)
    )
    password = (
        checklib.rnd_password() if checklib and hasattr(checklib, "rnd_password")
        else secrets.token_urlsafe(24)
    )
    clean = re.sub(r"[^a-zA-Z0-9_-]", "", str(username))[:24]
    if len(clean) < 4:
        clean = secrets.token_hex(8)
    if len(password) < 16:
        password += secrets.token_urlsafe(16)
    return "sp-" + clean, password


class Client:
    def __init__(self, ip):
        self.base = target_url(ip)
        self.user_id = None
        self.session = requests.Session()
        self.session.trust_env = False
        self.session.headers.update({
            "Origin": self.base,
            "X-Svyaz-CSRF": "1",
            "Accept": "application/json",
            "User-Agent": "Svyaz desktop client/1.0",
        })

    def api(self, method, path, body=None, data=None, expected=200, raw=False, headers=None):
        url = self.base + "/api/v1" + path
        response = self.session.request(
            method, url, json=body, data=data, headers=headers, timeout=6,
            allow_redirects=False,
        )
        if response.status_code != expected:
            raise RuntimeError(f"{method} {path}: HTTP {response.status_code}: {response.text[:180]}")
        if raw:
            return response.content
        return response.json() if response.content else {}

    def register(self):
        username, password = credentials()
        key = fresh_id()
        for attempt in range(12):
            try:
                self.api("POST", "/auth/register", {
                    "login": username, "password": password, "display_name": username,
                }, expected=201, headers={"Idempotency-Key": key})
                break
            except RuntimeError as exc:
                if "HTTP 429" not in str(exc) or attempt == 11:
                    raise
                time.sleep(0.15 + secrets.randbelow(200) / 1000)
        for attempt in range(12):
            try:
                answer = self.api("POST", "/auth/login", {
                    "login": username, "password": password, "device": "Svyaz desktop",
                })
                break
            except RuntimeError as exc:
                if "HTTP 429" not in str(exc) or attempt == 11:
                    raise
                time.sleep(0.15 + secrets.randbelow(200) / 1000)
        self.user_id = answer["user"]["id"]
        return self

    def join(self, invite):
        return self.api("POST", f"/invites/{quote(invite)}/accept", {},
                        headers={"Idempotency-Key": fresh_id()})

    def channels(self, guild):
        return self.api("GET", f"/guilds/{guild}/channels")["items"]

    def messages(self, room):
        return self.api("GET", f"/channels/{room}/messages")["items"]

    def post(self, room, content):
        return self.api("POST", f"/channels/{room}/messages", {
            "client_id": fresh_id(), "content": content, "mentions": [],
        }, expected=201)

    def edit(self, room, message, content):
        return self.api("PATCH", f"/messages/{message['id']}?room_kind=channel&room_id={room}", {
            "revision": message["revision"], "content": content, "mentions": [],
        })

    def delete(self, room, message):
        return self.api("DELETE", f"/messages/{message['id']}?room_kind=channel&room_id={room}", {
            "revision": message["revision"],
        })

    def upload(self, room, data):
        scope = f"room_kind=channel&room_id={room}"
        item = self.api("POST", f"/uploads?{scope}", {
            "client_id": fresh_id(), "filename": "preview.png", "size_bytes": len(data),
        }, expected=201)
        upload_id = item["id"]
        self.api("PUT", f"/uploads/{upload_id}/content?{scope}", data=data)
        self.api("POST", f"/uploads/{upload_id}/complete?{scope}")
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            state = self.api("GET", f"/uploads/{upload_id}?{scope}")["state"]
            if state == "READY":
                return upload_id
            if state in ("FAILED", "EXPIRED"):
                raise RuntimeError("upload failed")
            time.sleep(0.1)
        raise TimeoutError("upload did not become READY")

    def attachment(self, room, upload_id):
        return self.api("GET", f"/attachments/{upload_id}/content?room_kind=channel&room_id={room}", raw=True)


def public_room(channels):
    return next(item["id"] for item in channels if item.get("kind") == "TEXT")


def matching_png(seed):
    """Реконструировать фон карточки; подпись в нижней полосе неизвестна."""
    key = hashlib.sha256(seed.encode("ascii")).digest()
    rows = bytearray()
    for y in range(PNG_CONTENT_ROWS):
        for x in range(PNG_WIDTH):
            rows.extend(((key[0] + x * 3 + y) & 255,
                         (key[1] + x + y * 2) & 255,
                         (key[2] + x * 2 + y * 3) & 255))
    rows.extend(bytes((10, 19, 27)) * PNG_WIDTH * (PNG_HEIGHT - PNG_CONTENT_ROWS))
    image = Image.frombytes("RGB", (PNG_WIDTH, PNG_HEIGHT), bytes(rows))
    draw = ImageDraw.Draw(image)
    for y in range(PNG_CONTENT_ROWS + 8, PNG_HEIGHT, 8):
        draw.line((0, y, PNG_WIDTH, y), fill=(20, 41, 48))
    draw.line((0, PNG_CONTENT_ROWS, PNG_WIDTH, PNG_CONTENT_ROWS),
              fill=(53, 185, 178), width=2)
    output = io.BytesIO()
    image.save(output, format="PNG", compress_level=6)
    return output.getvalue()


@lru_cache(maxsize=1)
def _atlas():
    atlas = Image.open(PNG_ATLAS).convert("L")
    if atlas.size != (len(PNG_ALPHABET) * PNG_CELL_WIDTH,
                       PNG_HEIGHT - PNG_CONTENT_ROWS):
        raise ValueError("invalid glyph atlas")
    return atlas


def png_flag(data, seed):
    """OCR по форме пикселей в 32 ячейках; метаданные PNG не используются."""
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return None
    try:
        image = Image.open(io.BytesIO(data)).convert("RGB")
        image.load()
    except OSError:
        return None
    if image.size != (PNG_WIDTH, PNG_HEIGHT):
        return None
    atlas = _atlas()
    positions = hashlib.sha256((seed + ":glyph").encode("ascii")).digest()
    result = []
    for index in range(32):
        left = 16 + index * PNG_CELL_WIDTH
        cell = image.crop((left, PNG_CONTENT_ROWS,
                           left + PNG_CELL_WIDTH, PNG_HEIGHT))
        raw = cell.tobytes()
        observed = tuple(min(raw[offset:offset + 3]) > 190
                         for offset in range(0, len(raw), 3))
        shift = positions[index] % 5 - 2
        scores = []
        for char in PNG_ALPHABET:
            glyph_index = PNG_ALPHABET.index(char)
            glyph = atlas.crop((glyph_index * PNG_CELL_WIDTH, 0,
                                (glyph_index + 1) * PNG_CELL_WIDTH,
                                PNG_HEIGHT - PNG_CONTENT_ROWS))
            template = Image.new("L", glyph.size)
            template.paste(glyph, (0, shift))
            expected = tuple(pixel > 0 for pixel in template.tobytes())
            scores.append((sum(a != b for a, b in zip(observed, expected)), char))
        score, char = min(scores)
        if score > 1:
            return None
        result.append(char)
    value = "".join(result)
    return value if FLAG.fullmatch(value) else None
