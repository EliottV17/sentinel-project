import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlmodel import SQLModel

from app.db.database import get_session as get_db
from app.main import app
from app.models.check_result import CheckResult  # noqa: F401
from app.models.alert import Alert  # noqa: F401

transport = ASGITransport(app=app)

DATABASE_URL = "postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/sentinel_tests_db"


@pytest.fixture(scope="function")
async def db_engine():
    local_engine = create_async_engine(DATABASE_URL, echo=False)

    async with local_engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    yield local_engine
    async with local_engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.drop_all)
    await local_engine.dispose()


@pytest.fixture
async def override_session_db(db_engine):

    TestingSessionLocal = async_sessionmaker(
        bind=db_engine, class_=AsyncSession, expire_on_commit=False
    )

    async def get_test_session():
        async with TestingSessionLocal() as test_session:
            yield test_session

    app.dependency_overrides[get_db] = get_test_session

    async with AsyncClient(base_url="https://test", transport=transport) as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
async def registered_user(override_session_db):
    payload = {
        "name": "Test",
        "last_name": "User",
        "username": "testuser",
        "email": "test@sentinel.com",
        "phonenumber": "123456789",
        "password": "superpassword123",
    }
    await override_session_db.post("/api/v1/users/", json=payload)
    return payload


@pytest.fixture
def auth_headers(override_session_db, registered_user):
    """Fixture que devuelve headers con token JWT para requests autenticados."""

    async def _get_token():
        login_response = await override_session_db.post(
            "/api/v1/auth/login",
            data={
                "username": registered_user["email"],
                "password": registered_user["password"],
            },
        )
        login_data = login_response.json()
        return {"Authorization": f"Bearer {login_data['access_token']}"}

    return _get_token


@pytest.fixture
def monitor_payload():
    """Fixture con el payload base para crear un monitor HTTP."""
    return {
        "name": "Sentinel Main API",
        "target": "https://api.sentinel.com/health",
        "check_type": "http",
        "check_config": {"expected_status": 200, "method": "GET", "timeout": 10},
        "frequency": 30,
    }