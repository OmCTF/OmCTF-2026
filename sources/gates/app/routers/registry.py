import hmac

from blacksheep import Request
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..exceptions import Forbidden, NotFound
from ..models import Incident, ReportHandoff
from ..routing import Depends, Header, Query, RouteGroup
from ..schemas.reports import RegistryReportIn, ReportInboxOut
from ..services import briefings
from ..services.report_codec import seal_route_payload
from ..services.registry_auth import report_inbox_proof, report_inbox_url
from ..workers.corroboration import worker as corroboration_worker

router = RouteGroup(prefix="/registry", tags=["Межведомственная сверка"])


def build_report_route(incident_id: str) -> dict[str, str]:
    return seal_route_payload({
        "method": "POST",
        "url": report_inbox_url(incident_id),
    })


@router.get("/report-route")
async def report_route(request: Request):
    """Return the configured delivery method and inbox for a case report."""
    raw_incident_id = request.get_first_header(b"x-case-id")
    if raw_incident_id is None:
        raise NotFound("Не указан номер дела.")
    incident_id = raw_incident_id.decode("ascii", "ignore")
    return build_report_route(incident_id)


@router.post("/report-inbox", response_model=ReportInboxOut)
async def report_inbox(
    request: Request,
    incident_id: str = Query(...),
    x_registry_proof: str | None = Header(None),
    db: AsyncSession = Depends(get_db),
):
    expected_proof = report_inbox_proof(incident_id)
    supplied_proof = (x_registry_proof or "").encode("latin-1")
    if not hmac.compare_digest(supplied_proof, expected_proof.encode("ascii")):
        raise Forbidden("Источник отчёта не подтверждён.")

    incident = await db.get(Incident, incident_id)
    if incident is None:
        raise NotFound("Дело не найдено.")
    report = RegistryReportIn.model_validate(await request.json())

    artifact_id = await briefings.put(
        db,
        report.model_dump_json(),
        owner_id=incident.reporter_id,
    )
    db.add(ReportHandoff(id=report.request_id, incident_id=incident.id))
    await db.commit()
    await corroboration_worker.queue_corroboration(
        incident.id,
        artifact_id,
        report.request_id,
    )
    return ReportInboxOut(
        accepted=True,
        incident_id=incident.id,
        request_id=report.request_id,
    )
