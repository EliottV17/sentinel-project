from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.security import hash_password
from app.models.user import User
from app.schemas.user import UserCreate


class UserService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_user_by_email(self, email: str) -> User | None:
        statement = select(User).where(User.email == email)
        result = await self.db.execute(statement)
        return result.scalars().first()

    async def get_user_by_username(self, username: str) -> User | None:
        statement = select(User).where(User.username == username)
        result = await self.db.execute(statement)
        return result.scalars().first()

    async def get_user_by_id(self, user_id: int) -> User | None:
        statement = select(User).where(User.id == user_id)
        result = await self.db.execute(statement)
        return result.scalars().first()

    async def create_user(self, user_create: UserCreate) -> User:
        
        if await self.get_user_by_email(user_create.email):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, 
                detail="Email already registered"
            )

        if await self.get_user_by_username(user_create.username):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already taken"
            )

        hashed_password = hash_password(user_create.password)
        user_data = user_create.model_dump(exclude={"password"})

        user_model = User(**user_data, password=hashed_password)

        self.db.add(user_model)
        await self.db.commit()
        await self.db.refresh(user_model)
        return user_model