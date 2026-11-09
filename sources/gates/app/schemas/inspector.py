from datetime import datetime

from pydantic import BaseModel, Field


class RegisterReq(BaseModel):
    callsign: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=4, max_length=128)


class LoginReq(BaseModel):
    callsign: str
    password: str


class PromoteReq(BaseModel):
    rank: str = Field(pattern=r"^(inspector|senior|commandant)$")


class InspectorOut(BaseModel):
    id: int
    callsign: str
    rank: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class LoginOut(BaseModel):
    callsign: str
    token: str
    rank: str
    transit_pass: str | None = None


class ProfileOut(BaseModel):
    inspector_id: int
    callsign: str
    rank: str
    active_shift_id: int | None = None
