import httpx
from app.core.checkers.base import BaseChecker, CheckResult, CheckerState
from app.core.checkers.registry import register


@register("http")
class HttpChecker(BaseChecker):
    async def check(self, monitor) -> CheckResult:
        config = monitor.check_config or {}
        expected_status = config.get("expected_status", 200)
        timeout = config.get("timeout", 10)
        method = config.get("method", "GET")

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.request(method, monitor.target, timeout=timeout)
            return CheckResult(
                state=CheckerState.HEALTHY
                if resp.status_code == expected_status
                else CheckerState.UNHEALTHY,
                latency_ms=resp.elapsed.total_seconds() * 1000,
                status_code=resp.status_code,
                response_sample=resp.text[:500] if len(resp.text) > 500 else resp.text,
            )
        except httpx.HTTPError as e:
            return CheckResult(
                state=CheckerState.UNHEALTHY,
                latency_ms=0,
                error_message=repr(e),
            )
