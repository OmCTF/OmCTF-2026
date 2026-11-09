from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Crossing, Incident, Inspector, Shift, WatchlistEntry, Zone


def _rate(part: int, total: int) -> float:
    return round(part / total, 3) if total else 0


async def checkpoint_stats(db: AsyncSession) -> dict:
    inspectors = await db.scalar(
        select(func.count()).where(Inspector.is_active.is_(True)),
    ) or 0
    active_shifts = await db.scalar(
        select(func.count()).where(Shift.ended_at.is_(None)),
    ) or 0
    total, granted, wl_hits = (await db.execute(
        select(
            func.count(),
            func.count().filter(Crossing.granted.is_(True)),
            func.count().filter(Crossing.watchlist_hit.is_(True)),
        ).select_from(Crossing),
    )).one()
    open_incidents = await db.scalar(
        select(func.count()).where(Incident.status.in_(["open", "investigating"])),
    ) or 0
    watchlist_size = await db.scalar(
        select(func.count()).where(WatchlistEntry.is_active.is_(True)),
    ) or 0

    data = {
        "inspectors_registered": inspectors,
        "active_shifts": active_shifts,
        "crossings_total": total,
        "crossings_granted": granted,
        "crossings_denied": total - granted,
        "denial_rate": _rate(total - granted, total),
        "watchlist_hits": wl_hits,
        "watchlist_entries": watchlist_size,
        "open_incidents": open_incidents,
    }

    return data


async def zone_stats(db: AsyncSession) -> list[dict]:
    counts = {
        zone: (total, granted)
        for zone, total, granted in (await db.execute(
            select(
                Crossing.zone,
                func.count(),
                func.count().filter(Crossing.granted.is_(True)),
            ).group_by(Crossing.zone),
        )).all()
    }
    result = []
    for z in (await db.scalars(select(Zone).order_by(Zone.zone))).all():
        total, granted = counts.get(z.zone, (0, 0))
        result.append({
            "zone": z.zone,
            "name": z.name,
            "status": z.status.value,
            "capacity": z.capacity,
            "current_count": z.current_count,
            "crossings_total": total,
            "crossings_granted": granted,
            "crossings_denied": total - granted,
        })

    return result


async def shift_leaderboard(db: AsyncSession, limit: int = 10) -> list[dict]:
    q = (
        select(Shift)
        .where(Shift.ended_at.is_not(None))
        .order_by((Shift.crossings_granted + Shift.crossings_denied).desc())
        .limit(limit)
    )
    result = []
    for s in (await db.scalars(q)).all():
        total = s.crossings_granted + s.crossings_denied
        result.append({
            "shift_id": s.id,
            "inspector_id": s.inspector_id,
            "inspector_callsign": s.inspector.callsign,
            "started_at": s.started_at.isoformat(),
            "ended_at": s.ended_at.isoformat(),
            "crossings_granted": s.crossings_granted,
            "crossings_denied": s.crossings_denied,
            "incidents_count": s.incidents_count,
            "total_crossings": total,
            "denial_rate": _rate(s.crossings_denied, total),
        })

    return result


async def inspector_performance(db: AsyncSession, inspector_id: int) -> dict:
    total_shifts, completed_shifts = (await db.execute(
        select(func.count(), func.count().filter(Shift.ended_at.is_not(None)))
        .where(Shift.inspector_id == inspector_id),
    )).one()
    total, granted, wl_hits = (await db.execute(
        select(
            func.count(),
            func.count().filter(Crossing.granted.is_(True)),
            func.count().filter(Crossing.watchlist_hit.is_(True)),
        ).where(Crossing.inspector_id == inspector_id),
    )).one()

    return {
        "inspector_id": inspector_id,
        "total_shifts": total_shifts,
        "completed_shifts": completed_shifts,
        "total_crossings": total,
        "crossings_granted": granted,
        "crossings_denied": total - granted,
        "denial_rate": _rate(total - granted, total),
        "watchlist_hits": wl_hits,
    }


async def daily_summary(db: AsyncSession) -> dict:
    start_of_day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    total, granted = (await db.execute(
        select(func.count(), func.count().filter(Crossing.granted.is_(True)))
        .where(Crossing.created_at >= start_of_day),
    )).one()
    incidents_today = await db.scalar(
        select(func.count()).where(Incident.created_at >= start_of_day),
    ) or 0
    shifts_started = await db.scalar(
        select(func.count()).where(Shift.started_at >= start_of_day),
    ) or 0

    data = {
        "date": start_of_day.isoformat(),
        "crossings_total": total,
        "crossings_granted": granted,
        "crossings_denied": total - granted,
        "denial_rate": _rate(total - granted, total),
        "incidents_created": incidents_today,
        "shifts_started": shifts_started,
    }

    return data
