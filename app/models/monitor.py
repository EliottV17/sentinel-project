from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from .alert import Alert
    from .user import User
    
class Monitor(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    target: str
    condition: str
    target_value_num: float | None = Field(default=None)
    target_value_str: str | None = Field(default=None)
    frequency: int 
    state: str = Field(default="Active")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    user_id: int = Field(default=None, foreign_key="users.id")
    user: Optional["User"] = Relationship(back_populates="monitors")
    alerts: list["Alert"] = Relationship(back_populates="monitor")