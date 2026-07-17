from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import StrEnum
from typing import TYPE_CHECKING

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
    async def check(self, monitor: "Monitor") -> CheckResult:
        """Ejecuta la verificación y devuelve el resultado"""
        ...
