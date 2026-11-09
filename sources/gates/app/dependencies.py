from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from .routing import Depends, Header, Query

from .exceptions import Forbidden, Unauthorized
from .database import get_db
from .services import auth as auth_service


@dataclass
class CurrentUser:
    inspector_id: int
    callsign: str
    rank: str


async def get_current_user(
    x_token: str | None = Header(None),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    data = await auth_service.validate_session(db, x_token) if x_token else None
    if data is None:
        raise Unauthorized()
    return CurrentUser(**data)


async def require_senior(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if user.rank not in ("senior", "commandant"):
        raise Forbidden("Требуется ранг старшего инспектора или выше.")
    return user


async def require_commandant(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if user.rank != "commandant":
        raise Forbidden("Требуется ранг коменданта.")
    return user


@dataclass
class Pagination:
    offset: int
    limit: int


def get_pagination(
    offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200),
) -> Pagination:
    return Pagination(offset=offset, limit=limit)
