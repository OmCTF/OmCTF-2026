"""Database-backed counters for bounded authentication flows."""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone

from sqlalchemy import case, delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import RateLimitWindow


def _key_hash(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


async def rate_limit_check(
    db: AsyncSession,
    key: str,
    max_hits: int,
    window_seconds: int,
) -> bool:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=max(1, int(window_seconds)))
    dialect = db.get_bind().dialect.name
    insert = pg_insert if dialect == "postgresql" else sqlite_insert
    statement = insert(RateLimitWindow).values(
        key_hash=_key_hash(key),
        window_started_at=now,
        attempts=1,
    )
    expired = RateLimitWindow.window_started_at <= cutoff
    statement = statement.on_conflict_do_update(
        index_elements=[RateLimitWindow.key_hash],
        set_={
            "window_started_at": case(
                (expired, now), else_=RateLimitWindow.window_started_at,
            ),
            "attempts": case(
                (expired, 1), else_=RateLimitWindow.attempts + 1,
            ),
        },
    )
    await db.execute(statement)
    count = await db.scalar(
        select(RateLimitWindow.attempts).where(
            RateLimitWindow.key_hash == _key_hash(key),
        ),
    )
    await db.commit()
    return int(count or 0) <= max_hits


async def rate_limit_clear(db: AsyncSession, key: str) -> None:
    await db.execute(
        delete(RateLimitWindow).where(
            RateLimitWindow.key_hash == _key_hash(key),
        ),
    )
    await db.commit()
