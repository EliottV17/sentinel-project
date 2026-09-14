from datetime import datetime

from pydantic import BaseModel, Field


class MonitorBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    target: str
    check_type: str = "http"
    check_config: dict = {}
    frequency: int = Field(default=60, ge=10)

class MonitorCreate(MonitorBase):
    pass


class MonitorUpdate(BaseModel):
    name: str | None = None
    target: str | None = None
    check_type: str | None = None
    check_config: dict | None = None
    frequency: int | None = Field(default=None, ge=10)


class MonitorRead(MonitorBase):
    id: int
    state: str
    last_state: str | None
    last_checked_at: datetime | None
    consecutive_failures: int
    created_at: datetime
    user_id: int

    model_config = {"from_attributes": True}
