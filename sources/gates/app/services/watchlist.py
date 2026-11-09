from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..exceptions import Conflict, NotFound
from ..models import WatchlistEntry
from .audit import record


def _normalize(name: str) -> str:
    return name.strip().lower()


async def add_entry(
    db: AsyncSession,
    name: str,
    reason: str,
    added_by_id: int,
    added_by_callsign: str,
) -> WatchlistEntry:
    if await check_name(db, name) is not None:
        raise Conflict(f"<<{name}>> уже в списке наблюдения.")

    entry = WatchlistEntry(
        name=name.strip(),
        name_normalized=_normalize(name),
        reason=reason,
        added_by_id=added_by_id,
    )
    db.add(entry)
    await db.flush()

    await record(
        db, added_by_id, added_by_callsign, "watchlist.add",
        "watchlist", str(entry.id), {"name": name},
    )

    await db.commit()
    await db.refresh(entry, ["added_by"])
    return entry


async def remove_entry(
    db: AsyncSession,
    entry_id: int,
    actor_id: int,
    actor_callsign: str,
) -> WatchlistEntry:
    entry = await db.get(WatchlistEntry, entry_id)
    if entry is None or not entry.is_active:
        raise NotFound("Запись не найдена в списке наблюдения.")
    entry.is_active = False
    entry.deactivated_at = datetime.now(timezone.utc)

    await record(
        db, actor_id, actor_callsign, "watchlist.remove",
        "watchlist", str(entry_id), {"name": entry.name},
    )

    await db.commit()
    return entry


async def check_name(db: AsyncSession, name: str) -> WatchlistEntry | None:
    return await db.scalar(
        select(WatchlistEntry).where(
            WatchlistEntry.name_normalized == _normalize(name),
            WatchlistEntry.is_active.is_(True),
        ),
    )


async def list_entries(
    db: AsyncSession, query: str | None = None, offset: int = 0, limit: int = 50,
) -> tuple[list[WatchlistEntry], int]:
    base = select(WatchlistEntry).where(WatchlistEntry.is_active.is_(True))
    if query and query.strip():
        base = base.where(WatchlistEntry.name_normalized.ilike(f"%{_normalize(query)}%"))

    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    q = base.order_by(WatchlistEntry.created_at.desc()).offset(offset).limit(limit)
    return list((await db.scalars(q)).all()), total
