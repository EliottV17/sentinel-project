from datetime import datetime
from pydantic import BaseModel


class CheckResultRead(BaseModel):
    id: int
    monitor_id: int
    state: str
    status_code: int | None
    latency_ms: float | None
    error_message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
