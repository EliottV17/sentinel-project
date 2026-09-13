import pytest


@pytest.mark.asyncio
async def test_create_new_monitor(override_session_db, auth_headers, monitor_payload):
    headers = await auth_headers()

    response = await override_session_db.post(
        "/api/v1/monitors/",
        json=monitor_payload,
        headers=headers,
    )

    assert response.status_code == 201
    data = response.json()
    assert data["name"] == monitor_payload["name"]
    assert data["target"] == monitor_payload["target"]
    assert data["check_type"] == "http"
    assert "id" in data


@pytest.mark.asyncio
async def test_create_monitor_unauthorized(override_session_db, monitor_payload):
    response = await override_session_db.post(
        "/api/v1/monitors/",
        json=monitor_payload,
    )

    assert response.status_code == 401
    data = response.json()
    assert data["detail"] == "Not authenticated"


@pytest.mark.asyncio
async def test_create_monitor_invalid_frequency(
    override_session_db, auth_headers, monitor_payload
):
    headers = await auth_headers()
    payload = {**monitor_payload, "frequency": 5}

    response = await override_session_db.post(
        "/api/v1/monitors/",
        json=payload,
        headers=headers,
    )

    assert response.status_code == 422
    data = response.json()
    assert "frequency" in str(data)


@pytest.mark.asyncio
async def test_get_all_monitors_success(
    override_session_db, auth_headers, monitor_payload
):
    headers = await auth_headers()

    response_alfa = await override_session_db.post(
        "/api/v1/monitors/",
        json={**monitor_payload, "name": "Monitor Alfa"},
        headers=headers,
    )
    assert response_alfa.status_code == 201

    response_beta = await override_session_db.post(
        "/api/v1/monitors/",
        json={**monitor_payload, "name": "Monitor Beta"},
        headers=headers,
    )
    assert response_beta.status_code == 201

    get_response = await override_session_db.get("/api/v1/monitors/", headers=headers)

    assert get_response.status_code == 200
    data = get_response.json()
    assert len(data) == 2
    names = [m["name"] for m in data]
    assert "Monitor Alfa" in names
    assert "Monitor Beta" in names


@pytest.mark.asyncio
async def test_delete_monitor_success(
    override_session_db, auth_headers, monitor_payload
):
    headers = await auth_headers()

    create_response = await override_session_db.post(
        "/api/v1/monitors/",
        json=monitor_payload,
        headers=headers,
    )
    monitor_id = create_response.json()["id"]

    delete_response = await override_session_db.delete(
        f"/api/v1/monitors/{monitor_id}",
        headers=headers,
    )

    assert delete_response.status_code == 200
    assert delete_response.json()["message"] == "Monitor deleted successfully"


