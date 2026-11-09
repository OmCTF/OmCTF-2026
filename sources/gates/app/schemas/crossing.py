from datetime import datetime

from pydantic import BaseModel, Field


class DocumentReq(BaseModel):
    document: str = Field(max_length=16384)


class CrossingReq(BaseModel):
    traveler: str = Field(max_length=128)
    document: str = Field(max_length=16384)
    zone: int = Field(ge=0, le=9)
    notes: str = Field(default="", max_length=1024)
    stamp: str | None = Field(default=None, pattern=r"^(admit|deny)$")
    bribe: bool = False


class VerifyOut(BaseModel):
    valid: bool
    level: int
    level_name: str


class CrossingOut(BaseModel):
    id: str
    inspector_callsign: str
    traveler_name: str
    document_level: int
    document_level_name: str
    zone: int
    zone_name: str
    granted: bool
    deny_reason: str | None
    notes: str | None
    watchlist_hit: bool
    created_at: datetime


class CrossingBrief(BaseModel):
    id: str
    traveler_name: str
    zone: int
    granted: bool
    watchlist_hit: bool
    created_at: datetime


class CrossingResult(BaseModel):
    crossing_id: str
    traveler: str
    zone: int
    zone_name: str
    granted: bool
    document_level: str
    deny_reason: str | None = None
    watchlist_hit: bool = False
    auto_incident_id: str | None = None
    dispatches: dict[str, str] | None = None
    pay: dict | None = None
