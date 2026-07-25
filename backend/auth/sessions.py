"""Opaque session token lifecycle (AUTH-02/03, D-05–D-15)."""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import aiosqlite
from auth.cookies import ACCESS_TTL_SECONDS, REFRESH_TTL_SECONDS
import sidecar_db
from sidecar_db import (
    create_session_pair_conn,
    get_db_path,
    init_db,
    revoke_all_user_sessions_conn,
    revoke_refresh_token_conn,
    rotate_refresh_conn,
    validate_access_token_conn,
)


class ReuseDetected(Exception):
    """Refresh token was presented after revocation (D-08)."""


class InvalidRefreshToken(Exception):
    """Refresh token missing, expired, or unknown."""


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


@dataclass(frozen=True, slots=True)
class SessionPair:
    access: str
    refresh: str
    refresh_id: int
    session_id: int


async def create_session_pair(user_id: int) -> SessionPair:
    await init_db()
    raw_access = secrets.token_urlsafe(32)
    raw_refresh = secrets.token_urlsafe(32)
    now = _utc_now()
    refresh_expires = now + timedelta(seconds=REFRESH_TTL_SECONDS)
    access_expires = now + timedelta(seconds=ACCESS_TTL_SECONDS)
    created_at = _iso(now)
    async with aiosqlite.connect(get_db_path()) as db:
        result = await create_session_pair_conn(
            db,
            user_id=user_id,
            refresh_hash=hash_token(raw_refresh),
            access_hash=hash_token(raw_access),
            refresh_expires_at=_iso(refresh_expires),
            access_expires_at=_iso(access_expires),
            created_at=created_at,
        )
        await db.commit()
    return SessionPair(
        access=raw_access,
        refresh=raw_refresh,
        refresh_id=result.refresh_id,
        session_id=result.session_id,
    )


async def validate_access_token(raw_token: str) -> int | None:
    await init_db()
    token_hash = hash_token(raw_token)
    now = _iso(_utc_now())
    async with aiosqlite.connect(get_db_path()) as db:
        user_id = await validate_access_token_conn(db, token_hash=token_hash, now=now)
        await db.commit()
        return user_id


async def rotate_refresh(raw_refresh: str) -> SessionPair:
    await init_db()
    refresh_hash = hash_token(raw_refresh)
    raw_access = secrets.token_urlsafe(32)
    raw_new_refresh = secrets.token_urlsafe(32)
    now = _utc_now()
    created_at = _iso(now)
    access_expires = _iso(now + timedelta(seconds=ACCESS_TTL_SECONDS))
    async with aiosqlite.connect(get_db_path()) as db:
        try:
            result = await rotate_refresh_conn(
                db,
                refresh_hash=refresh_hash,
                new_refresh_hash=hash_token(raw_new_refresh),
                new_access_hash=hash_token(raw_access),
                access_expires_at=access_expires,
                created_at=created_at,
                now=_iso(now),
            )
        except sidecar_db.ReuseDetected as exc:
            raise ReuseDetected(str(exc)) from exc
        except sidecar_db.InvalidRefreshToken as exc:
            raise InvalidRefreshToken(str(exc)) from exc
        await db.commit()
    return SessionPair(
        access=raw_access,
        refresh=raw_new_refresh,
        refresh_id=result.refresh_id,
        session_id=result.session_id,
    )


async def revoke_refresh(raw_refresh: str) -> None:
    await init_db()
    refresh_hash = hash_token(raw_refresh)
    revoked_at = _iso(_utc_now())
    async with aiosqlite.connect(get_db_path()) as db:
        row = await sidecar_db.get_refresh_by_hash_conn(db, refresh_hash)
        if row is None:
            return
        await revoke_refresh_token_conn(db, refresh_id=row["id"], revoked_at=revoked_at)
        await db.commit()


async def revoke_all_user_sessions(user_id: int) -> None:
    await init_db()
    revoked_at = _iso(_utc_now())
    async with aiosqlite.connect(get_db_path()) as db:
        await revoke_all_user_sessions_conn(db, user_id=user_id, revoked_at=revoked_at)
        await db.commit()
