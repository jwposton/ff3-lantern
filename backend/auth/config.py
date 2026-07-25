"""Auth mode and cookie settings from environment (AUTH-01, D-01, D-02)."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

logger = logging.getLogger("uvicorn.error")

_VALID_MODES = frozenset({"none", "local", "oidc"})


@dataclass(frozen=True, slots=True)
class AuthSettings:
    auth_mode: str
    cookie_secure: bool

    @property
    def secured(self) -> bool:
        return self.auth_mode != "none"


def _parse_bool_env(name: str, *, default: bool = False) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes")


def load_auth_settings() -> AuthSettings:
    """Parse FF3LANTERN_AUTH_MODE and cookie flags; exit on invalid mode."""
    raw_mode = os.environ.get("FF3LANTERN_AUTH_MODE", "none").strip().lower()
    if raw_mode not in _VALID_MODES:
        logger.error(
            "Invalid FF3LANTERN_AUTH_MODE=%r — must be one of: %s",
            os.environ.get("FF3LANTERN_AUTH_MODE", ""),
            ", ".join(sorted(_VALID_MODES)),
        )
        raise SystemExit(1)
    return AuthSettings(
        auth_mode=raw_mode,
        cookie_secure=_parse_bool_env("FF3LANTERN_COOKIE_SECURE"),
    )
