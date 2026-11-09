import asyncio

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..routing import Depends, Query, RouteGroup
from ..schemas.stats import CheckpointStatsOut, ZoneStatsOut
from ..services import stats

router = RouteGroup(prefix="/internal", tags=["Служебное API"])


class HealthOut(BaseModel):
    status: str
    checkpoint: str
    version: str


class ReadinessOut(BaseModel):
    status: str
    database: str
    redis: str
    queue: str
    checkpoint: str


@router.get("/health", response_model=HealthOut)
async def health():
    return HealthOut(
        status="operational",
        checkpoint=settings.checkpoint_name,
        version=settings.version,
    )


@router.get("/readiness", response_model=ReadinessOut)
async def readiness(db: AsyncSession = Depends(get_db)):
    db_status = "ok"
    redis_status = "ok"

    try:
        from sqlalchemy import text
        await db.execute(text("SELECT 1"))
    except Exception:
        db_status = "error"

    connection = None
    try:
        from ..workers.celery_tasks import celery_app
        connection = celery_app.connection_for_write()
        await asyncio.to_thread(connection.ensure_connection, max_retries=0)
    except Exception:
        redis_status = "error"
    finally:
        if connection is not None:
            connection.release()

    queue_status = "ok" if redis_status == "ok" else "error"
    overall = (
        "ready"
        if db_status == "ok" and redis_status == "ok" and queue_status == "ok"
        else "degraded"
    )
    return ReadinessOut(
        status=overall,
        database=db_status,
        redis=redis_status,
        queue=queue_status,
        checkpoint=settings.checkpoint_name,
    )


@router.get("/stats", response_model=CheckpointStatsOut)
async def get_stats(db: AsyncSession = Depends(get_db)):
    data = await stats.checkpoint_stats(db)
    return CheckpointStatsOut(**data)


@router.get("/stats/zones", response_model=list[ZoneStatsOut])
async def get_zone_stats(db: AsyncSession = Depends(get_db)):
    data = await stats.zone_stats(db)
    return [ZoneStatsOut(**z) for z in data]


@router.get("/stats/daily")
async def get_daily_stats(db: AsyncSession = Depends(get_db)):
    return await stats.daily_summary(db)


@router.get("/stats/leaderboard")
async def get_leaderboard(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(10, ge=1, le=50),
):
    return await stats.shift_leaderboard(db, limit)
