from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.api import api_router
from app.core.checkers import http_checker  # noqa: F401
from app.core.config import settings
from app.core.scheduler import lifespan

app = FastAPI(title="Sentinel API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"message": "Sentinel API está en línea y vigilando"}


app.include_router(api_router, prefix="/api/v1")
