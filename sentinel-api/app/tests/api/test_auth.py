import pytest


@pytest.mark.asyncio
async def test_register_user_success(override_session_db):
    response = await override_session_db.post(
        "/api/v1/users/",
        json={
            "name": "Test",
            "last_name": "User",
            "username": "testuser",
            "email": "test@sentinel.com",
            "phonenumber": "123456789",
            "password": "superpassword123",
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["email"] == "test@sentinel.com"


@pytest.mark.asyncio
async def test_register_user_fails_with_invalid_password(override_session_db):
    response = await override_session_db.post(
        "/api/v1/users/",
        json={
            "name": "Test",
            "last_name": "User",
            "username": "testuser",
            "email": "test_invalid@sentinel.com",
            "phonenumber": "123456789",
            "password": "superpassword",
        },
    )

    assert response.status_code == 422
    data = response.json()
    assert "detail" in data


@pytest.mark.asyncio
async def test_registration_fails_when_email_is_already_register(
    override_session_db, registered_user
):
    response = await override_session_db.post(
        "/api/v1/users/",
        json={
            "name": "Test1",
            "last_name": "User1",
            "username": "testuser1",
            "email": registered_user["email"],
            "phonenumber": "123456781",
            "password": "super_password123",
        },
    )

    assert response.status_code == 400
    data = response.json()
    assert data["detail"] == "Email already registered"


@pytest.mark.asyncio
async def test_login_success(override_session_db, registered_user):
    response = await override_session_db.post(
        "/api/v1/auth/login",
        data={
            "username": registered_user["email"],
            "password": registered_user["password"],
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["access_token"]
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_login_fails_with_incorrect_password(
    override_session_db, registered_user
):
    response = await override_session_db.post(
        "/api/v1/auth/login",
        data={"username": registered_user["email"], "password": "wrong_password123"},
    )

    assert response.status_code == 401
    data = response.json()
    assert "detail" in data
    assert data["detail"] == "Incorrect username or password"