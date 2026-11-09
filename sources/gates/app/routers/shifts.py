from ..routing import RouteGroup, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies import CurrentUser, Pagination, get_current_user, get_pagination
from ..schemas.common import PaginatedResponse
from ..schemas.shift import ShiftEndReq, ShiftOut
from ..services import quarters, shifts
from ..services.audit import record
from ..services.auth import get_inspector_by_callsign

router = RouteGroup(prefix="/shifts", tags=["Смены"])


class ShiftReportOut(BaseModel):
    shift_id: int
    inspector_callsign: str
    started_at: str
    ended_at: str | None
    crossings_granted: int
    crossings_denied: int
    incidents_count: int
    denial_rate: float
    crossings_by_zone: list[dict]
    recent_denials: list[dict]


def _shift_out(s) -> ShiftOut:
    return ShiftOut(
        id=s.id,
        inspector_callsign=s.inspector.callsign if s.inspector else "N/A",
        started_at=s.started_at,
        ended_at=s.ended_at,
        handoff_notes=s.handoff_notes,
        crossings_granted=s.crossings_granted,
        crossings_denied=s.crossings_denied,
        incidents_count=s.incidents_count,
    )


@router.post("/start", response_model=ShiftOut, status_code=201)
async def start_shift(
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    s = await shifts.start_shift(db, user.inspector_id)
    await record(db, user.inspector_id, user.callsign, "shift.start", "shift", str(s.id), {})
    await db.commit()
    return _shift_out(s)


@router.post("/end", response_model=ShiftOut)
async def end_shift(
    body: ShiftEndReq,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    s = await shifts.end_shift(db, user.inspector_id, body.handoff_notes)
    await quarters.settle_shift(db, user.inspector_id, s)
    await record(
        db, user.inspector_id, user.callsign, "shift.end", "shift", str(s.id),
        {
            "crossings_granted": s.crossings_granted,
            "crossings_denied": s.crossings_denied,
            "incidents": s.incidents_count,
        },
    )
    await db.commit()
    return _shift_out(s)


@router.get("/current", response_model=ShiftOut | None)
async def current_shift(
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    s = await shifts.get_active_shift(db, user.inspector_id)
    return _shift_out(s) if s else None


@router.get("/report/{shift_id}", response_model=ShiftReportOut)
async def shift_report(
    shift_id: int,
    db: AsyncSession = Depends(get_db),
    _user: CurrentUser = Depends(get_current_user),
):
    s = await shifts.get_shift(db, shift_id)
    return ShiftReportOut(**await shifts.shift_report(db, s))


@router.get("", response_model=PaginatedResponse[ShiftOut])
async def list_shifts(
    db: AsyncSession = Depends(get_db),
    _user: CurrentUser = Depends(get_current_user),
    pag: Pagination = Depends(get_pagination),
    inspector: str | None = Query(None),
):
    inspector_id = None
    if inspector:
        found = await get_inspector_by_callsign(db, inspector)
        if found is None:
            return PaginatedResponse(items=[], total=0, offset=pag.offset, limit=pag.limit)
        inspector_id = found.id

    items, total = await shifts.list_shifts(
        db, inspector_id=inspector_id, offset=pag.offset, limit=pag.limit,
    )
    return PaginatedResponse(
        items=[_shift_out(s) for s in items],
        total=total,
        offset=pag.offset,
        limit=pag.limit,
    )
