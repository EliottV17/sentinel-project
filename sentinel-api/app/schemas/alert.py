from datetime import datetime
from pydantic import BaseModel


class AlertRead(BaseModel):
    id: int
    monitor_id: int
    alert_type: str
    message: str
    created_at: datetime

    model_config = {"from_attributes": True}
