"""FF3 Lantern API — Phase 1 foundation (health only)."""
import os
from contextlib import asynccontextmanager

import sidecar_db
from api_normalized_transactions import router as api_router
from routes.cache import router as cache_router
from routes.categorize import router as categorize_router
from routes.loans import router as loans_router
from routes.payment_run import payment_worksheet_enabled, router as payment_run_router
from routes.transactions import router as transactions_router
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


class HealthResponse(BaseModel):
    status: str
    firefly_base_url_configured: bool
    firefly_api_token_configured: bool
    openrouter_configured: bool
    sidecar_writable: bool
    payment_worksheet_enabled: bool


def _is_set(name: str) -> bool:
    return bool(os.environ.get(name, "").strip())


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        firefly_base_url_configured=_is_set("FIREFLY_BASE_URL"),
        firefly_api_token_configured=_is_set("FIREFLY_API_TOKEN"),
        openrouter_configured=_is_set("OPENROUTER_API_KEY"),
        sidecar_writable=await sidecar_db.is_writable(),
        payment_worksheet_enabled=payment_worksheet_enabled(),
    )
