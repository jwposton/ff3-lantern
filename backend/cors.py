"""CORS origin parsing for FF3 Lantern API (OPS-01)."""

from __future__ import annotations

import logging
import os

logger = logging.getLogger("uvicorn.error")

DEFAULT_DEV_ORIGINS = [
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]


def parse_cors_origins() -> list[str]:
    """Return explicit allowed origins from CORS_ALLOWED_ORIGINS or localhost dev defaults."""
    raw = os.environ.get("CORS_ALLOWED_ORIGINS", "").strip()
    if not raw:
        logger.warning(
            "CORS_ALLOWED_ORIGINS unset — using localhost dev origins only"
        )
        return list(DEFAULT_DEV_ORIGINS)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]
