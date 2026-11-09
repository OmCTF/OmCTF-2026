from ..routing import RouteGroup, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies import (
    CurrentUser,
    Pagination,
    get_current_user,
    get_pagination,
    require_commandant,
)
from ..exceptions import BadRequest, NotFound, Unauthorized
from ..models import InspectorRank
from ..schemas.common import PaginatedResponse
from ..schemas.inspector import (
    InspectorOut,
    LoginOut,
    LoginReq,
    ProfileOut,
    PromoteReq,
    RegisterReq,
)
from ..services import auth as auth_service
from ..services import documents, stats
from ..services.audit import record
from ..services.shifts import get_active_shift
from ..utils.security import hash_password, verify_password

router = RouteGroup(prefix="/inspectors", tags=["Инспекторы"])


class ChangePasswordReq(BaseModel):
    old_password: str
    new_password: str = Field(min_length=4, max_length=128)


class InspectorPerformanceOut(BaseModel):
    inspector_id: int
    callsign: str
    total_shifts: int
    completed_shifts: int
    total_crossings: int
    crossings_granted: int
    crossings_denied: int
    denial_rate: float
    watchlist_hits: int


async def _get_or_404(db: AsyncSession, callsign: str):
    inspector = await auth_service.get_inspector_by_callsign(db, callsign)
    if inspector is None:
        raise NotFound("Инспектор не найден.")
    return inspector


@router.post("/register", response_model=LoginOut, status_code=201)
async def register(body: RegisterReq, db: AsyncSession = Depends(get_db)):
    inspector, token = await auth_service.register(db, body.callsign, body.password)
    transit_pass = documents.issue(inspector.callsign, "guest")

    await record(
        db, inspector.id, inspector.callsign, "inspector.register",
        "inspector", str(inspector.id), {},
    )
    await db.commit()

    return LoginOut(
        callsign=inspector.callsign,
        token=token,
        rank=inspector.rank.value,
        transit_pass=transit_pass,
    )


@router.post("/login", response_model=LoginOut)
async def login(body: LoginReq, db: AsyncSession = Depends(get_db)):
    inspector, token = await auth_service.login(db, body.callsign, body.password)
    role = "commandant" if inspector.rank == InspectorRank.COMMANDANT else "guest"
    transit_pass = documents.issue(inspector.callsign, role)

    await record(
        db, inspector.id, inspector.callsign, "inspector.login",
        "inspector", str(inspector.id), {},
    )
    await db.commit()

    return LoginOut(
        callsign=inspector.callsign,
        token=token,
        rank=inspector.rank.value if isinstance(inspector.rank, InspectorRank) else inspector.rank,
        transit_pass=transit_pass,
    )


@router.post("/logout", status_code=204)
async def logout(
    x_token: str = Header(),
    db: AsyncSession = Depends(get_db),
    _user: CurrentUser = Depends(get_current_user),
):
    await auth_service.logout(db, x_token)


@router.get("/me", response_model=ProfileOut)
async def me(user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    shift = await get_active_shift(db, user.inspector_id)
    return ProfileOut(
        inspector_id=user.inspector_id,
        callsign=user.callsign,
        rank=user.rank,
        active_shift_id=shift.id if shift else None,
    )


@router.post("/change-password", status_code=204)
async def change_password(
    body: ChangePasswordReq,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    inspector = await auth_service.get_inspector_by_callsign(db, user.callsign)
    if inspector is None:
        raise Unauthorized()
    if not verify_password(body.old_password, inspector.password_hash):
        raise Unauthorized("Неверный текущий пароль.")

    inspector.password_hash = hash_password(body.new_password)

    await record(
        db, user.inspector_id, user.callsign, "inspector.change_password",
        "inspector", str(user.inspector_id), {},
    )
    await db.commit()


@router.get("", response_model=PaginatedResponse[InspectorOut])
async def list_inspectors(
    db: AsyncSession = Depends(get_db),
    pag: Pagination = Depends(get_pagination),
    _user: CurrentUser = Depends(get_current_user),
):
    items, total = await auth_service.list_inspectors(db, pag.offset, pag.limit)
    return PaginatedResponse(
        items=[InspectorOut.model_validate(i) for i in items],
        total=total,
        offset=pag.offset,
        limit=pag.limit,
    )


@router.get("/{callsign}", response_model=InspectorOut)
async def get_inspector(
    callsign: str,
    db: AsyncSession = Depends(get_db),
    _user: CurrentUser = Depends(get_current_user),
):
    return InspectorOut.model_validate(await _get_or_404(db, callsign))


@router.get("/{callsign}/performance", response_model=InspectorPerformanceOut)
async def inspector_performance(
    callsign: str,
    db: AsyncSession = Depends(get_db),
    _user: CurrentUser = Depends(get_current_user),
):
    inspector = await _get_or_404(db, callsign)
    data = await stats.inspector_performance(db, inspector.id)
    return InspectorPerformanceOut(callsign=callsign, **data)


@router.post("/{callsign}/promote", response_model=InspectorOut)
async def promote(
    callsign: str,
    body: PromoteReq,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_commandant),
):
    inspector = await auth_service.promote(db, callsign, InspectorRank(body.rank))

    await record(
        db, user.inspector_id, user.callsign, "inspector.promote",
        "inspector", str(inspector.id),
        {"target": callsign, "new_rank": body.rank},
    )
    await db.commit()

    return InspectorOut.model_validate(inspector)


@router.post("/{callsign}/deactivate", response_model=InspectorOut)
async def deactivate(
    callsign: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_commandant),
):
    inspector = await _get_or_404(db, callsign)
    if not inspector.is_active:
        raise BadRequest("Инспектор уже деактивирован.")
    if inspector.callsign == user.callsign:
        raise BadRequest("Нельзя деактивировать собственную учетную запись.")

    inspector.is_active = False
    await auth_service.drop_sessions(db, callsign)

    await record(
        db, user.inspector_id, user.callsign, "inspector.deactivate",
        "inspector", str(inspector.id), {"target": callsign},
    )
    await db.commit()
    await db.refresh(inspector)

    return InspectorOut.model_validate(inspector)


@router.post("/{callsign}/reactivate", response_model=InspectorOut)
async def reactivate(
    callsign: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_commandant),
):
    inspector = await _get_or_404(db, callsign)
    if inspector.is_active:
        raise BadRequest("Инспектор уже активен.")

    inspector.is_active = True

    await record(
        db, user.inspector_id, user.callsign, "inspector.reactivate",
        "inspector", str(inspector.id), {"target": callsign},
    )
    await db.commit()
    await db.refresh(inspector)

    return InspectorOut.model_validate(inspector)
