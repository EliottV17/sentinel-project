from app.core.security import verify_password
from app.services.user_service import UserService


class AuthService():
    def __init__(self, db):
        self.db = db

    async def authenticate_user(self, login_identifier: str, password: str):
        user_service = UserService(self.db)
        user = await user_service.get_user_by_email(login_identifier)
        
        if not user:
            user = await user_service.get_user_by_username(login_identifier)

        if not user:
            return False

        if not verify_password(user.password, password):
            return False

        return user