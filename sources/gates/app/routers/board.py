from ..routing import RouteGroup, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies import (
    CurrentUser,
    Pagination,
    get_current_user,
    get_pagination,
    require_senior,
)
from ..schemas.bulletin import BulletinOut, BulletinReq
from ..schemas.common import PaginatedResponse
from ..services import bulletins

router = RouteGroup(prefix="/board", tags=["Доска объявлений"])


class BulletinUpdateReq(BaseModel):
    title: str | None = Field(None, max_length=200)
    body: str | None = Field(None, max_length=4096)
    priority: str | None = Field(None, pattern=r"^(normal|urgent|critical)$")


def _bulletin_out(b) -> BulletinOut:
    return BulletinOut(
        id=b.id,
        author_callsign=b.author.callsign if b.author else "N/A",
        title=b.title,
        body=b.body,
        rendered=b.rendered,
        priority=b.priority.value,
        is_pinned=b.is_pinned,
        created_at=b.created_at,
    )


@router.post("", response_model=BulletinOut, status_code=201)
async def create_bulletin(
    body: BulletinReq,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    b = await bulletins.create_bulletin(
        db, user.inspector_id, user.callsign,
        body.title, body.body, body.priority,
    )
    return _bulletin_out(b)


@router.get("", response_model=PaginatedResponse[BulletinOut])
async def list_bulletins(
    db: AsyncSession = Depends(get_db),
    _user: CurrentUser = Depends(get_current_user),
    pag: Pagination = Depends(get_pagination),
    q: str | None = Query(None, max_length=200),
):
    if q and q.strip():
        items, total = await bulletins.search_bulletins(db, q, pag.offset, pag.limit)
    else:
        items, total = await bulletins.list_bulletins(db, pag.offset, pag.limit)
    return PaginatedResponse(
        items=[_bulletin_out(b) for b in items],
        total=total,
        offset=pag.offset,
        limit=pag.limit,
    )


@router.get("/{bulletin_id}", response_model=BulletinOut)
async def get_bulletin(
    bulletin_id: str,
    db: AsyncSession = Depends(get_db),
    _user: CurrentUser = Depends(get_current_user),
):
    return _bulletin_out(await bulletins.get_bulletin(db, bulletin_id))


@router.post("/{bulletin_id}/pin", response_model=BulletinOut)
async def pin_bulletin(
    bulletin_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_senior),
):
    b = await bulletins.pin_bulletin(db, bulletin_id, True, user.inspector_id, user.callsign)
    return _bulletin_out(b)


@router.post("/{bulletin_id}/unpin", response_model=BulletinOut)
async def unpin_bulletin(
    bulletin_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_senior),
):
    b = await bulletins.pin_bulletin(db, bulletin_id, False, user.inspector_id, user.callsign)
    return _bulletin_out(b)


@router.put("/{bulletin_id}", response_model=BulletinOut)
async def update_bulletin(
    bulletin_id: str,
    body: BulletinUpdateReq,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_senior),
):
    b = await bulletins.update_bulletin(
        db, bulletin_id, user.inspector_id, user.callsign,
        title=body.title, body=body.body, priority=body.priority,
    )
    return _bulletin_out(b)


@router.delete("/{bulletin_id}", status_code=204)
async def delete_bulletin(
    bulletin_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_senior),
):
    await bulletins.delete_bulletin(db, bulletin_id, user.inspector_id, user.callsign)
