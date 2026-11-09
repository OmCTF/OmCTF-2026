from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..exceptions import BadRequest, NotFound
from ..models import (
    Incident,
    IncidentNote,
    IncidentPriority,
    IncidentStatus,
    Inspector,
)
from ..services.audit import record
from ..utils.security import generate_id

_RELATIONS = ["reporter", "assignee", "notes"]


async def create_incident(
    db: AsyncSession,
    reporter_id: int,
    reporter_callsign: str,
    title: str,
    description: str,
    crossing_id: str | None = None,
    priority: str = "normal",
) -> Incident:
    incident = Incident(
        id=generate_id("INC"),
        reporter_id=reporter_id,
        title=title,
        description=description,
        crossing_id=crossing_id,
        priority=IncidentPriority(priority),
    )
    db.add(incident)

    await record(
        db, reporter_id, reporter_callsign, "incident.create",
        "incident", incident.id, {"title": title, "priority": priority},
    )

    await db.commit()
    await db.refresh(incident, _RELATIONS)
    return incident


async def create_auto_incident(
    db: AsyncSession,
    inspector_id: int,
    crossing_id: str,
    traveler_name: str,
    shift_id: int,
) -> str:
    from .shifts import increment_shift_incidents

    incident = Incident(
        id=generate_id("INC"),
        reporter_id=inspector_id,
        crossing_id=crossing_id,
        title=f"Срабатывание розыска: {traveler_name}",
        description=(
            f"Автоматически создан при обработке пересечения {crossing_id}. "
            f"Субъект «{traveler_name}» обнаружен в списке наблюдения."
        ),
        priority=IncidentPriority.HIGH,
    )
    db.add(incident)
    await increment_shift_incidents(db, shift_id)
    return incident.id


async def get_incident(db: AsyncSession, incident_id: str) -> Incident:
    incident = await db.get(Incident, incident_id)
    if incident is None:
        raise NotFound("Инцидент не найден.")
    return incident


async def list_incidents(
    db: AsyncSession,
    status: str | None = None,
    priority: str | None = None,
    assignee_callsign: str | None = None,
    query: str | None = None,
    involved_id: int | None = None,
    crossing_id: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[Incident], int]:
    base = select(Incident)
    if status:
        base = base.where(Incident.status == IncidentStatus(status))
    if priority:
        base = base.where(Incident.priority == IncidentPriority(priority))
    if assignee_callsign:
        base = base.join(Inspector, Incident.assignee_id == Inspector.id).where(
            Inspector.callsign == assignee_callsign,
        )
    if query and query.strip():
        pattern = f"%{query.strip()}%"
        base = base.where(
            or_(Incident.title.ilike(pattern), Incident.description.ilike(pattern)),
        )
    if involved_id is not None:
        base = base.where(
            or_(Incident.reporter_id == involved_id, Incident.assignee_id == involved_id),
        )
    if crossing_id:
        base = base.where(Incident.crossing_id == crossing_id)

    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    q = base.order_by(Incident.updated_at.desc()).offset(offset).limit(limit)
    return list((await db.scalars(q)).all()), total


async def assign_incident(
    db: AsyncSession,
    incident_id: str,
    assignee_callsign: str,
    actor_id: int,
    actor_callsign: str,
) -> Incident:
    incident = await get_incident(db, incident_id)
    if incident.status in (IncidentStatus.RESOLVED, IncidentStatus.CLOSED):
        raise BadRequest("Нельзя назначить закрытый инцидент.")

    assignee = await db.scalar(
        select(Inspector).where(Inspector.callsign == assignee_callsign),
    )
    if assignee is None:
        raise NotFound("Инспектор-исполнитель не найден.")

    incident.assignee_id = assignee.id
    if incident.status == IncidentStatus.OPEN:
        incident.status = IncidentStatus.INVESTIGATING

    await record(
        db, actor_id, actor_callsign, "incident.assign",
        "incident", incident_id, {"assignee": assignee_callsign},
    )

    await db.commit()
    await db.refresh(incident, _RELATIONS)
    return incident


async def resolve_incident(
    db: AsyncSession,
    incident_id: str,
    resolution_notes: str,
    actor_id: int,
    actor_callsign: str,
) -> Incident:
    incident = await get_incident(db, incident_id)
    if incident.status == IncidentStatus.CLOSED:
        raise BadRequest("Инцидент уже закрыт.")

    incident.status = IncidentStatus.RESOLVED
    incident.resolution_notes = resolution_notes
    incident.resolved_at = datetime.now(timezone.utc)

    await record(
        db, actor_id, actor_callsign, "incident.resolve",
        "incident", incident_id, {},
    )

    await db.commit()
    await db.refresh(incident, _RELATIONS)
    return incident


async def close_incident(
    db: AsyncSession,
    incident_id: str,
    actor_id: int,
    actor_callsign: str,
) -> Incident:
    incident = await get_incident(db, incident_id)
    if incident.status != IncidentStatus.RESOLVED:
        raise BadRequest("Только разрешённые инциденты можно закрыть.")

    incident.status = IncidentStatus.CLOSED

    await record(
        db, actor_id, actor_callsign, "incident.close",
        "incident", incident_id, {},
    )

    await db.commit()
    await db.refresh(incident, _RELATIONS)
    return incident


async def add_note(
    db: AsyncSession,
    incident_id: str,
    author_id: int,
    content: str,
) -> IncidentNote:
    incident = await get_incident(db, incident_id)
    if incident.status == IncidentStatus.CLOSED:
        raise BadRequest("Нельзя добавить заметку к закрытому инциденту.")

    note = IncidentNote(
        incident_id=incident_id,
        author_id=author_id,
        content=content,
    )
    db.add(note)
    await db.commit()
    await db.refresh(note, ["author"])
    return note


async def incident_stats(db: AsyncSession, involved_id: int) -> dict:
    involved = or_(
        Incident.reporter_id == involved_id,
        Incident.assignee_id == involved_id,
    )
    by_status = dict((await db.execute(
        select(Incident.status, func.count()).where(involved).group_by(Incident.status),
    )).all())
    by_priority = dict((await db.execute(
        select(Incident.priority, func.count()).where(involved).group_by(Incident.priority),
    )).all())
    return {
        "total": sum(by_status.values()),
        **{s.value: by_status.get(s, 0) for s in IncidentStatus},
        "by_priority": {p.value: by_priority.get(p, 0) for p in IncidentPriority},
    }
