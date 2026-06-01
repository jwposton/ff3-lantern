"""FF3Analytics FastAPI application — Phase 1 health only (D-05, D-06)."""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    firefly_base_url_configured: bool
    firefly_api_token_configured: bool


app = FastAPI(
    title="FF3Analytics API",
    description="Backend for FF3Analytics (Firefly III analytics UI).",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _is_set(name: str) -> bool:
    return bool(os.environ.get(name, "").strip())


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        firefly_base_url_configured=_is_set("FIREFLY_BASE_URL"),
        firefly_api_token_configured=_is_set("FIREFLY_API_TOKEN"),
    )
