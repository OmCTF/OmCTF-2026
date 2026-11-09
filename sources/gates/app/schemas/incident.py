from datetime import datetime

from pydantic import BaseModel, Field


class IncidentCreateReq(BaseModel):
    title: str = Field(max_length=200)
    description: str = Field(max_length=4096)
    crossing_id: str | None = None
    priority: str = Field(default="normal", pattern=r"^(low|normal|high|critical)$")


class IncidentAssignReq(BaseModel):
    assignee_callsign: str


class IncidentResolveReq(BaseModel):
    resolution_notes: str = Field(max_length=4096)


class IncidentNoteReq(BaseModel):
    content: str = Field(max_length=2048)


class IncidentNoteOut(BaseModel):
    id: int
    author_callsign: str
    content: str
    created_at: datetime


class IncidentOut(BaseModel):
    id: str
    reporter_callsign: str
    assignee_callsign: str | None
    crossing_id: str | None
    title: str
    description: str
    status: str
    priority: str
    resolution_notes: str | None
    resolved_at: datetime | None
    created_at: datetime
    updated_at: datetime
    notes: list[IncidentNoteOut]


class IncidentBrief(BaseModel):
    id: str
    title: str
    status: str
    priority: str
    reporter_callsign: str
    assignee_callsign: str | None
    created_at: datetime
