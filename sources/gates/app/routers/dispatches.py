from ..routing import RouteGroup, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies import CurrentUser, Pagination, get_current_user, get_pagination
from ..models import Dispatch
from ..schemas.common import PaginatedResponse
from ..schemas.crossing import DocumentReq
from ..schemas.dispatch import DispatchOut, DispatchReq
from ..services import dispatches, documents
from ..services.audit import record

router = RouteGroup(prefix="/dispatches", tags=["Депеши"])


@router.post("", response_model=DispatchOut, status_code=201)
async def create_dispatch(
    body: DispatchReq,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    item = await dispatches.create_dispatch(
        db, user.inspector_id, body.content,
    )
    return DispatchOut(id=item.id, content=item.content, created_at=item.created_at)


@router.post("/access", response_model=list[DispatchOut])
async def access_dispatches(
    body: DocumentReq,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    level = documents.verify(body.document)
    if level < documents.ticketlib.LEVEL_GUEST:
        from ..exceptions import Forbidden
        raise Forbidden("Недействительный пропуск.")

    owner_id = None
    if level < documents.ticketlib.LEVEL_COMMANDANT:
        if documents.subject(body.document) != user.callsign:
            from ..exceptions import Forbidden
            raise Forbidden("Пропуск не принадлежит текущему инспектору.")
        owner_id = user.inspector_id

    await record(
        db, user.inspector_id, user.callsign, "dispatches.access",
        "dispatches", None, {},
    )
    await db.commit()

    items = await dispatches.list_dispatches(db, owner_id=owner_id)
    return [
        DispatchOut(id=d.id, content=d.content, created_at=d.created_at)
        for d in items
    ]


@router.get("", response_model=PaginatedResponse[DispatchOut])
async def list_dispatches_endpoint(
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    pag: Pagination = Depends(get_pagination),
):
    query = select(Dispatch).where(Dispatch.owner_id == user.inspector_id)
    total = await db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = await dispatches.list_dispatches(
        db, pag.offset, pag.limit, owner_id=user.inspector_id,
    )
    return PaginatedResponse(
        items=[
            DispatchOut(id=d.id, content=d.content, created_at=d.created_at)
            for d in items
        ],
        total=total,
        offset=pag.offset,
        limit=pag.limit,
    )


@router.get("/{dispatch_id}", response_model=DispatchOut)
async def get_dispatch(
    dispatch_id: int,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    d = await dispatches.get_for_owner(db, dispatch_id, user.inspector_id)
    if d is None:
        from ..exceptions import NotFound
        raise NotFound("Депеша не найдена.")

    return DispatchOut(id=d.id, content=d.content, created_at=d.created_at)
