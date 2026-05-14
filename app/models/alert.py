from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from .monitor import Monitor

class Alert(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    message: str
    captured_value: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    monitor_id: int = Field(default=None, foreign_key="monitor.id")
    monitor: Optional["Monitor"] = Relationship(back_populates="alerts")