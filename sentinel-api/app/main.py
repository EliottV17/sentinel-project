from fastapi import FastAPI

from app.api.v1.api import api_router
from app.core.scheduler import lifespan
from app.core.checkers import http_checker

app = FastAPI(title="Sentinel API", lifespan=lifespan)


@app.get("/")
async def root():
    return {"message": "Sentinel API está en línea y vigilando"}


app.include_router(api_router, prefix="/api/v1")
