import asyncio
import logging
from datetime import datetime, timezone

import httpx
from sqlmodel import select
import sys
from contextlib import asynccontextmanager

from app.core.checkers.registry import get_checker
from app.models.monitor import Monitor
from app.models.alert import Alert
from app.models.check_result import CheckResult
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from app.db.database import async_session_factory

from sqlmodel import select

logger = logging.getLogger(__name__)
handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logger.addHandler(handler)
logger.setLevel(logging.INFO)
logger.propagate = False

SEMAPHORE = asyncio.Semaphore(10)


async def _check_and_persist(monitor: Monitor, client: httpx.AsyncClient):
    async with SEMAPHORE:
        checker = get_checker(monitor.check_type)
        result = await checker.check(monitor)

    assert monitor.id is not None, "El monitor recuperado de la BD no tiene ID"

    async with async_session_factory() as session:
        result_record = CheckResult(
            monitor_id=monitor.id,
            state=result.state.value,
            status_code=result.status_code,
            latency_ms=result.latency_ms,
            response_sample=result.response_sample,
            error_message=result.error_message,
            extra_data=result.extra_data,
        )
        session.add(result_record)

        old_state = monitor.last_state
        new_state = result.state.value

        monitor.last_state = new_state
        monitor.last_checked_at = datetime.now(timezone.utc).replace(tzinfo=None)
        monitor.consecutive_failures = (
            0 if new_state == "healthy" else (monitor.consecutive_failures or 0) + 1
        )
        session.add(monitor)

        if old_state is not None and old_state != new_state:
            alert = Alert(
                monitor_id=monitor.id,
                alert_type="down" if new_state == "unhealthy" else "recovery",
                message=(
                    f"{monitor.name} esta caído"
                    if new_state == "unhealthy"
                    else f"{monitor.name} se recuperó"
                ),
            )
            session.add(alert)
            logger.info(
                "State transition: %s %s -> %s", monitor.name, old_state, new_state
            )

        await session.commit()


async def check_all_monitors():
    async with async_session_factory() as session:
        result = await session.execute(select(Monitor).where(Monitor.state == "Active"))
        monitors = result.scalars().all()

    if not monitors:
        return

    async with httpx.AsyncClient() as client:
        tasks = [_check_and_persist(m, client) for m in monitors]
        await asyncio.gather(*tasks)


scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Starting engine...")
    scheduler.add_job(
        check_all_monitors,
        "interval",
        seconds=10,
    )
    scheduler.start()
    yield

    print("Shutting down scheduler...")
    scheduler.shutdown()
