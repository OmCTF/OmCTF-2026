from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from .config import settings

engine_options = {"echo": False}
if not settings.database_url.startswith("sqlite"):
    engine_options["pool_size"] = 20

engine = create_async_engine(settings.database_url, **engine_options)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        yield session