@pytest.mark.asyncio
async def test_delete_monitor_with_children_deletes_referencing_rows(
    override_session_db, db_engine, auth_headers, monitor_payload
):
    """Deleting a monitor must also remove its check_result and alert children
    (which hold an FK to monitor.id), not raise a ForeignKeyViolationError."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
    from sqlmodel import select

    from app.models.alert import Alert
    from app.models.check_result import CheckResult
    from app.models.monitor import Monitor

    headers = await auth_headers()

    create_response = await override_session_db.post(
        "/api/v1/monitors/",
        json=monitor_payload,
        headers=headers,
    )
    assert create_response.status_code == 201
    monitor_id = create_response.json()["id"]

    # Simulate engine-written children referencing the monitor.
    SessionMaker = async_sessionmaker(
        bind=db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with SessionMaker() as session:
        session.add(
            CheckResult(monitor_id=monitor_id, state="healthy", status_code=200)
        )
        session.add(Alert(monitor_id=monitor_id, alert_type="down", message="down"))
        await session.commit()

    delete_response = await override_session_db.delete(
        f"/api/v1/monitors/{monitor_id}",
        headers=headers,
    )
    assert delete_response.status_code == 200
    assert delete_response.json()["message"] == "Monitor deleted successfully"

    async with SessionMaker() as session:
        checks = (
            (
                await session.execute(
                    select(CheckResult).where(CheckResult.monitor_id == monitor_id)
                )
            )
            .scalars()
            .all()
        )
        alerts = (
            (await session.execute(select(Alert).where(Alert.monitor_id == monitor_id)))
            .scalars()
            .all()
        )
        monitor = (
            (await session.execute(select(Monitor).where(Monitor.id == monitor_id)))
            .scalars()
            .all()
        )

    assert checks == []
    assert alerts == []
    assert monitor == []


@pytest.mark.asyncio
async def test_delete_monitor_cross_access_forbidden(
    override_session_db, auth_headers, monitor_payload
):
    headers = await auth_headers()

    create_response = await override_session_db.post(
        "/api/v1/monitors/",
        json=monitor_payload,
        headers=headers,
    )
    monitor_id = create_response.json()["id"]

    await override_session_db.post(
        "/api/v1/users/",
        json={
            "name": "Attacker",
            "last_name": "Test",
            "username": "attacker",
            "email": "attacker@sentinel.com",
            "phonenumber": "123456784",
            "password": "attacker123",
        },
    )

    login_attacker = await override_session_db.post(
        "/api/v1/auth/login",
        data={"username": "attacker@sentinel.com", "password": "attacker123"},
    )
    attacker_token = login_attacker.json()["access_token"]
    attacker_headers = {"Authorization": f"Bearer {attacker_token}"}

    attacker_response = await override_session_db.delete(
        f"/api/v1/monitors/{monitor_id}",
        headers=attacker_headers,
    )

    assert attacker_response.status_code == 404


@pytest.mark.asyncio
async def test_update_monitor_success(
    override_session_db, auth_headers, monitor_payload
):
    headers = await auth_headers()

    create_response = await override_session_db.post(
        "/api/v1/monitors/",
        json=monitor_payload,
        headers=headers,
    )
    monitor_id = create_response.json()["id"]

    update_response = await override_session_db.patch(
        f"/api/v1/monitors/{monitor_id}",
        json={"name": "Monitor Modificado"},
        headers=headers,
    )

    assert update_response.status_code == 200
    data = update_response.json()
    assert data["name"] == "Monitor Modificado"
    assert data["frequency"] == 30
    assert data["check_type"] == "http"


@pytest.mark.asyncio
async def test_update_monitor_check_config(
    override_session_db, auth_headers, monitor_payload
):
    headers = await auth_headers()

    create_response = await override_session_db.post(
        "/api/v1/monitors/",
        json=monitor_payload,
        headers=headers,
    )
    monitor_id = create_response.json()["id"]

    update_response = await override_session_db.patch(
        f"/api/v1/monitors/{monitor_id}",
        json={"check_config": {"expected_status": 201, "method": "POST"}},
        headers=headers,
    )

    assert update_response.status_code == 200
    data = update_response.json()
    assert data["check_config"]["expected_status"] == 201
    assert data["check_config"]["method"] == "POST"


@pytest.mark.asyncio
async def test_get_monitor_history_empty(
    override_session_db, auth_headers, monitor_payload
):
    headers = await auth_headers()

    create_response = await override_session_db.post(
        "/api/v1/monitors/",
        json=monitor_payload,
        headers=headers,
    )
    monitor_id = create_response.json()["id"]

    history_response = await override_session_db.get(
        f"/api/v1/monitors/{monitor_id}/history",
        headers=headers,
    )

    assert history_response.status_code == 200
    data = history_response.json()
    assert isinstance(data, list)
    assert len(data) == 0


@pytest.mark.asyncio
async def test_get_monitor_history_unauthorized(
    override_session_db, auth_headers, monitor_payload
):
    headers = await auth_headers()

    create_response = await override_session_db.post(
        "/api/v1/monitors/",
        json=monitor_payload,
        headers=headers,
    )
    monitor_id = create_response.json()["id"]

    history_response = await override_session_db.get(
        f"/api/v1/monitors/{monitor_id}/history",
    )

    assert history_response.status_code == 401


@pytest.mark.asyncio
async def test_get_monitor_history_cross_access_forbidden(
    override_session_db, auth_headers, monitor_payload
):
    headers = await auth_headers()

    create_response = await override_session_db.post(
        "/api/v1/monitors/",
        json=monitor_payload,
        headers=headers,
    )
    monitor_id = create_response.json()["id"]

    await override_session_db.post(
        "/api/v1/users/",
        json={
            "name": "Other",
            "last_name": "User",
            "username": "otheruser",
            "email": "other@sentinel.com",
            "phonenumber": "999999999",
            "password": "otherpassword123",
        },
    )

    login_other = await override_session_db.post(
        "/api/v1/auth/login",
        data={"username": "other@sentinel.com", "password": "otherpassword123"},
    )
    other_token = login_other.json()["access_token"]
    other_headers = {"Authorization": f"Bearer {other_token}"}

    history_response = await override_session_db.get(
        f"/api/v1/monitors/{monitor_id}/history",
        headers=other_headers,
    )

    assert history_response.status_code == 403


@pytest.mark.asyncio
async def test_get_monitor_alerts_empty(
    override_session_db, auth_headers, monitor_payload
):
    headers = await auth_headers()

    create_response = await override_session_db.post(
        "/api/v1/monitors/",
        json=monitor_payload,
        headers=headers,
    )
    monitor_id = create_response.json()["id"]

    alerts_response = await override_session_db.get(
        f"/api/v1/monitors/{monitor_id}/alerts",
        headers=headers,
    )

    assert alerts_response.status_code == 200
    data = alerts_response.json()
    assert isinstance(data, list)
    assert len(data) == 0


@pytest.mark.asyncio
async def test_get_monitor_alerts_unauthorized(
    override_session_db, auth_headers, monitor_payload
):
    headers = await auth_headers()

    create_response = await override_session_db.post(
        "/api/v1/monitors/",
        json=monitor_payload,
        headers=headers,
    )
    monitor_id = create_response.json()["id"]

    alerts_response = await override_session_db.get(
        f"/api/v1/monitors/{monitor_id}/alerts",
    )

    assert alerts_response.status_code == 401
