from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING

import httpx

if TYPE_CHECKING:
    from app.models.monitor import Monitor


class CheckerState(StrEnum):
    HEALTHY = "healthy"
    UNHEALTHY = "unhealthy"


@dataclass
class CheckResult:
    state: CheckerState
    latency_ms: float
    status_code: int | None = None
    response_sample: str | None = None
    error_message: str | None = None
    extra_data: dict | None = None


class BaseChecker(ABC):
    @abstractmethod
    async def check(
        self, monitor: "Monitor", client: httpx.AsyncClient | None = None
    ) -> CheckResult: ...
