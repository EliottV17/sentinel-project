from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.monitor import Monitor
from app.schemas.monitor import MonitorCreate, MonitorUpdate


class MonitorService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_monitor(
        self, monitor_create: MonitorCreate, user_id: int
    ) -> Monitor:

        monitor_data = monitor_create.model_dump()
        monitor_model = Monitor(**monitor_data, user_id=user_id)

        self.db.add(monitor_model)
        await self.db.commit()
        await self.db.refresh(monitor_model)
        return monitor_model

    async def get_monitors_by_user(self, user_id: int) -> list[Monitor]:
        statement = select(Monitor).where(Monitor.user_id == user_id)
        result = await self.db.execute(statement)
        return list(result.scalars().all())

    async def get_monitor_by_id(self, monitor_id: int) -> Monitor | None:
        statement = select(Monitor).where(Monitor.id == monitor_id)
        result = await self.db.execute(statement)
        return result.scalars().first()

    async def update_monitor(
        self, monitor_id: int, user_id: int, monitor_update: MonitorUpdate
    ) -> Monitor | None:
        statement = select(Monitor).where(
            Monitor.id == monitor_id, Monitor.user_id == user_id
        )
        result = await self.db.execute(statement)
        monitor = result.scalars().first()

        if not monitor:
            return None

        update_data = monitor_update.model_dump(exclude_unset=True)

        for key, value in update_data.items():
            setattr(monitor, key, value)

        self.db.add(monitor)
        await self.db.commit()
        await self.db.refresh(monitor)
        return monitor

    async def delete_monitor_by_id(self, monitor_id: int, user_id: int) -> bool:
        statement = select(Monitor).where(
            Monitor.id == monitor_id, Monitor.user_id == user_id
        )
        result = await self.db.execute(statement)
        monitor = result.scalars().first()

        if not monitor:
            return False

        await self.db.delete(monitor)
        await self.db.commit()
        return True
