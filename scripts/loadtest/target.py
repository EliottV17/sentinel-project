#!/usr/bin/env python3
"""Dependency-free local HTTP target used by the isolated worker load test."""

from __future__ import annotations

import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


BODY = b"ok\n"
HEALTH_BODY = b'{"status":"ok"}\n'


def delay_from_environment() -> int:
    raw = os.environ.get("TARGET_DELAY_MS", "10")
    try:
        delay = int(raw)
    except ValueError as exc:
        raise ValueError("TARGET_DELAY_MS must be a non-negative integer") from exc
    if delay < 0:
        raise ValueError("TARGET_DELAY_MS must be a non-negative integer")
    return delay


def make_server(host: str = "0.0.0.0", port: int = 8080, delay_ms: int = 10):
    """Construct a concurrent HTTP server; test code can bind an ephemeral port."""
    if delay_ms < 0:
        raise ValueError("delay_ms must be non-negative")

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_GET(self):
            if self.path.split("?", 1)[0] == "/health":
                body = HEALTH_BODY
            elif self.path.split("?", 1)[0] == "/ok":
                time.sleep(delay_ms / 1000)
                body = BODY
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json" if body is HEALTH_BODY else "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format, *_args):
            return

    class ConcurrentServer(ThreadingHTTPServer):
        daemon_threads = True
        request_queue_size = 128

    return ConcurrentServer((host, port), Handler)


def main() -> None:
    delay = delay_from_environment()
    server = make_server(delay_ms=delay)
    print(json.dumps({"event": "target_ready", "port": server.server_address[1], "delay_ms": delay}), flush=True)
    try:
        server.serve_forever(poll_interval=0.2)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
