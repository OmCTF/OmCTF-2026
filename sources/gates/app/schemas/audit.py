from datetime import datetime
from typing import Any

from pydantic import BaseModel


class AuditEntryOut(BaseModel):
    id: int
    actor_callsign: str | None
    action: str
    target_type: str | None
    target_id: str | None
    details: dict[str, Any] | None
    created_at: datetime
