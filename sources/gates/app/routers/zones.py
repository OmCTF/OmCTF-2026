from ..routing import RouteGroup, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies import CurrentUser, get_current_user, require_commandant
from ..schemas.zone import ZoneCapacityReq, ZoneLockdownReq, ZoneOut
from ..services import zones

router = RouteGroup(prefix="/zones", tags=["Зоны"])


def _zone_out(z) -> ZoneOut:
    return ZoneOut(
        zone=z.zone,
        name=z.name,
        min_level=z.min_level,
        status=z.status.value,
        capacity=z.capacity,
        current_count=z.current_count,
        updated_at=z.updated_at,
    )


@router.get("", response_model=list[ZoneOut])
async def list_zones(
    db: AsyncSession = Depends(get_db),
    _user: CurrentUser = Depends(get_current_user),
):
    return [_zone_out(z) for z in await zones.list_zones(db)]


@router.post("/reset-counts", status_code=204)
async def reset_counts(
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_commandant),
):
    await zones.reset_zone_counts(db, user.inspector_id, user.callsign)


@router.get("/{zone_id}", response_model=ZoneOut)
async def get_zone(
    zone_id: int,
    db: AsyncSession = Depends(get_db),
    _user: CurrentUser = Depends(get_current_user),
):
    return _zone_out(await zones.get_zone(db, zone_id))


@router.post("/{zone_id}/status", response_model=ZoneOut)
async def set_zone_status(
    zone_id: int,
    body: ZoneLockdownReq,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_commandant),
):
    z = await zones.set_zone_status(
        db, zone_id, body.status, user.inspector_id, user.callsign,
    )
    return _zone_out(z)


@router.post("/{zone_id}/capacity", response_model=ZoneOut)
async def set_zone_capacity(
    zone_id: int,
    body: ZoneCapacityReq,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_commandant),
):
    z = await zones.set_zone_capacity(
        db, zone_id, body.capacity, user.inspector_id, user.callsign,
    )
    return _zone_out(z)
