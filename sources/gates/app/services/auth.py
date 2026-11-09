import hashlib
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..exceptions import Conflict, NotFound, RateLimited, Unauthorized
from ..models import AuthSession, Inspector, InspectorRank
from ..utils.security import generate_token, hash_password, verify_password
from .rate_limits import rate_limit_check


async def register(
    db: AsyncSession, callsign: str, password: str,
) -> tuple[Inspector, str]:
    existing = await db.scalar(
        select(Inspector).where(Inspector.callsign == callsign),
    )
    if existing is not None:
        raise Conflict("Позывной уже занят.")

    inspector = Inspector(
        callsign=callsign,
        password_hash=hash_password(password),
        rank=InspectorRank.INSPECTOR,
    )
    db.add(inspector)
    await db.flush()

    token = await _create_session(db, inspector)
    await db.commit()
    return inspector, token


async def login(db: AsyncSession, callsign: str, password: str) -> tuple[Inspector, str]:
    ok = await rate_limit_check(
        db,
        f"ratelimit:login:{callsign}",
        settings.rate_limit_max,
        settings.rate_limit_window,
    )
    if not ok:
        raise RateLimited(settings.rate_limit_window)

    inspector = await db.scalar(
        select(Inspector).where(
            Inspector.callsign == callsign, Inspector.is_active.is_(True),
        ),
    )
    if inspector is None or not verify_password(password, inspector.password_hash):
        raise Unauthorized("Неверные учетные данные.")

    token = await _create_session(db, inspector)
    return inspector, token


async def logout(db: AsyncSession, token: str):
    await db.execute(
        delete(AuthSession).where(AuthSession.token_hash == _token_hash(token)),
    )
    await db.commit()


async def validate_session(db: AsyncSession, token: str) -> dict | None:
    auth_session = await db.get(AuthSession, _token_hash(token))
    if auth_session is None:
        return None

    expires_at = auth_session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        await db.delete(auth_session)
        await db.commit()
        return None

    inspector = await db.get(Inspector, auth_session.inspector_id)
    if inspector is None or not inspector.is_active:
        return None
    rank = inspector.rank.value if isinstance(inspector.rank, InspectorRank) else inspector.rank
    return {
        "inspector_id": inspector.id,
        "callsign": inspector.callsign,
        "rank": rank,
    }


async def promote(db: AsyncSession, callsign: str, rank: InspectorRank) -> Inspector:
    inspector = await get_inspector_by_callsign(db, callsign)
    if inspector is None:
        raise NotFound("Инспектор не найден.")
    inspector.rank = rank
    await db.commit()
    await db.refresh(inspector)
    return inspector


async def list_inspectors(
    db: AsyncSession, offset: int = 0, limit: int = 50,
) -> tuple[list[Inspector], int]:
    base = select(Inspector).where(Inspector.is_active.is_(True))
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    q = base.order_by(Inspector.created_at.desc()).offset(offset).limit(limit)
    return list((await db.scalars(q)).all()), total


async def get_inspector_by_callsign(db: AsyncSession, callsign: str) -> Inspector | None:
    return await db.scalar(
        select(Inspector).where(Inspector.callsign == callsign),
    )


async def drop_sessions(db: AsyncSession, callsign: str):
    inspector = await get_inspector_by_callsign(db, callsign)
    if inspector is not None:
        await db.execute(
            delete(AuthSession).where(AuthSession.inspector_id == inspector.id),
        )


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def _create_session(db: AsyncSession, inspector: Inspector) -> str:
    token = generate_token()
    await db.merge(AuthSession(
        token_hash=_token_hash(token),
        inspector_id=inspector.id,
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=settings.session_ttl),
    ))
    return token
