import asyncio
from datetime import datetime, timezone

import asyncpg

DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/sentinel_db"


async def seed_monitors(total: int = 5000):
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        print(f"Inserting {total} mock monitors...")
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        records = [
            (
                f"Load Test Monitor {i}",
                "https://httpbin.org/status/200",
                60,
                "Active",
                "http",
                "{}",
                1,
                now,
                0,
            )
            for i in range(1, total + 1)
        ]

        await conn.executemany(
            """
                INSERT INTO monitor (name, target, frequency, state, check_type,
                check_config, user_id, created_at, consecutive_failures)
                VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
            """,
            records,
        )
        print("Done seeding!")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(seed_monitors(5000))
