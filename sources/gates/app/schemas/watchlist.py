from datetime import datetime

from pydantic import BaseModel, Field


class WatchlistAddReq(BaseModel):
    name: str = Field(max_length=128)
    reason: str = Field(max_length=512)


class WatchlistOut(BaseModel):
    id: int
    name: str
    reason: str
    added_by_callsign: str
    is_active: bool
    created_at: datetime


class WatchlistCheck(BaseModel):
    found: bool
    name: str
    reason: str | None = None
    added_by: str | None = None
