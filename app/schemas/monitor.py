from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class MonitorBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    target: str
    condition: str
    frequency: int = Field(..., ge=10)
    target_value_num: float | None | None
    target_value_str: str | None = None

    @field_validator("frequency")
    @classmethod
    def validate_frequency(cls, value: int) -> int:
        if value < 10:
            raise ValueError("Frequency must be at least 10 seconds")
        return value


class MonitorCreate(MonitorBase):
    pass


class MonitorRead(MonitorBase):
    id: int
    state: str
    created_at: datetime
    user_id: int

    model_config = {"from_attributes": True}


class MonitorUpdate(MonitorBase):
    name: str | None = None
    target: str | None = None
    condition: str | None = None
    frequency: int | None = None
    target_value_num: float | None = None
    target_value_str: str | None = None
