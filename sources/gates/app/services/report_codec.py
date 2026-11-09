from __future__ import annotations

import base64
import binascii
import hashlib
import json
import secrets
import time

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidTag

_MODULUS = 168313682358647251206535970977734992003
_COEFFICIENTS = (
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
_SHIFTS = (48, 15, 45, 61, 24)
_ROUNDS = 223
_SALT = bytes((
    123, 93, 220, 239, 161, 95, 111, 194, 188, 152, 233, 188,
    53, 38, 27, 253, 95, 228, 32, 140, 219, 253, 28, 160,
))
_START_EPOCH: int | None = None
_KEY: bytes | None = None
_AAD = bytes((179, 23, 56, 236, 217, 136, 31, 146, 75, 170, 209, 191, 67, 143, 9, 78))


def _derive_key(epoch: int) -> bytes:
    if epoch < 0:
        raise ValueError("invalid epoch")
    c = _COEFFICIENTS
    s = _SHIFTS
    state = (epoch * c[0] + c[1]) % _MODULUS
    for index in range(_ROUNDS):
        tap = (epoch * c[2] + index * c[3] + c[4]) % _MODULUS
        state = (state ^ ((state << s[0]) % _MODULUS) ^ tap) % _MODULUS
        state = (state + ((state >> s[1]) * c[5]) + c[6]) % _MODULUS
        state = ((state * c[7] + index * c[8]) ^ ((state << s[2]) + c[9])) % _MODULUS
        state = (state ^ (((state >> s[3]) + c[10]) * c[11])) % _MODULUS
        state = (state * c[12] + (epoch ^ c[13]) + index) % _MODULUS
        state = (state ^ ((state << s[4]) % _MODULUS)) % _MODULUS
    epoch_bytes = epoch.to_bytes((epoch.bit_length() + 7) // 8 or 1, "big")
    state_bytes = state.to_bytes((_MODULUS.bit_length() + 7) // 8, "big")
    material = bytes((len(epoch_bytes),)) + epoch_bytes + state_bytes + _SALT
    return hashlib.sha256(material).digest()


def initialize(start_epoch: int | None = None) -> int:
    global _START_EPOCH, _KEY
    _START_EPOCH = int(time.time()) if start_epoch is None else int(start_epoch)
    _KEY = _derive_key(_START_EPOCH)
    return _START_EPOCH


def start_epoch() -> int:
    if _START_EPOCH is None:
        return initialize()
    return _START_EPOCH


def _key() -> bytes:
    if _KEY is None:
        initialize()
    return _KEY


def seal_route_payload(value: dict) -> dict[str, str]:
    nonce = secrets.token_bytes(12)
    plaintext = json.dumps(
        value, ensure_ascii=False, separators=(",", ":"),
    ).encode("utf-8")
    ciphertext = AESGCM(_key()).encrypt(nonce, plaintext, _AAD)
    return {
        "nonce": base64.urlsafe_b64encode(nonce).rstrip(b"=").decode("ascii"),
        "payload": base64.urlsafe_b64encode(ciphertext).rstrip(b"=").decode("ascii"),
    }


def open_route_payload(value) -> dict:
    if (
        not isinstance(value, dict)
        or set(value) != {"nonce", "payload"}
        or not isinstance(value["nonce"], str)
        or not isinstance(value["payload"], str)
        or len(value["nonce"]) > 64
        or len(value["payload"]) > 16384
    ):
        raise ValueError("invalid descriptor")

    def decode(part: str) -> bytes:
        raw = part.encode("ascii")
        return base64.b64decode(
            raw + b"=" * (-len(raw) % 4), altchars=b"-_", validate=True,
        )

    try:
        nonce = decode(value["nonce"])
        ciphertext = decode(value["payload"])
        if len(nonce) != 12 or len(ciphertext) < 16:
            raise ValueError("invalid descriptor")
        plaintext = AESGCM(_key()).decrypt(nonce, ciphertext, _AAD)
        result = json.loads(plaintext.decode("utf-8"))
    except (UnicodeError, ValueError, binascii.Error, InvalidTag) as exc:
        raise ValueError("invalid descriptor") from exc
    if not isinstance(result, dict):
        raise ValueError("invalid descriptor")
    return result
