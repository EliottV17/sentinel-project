from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional

from sqlmodel import Field, Relationship, SQLModel
from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSON

if TYPE_CHECKING:
    from .alert import Alert
    from .user import User


class Monitor(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    target: str
    frequency: int
    state: str = Field(default="Active")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc).replace(tzinfo=None)
    )
    check_type: str = Field(default="http")
    check_config: dict = Field(default={}, sa_column=Column(JSON))
    last_state: str | None = Field(default=None)
    last_checked_at: datetime | None = Field(default=None)
    consecutive_failures: int = Field(default=0)
    user_id: int = Field(default=None, foreign_key="users.id")
    user: Optional["User"] = Relationship(back_populates="monitors")
    alerts: list["Alert"] = Relationship(back_populates="monitor")
