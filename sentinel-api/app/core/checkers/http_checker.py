import httpx

from app.core.checkers.base import BaseChecker, CheckerState, CheckResult
from app.core.checkers.registry import register


@register("http")
class HttpChecker(BaseChecker):
    async def check(
        self, monitor, client: httpx.AsyncClient | None = None
    ) -> CheckResult:
        config = monitor.check_config or {}
        expected_status = config.get("expected_status", 200)
        timeout = config.get("timeout", 10)
        method = config.get("method", "GET")

        try:
            _client = client or httpx.AsyncClient()
            if client is None:
                async with _client:
                    resp = await _client.request(
                        method, monitor.target, timeout=timeout
                    )
            else:
                resp = await _client.request(method, monitor.target, timeout=timeout)
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
