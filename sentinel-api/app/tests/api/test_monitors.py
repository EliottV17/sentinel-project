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

    get_response = await override_session_db.get(
        "/api/v1/monitors/", headers=headers
    )

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

    assert delete_response.status_code == 204


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