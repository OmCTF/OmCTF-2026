from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Dispatch


async def create_dispatch(db: AsyncSession, owner_id: int, content: str):
    item = Dispatch(owner_id=owner_id, content=content)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def list_all_for_owner(db: AsyncSession, owner_id: int) -> dict[str, str]:
    q = select(Dispatch).where(Dispatch.owner_id == owner_id).order_by(Dispatch.created_at.desc())
    items = (await db.scalars(q)).all()
    return {str(d.id): d.content for d in items}


async def list_dispatches(
    db: AsyncSession, offset: int = 0, limit: int = 50,
    owner_id: int | None = None,
) -> list[Dispatch]:
    q = select(Dispatch).order_by(Dispatch.created_at.desc()).offset(offset).limit(limit)
    if owner_id is not None:
        q = q.where(Dispatch.owner_id == owner_id)
    return list((await db.scalars(q)).all())


async def get_for_owner(
    db: AsyncSession, dispatch_id: int, owner_id: int,
) -> Dispatch | None:
    return await db.scalar(
        select(Dispatch).where(
            Dispatch.id == dispatch_id,
            Dispatch.owner_id == owner_id,
        ),
    )
