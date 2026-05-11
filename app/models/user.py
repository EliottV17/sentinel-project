from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from .monitor import Monitor
    
class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str | None = Field(index=True)
    lastname: str 
    email: str | None = Field(unique=True, index=True)
    password: str
    phonenumber: str | None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)}
        )
    status: str | None = Field(default="Active")
    monitors: list["Monitor"] = Relationship(back_populates="user")
