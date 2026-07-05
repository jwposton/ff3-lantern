"""FF3 Lantern API — Phase 1 foundation (health only)."""
import logging
import os
from contextlib import asynccontextmanager

import httpx
import sidecar_db
from api_normalized_transactions import router as api_router
from routes.cache import router as cache_router
from routes.categorize import router as categorize_router
from routes.loans import router as loans_router
from routes.payment_run import payment_worksheet_enabled, router as payment_run_router
from routes.transactions import router as transactions_router
from app_clock import demo_anchor_date_str
from cors import parse_cors_origins
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


@asynccontextmanager
async def lifespan(app: FastAPI):
    await sidecar_db.init_db()
    yield


app = FastAPI(title="FF3 Lantern API", version="2.0.0", lifespan=lifespan)
app.include_router(api_router, prefix="/api")
app.include_router(categorize_router, prefix="/api")
app.include_router(loans_router, prefix="/api")
app.include_router(payment_run_router, prefix="/api")
app.include_router(transactions_router, prefix="/api")
app.include_router(cache_router, prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

logger = logging.getLogger(__name__)


class HealthResponse(BaseModel):
    status: str
    firefly_base_url_configured: bool
    firefly_api_token_configured: bool
    firefly_version: str | None = None
    openrouter_configured: bool
    sidecar_writable: bool
    payment_worksheet_enabled: bool
    demo_anchor_date: str | None = None


def _is_set(name: str) -> bool:
    return bool(os.environ.get(name, "").strip())


def _parse_firefly_version(payload: dict) -> str | None:
    data = payload.get("data")
    if isinstance(data, dict):
        attrs = data.get("attributes")
        if isinstance(attrs, dict):
            version = attrs.get("version")
            if version:
                return str(version)
        version = data.get("version")
        if version:
            return str(version)
    version = payload.get("version")
    return str(version) if version else None


async def _fetch_firefly_version() -> str | None:
    if not _is_set("FIREFLY_BASE_URL") or not _is_set("FIREFLY_API_TOKEN"):
        return None
    base_url = os.environ.get("FIREFLY_BASE_URL", "").rstrip("/")
    token = os.environ.get("FIREFLY_API_TOKEN", "")
    try:
        async with httpx.AsyncClient(
            base_url=base_url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
            },
            timeout=httpx.Timeout(5.0, connect=3.0),
        ) as client:
            response = await client.get("/api/v1/about")
            if response.status_code != 200:
                return None
            return _parse_firefly_version(response.json())
    except Exception:
        logger.debug("Unable to fetch Firefly version for /health", exc_info=True)
        return None


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        firefly_base_url_configured=_is_set("FIREFLY_BASE_URL"),
        firefly_api_token_configured=_is_set("FIREFLY_API_TOKEN"),
        firefly_version=await _fetch_firefly_version(),
        openrouter_configured=_is_set("OPENROUTER_API_KEY"),
        sidecar_writable=await sidecar_db.is_writable(),
        payment_worksheet_enabled=payment_worksheet_enabled(),
        demo_anchor_date=demo_anchor_date_str(),
    )
