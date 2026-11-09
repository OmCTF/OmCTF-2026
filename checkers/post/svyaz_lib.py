"""Клиент публичного API «Связи» и медиа-функции для чекера ForcAD.

Только этот модуль знает пути API, форматы HTTP-запросов и кадры WebSocket.
Здесь нет вердиктов ForcAD и локального постоянного состояния чекера.
"""

import base64
import hashlib
import ipaddress
import io
import json
import math
import os
import re
import secrets
import struct
import time
import uuid
import wave
from functools import lru_cache
from urllib.parse import quote, urlsplit

import requests
import websocket
from PIL import Image, ImageDraw


FLAG_RE = re.compile(r"^[A-Z0-9]{31}=$")
SOUND_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789="
SAMPLE_RATE = 8000
VOICE_SAMPLES = 2400
VOICE_ATLAS_PATH = os.path.join(os.path.dirname(__file__), "assets", "voice-alphabet.wav")
DEFAULT_PORT = int(os.environ.get("SVYAZ_PORT", "18080"))
DEFAULT_SCHEME = os.environ.get("SVYAZ_SCHEME")
HOST_TEMPLATE = os.environ.get("SVYAZ_HOST_TEMPLATE", "")
if DEFAULT_SCHEME not in (None, "http", "https"):
    raise ValueError("SVYAZ_SCHEME must be http or https")
HTTP_TIMEOUT = float(os.environ.get("SVYAZ_HTTP_TIMEOUT", "4"))
PNG_WIDTH, PNG_HEIGHT, PNG_CONTENT_ROWS = 1056, 200, 150
PNG_CELL_WIDTH = 32
PNG_ATLAS_PATH = os.path.join(os.path.dirname(__file__), "assets", "signal-glyphs.png")
PNG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789="


def target_host(host):
    """Преобразовать IP команды в TLS-домен, если задан шаблон организаторов."""
    if not HOST_TEMPLATE:
        return host
    try:
        address = ipaddress.IPv4Address(host)
    except ipaddress.AddressValueError:
        return host
    domain = HOST_TEMPLATE.format(host=host, octet=int(address) & 255)
    labels = domain.split(".")
    if len(labels) < 2 or any(
        not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
        for label in labels
    ):
        raise ValueError("SVYAZ_HOST_TEMPLATE produced an invalid domain")
    return domain


def origin(scheme, host, port):
    authority = host if (scheme, port) in (("http", 80), ("https", 443)) else "%s:%d" % (host, port)
    return "%s://%s" % (scheme, authority)


class TransportError(Exception):
    """Не удалось связаться с хостом команды."""


class ApiError(Exception):
    """Хост ответил, но операция API завершилась ошибкой или вернула неверные данные."""

    def __init__(self, message, status_code=None):
        super().__init__(message)
        self.status_code = status_code


def new_id():
    return str(uuid.uuid4())


@lru_cache(maxsize=1)
def _flag_atlas():
    atlas = Image.open(PNG_ATLAS_PATH).convert("L")
    if atlas.size != (len(PNG_ALPHABET) * PNG_CELL_WIDTH,
                       PNG_HEIGHT - PNG_CONTENT_ROWS):
        raise ValueError("invalid glyph atlas")
    return atlas


def make_png(seed, flag=None):
    """Создать сигнальную карточку: флаг нарисован только в нижней полосе."""
    if flag is not None and not FLAG_RE.fullmatch(flag):
        raise ValueError("invalid flag")
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
    if flag is not None:
        atlas = _flag_atlas()
        positions = hashlib.sha256((seed + ":glyph").encode("ascii")).digest()
        for index, char in enumerate(flag):
            glyph_index = PNG_ALPHABET.index(char)
            glyph = atlas.crop((glyph_index * PNG_CELL_WIDTH, 0,
                                (glyph_index + 1) * PNG_CELL_WIDTH,
                                PNG_HEIGHT - PNG_CONTENT_ROWS))
            left = 16 + index * PNG_CELL_WIDTH
            top = PNG_CONTENT_ROWS + positions[index] % 5 - 2
            image.paste((44, 125, 127), (left + 1, top + 1), glyph)
            image.paste((245, 247, 235), (left, top), glyph)
    output = io.BytesIO()
    image.save(output, format="PNG", compress_level=6)
    return output.getvalue()


