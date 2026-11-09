from datetime import datetime

from pydantic import BaseModel, Field


class DispatchReq(BaseModel):
    content: str = Field(max_length=4096)


class DispatchOut(BaseModel):
    id: int
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}
