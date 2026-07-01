"""FF3Analytics API — Phase 1 foundation (health only)."""
import os

from api_normalized_transactions import router as api_router
from cors import parse_cors_origins
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="FF3Analytics API", version="0.1.0")
app.include_router(api_router, prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)


class HealthResponse(BaseModel):
    status: str
    firefly_base_url_configured: bool
    firefly_api_token_configured: bool


def _is_set(name: str) -> bool:
    return bool(os.environ.get(name, "").strip())


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        firefly_base_url_configured=_is_set("FIREFLY_BASE_URL"),
        firefly_api_token_configured=_is_set("FIREFLY_API_TOKEN"),
    )
