import pytest


@pytest.mark.asyncio
async def test_create_new_monitor(override_session_db, registered_user):

    login_response = await override_session_db.post(
        "/api/v1/auth/login",
        data={
            "username": registered_user["email"],
            "password": registered_user["password"],
        },
    )
    login_data = login_response.json()
    token = login_data["access_token"]

    response = await override_session_db.post(
        "/api/v1/monitors/",
        json={
            "name": "Sentinel Main API",
            "target": "https://api.sentinel.com/health",
            "condition": "status_code_equals",
            "frequency": 30,
            "target_value_num": 200,
            "target_value_str": None,
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Sentinel Main API"
    assert data["target"] == "https://api.sentinel.com/health"
    assert "id" in data


@pytest.mark.asyncio
async def test_create_new_monitor_unauthorized(override_session_db):
    response = await override_session_db.post(
        "/api/v1/monitors/",
        json={
            "name": "Sentinel Main API",
            "target": "https://api.sentinel.com/health",
            "condition": "status_code_equals",
            "frequency": 30,
            "target_value_num": 200,
            "target_value_str": None,
        },
    )

    assert response.status_code == 401
    data = response.json()
    assert data["detail"] == "Not authenticated"


@pytest.mark.asyncio
async def test_delete_monitor_cross_access_forbidden(
    override_session_db, registered_user
):

    response = await override_session_db.post(
        "/api/v1/users/",
        json={
            "name": "attackername",
            "last_name": "Test",
            "username": "attacker",
            "email": "attacker@sentinel.com",
            "phonenumber": "123456784",
            "password": "attacker123",
        },
    )

    login_response = await override_session_db.post(
        "/api/v1/auth/login",
        data={
            "username": registered_user["email"],
            "password": registered_user["password"],
        },
    )
    login_data = login_response.json()
    token = login_data["access_token"]

    response = await override_session_db.post(
        "/api/v1/monitors/",
        json={
            "name": "Attacker test Api",
            "target": "https://api.attacker.com/health",
            "condition": "status_code_equals",
            "frequency": 30,
            "target_value_num": 200,
            "target_value_str": None,
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    monitor_id = response.json()["id"]

    login_attacker_response = await override_session_db.post(
        "/api/v1/auth/login",
        data={"username": "attacker@sentinel.com", "password": "attacker123"},
    )

    login_attacker_data = login_attacker_response.json()
    token_attacker = login_attacker_data["access_token"]

    attacker_response = await override_session_db.delete(
        f"/api/v1/monitors/{monitor_id}",
        headers={"Authorization": f"Bearer {token_attacker}"},
    )

    assert attacker_response.status_code == 404


@pytest.mark.asyncio
async def test_create_monitor_invalid_frequency(override_session_db, registered_user):
    login_response = await override_session_db.post(
        "/api/v1/auth/login",
        data={
            "username": registered_user["email"],
            "password": registered_user["password"],
        },
    )

    login_data = login_response.json()
    token = login_data["access_token"]

    response = await override_session_db.post(
        "/api/v1/monitors/",
        json={
            "name": "Sentinel Main API",
            "target": "https://api.sentinel.com/health",
            "condition": "status_code_equals",
            "frequency": 5,
            "target_value_num": 200,
            "target_value_str": None,
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 422
    data = response.json()
    assert "frequency" in str(data)


@pytest.mark.asyncio
async def test_get_all_monitors_success(override_session_db, registered_user):
    login_response = await override_session_db.post(
        "/api/v1/auth/login",
        data={
            "username": registered_user["email"],
            "password": registered_user["password"],
        },
    )

    login_data = login_response.json()
    token = login_data["access_token"]

    response_alfa = await override_session_db.post(
        "/api/v1/monitors/",
        json={
            "name": "Monitor Alfa",
            "target": "https://api.sentinel.com/alfa",
            "condition": "status_code_equals",
            "frequency": 30,
            "target_value_num": 200,
            "target_value_str": None,
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response_alfa.status_code == 201

    response_beta = await override_session_db.post(
        "/api/v1/monitors/",
        json={
            "name": "Monitor Beta",
            "target": "https://api.sentinel.com/beta",
            "condition": "status_code_equals",
            "frequency": 30,
            "target_value_num": 200,
            "target_value_str": None,
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response_beta.status_code == 201

    get_response = await override_session_db.get(
        "/api/v1/monitors/", headers={"Authorization": f"Bearer {token}"}
    )

    assert get_response.status_code == 200
    data = get_response.json()
    assert len(data) == 2


@pytest.mark.asyncio
async def test_update_monitor_success(override_session_db, registered_user):

    login_response = await override_session_db.post(
        "/api/v1/auth/login",
        data={
            "username": registered_user["email"],
            "password": registered_user["password"],
        },
    )

    login_data = login_response.json()
    token = login_data["access_token"]

    response = await override_session_db.post(
        "/api/v1/monitors/",
        json={
            "name": "Update Test Api",
            "target": "https://api.sentinel.com/edit",
            "condition": "status_code_equals",
            "frequency": 30,
            "target_value_num": 200,
            "target_value_str": None,
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    monitor_id = response.json()["id"]

    update_response = await override_session_db.patch(
        f"/api/v1/monitors/{monitor_id}",
        json={"name": "Monitor Modificado"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert update_response.status_code == 200
    data = update_response.json()
    assert data["name"] == "Monitor Modificado"
    assert data["frequency"] == 30