def read_png_flag(data, seed):
    """Распознать нарисованные глифы флага по пикселям PNG."""
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("download is not PNG")
    try:
        image = Image.open(io.BytesIO(data)).convert("RGB")
        image.load()
    except OSError as exc:
        raise ValueError("invalid PNG image") from exc
    if image.size != (PNG_WIDTH, PNG_HEIGHT):
        raise ValueError("invalid PNG dimensions")
    atlas = _flag_atlas()
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
        options = []
        for char in PNG_ALPHABET:
            glyph_index = PNG_ALPHABET.index(char)
            glyph = atlas.crop((glyph_index * PNG_CELL_WIDTH, 0,
                                (glyph_index + 1) * PNG_CELL_WIDTH,
                                PNG_HEIGHT - PNG_CONTENT_ROWS))
            template = Image.new("L", glyph.size)
            template.paste(glyph, (0, shift))
            expected = tuple(pixel > 0 for pixel in template.tobytes())
            options.append((sum(a != b for a, b in zip(observed, expected)), char))
        score, char = min(options)
        if score > 1:
            raise ValueError("unrecognized PNG glyph")
        result.append(char)
    value = "".join(result)
    if not FLAG_RE.fullmatch(value):
        raise ValueError("invalid PNG glyph sequence")
    return value


def make_wave(flag=None):
    """Создать обычный PCM или клип с произнесёнными символами флага."""
    if flag is not None and not FLAG_RE.fullmatch(flag):
        raise ValueError("invalid flag")
    if flag is None:
        samples = b"".join(
            struct.pack("<h", round(12000 * math.sin(2 * math.pi * 440 * i / SAMPLE_RATE)))
            for i in range(SAMPLE_RATE)
        )
    else:
        templates = _voice_symbols()
        samples = b"".join(templates[char] for char in flag)
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(samples)
    return output.getvalue()


@lru_cache(maxsize=1)
def _voice_symbols():
    with wave.open(VOICE_ATLAS_PATH, "rb") as atlas:
        if (atlas.getnchannels(), atlas.getsampwidth(), atlas.getframerate()) != (1, 2, SAMPLE_RATE):
            raise ValueError("invalid voice atlas format")
        pcm = atlas.readframes(atlas.getnframes())
    stride = VOICE_SAMPLES * 2
    if len(pcm) != len(SOUND_ALPHABET) * stride:
        raise ValueError("invalid voice atlas length")
    return {char: pcm[index * stride:(index + 1) * stride]
            for index, char in enumerate(SOUND_ALPHABET)}


def read_wave_flag(data):
    """Восстановить произнесённые символы из приватного клипа soundboard."""
    try:
        with wave.open(io.BytesIO(data), "rb") as wav:
            if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, SAMPLE_RATE):
                raise ValueError("wrong sound format")
            pcm = wav.readframes(wav.getnframes())
    except (EOFError, wave.Error) as exc:
        raise ValueError("invalid sound file") from exc
    if len(pcm) != 32 * VOICE_SAMPLES * 2:
        raise ValueError("wrong sound length")
    symbols = {audio: char for char, audio in _voice_symbols().items()}
    stride = VOICE_SAMPLES * 2
    try:
        flag = "".join(symbols[pcm[i * stride:(i + 1) * stride]] for i in range(32))
    except KeyError as exc:
        raise ValueError("unrecognized voice symbol") from exc
    if not FLAG_RE.fullmatch(flag):
        raise ValueError("invalid voice symbols")
    return flag


