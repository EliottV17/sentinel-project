#!/usr/bin/env python3
import asyncio
import json
import os
import time
from datetime import datetime, timezone
import asyncpg

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/sentinel_db",
)

QUERY = """
INSERT INTO monitor (
    name, target, frequency, state, created_at,
    check_type, check_config, consecutive_failures, user_id
) VALUES ($1, $2, $3, $4, $5, $6, $7::json, $8, $9);
"""


async def main():
    conn = await asyncpg.connect(DATABASE_URL)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    cfg = json.dumps({"method": "GET", "expected_status": 200, "timeout": 5})

    print("[*] Generando 5,000 monitores dummy...")
    monitors = [
        (
            f"Stress Monitor {i}",
            f"http://localhost:9999/dummy-{i}",
            10,
            "Active",
            now,
            "http",
            cfg,
            0,
            1,
        )
        for i in range(1, 5001)
    ]

    print(f"[*] Inyectando en {DATABASE_URL}...")
    start = time.perf_counter()
    try:
        await conn.executemany(QUERY, monitors)
    finally:
        await conn.close()

    elapsed = time.perf_counter() - start
    print(f"[✔] 5,000 registros inyectados en {elapsed:.3f} segundos.")


if __name__ == "__main__":
    asyncio.run(main())
