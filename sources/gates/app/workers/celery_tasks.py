"""Celery entry points for asynchronous registry reconciliation."""

from __future__ import annotations

import asyncio
import json
import logging

from celery import Celery
from celery.signals import worker_process_shutdown

from ..config import settings
from ..database import async_session_factory, engine
from ..models import Incident, IncidentNote, ReportHandoff
from ..services.briefings import get as get_briefing

logger = logging.getLogger(__name__)

celery_app = Celery(
    "gateguardian",
    broker=settings.redis_url,
)
celery_app.conf.update(
    task_default_queue="reports",
    task_default_exchange="reports",
    task_default_routing_key="reports",
    task_routes={
        "gate.reports.corroborate": {"queue": "reports"},
    },
    task_create_missing_queues=False,
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    task_ignore_result=True,
    worker_prefetch_multiplier=1,
    worker_enable_remote_control=False,
    broker_connection_retry_on_startup=True,
    broker_transport_options={
        "global_keyprefix": "kpp7:tasks:",
        "visibility_timeout": 3600,
        "socket_connect_timeout": 2,
        "socket_timeout": 2,
    },
)

# Celery tasks are synchronous entry points, while the service's database
# access is asyncio-based. Keep one event loop per worker process so
# their connection pools are not moved between short-lived asyncio.run loops.
_task_loop: asyncio.AbstractEventLoop | None = None


def _run_in_task_loop(coro):
    global _task_loop
    if _task_loop is None:
        _task_loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_task_loop)
    return _task_loop.run_until_complete(coro)


async def _append_corroboration_note(
    incident_id: str,
    artifact_id: int,
    request_id: str,
) -> bool:
    if (
        len(request_id) != 24
        or any(ch not in "0123456789abcdef" for ch in request_id)
        or len(incident_id) > 32
        or artifact_id < 1
    ):
        return False


    async with async_session_factory() as db:
        handoff = await db.get(ReportHandoff, request_id)
        if handoff is None or handoff.incident_id != incident_id:
            return False
        await db.delete(handoff)
        await db.commit()

        content = await get_briefing(db, artifact_id)
        if content is None:
            return False

        try:
            report = json.loads(content)
        except (TypeError, ValueError):
            report = {"summary": content}
        if not isinstance(report, dict):
            report = {"summary": content}

        report_summary = str(report.get("summary", ""))[:2048]
        note = f"Сверка межведомственного источника: {report_summary}"
        attachment = report.get("attachment")
        if isinstance(attachment, dict):
            filename = str(attachment.get("filename", ""))[:128]
            if filename:
                note += f" Приложен документ: {filename}."

        incident = await db.get(Incident, incident_id)
        if incident is None:
            return False
        db.add(IncidentNote(
            incident_id=incident.id,
            author_id=incident.reporter_id,
            content=note[:4096],
        ))
        await db.commit()

    logger.info("attached corroboration report %s to %s", request_id, incident_id)
    return True


@celery_app.task(name="gate.reports.corroborate")
def corroborate(incident_id: str, artifact_id: int, request_id: str) -> bool:
    return _run_in_task_loop(
        _append_corroboration_note(
            str(incident_id),
            int(artifact_id),
            str(request_id),
        ),
    )


def worker_main() -> None:
    celery_app.worker_main([
        "worker",
        "--loglevel=INFO",
        "--concurrency=1",
        "--prefetch-multiplier=1",
        "--queues=reports",
        "--without-gossip",
        "--without-mingle",
        "--without-heartbeat",
    ])


@worker_process_shutdown.connect
def _dispose_worker_loop(**_kwargs) -> None:
    global _task_loop
    if _task_loop is not None:
        asyncio.set_event_loop(_task_loop)
        _task_loop.run_until_complete(engine.dispose())
        _task_loop.close()
        _task_loop = None
