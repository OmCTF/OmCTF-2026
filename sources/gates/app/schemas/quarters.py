from datetime import datetime

from pydantic import BaseModel, Field

STASH_CODE = r"^\d{4,8}$"


class BuyReq(BaseModel):
    code: str = Field(max_length=32)


class StashCodeReq(BaseModel):
    code: str = Field(pattern=STASH_CODE)
    old_code: str | None = Field(default=None, pattern=STASH_CODE)


class StashOpenReq(BaseModel):
    code: str = Field(pattern=STASH_CODE)


class StashPutReq(StashOpenReq):
    label: str = Field(min_length=1, max_length=64)
    content: str = Field(min_length=1, max_length=1024)


class StashTakeReq(StashOpenReq):
    item_id: str = Field(max_length=32)


class StashItemOut(BaseModel):
    id: str
    label: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class LedgerEntryOut(BaseModel):
    id: int
    amount: int
    kind: str
    memo: str
    shift_id: int | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CatalogItemOut(BaseModel):
    code: str
    name: str
    price: int
    description: str
    owned: bool


class MedalOut(BaseModel):
    code: str
    name: str
    description: str
    earned: bool


class BountyOut(BaseModel):
    zone: int
    zone_name: str
    bonus: int


class StashStateOut(BaseModel):
    owned: bool
    locked: bool
    items: int


class QuartersOut(BaseModel):
    balance: int
    streak: int
    best_streak: int
    stamps_ok: int
    stamps_miss: int
    suspicion: int
    rates: dict[str, int]
    bounty: BountyOut | None
    catalog: list[CatalogItemOut]
    medals: list[MedalOut]
    stash: StashStateOut
