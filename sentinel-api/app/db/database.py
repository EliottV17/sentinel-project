from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

engine = create_async_engine(
    settings.DATABASE_URL, echo=False, pool_size=20, max_overflow=40, pool_pre_ping=True
)

async_session_factory = async_sessionmaker(
    bind=engine, expire_on_commit=False, class_=AsyncSession
)


async def get_session():
    async with async_session_factory() as session:
        yield session
