from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import ZONES
from ..exceptions import NotFound
from ..models import Zone, ZoneStatus
from ..services.audit import record


async def seed_zones(db: AsyncSession):
    for zone_id, info in ZONES.items():
        existing = await db.get(Zone, zone_id)
        if existing is None:
            db.add(Zone(
                zone=zone_id,
                name=info["name"],
                min_level=info["min_level"],
            ))
    await db.commit()


async def list_zones(db: AsyncSession) -> list[Zone]:
    q = select(Zone).order_by(Zone.zone)
    return list((await db.scalars(q)).all())


async def get_zone(db: AsyncSession, zone_id: int) -> Zone:
    zone = await db.get(Zone, zone_id)
    if zone is None:
        raise NotFound(f"Зона {zone_id} не найдена.")
    return zone


async def set_zone_status(
    db: AsyncSession,
    zone_id: int,
    status: str,
    actor_id: int,
    actor_callsign: str,
) -> Zone:
    zone = await get_zone(db, zone_id)
    old_status = zone.status
    zone.status = ZoneStatus(status)
    zone.updated_by_id = actor_id

    await record(
        db, actor_id, actor_callsign, "zone.status_change",
        "zone", str(zone_id),
        {"old_status": old_status.value, "new_status": status},
    )

    await db.commit()
    await db.refresh(zone)
    return zone


async def set_zone_capacity(
    db: AsyncSession,
    zone_id: int,
    capacity: int | None,
    actor_id: int,
    actor_callsign: str,
) -> Zone:
    zone = await get_zone(db, zone_id)
    zone.capacity = capacity
    zone.updated_by_id = actor_id

    await record(
        db, actor_id, actor_callsign, "zone.capacity_change",
        "zone", str(zone_id), {"capacity": capacity},
    )

    await db.commit()
    await db.refresh(zone)
    return zone


async def reset_zone_counts(db: AsyncSession, actor_id: int, actor_callsign: str):
    await db.execute(update(Zone).values(current_count=0))
    await record(db, actor_id, actor_callsign, "zone.reset_counts", "zone", None, {})
    await db.commit()
