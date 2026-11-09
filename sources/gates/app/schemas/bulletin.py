from datetime import datetime

from pydantic import BaseModel, Field


class BulletinReq(BaseModel):
    title: str = Field(max_length=200)
    body: str = Field(max_length=4096)
    priority: str = Field(default="normal", pattern=r"^(normal|urgent|critical)$")


class BulletinOut(BaseModel):
    id: str
    author_callsign: str
    title: str
    body: str
    rendered: str
    priority: str
    is_pinned: bool
    created_at: datetime
