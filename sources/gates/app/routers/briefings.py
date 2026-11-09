from ..routing import RouteGroup, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies import CurrentUser, get_current_user
from ..schemas.crossing import DocumentReq
from ..services import briefings
from ..services.audit import record

router = RouteGroup(prefix="/briefings", tags=["Оперативные записки"])


class BriefingSnapshotOut(BaseModel):
    items: dict[str, str]
    count: int


class BriefingItemOut(BaseModel):
    key: int
    content: str


@router.post("/access", response_model=BriefingSnapshotOut)
async def access_briefings(
    _body: DocumentReq,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    await record(
        db, user.inspector_id, user.callsign, "briefings.access",
        "briefings", None, {},
    )
    await db.commit()

    data = await briefings.list_for_owner(db, user.inspector_id)
    return BriefingSnapshotOut(items=data, count=len(data))


@router.post("/access/{key}", response_model=BriefingItemOut)
async def access_briefing_item(
    key: int,
    _body: DocumentReq,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    item = await briefings.get_for_owner(db, key, user.inspector_id)
    if item is None:
        from ..exceptions import NotFound
        raise NotFound("Записка не найдена.")

    await record(
        db, user.inspector_id, user.callsign, "briefings.access_item",
        "briefings", str(key), {},
    )
    await db.commit()

    return BriefingItemOut(key=key, content=item.content)
