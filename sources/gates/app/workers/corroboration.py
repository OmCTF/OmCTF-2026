"""Small producer facade for the report-processing queue."""

from __future__ import annotations

import asyncio

from .celery_tasks import celery_app


class CorroborationWorker:
    """Publishes registry receipts for the standalone Celery worker."""

    subject = "gate.reports.corroborate"

    async def queue_corroboration(
        self,
        incident_id: str,
        artifact_id: int,
        request_id: str,
    ) -> None:
        await asyncio.to_thread(
            celery_app.send_task,
            self.subject,
            args=[incident_id, artifact_id, request_id],
            task_id=request_id,
            queue="reports",
        )


worker = CorroborationWorker()
