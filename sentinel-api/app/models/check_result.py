from datetime import datetime, timezone

from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSON
from sqlmodel import Field, SQLModel


class CheckResult(SQLModel, table=True):
    __tablename__ = "check_result"  # type: ignore

    id: int | None = Field(default=None, primary_key=True)
    monitor_id: int = Field(foreign_key="monitor.id", index=True)
    state: str
    status_code: int | None = None
    latency_ms: float | None = None
    response_sample: str | None = None
    error_message: str | None = None
    extra_data: dict | None = Field(default=None, sa_column=Column(JSON))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc).replace(tzinfo=None)
    )
