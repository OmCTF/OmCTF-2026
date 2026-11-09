from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AuditLog


async def record(
    db: AsyncSession,
    actor_id: int | None,
    actor_callsign: str | None,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    details: dict | None = None,
):
    db.add(AuditLog(
        actor_id=actor_id,
        actor_callsign=actor_callsign,
        action=action,
        target_type=target_type,
        target_id=target_id,
        details=details,
    ))


async def query_log(
    db: AsyncSession,
    action: str | None = None,
    actor_callsign: str | None = None,
    target_type: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[AuditLog], int]:
    base = select(AuditLog)
    if action:
        base = base.where(AuditLog.action == action)
    if actor_callsign:
        base = base.where(AuditLog.actor_callsign == actor_callsign)
    if target_type:
        base = base.where(AuditLog.target_type == target_type)

    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    q = base.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit)
    return list((await db.scalars(q)).all()), total
