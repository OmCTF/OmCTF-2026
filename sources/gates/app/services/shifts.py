from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import ZONES
from ..exceptions import BadRequest, NotFound
from ..models import Crossing, Shift


def _granted():
    return func.count().filter(Crossing.granted.is_(True))


def _denied():
    return func.count().filter(Crossing.granted.is_(False))


async def get_active_shift(db: AsyncSession, inspector_id: int) -> Shift | None:
    return await db.scalar(
        select(Shift).where(
            Shift.inspector_id == inspector_id,
            Shift.ended_at.is_(None),
        ),
    )


async def require_active_shift(db: AsyncSession, inspector_id: int) -> Shift:
    shift = await get_active_shift(db, inspector_id)
    if shift is None:
        raise BadRequest("Начните смену перед выполнением операций.")
    return shift


async def start_shift(db: AsyncSession, inspector_id: int) -> Shift:
    if await get_active_shift(db, inspector_id) is not None:
        raise BadRequest("У вас уже есть активная смена. Завершите текущую.")

    shift = Shift(inspector_id=inspector_id)
    db.add(shift)
    await db.commit()
    await db.refresh(shift, ["inspector"])
    return shift


async def end_shift(
    db: AsyncSession, inspector_id: int, handoff_notes: str = "",
) -> Shift:
    shift = await get_active_shift(db, inspector_id)
    if shift is None:
        raise BadRequest("Нет активной смены.")

    granted, denied = (await db.execute(
        select(_granted(), _denied()).where(Crossing.shift_id == shift.id),
    )).one()

    shift.ended_at = datetime.now(timezone.utc)
    shift.handoff_notes = handoff_notes or None
    shift.crossings_granted = granted
    shift.crossings_denied = denied
    await db.commit()
    await db.refresh(shift, ["inspector"])
    return shift


async def get_shift(db: AsyncSession, shift_id: int) -> Shift:
    shift = await db.get(Shift, shift_id)
    if shift is None:
        raise NotFound("Смена не найдена.")
    return shift


async def list_shifts(
    db: AsyncSession, inspector_id: int | None = None,
    offset: int = 0, limit: int = 50,
) -> tuple[list[Shift], int]:
    base = select(Shift)
    if inspector_id is not None:
        base = base.where(Shift.inspector_id == inspector_id)

    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    q = base.order_by(Shift.started_at.desc()).offset(offset).limit(limit)
    return list((await db.scalars(q)).all()), total


async def shift_report(db: AsyncSession, shift: Shift) -> dict:
    by_zone = (await db.execute(
        select(Crossing.zone, _granted(), _denied())
        .where(Crossing.shift_id == shift.id)
        .group_by(Crossing.zone)
        .order_by(Crossing.zone),
    )).all()
    denials = (await db.scalars(
        select(Crossing)
        .where(Crossing.shift_id == shift.id, Crossing.granted.is_(False))
        .order_by(Crossing.created_at.desc())
        .limit(20),
    )).all()

    total = shift.crossings_granted + shift.crossings_denied
    return {
        "shift_id": shift.id,
        "inspector_callsign": shift.inspector.callsign,
        "started_at": shift.started_at.isoformat(),
        "ended_at": shift.ended_at.isoformat() if shift.ended_at else None,
        "crossings_granted": shift.crossings_granted,
        "crossings_denied": shift.crossings_denied,
        "incidents_count": shift.incidents_count,
        "denial_rate": round(shift.crossings_denied / total, 3) if total else 0,
        "crossings_by_zone": [
            {
                "zone": zone,
                "zone_name": ZONES.get(zone, {}).get("name", f"Зона {zone}"),
                "granted": granted,
                "denied": denied,
            }
            for zone, granted, denied in by_zone
        ],
        "recent_denials": [
            {
                "crossing_id": c.id,
                "traveler": c.traveler_name,
                "zone": c.zone,
                "reason": c.deny_reason,
                "watchlist_hit": c.watchlist_hit,
            }
            for c in denials
        ],
    }


async def increment_shift_counters(
    db: AsyncSession, shift_id: int, granted: bool,
):
    shift = await db.get(Shift, shift_id)
    if shift is None:
        return
    if granted:
        shift.crossings_granted += 1
    else:
        shift.crossings_denied += 1


async def increment_shift_incidents(db: AsyncSession, shift_id: int):
    shift = await db.get(Shift, shift_id)
    if shift is None:
        return
    shift.incidents_count += 1