class SvyazClient:
    """Одна пользовательская сессия с методами публичного API."""

    def __init__(self, host, port=DEFAULT_PORT):
        self.host = target_host(host)
        self.port = port
        try:
            private = ipaddress.ip_address(self.host).is_private
        except ValueError:
            private = False
        scheme = DEFAULT_SCHEME or ("http" if private else "https")
        self.base = origin(scheme, self.host, port)
        self.session = requests.Session()
        self.session.trust_env = False  # Не отправляем трафик команды через прокси хоста.
        self.account = None
        self.user_id = None

    def _request(self, method, path, body=None, expected=200, headers=None, raw=False):
        url = self.base + (path if path == "/" else "/api/v1" + path)
        for attempt in range(12):
            fixed = {"Origin": self.base, "X-Svyaz-CSRF": "1", "Accept": "application/json"}
            if headers:
                fixed.update(headers)
            try:
                response = self.session.request(
                    method, url, json=body if not isinstance(body, bytes) else None,
                    data=body if isinstance(body, bytes) else None,
                    headers=fixed, timeout=HTTP_TIMEOUT, allow_redirects=False,
                )
            except requests.RequestException as exc:
                raise TransportError("connection failed: %s" % type(exc).__name__) from exc
            if response.status_code in (301, 308) and self.base.startswith("http://"):
                # Повторяем исходный метод только при переходе на тот же хост и порт.
                target = urlsplit(response.headers.get("Location", ""))
                original = urlsplit(url)
                if (target.scheme == "https" and target.hostname == self.host
                        and (target.port or 443) == self.port and target.path == original.path
                        and target.query == original.query):
                    self.base = origin("https", self.host, self.port)
                    url = self.base + (path if path == "/" else "/api/v1" + path)
                    continue
            try:
                result = response.json() if response.content and not raw else None
            except ValueError:
                result = None
            code = result.get("code") if isinstance(result, dict) else None
            if (response.status_code, code) not in ((503, "policy_busy"), (429, "authentication_busy")):
                break
            time.sleep(0.10 + attempt * 0.05)
        allowed = expected if isinstance(expected, (tuple, list)) else (expected,)
        if response.status_code not in allowed:
            raise ApiError("%s %s: HTTP %d %s" %
                           (method, path.split("?")[0], response.status_code, code or ""),
                           response.status_code)
        if raw:
            return response.content
        if response.status_code == 204:
            return None
        if not isinstance(result, dict):
            raise ApiError("%s returned non-JSON" % path)
        return result

    def frontend_html(self):
        return self._request("GET", "/", raw=True)

    def register(self):
        login = "ad-" + secrets.token_hex(10)
        password = secrets.token_urlsafe(24)
        self._request("POST", "/auth/register", {
            "login": login, "password": password, "display_name": login,
        }, 201, {"Idempotency-Key": new_id()})
        self.login({"login": login, "password": password})
        return self

    def login(self, account):
        answer = self._request("POST", "/auth/login", {
            "login": account["login"], "password": account["password"], "device": "ForcAD checker",
        })
        self.user_id = answer["user"]["id"]
        self.account = account
        return self

    def _guild_write(self, guild_id, method, path, body=None, expected=200):
        # Для изменений сервера нужен актуальный revision в заголовке If-Match.
        guild = self.get_guild(guild_id)
        return self._request(method, path, body, expected,
                             {"If-Match": '"%s"' % guild["revision"]})

    def create_guild(self, name):
        return self._request("POST", "/guilds", {"name": name}, 201,
                             {"Idempotency-Key": new_id()})

    def get_guild(self, guild_id):
        return self._request("GET", "/guilds/" + guild_id)

    def list_guilds(self):
        return self._request("GET", "/guilds")["items"]

    def list_channels(self, guild_id):
        return self._request("GET", "/guilds/%s/channels" % guild_id)["items"]

    def list_roles(self, guild_id):
        return self._request("GET", "/guilds/%s/roles" % guild_id)["items"]

    def create_invite(self, guild_id, room_id):
        return self._guild_write(guild_id, "POST", "/guilds/%s/invites" % guild_id,
                                 {"channel_id": room_id, "max_uses": 1000,
                                  "ttl_seconds": 3600}, 201)

    def list_invites(self, guild_id):
        return self._request("GET", "/guilds/%s/invites" % guild_id)["items"]

    def revoke_invite(self, guild_id, invite_id):
        return self._guild_write(guild_id, "DELETE", "/invites/%s" % invite_id)

    def accept_invite(self, code):
        return self._request("POST", "/invites/%s/accept" % code, {}, 200,
                             {"Idempotency-Key": new_id()})

    def invite_preview(self, code, expected=200):
        return self._request("GET", "/invite-preview/%s" % code, expected=expected)

    def remove_member(self, guild_id, user_id):
        return self._guild_write(guild_id, "DELETE", "/guilds/%s/members/%s" %
                                 (guild_id, user_id))

    def create_category(self, guild_id, name):
        return self._guild_write(guild_id, "POST", "/guilds/%s/categories" % guild_id,
                                 {"name": name, "position": 0}, 201)

    def list_categories(self, guild_id):
        return self._request("GET", "/guilds/%s/categories" % guild_id)["items"]

    def rename_category(self, guild_id, category_id, name):
        return self._guild_write(guild_id, "PATCH", "/categories/%s" % category_id,
                                 {"name": name})

    def delete_category(self, guild_id, category_id):
        return self._guild_write(guild_id, "DELETE", "/categories/%s" % category_id,
                                 {"detach_children": True})

    def deny_category_role(self, guild_id, category_id, role_id):
        return self._guild_write(guild_id, "PUT", "/categories/%s/overwrites/role:%s" %
                                 (category_id, role_id),
                                 {"allow": [], "deny": ["VIEW_CHANNEL"]})

    def list_overwrites(self, resource_kind, resource_id):
        return self._request("GET", "/%s/%s/overwrites" %
                             (resource_kind, resource_id))["items"]

    def set_overwrite(self, guild_id, resource_kind, resource_id, subject, deny):
        return self._guild_write(guild_id, "PUT", "/%s/%s/overwrites/%s" %
                                 (resource_kind, resource_id, subject),
                                 {"allow": [], "deny": deny})

    def delete_overwrite(self, guild_id, resource_kind, resource_id, subject):
        return self._guild_write(guild_id, "DELETE", "/%s/%s/overwrites/%s" %
                                 (resource_kind, resource_id, subject))

    def create_channel(self, guild_id, name, kind, position=1, category_id=None):
        body = {"name": name, "kind": kind, "position": position}
        if category_id is not None:
            body["category_id"] = category_id
        return self._guild_write(guild_id, "POST", "/guilds/%s/channels" % guild_id,
                                 body, 201)

    def rename_channel(self, guild_id, room_id, name):
        return self._guild_write(guild_id, "PATCH", "/channels/%s" % room_id,
                                 {"name": name})

    def reorder_channels(self, guild_id, channel_id, position):
        return self._guild_write(guild_id, "PUT", "/guilds/%s/channel-order" % guild_id,
                                 {"categories": [], "channels": [
                                     {"id": channel_id, "position": position}]})

    def delete_channel(self, guild_id, room_id):
        return self._guild_write(guild_id, "DELETE", "/channels/%s" % room_id)

    def get_channel(self, room_id, expected=200):
        return self._request("GET", "/channels/%s" % room_id, expected=expected)

    def channel_access(self, room_id, operation, audience):
        return self._request("GET", "/channels/%s/access?operation=%s&audience=%s" %
                             (room_id, operation, audience))

    def post_channel_message(self, room_id, content, upload_ids=None):
        body = {"client_id": new_id(), "content": content, "mentions": []}
        if upload_ids:
            body["upload_ids"] = upload_ids
        return self._request("POST", "/channels/%s/messages" % room_id, body, 201)

    def channel_messages(self, room_id):
        return self._request("GET", "/channels/%s/messages" % room_id)["items"]

    def search_guild_messages(self, guild_id, query):
        path = "/search?q=%s&scope=channels&guild_id=%s" % (quote(query), guild_id)
        return self._request("GET", path)["items"]

    def chat_replay(self, room_id, expected_content):
        """Проверить подписку и воспроизведение нового сообщения через realtime WebSocket."""
        cookies = "; ".join("%s=%s" % (key, value) for key, value in
                            self.session.cookies.get_dict().items())
        url = "%s://%s/api/v1/chat/ws" % (
            "wss" if self.base.startswith("https://") else "ws", urlsplit(self.base).netloc)
        try:
            ws = websocket.create_connection(url, timeout=3, origin=self.base,
                                             header=["Cookie: " + cookies])
            try:
                for _ in range(5):
                    if json.loads(ws.recv()).get("op") == "ready":
                        break
                else:
                    raise ApiError("chat WebSocket did not become ready")
                request_id = new_id()
                ws.send(json.dumps({"op": "subscribe", "schema_version": 1,
                                    "request_id": request_id, "room_kind": "channel",
                                    "room_id": room_id, "after": 0}))
                acked = replayed = False
                for _ in range(8):
                    frame = json.loads(ws.recv())
                    if frame.get("op") == "error":
                        raise ApiError("chat WebSocket rejected subscription")
                    if frame.get("op") == "ack" and frame.get("request_id") == request_id:
                        acked = True
                    events = (frame.get("data") or {}).get("events") or []
                    if any((event.get("message") or {}).get("content") == expected_content
                           for event in events):
                        replayed = True
                    if acked and replayed:
                        return
                raise ApiError("chat WebSocket did not replay message")
            finally:
                ws.close()
        except (OSError, websocket.WebSocketException) as exc:
            raise ApiError("chat WebSocket unavailable") from exc

    def upload(self, room_id, data, filename):
        scope = "room_kind=channel&room_id=" + room_id
        item = self._request("POST", "/uploads?" + scope, {
            "client_id": new_id(), "filename": filename, "size_bytes": len(data),
        }, 201)
        self._request("PUT", "/uploads/%s/content?%s" % (item["id"], scope), data)
        self._request("POST", "/uploads/%s/complete?%s" % (item["id"], scope))
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            state = self._request("GET", "/uploads/%s?%s" % (item["id"], scope))
            if state.get("state") == "READY":
                return item["id"]
            if state.get("state") in ("FAILED", "EXPIRED"):
                raise ApiError("upload failed")
            time.sleep(0.10)
        raise ApiError("upload did not become READY")

    def attachment_content(self, room_id, attachment_id):
        return self._request("GET", "/attachments/%s/content?room_kind=channel&room_id=%s" %
                             (attachment_id, room_id), raw=True)

    def get_message(self, room_id, message_id, room_kind="channel"):
        return self._request("GET", "/messages/%s?room_kind=%s&room_id=%s" %
                             (message_id, room_kind, room_id))

    def edit_message(self, room_id, message_id, revision, content, expected=200,
                     room_kind="channel"):
        return self._request("PATCH", "/messages/%s?room_kind=%s&room_id=%s" %
                             (message_id, room_kind, room_id),
                             {"revision": revision, "content": content, "mentions": []}, expected)

    def delete_message(self, room_id, message_id, revision, room_kind="channel",
                       expected=200):
        return self._request("DELETE", "/messages/%s?room_kind=%s&room_id=%s" %
                             (message_id, room_kind, room_id), {"revision": revision},
                             expected)

    def get_upload(self, room_id, upload_id):
        return self._request("GET", "/uploads/%s?room_kind=channel&room_id=%s" %
                             (upload_id, room_id))

    def create_sound(self, guild_id, room_id, name, audio):
        return self._guild_write(guild_id, "POST", "/channels/%s/sounds" % room_id,
                                 {"name": name, "emoji": "🔔",
                                  "audio_base64": base64.b64encode(audio).decode()}, 201)

    def sound_content(self, room_id, sound_id):
        return self._request("GET", "/channels/%s/sounds/%s/content" %
                             (room_id, sound_id), raw=True)

    def update_guild(self, guild_id, name):
        return self._guild_write(guild_id, "PATCH", "/guilds/%s" % guild_id,
                                 {"name": name})

    def guild_audit(self, guild_id):
        return self._request("GET", "/guilds/%s/audit" % guild_id)["items"]

    def create_role(self, guild_id, name, position=1, permissions=None):
        return self._guild_write(guild_id, "POST", "/guilds/%s/roles" % guild_id,
                                 {"name": name, "position": position,
                                  "permissions": permissions or []}, 201)

    def update_role(self, guild_id, role_id, name, permissions):
        return self._guild_write(guild_id, "PATCH", "/guilds/%s/roles/%s" %
                                 (guild_id, role_id),
                                 {"name": name, "permissions": permissions})

    def reorder_roles(self, guild_id, role_ids):
        return self._guild_write(guild_id, "PUT", "/guilds/%s/role-order" % guild_id,
                                 {"role_ids": role_ids})

    def set_member_role(self, guild_id, user_id, role_id, present):
        return self._guild_write(guild_id, "PUT" if present else "DELETE",
                                 "/guilds/%s/members/%s/roles/%s" %
                                 (guild_id, user_id, role_id))

    def list_members(self, guild_id):
        return self._request("GET", "/guilds/%s/members" % guild_id)["items"]

    def delete_role(self, guild_id, role_id):
        return self._guild_write(guild_id, "DELETE", "/guilds/%s/roles/%s" %
                                 (guild_id, role_id))

    def confirm_guild_action(self, guild_id, action, target_user_id=None):
        body = {"action": action}
        if target_user_id is not None:
            body["target_user_id"] = target_user_id
        return self._guild_write(guild_id, "POST", "/guilds/%s/confirmations" %
                                 guild_id, body, 201)

    def complete_guild_action(self, guild_id, action, confirmation):
        path = "/guilds/%s/ownership" % guild_id if action == "TRANSFER_OWNER" else "/guilds/%s" % guild_id
        method = "POST" if action == "TRANSFER_OWNER" else "DELETE"
        return self._guild_write(guild_id, method, path,
                                 {"confirmation_id": confirmation["id"],
                                  "confirmation_token": confirmation["token"]})

    def moderate(self, guild_id, user_id, kind, reason, duration=0):
        return self._guild_write(guild_id, "POST", "/guilds/%s/moderation" % guild_id,
                                 {"user_id": user_id, "kind": kind,
                                  "reason": reason, "duration_seconds": duration}, 201)

    def moderation_records(self, guild_id):
        return self._request("GET", "/guilds/%s/moderation" % guild_id)["items"]

    def revoke_sanction(self, guild_id, sanction_id, reason):
        return self._guild_write(guild_id, "POST", "/guilds/%s/moderation/%s/revoke" %
                                 (guild_id, sanction_id), {"reason": reason})

    def create_webhook(self, guild_id, room_id):
        return self._guild_write(guild_id, "POST", "/guilds/%s/webhooks" % guild_id,
                                 {"channel_id": room_id, "name": "Dispatch bot",
                                  "avatar": "sky"}, 201)

    def list_webhooks(self, guild_id):
        return self._request("GET", "/guilds/%s/webhooks" % guild_id)["items"]

    def send_webhook(self, webhook_id, secret, content, expected=201):
        return self._request("POST", "/hooks/%s" % webhook_id,
                             {"client_id": new_id(), "content": content}, expected,
                             {"Authorization": "Webhook " + secret})

    def rotate_webhook(self, guild_id, webhook_id):
        return self._guild_write(guild_id, "POST", "/guilds/%s/webhooks/%s/rotate" %
                                 (guild_id, webhook_id))

    def delete_webhook(self, guild_id, webhook_id):
        return self._guild_write(guild_id, "DELETE", "/guilds/%s/webhooks/%s" %
                                 (guild_id, webhook_id))

    def community_settings(self):
        return self._request("GET", "/community/settings")

    def set_community_settings(self, enabled):
        return self._request("PUT", "/community/settings",
                             {"browser_notifications": enabled})

    def notification_rules(self):
        return self._request("GET", "/community/rules")["items"]

    def set_notification_rule(self, scope, scope_id, mode, duration=0):
        suffix = "/" + scope_id if scope_id else ""
        return self._request("PUT", "/community/rules/%s%s" % (scope, suffix),
                             {"mode": mode, "duration_seconds": duration})

    def delete_notification_rule(self, scope, scope_id):
        suffix = "/" + scope_id if scope_id else ""
        return self._request("DELETE", "/community/rules/%s%s" % (scope, suffix),
                             expected=204)

    def inbox(self):
        return self._request("GET", "/community/inbox")["items"]

    def claim_notification(self, notification_id):
        return self._request("POST", "/community/inbox/%s/claim" % notification_id)

    def read_notification(self, notification_id):
        return self._request("PUT", "/community/inbox/%s/read" % notification_id,
                             expected=204)

    def voice_capabilities(self, room_id):
        query = "device_id=%s&call_id=%s" % (new_id(), new_id())
        access = self._request("GET", "/channels/%s/voice-access?%s" % (room_id, query))
        encoded = access["grant"].split(".", 1)[0]
        return json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))

    def voice_join(self, room_id):
        """Проверить голосовую сигнализацию Rust без установки RTP-соединения."""
        query = "device_id=%s&call_id=%s" % (new_id(), new_id())
        access = self._request("GET", "/channels/%s/voice-access?%s" % (room_id, query))
        cookies = "; ".join("%s=%s" % (key, value) for key, value in
                            self.session.cookies.get_dict().items())
        url = "%s://%s/api/v1/voice/ws" % (
            "wss" if self.base.startswith("https://") else "ws", urlsplit(self.base).netloc)
        try:
            ws = websocket.create_connection(url, timeout=3, origin=self.base,
                                             header=["Cookie: " + cookies])
            try:
                ws.send(json.dumps({"schema_version": 1, "op": "join",
                                    "request_id": new_id(), "grant": access["grant"]}))
                for _ in range(5):
                    frame = json.loads(ws.recv())
                    if frame.get("op") == "hello":
                        return
                    if frame.get("op") == "error":
                        raise ApiError("voice rejected join")
                raise ApiError("voice did not acknowledge join")
            finally:
                ws.close()
        except (OSError, websocket.WebSocketException) as exc:
            raise ApiError("voice WebSocket unavailable") from exc

    def send_friend_request(self, user_id):
        return self._request("POST", "/friends/requests", {"user_id": user_id}, 201)

    def accept_friend_request(self, request_id):
        return self._request("POST", "/friends/requests/%s/accept" % request_id)

    def create_dm(self, user_id):
        return self._request("POST", "/conversations",
                             {"kind": "DM", "name": "Dispatch", "member_ids": [user_id]},
                             201, {"Idempotency-Key": new_id()})

    def post_dm_message(self, conversation_id, content):
        return self._request("POST", "/conversations/%s/messages" % conversation_id,
                             {"client_id": new_id(), "content": content, "mentions": []}, 201)

    def dm_messages(self, conversation_id):
        return self._request("GET", "/conversations/%s/messages" % conversation_id)["items"]
