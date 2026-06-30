from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select, col

from app.api.deps import get_current_active_user, get_db
from app.models.check_result import CheckResult
from app.models.monitor import Monitor
from app.models.user import User
from app.schemas.check_result import CheckResultRead
from app.schemas.monitor import MonitorCreate, MonitorRead, MonitorUpdate
from app.services.monitor_service import MonitorService
from app.models.alert import Alert
from app.schemas.alert import AlertRead

router = APIRouter()


@router.post("/", response_model=MonitorRead, status_code=status.HTTP_201_CREATED)
async def create_new_monitor(
    monitor_create: MonitorCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
):
    monitor_service = MonitorService(db)

    if current_user.id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid user state")

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

    if current_user.id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid user state")

    monitors = await monitor_service.get_monitors_by_user(user_id=current_user.id)
    return monitors


@router.delete("/{monitor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_monitor_by_id(
    db: Annotated[AsyncSession, Depends(get_db)],
    monitor_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
):
    monitor_service = MonitorService(db)

    if current_user.id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid user state")

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

    if current_user.id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid user state")

    updated_monitor = await monitor_service.update_monitor(
        monitor_id=monitor_id, user_id=current_user.id, monitor_update=monitor_in
    )

    if not updated_monitor:
        raise HTTPException(
            status_code=status.HTTP_404_BAD_REQUEST,
            detail="Monitor not found or you do not have permission to modify it.",
        )

    return updated_monitor


@router.get("/{monitor_id}/history", response_model=list[CheckResultRead])
async def get_monitor_history(
    monitor_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
    limit: int = 50,
):
    monitor_query = await db.execute(select(Monitor).where(Monitor.id == monitor_id))
    monitor = monitor_query.scalars().first()

    if not monitor:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Monitor no encontrado"
        )

    if monitor.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permiso para ver el historial de este monitor",
        )

    statement = (
        select(CheckResult)
        .where(CheckResult.monitor_id == monitor_id)
        .order_by(col(CheckResult.created_at).desc())
        .limit(limit)
    )
    result = await db.execute(statement)
    return result.scalars().all()


@router.get("/{monitor_id}/alerts", response_model=list[AlertRead])
async def get_monitor_alerts(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
    monitor_id: int,
    limit: int = 20,
):
    service = MonitorService(db)

    monitor = await service.get_monitor_by_id(monitor_id=monitor_id)

    if not monitor:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Monitor no encontrado"
        )

    if monitor.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permiso para ver el historial de este monitor",
        )

    statement = (
        select(Alert)
        .where(Alert.monitor_id == monitor_id)
        .order_by(col(Alert.created_at).desc())
        .limit(limit)
    )
    result = await db.execute(statement)
    return result.scalars().all()
