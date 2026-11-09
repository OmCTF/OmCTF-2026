from datetime import datetime

from pydantic import BaseModel, Field


class ZoneOut(BaseModel):
    zone: int
    name: str
    min_level: int
    status: str
    capacity: int | None
    current_count: int
    updated_at: datetime

    model_config = {"from_attributes": True}


class ZoneLockdownReq(BaseModel):
    status: str = Field(pattern=r"^(open|restricted|lockdown)$")


class ZoneCapacityReq(BaseModel):
    capacity: int | None = Field(ge=0, default=None)
