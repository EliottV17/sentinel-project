from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, get_db
from app.models.user import User
from app.schemas.monitor import MonitorCreate, MonitorRead, MonitorUpdate
from app.services.monitor_service import MonitorService

router = APIRouter()


@router.post("/", response_model=MonitorRead, status_code=status.HTTP_201_CREATED)
async def create_new_monitor(
    monitor_create: MonitorCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
):
    monitor_service = MonitorService(db)

    new_monitor = await monitor_service.create_monitor(
        monitor_create=monitor_create, user_id=current_user.id
    )

    return new_monitor


@router.get("/", response_model=list[MonitorRead])
async def get_user_monitors(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
):
    monitor_service = MonitorService(db)
    monitors = await monitor_service.get_monitors_by_user(user_id=current_user.id)
    return monitors


@router.delete("/{monitor_id}", status_code=status.HTTP_200_OK)
async def delete_monitor_by_id(
    db: Annotated[AsyncSession, Depends(get_db)],
    monitor_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
):
    monitor_service = MonitorService(db)

    success = await monitor_service.delete_monitor_by_id(
        monitor_id=monitor_id, user_id=current_user.id
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Monitor not found or you don't have permission to delete it",
        )

    return {"message": "Monitor deleted successfully"}


@router.patch("/{monitor_id}")
async def update_monitor_by_id(
    db: Annotated[AsyncSession, Depends(get_db)],
    monitor_in: MonitorUpdate,
    monitor_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
):
    monitor_service = MonitorService(db)

    updated_monitor = await monitor_service.update_monitor(
        monitor_id=monitor_id, user_id=current_user.id, monitor_update=monitor_in
    )

    if not updated_monitor:
        raise HTTPException(
            status_code=status.HTTP_404_BAD_REQUEST,
            detail="Monitor not found or you do not have permission to modify it.",
        )

    return updated_monitor
