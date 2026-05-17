from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, get_db
from app.models.user import User
from app.schemas.user import UserCreate, UserRead
from app.services.user_service import UserService

router = APIRouter()

@router.post("/", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def register_user(
    user_create: UserCreate, 
    db: Annotated[AsyncSession, Depends(get_db)]
    ):
    user_service = UserService(db)
    return await user_service.create_user(user_create)

@router.get("/me", response_model=User)
async def read_user_me(
    current_user: Annotated[User, Depends(get_current_active_user)]
    ):
    return current_user