from ..routing import RouteGroup, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import ZONES, settings
from ..database import get_db
from ..dependencies import (
    CurrentUser,
    Pagination,
    get_current_user,
    get_pagination,
    require_senior,
)
from ..exceptions import Forbidden
from ..schemas.common import PaginatedResponse
from ..schemas.crossing import (
    CrossingBrief,
    CrossingOut,
    CrossingReq,
    CrossingResult,
    DocumentReq,
    VerifyOut,
)
from ..services import crossings, documents, quarters

router = RouteGroup(prefix="/checkpoint", tags=["КПП"])


class IssuePassReq(BaseModel):
    subject: str = Field(max_length=128)
    role: str = Field(default="guest", pattern=r"^(guest|resident|commandant)$")


class IssuePassOut(BaseModel):
    subject: str
    role: str
    transit_pass: str | None


class RulesOut(BaseModel):
    checkpoint: str
    levels: dict[int, str]


@router.get("/rules", response_model=RulesOut)
async def rules(_user: CurrentUser = Depends(get_current_user)):
    return RulesOut(checkpoint=settings.checkpoint_name, levels=documents.LEVEL_NAMES)


@router.post("/verify", response_model=VerifyOut)
async def verify_document(
    body: DocumentReq,
    _user: CurrentUser = Depends(get_current_user),
):
    level = documents.verify(body.document)
    return VerifyOut(
        valid=level >= 0,
        level=level,
        level_name=documents.level_name(level),
    )


@router.post("/crossing", response_model=CrossingResult, status_code=201)
async def process_crossing(
    body: CrossingReq,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    result = await crossings.process_crossing(
        db, user.inspector_id, user.callsign,
        body.traveler, body.document, body.zone, body.notes,
    )
    if body.stamp:
        result["pay"] = await quarters.settle_stamp(
            db, user.inspector_id, result, body.stamp, body.bribe,
        )
    return CrossingResult(**result)


@router.get("/crossings", response_model=PaginatedResponse[CrossingBrief])
async def list_crossings(
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    pag: Pagination = Depends(get_pagination),
    zone: int | None = Query(None),
    granted: bool | None = Query(None),
    watchlist_hit: bool | None = Query(None),
    traveler: str | None = Query(None, max_length=128),
    mine: bool = Query(False),
):
    items, total = await crossings.list_crossings(
        db, inspector_id=user.inspector_id if mine else None, zone=zone, granted=granted,
        watchlist_hit=watchlist_hit, traveler=traveler,
        offset=pag.offset, limit=pag.limit,
    )
    return PaginatedResponse(
        items=[
            CrossingBrief(
                id=c.id,
                traveler_name=c.traveler_name,
                zone=c.zone,
                granted=c.granted,
                watchlist_hit=c.watchlist_hit,
                created_at=c.created_at,
            )
            for c in items
        ],
        total=total,
        offset=pag.offset,
        limit=pag.limit,
    )


@router.get("/crossings/{crossing_id}", response_model=CrossingOut)
async def get_crossing(
    crossing_id: str,
    db: AsyncSession = Depends(get_db),
    _user: CurrentUser = Depends(get_current_user),
):
    c = await crossings.get_crossing(db, crossing_id)
    zone_name = ZONES.get(c.zone, {}).get("name", f"Зона {c.zone}")
    return CrossingOut(
        id=c.id,
        inspector_callsign=c.inspector.callsign if c.inspector else "N/A",
        traveler_name=c.traveler_name,
        document_level=c.document_level,
        document_level_name=documents.level_name(c.document_level),
        zone=c.zone,
        zone_name=zone_name,
        granted=c.granted,
        deny_reason=c.deny_reason,
        notes=c.notes,
        watchlist_hit=c.watchlist_hit,
        created_at=c.created_at,
    )


@router.post("/issue-pass", response_model=IssuePassOut)
async def issue_pass(
    body: IssuePassReq,
    user: CurrentUser = Depends(require_senior),
):
    if body.role == "commandant" and user.rank != "commandant":
        raise Forbidden("Только комендант может выдавать пропуск коменданта.")
    transit_pass = documents.issue(body.subject, body.role)
    return IssuePassOut(
        subject=body.subject,
        role=body.role,
        transit_pass=transit_pass,
    )
