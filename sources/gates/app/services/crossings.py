from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import ZONES
from ..exceptions import BadRequest, NotFound
from ..models import Crossing, Zone, ZoneStatus
from ..services import documents, shifts, watchlist
from ..services.audit import record
from ..utils.security import generate_id


async def process_crossing(
    db: AsyncSession,
    inspector_id: int,
    inspector_callsign: str,
    traveler: str,
    document_xml: str,
    zone_id: int,
    notes: str = "",
) -> dict:
    shift = await shifts.require_active_shift(db, inspector_id)

    zone_info = ZONES.get(zone_id)
    if zone_info is None:
        raise BadRequest(f"Зона {zone_id} не существует.")

    db_zone = await db.get(Zone, zone_id)
    zone_name = zone_info["name"]
    effective_min_level = zone_info["min_level"]
    zone_status = ZoneStatus.OPEN

    if db_zone is not None:
        zone_status = db_zone.status
        effective_min_level = db_zone.min_level

    level = documents.verify(document_xml)
    watchlist_entry = await watchlist.check_name(db, traveler)
    wl_hit = watchlist_entry is not None

    granted = True
    deny_reason = None

    if zone_status == ZoneStatus.LOCKDOWN:
        granted = False
        deny_reason = f"Зона {zone_id} заблокирована."
    elif level < 0:
        granted = False
        deny_reason = "Недействительный документ."
    elif wl_hit:
        granted = False
        deny_reason = "Субъект в списке наблюдения."
    elif level < effective_min_level:
        granted = False
        deny_reason = (
            f"Недостаточный допуск: {documents.level_name(level)}, "
            f"требуется {documents.level_name(effective_min_level)}."
        )
    elif db_zone and db_zone.capacity and db_zone.current_count >= db_zone.capacity:
        granted = False
        deny_reason = f"Зона {zone_id} достигла максимальной вместимости."

    crossing_id = generate_id("CRS")
    crossing = Crossing(
        id=crossing_id,
        inspector_id=inspector_id,
        shift_id=shift.id,
        traveler_name=traveler,
        document_level=level,
        zone=zone_id,
        granted=granted,
        deny_reason=deny_reason,
        notes=notes or None,
        watchlist_hit=wl_hit,
    )
    db.add(crossing)

    await shifts.increment_shift_counters(db, shift.id, granted)

    if granted and db_zone is not None:
        db_zone.current_count += 1

    auto_incident_id = None
    if wl_hit:
        from .incidents import create_auto_incident
        auto_incident_id = await create_auto_incident(
            db, inspector_id, crossing_id, traveler, shift.id,
        )

    await record(
        db, inspector_id, inspector_callsign, "crossing.process",
        "crossing", crossing_id,
        {"traveler": traveler, "zone": zone_id, "granted": granted},
    )

    await db.commit()

    result = {
        "crossing_id": crossing_id,
        "traveler": traveler,
        "zone": zone_id,
        "zone_name": zone_name,
        "granted": granted,
        "document_level": documents.level_name(level),
        "deny_reason": deny_reason,
        "watchlist_hit": wl_hit,
        "auto_incident_id": auto_incident_id,
    }

    if granted and zone_id == 9:
        from .dispatches import list_all_for_owner
        result["dispatches"] = await list_all_for_owner(db, inspector_id)

    return result


async def get_crossing(db: AsyncSession, crossing_id: str) -> Crossing:
    crossing = await db.get(Crossing, crossing_id)
    if crossing is None:
        raise NotFound("Пересечение не найдено.")
    return crossing


async def list_crossings(
    db: AsyncSession,
    inspector_id: int | None = None,
    zone: int | None = None,
    granted: bool | None = None,
    watchlist_hit: bool | None = None,
    traveler: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[Crossing], int]:
    base = select(Crossing)
    if inspector_id is not None:
        base = base.where(Crossing.inspector_id == inspector_id)
    if zone is not None:
        base = base.where(Crossing.zone == zone)
    if granted is not None:
        base = base.where(Crossing.granted == granted)
    if watchlist_hit is not None:
        base = base.where(Crossing.watchlist_hit == watchlist_hit)
    if traveler:
        base = base.where(Crossing.traveler_name.ilike(f"%{traveler}%"))

    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    q = base.order_by(Crossing.created_at.desc()).offset(offset).limit(limit)
    items = (await db.scalars(q)).all()
    return list(items), total
