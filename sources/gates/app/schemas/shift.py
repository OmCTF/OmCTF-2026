from datetime import datetime

from pydantic import BaseModel, Field


class ShiftEndReq(BaseModel):
    handoff_notes: str = Field(default="", max_length=2048)


class ShiftOut(BaseModel):
    id: int
    inspector_callsign: str
    started_at: datetime
    ended_at: datetime | None
    handoff_notes: str | None
    crossings_granted: int
    crossings_denied: int
    incidents_count: int

    model_config = {"from_attributes": True}
