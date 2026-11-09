from ..routing import RouteGroup, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies import CurrentUser, Pagination, get_current_user, get_pagination
from ..schemas.common import PaginatedResponse
from ..schemas.quarters import (
    BuyReq,
    LedgerEntryOut,
    QuartersOut,
    StashCodeReq,
    StashItemOut,
    StashOpenReq,
    StashPutReq,
    StashTakeReq,
)
from ..services import quarters

router = RouteGroup(prefix="/quarters", tags=["Квартира"])


@router.get("", response_model=QuartersOut)
async def get_quarters(
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return QuartersOut(**await quarters.summary(db, user.inspector_id))


@router.get("/ledger", response_model=PaginatedResponse[LedgerEntryOut])
async def get_ledger(
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    pag: Pagination = Depends(get_pagination),
    shift_id: int | None = Query(None),
):
    items, total = await quarters.ledger(db, user.inspector_id, shift_id, pag.offset, pag.limit)
    return PaginatedResponse(
        items=[LedgerEntryOut.model_validate(e) for e in items],
        total=total,
        offset=pag.offset,
        limit=pag.limit,
    )


@router.post("/buy", response_model=QuartersOut)
async def buy(
    body: BuyReq,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return QuartersOut(**await quarters.buy(db, user.inspector_id, user.callsign, body.code))


@router.post("/stash/code", status_code=204)
async def set_stash_code(
    body: StashCodeReq,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    await quarters.set_stash_code(db, user.inspector_id, user.callsign, body.code, body.old_code)


@router.post("/stash/open", response_model=list[StashItemOut])
async def open_stash(
    body: StashOpenReq,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    items = await quarters.open_stash(db, user.inspector_id, body.code)
    return [StashItemOut.model_validate(i) for i in items]


@router.post("/stash/put", response_model=StashItemOut, status_code=201)
async def put_into_stash(
    body: StashPutReq,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    item = await quarters.put_into_stash(db, user.inspector_id, body.code, body.label, body.content)
    return StashItemOut.model_validate(item)


@router.post("/stash/take", status_code=204)
async def take_from_stash(
    body: StashTakeReq,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    await quarters.take_from_stash(db, user.inspector_id, body.code, body.item_id)
