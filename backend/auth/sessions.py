"""Opaque session token validation (AUTH-02 stub until plan 03)."""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone

import aiosqlite
from sidecar_db import get_db_path

ACCESS_COOKIE_NAME = "ff3lantern_access"


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def validate_access_token(raw_token: str) -> int | None:
    """Return user_id when token is valid and unexpired; otherwise None."""
    token_hash = hash_token(raw_token)
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(get_db_path()) as db:
        cursor = await db.execute(
            """
            SELECT user_id, expires_at
            FROM lantern_sessions
            WHERE access_token_hash = ?
            """,
            (token_hash,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        user_id, expires_at = row
        if expires_at <= now:
            return None
        return int(user_id)
