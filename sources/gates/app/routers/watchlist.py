from ..routing import RouteGroup, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies import (
    CurrentUser,
    Pagination,
    get_current_user,
    get_pagination,
    require_senior,
)
from ..schemas.common import PaginatedResponse
from ..schemas.watchlist import WatchlistAddReq, WatchlistCheck, WatchlistOut
from ..services import watchlist

router = RouteGroup(prefix="/watchlist", tags=["Список наблюдения"])


def _entry_out(e) -> WatchlistOut:
    return WatchlistOut(
        id=e.id,
        name=e.name,
        reason=e.reason,
        added_by_callsign=e.added_by.callsign if e.added_by else "N/A",
        is_active=e.is_active,
        created_at=e.created_at,
    )


@router.post("", response_model=WatchlistOut, status_code=201)
async def add_entry(
    body: WatchlistAddReq,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_senior),
):
    entry = await watchlist.add_entry(
        db, body.name, body.reason,
        user.inspector_id, user.callsign,
    )
    return _entry_out(entry)


@router.get("", response_model=PaginatedResponse[WatchlistOut])
async def list_entries(
    db: AsyncSession = Depends(get_db),
    _user: CurrentUser = Depends(get_current_user),
    pag: Pagination = Depends(get_pagination),
    q: str | None = Query(None, max_length=128),
):
    items, total = await watchlist.list_entries(db, q, pag.offset, pag.limit)
    return PaginatedResponse(
        items=[_entry_out(e) for e in items],
        total=total,
        offset=pag.offset,
        limit=pag.limit,
    )


@router.get("/check", response_model=WatchlistCheck)
async def check_name(
    name: str = Query(..., max_length=128),
    db: AsyncSession = Depends(get_db),
    _user: CurrentUser = Depends(get_current_user),
):
    entry = await watchlist.check_name(db, name)
    if entry is None:
        return WatchlistCheck(found=False, name=name)
    return WatchlistCheck(
        found=True,
        name=entry.name,
        reason=entry.reason,
        added_by=entry.added_by.callsign if entry.added_by else None,
    )


@router.delete("/{entry_id}", status_code=204)
async def remove_entry(
    entry_id: int,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_senior),
):
    await watchlist.remove_entry(db, entry_id, user.inspector_id, user.callsign)
