"""Database operations for operational briefing records."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import BriefingArtifact


async def list_for_owner(db: AsyncSession, owner_id: int) -> dict[str, str]:
    items = (await db.scalars(
        select(BriefingArtifact)
        .where(BriefingArtifact.owner_id == owner_id)
        .order_by(BriefingArtifact.created_at),
    )).all()
    return {str(item.id): item.content for item in items}


async def get(db: AsyncSession, key: int) -> str | None:
    item = await db.get(BriefingArtifact, key)
    return item.content if item is not None else None


async def get_for_owner(
    db: AsyncSession, key: int, owner_id: int,
) -> BriefingArtifact | None:
    return await db.scalar(
        select(BriefingArtifact).where(
            BriefingArtifact.id == key,
            BriefingArtifact.owner_id == owner_id,
        ),
    )


async def put(db: AsyncSession, value: str, owner_id: int) -> int:
    item = BriefingArtifact(owner_id=owner_id, content=value)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item.id


async def remove(db: AsyncSession, key: int) -> bool:
    item = await db.get(BriefingArtifact, key)
    if item is None:
        return False
    await db.delete(item)
    await db.commit()
    return True
