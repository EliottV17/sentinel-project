import asyncio
import os
import asyncpg

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/sentinel_db",
)

async def main():
    conn = await asyncpg.connect(DATABASE_URL)
    print(f"[*] Limpiando monitores de estrés en {DATABASE_URL}...")
    
    # Borra solo los monitores creados por el seed (dejando intactos tus monitores reales)
    status = await conn.execute("DELETE FROM monitor WHERE name LIKE 'Stress Monitor %';")
    
    await conn.close()
    print(f"[✔] Comando ejecutado: {status}")

if __name__ == "__main__":
    asyncio.run(main())
