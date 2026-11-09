"""Authentication helpers for the service's private report receiver."""

from __future__ import annotations

import hashlib
import hmac
from urllib.parse import quote

from ..config import settings


def report_inbox_url(incident_id: str) -> str:
    return (
        f"{settings.registry_url_prefix}/registry/report-inbox"
        f"?incident_id={quote(incident_id, safe='')}"
    )


def report_inbox_proof(incident_id: str) -> str:
    message = f"registry-report-inbox:{incident_id}".encode("utf-8")
    return hmac.new(
        settings.master_key.encode("utf-8"),
        message,
        hashlib.sha256,
    ).hexdigest()
