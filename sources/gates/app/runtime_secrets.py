"""Per-process signing material, generated in Python before the app starts."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

_private_key_der: bytes | None = None
_certificate_der: bytes | None = None


def initialize_runtime_secrets() -> None:
    global _private_key_der, _certificate_der
    if _private_key_der is not None:
        return

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    identity = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "KPP7 Runtime Pass Signer"),
    ])
    certificate = (
        x509.CertificateBuilder()
        .subject_name(identity)
        .issuer_name(identity)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(private_key, hashes.SHA256())
    )

    _private_key_der = private_key.private_bytes(
        serialization.Encoding.DER,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    _certificate_der = certificate.public_bytes(serialization.Encoding.DER)


def saml_credentials() -> tuple[bytes, bytes]:
    initialize_runtime_secrets()
    assert _private_key_der is not None and _certificate_der is not None
    return _private_key_der, _certificate_der
