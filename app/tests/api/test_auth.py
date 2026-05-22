import pytest


@pytest.mark.asyncio
async def test_register_user_succes(override_session_db):
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
