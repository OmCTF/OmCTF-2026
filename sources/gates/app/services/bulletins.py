from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..exceptions import Forbidden, NotFound
from ..models import Bulletin, BulletinPriority
from ..services.audit import record
from ..utils.formatting import render_template
from ..utils.security import generate_id


async def create_bulletin(
    db: AsyncSession,
    author_id: int,
    author_callsign: str,
    title: str,
    body: str,
    priority: str = "normal",
) -> Bulletin:
    rendered = render_template(body, author_callsign, settings.checkpoint_name)

    bulletin = Bulletin(
        id=generate_id("BUL"),
        author_id=author_id,
        title=title,
        body=body,
        rendered=rendered,
        priority=BulletinPriority(priority),
    )
    db.add(bulletin)

    await record(
        db, author_id, author_callsign, "bulletin.create",
        "bulletin", bulletin.id, {"title": title},
    )

    await db.commit()
    await db.refresh(bulletin, ["author"])
    return bulletin


async def get_bulletin(db: AsyncSession, bulletin_id: str) -> Bulletin:
    bulletin = await db.get(Bulletin, bulletin_id)
    if bulletin is None:
        raise NotFound("Бюллетень не найден.")
    return bulletin


async def list_bulletins(
    db: AsyncSession, offset: int = 0, limit: int = 50,
) -> tuple[list[Bulletin], int]:
    base = select(Bulletin)
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0

    q = (
        base
        .order_by(Bulletin.is_pinned.desc(), Bulletin.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    items = (await db.scalars(q)).all()
    return list(items), total


async def pin_bulletin(
    db: AsyncSession,
    bulletin_id: str,
    pinned: bool,
    actor_id: int,
    actor_callsign: str,
) -> Bulletin:
    bulletin = await get_bulletin(db, bulletin_id)
    bulletin.is_pinned = pinned

    await record(
        db, actor_id, actor_callsign,
        "bulletin.pin" if pinned else "bulletin.unpin",
        "bulletin", bulletin_id, {},
    )

    await db.commit()
    await db.refresh(bulletin, ["author"])
    return bulletin


async def update_bulletin(
    db: AsyncSession,
    bulletin_id: str,
    actor_id: int,
    actor_callsign: str,
    title: str | None = None,
    body: str | None = None,
    priority: str | None = None,
) -> Bulletin:
    bulletin = await get_bulletin(db, bulletin_id)

    if title is not None:
        bulletin.title = title
    if body is not None:
        bulletin.body = body
        bulletin.rendered = render_template(body, actor_callsign, settings.checkpoint_name)
    if priority is not None:
        bulletin.priority = BulletinPriority(priority)

    await record(
        db, actor_id, actor_callsign, "bulletin.update",
        "bulletin", bulletin_id, {"title": bulletin.title},
    )

    await db.commit()
    await db.refresh(bulletin, ["author"])
    return bulletin


async def search_bulletins(
    db: AsyncSession, query: str, offset: int = 0, limit: int = 50,
) -> tuple[list[Bulletin], int]:
    from sqlalchemy import or_

    pattern = f"%{query.strip()}%"
    base = select(Bulletin).where(
        or_(
            Bulletin.title.ilike(pattern),
            Bulletin.body.ilike(pattern),
        ),
    )
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    q = base.order_by(Bulletin.created_at.desc()).offset(offset).limit(limit)
    items = (await db.scalars(q)).all()
    return list(items), total


async def delete_bulletin(
    db: AsyncSession, bulletin_id: str,
    actor_id: int, actor_callsign: str,
):
    bulletin = await get_bulletin(db, bulletin_id)

    await record(
        db, actor_id, actor_callsign, "bulletin.delete",
        "bulletin", bulletin_id, {"title": bulletin.title},
    )

    await db.delete(bulletin)
    await db.commit()
