from blacksheep import Request

from ..routing import RouteGroup, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies import (
    CurrentUser,
    Pagination,
    get_current_user,
    get_pagination,
    require_senior,
)
from ..exceptions import HTTPError, NotFound
from ..schemas.common import PaginatedResponse
from ..schemas.incident import (
    IncidentAssignReq,
    IncidentBrief,
    IncidentCreateReq,
    IncidentNoteOut,
    IncidentNoteReq,
    IncidentOut,
    IncidentResolveReq,
)
from ..schemas.reports import CorroborationRequest, CorroborationResult
from ..services import incidents
from ..services.report_dispatch import request_corroboration

router = RouteGroup(prefix="/incidents", tags=["Инциденты"])


class IncidentStatsOut(BaseModel):
    total: int
    open: int
    investigating: int
    resolved: int
    closed: int
    by_priority: dict[str, int]


def _note_out(n) -> IncidentNoteOut:
    return IncidentNoteOut(
        id=n.id,
        author_callsign=n.author.callsign if n.author else "N/A",
        content=n.content,
        created_at=n.created_at,
    )


def _incident_out(i) -> IncidentOut:
    return IncidentOut(
        id=i.id,
        reporter_callsign=i.reporter.callsign if i.reporter else "N/A",
        assignee_callsign=i.assignee.callsign if i.assignee else None,
        crossing_id=i.crossing_id,
        title=i.title,
        description=i.description,
        status=i.status.value,
        priority=i.priority.value,
        resolution_notes=i.resolution_notes,
        resolved_at=i.resolved_at,
        created_at=i.created_at,
        updated_at=i.updated_at,
        notes=[_note_out(n) for n in (i.notes or [])],
    )


def _brief(i) -> IncidentBrief:
    return IncidentBrief(
        id=i.id,
        title=i.title,
        status=i.status.value,
        priority=i.priority.value,
        reporter_callsign=i.reporter.callsign if i.reporter else "N/A",
        assignee_callsign=i.assignee.callsign if i.assignee else None,
        created_at=i.created_at,
    )


def _require_involved(i, user: CurrentUser):
    if i.reporter_id != user.inspector_id and i.assignee_id != user.inspector_id:
        raise NotFound("Инцидент не найден.")
    return i


@router.post("", response_model=IncidentOut, status_code=201)
async def create_incident(
    body: IncidentCreateReq,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    i = await incidents.create_incident(
        db, user.inspector_id, user.callsign,
        body.title, body.description, body.crossing_id, body.priority,
    )
    return _incident_out(i)


@router.post("/{incident_id}/request-corroboration", response_model=CorroborationResult)
async def request_incident_corroboration(
    request: Request,
    incident_id: str,
    body: CorroborationRequest,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    raw_target = request.get_first_header("x-report-route".encode("ascii"))
    if raw_target is None:
        target = "/registry/report-route"
    elif len(raw_target) > 2048:
        raise HTTPError(422, "Некорректный заголовок.")
    else:
        target = raw_target.decode("latin-1")

    incident = _require_involved(
        await incidents.get_incident(db, incident_id), user,
    )
    status = await request_corroboration(
        incident_id,
        body.summary,
        request_id=body.request_id,
        attachment=body.attachment.model_dump() if body.attachment else None,
        report_route_url=target,
    )
    return CorroborationResult(
        incident_id=incident_id,
        request_id=body.request_id,
        status=status,
        queued=200 <= status < 300,
    )


@router.get("", response_model=PaginatedResponse[IncidentBrief])
async def list_incidents(
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    pag: Pagination = Depends(get_pagination),
    status: str | None = Query(None, pattern=r"^(open|investigating|resolved|closed)$"),
    priority: str | None = Query(None, pattern=r"^(low|normal|high|critical)$"),
    assignee: str | None = Query(None),
    q: str | None = Query(None, max_length=200),
    crossing_id: str | None = Query(None, max_length=32),
):
    items, total = await incidents.list_incidents(
        db, status=status, priority=priority,
        assignee_callsign=assignee, query=q,
        involved_id=user.inspector_id,
        crossing_id=crossing_id,
        offset=pag.offset, limit=pag.limit,
    )
    return PaginatedResponse(
        items=[_brief(i) for i in items],
        total=total,
        offset=pag.offset,
        limit=pag.limit,
    )


@router.get("/stats", response_model=IncidentStatsOut)
async def incident_stats(
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return IncidentStatsOut(**await incidents.incident_stats(db, user.inspector_id))


@router.get("/{incident_id}", response_model=IncidentOut)
async def get_incident(
    incident_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    incident = _require_involved(
        await incidents.get_incident(db, incident_id), user,
    )
    return _incident_out(incident)


@router.post("/{incident_id}/assign", response_model=IncidentOut)
async def assign_incident(
    incident_id: str,
    body: IncidentAssignReq,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_senior),
):
    _require_involved(await incidents.get_incident(db, incident_id), user)
    i = await incidents.assign_incident(
        db, incident_id, body.assignee_callsign,
        user.inspector_id, user.callsign,
    )
    return _incident_out(i)


@router.post("/{incident_id}/resolve", response_model=IncidentOut)
async def resolve_incident(
    incident_id: str,
    body: IncidentResolveReq,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    _require_involved(await incidents.get_incident(db, incident_id), user)
    i = await incidents.resolve_incident(
        db, incident_id, body.resolution_notes,
        user.inspector_id, user.callsign,
    )
    return _incident_out(i)


@router.post("/{incident_id}/close", response_model=IncidentOut)
async def close_incident(
    incident_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_senior),
):
    _require_involved(await incidents.get_incident(db, incident_id), user)
    i = await incidents.close_incident(
        db, incident_id, user.inspector_id, user.callsign,
    )
    return _incident_out(i)


@router.post("/{incident_id}/notes", response_model=IncidentNoteOut, status_code=201)
async def add_note(
    incident_id: str,
    body: IncidentNoteReq,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    _require_involved(await incidents.get_incident(db, incident_id), user)
    n = await incidents.add_note(db, incident_id, user.inspector_id, body.content)
    return _note_out(n)
