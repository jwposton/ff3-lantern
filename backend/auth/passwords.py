"""bcrypt password hashing for local auth (AUTH-05, T-34-01-02)."""

from __future__ import annotations

import bcrypt


def hash_password(password: str) -> str:
    validate_password_length(password)
    hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        return bcrypt.checkpw(
            password.encode("utf-8"),
            stored_hash.encode("utf-8"),
        )
    except (ValueError, TypeError):
        return False


def validate_password_length(
    password: str,
    *,
    min_len: int = 12,
    max_bytes: int = 72,
) -> None:
    if len(password) < min_len:
        raise ValueError(
            f"Password must be at least {min_len} characters"
        )
    if len(password.encode("utf-8")) > max_bytes:
        raise ValueError(
            f"Password must be at most {max_bytes} bytes (bcrypt limit)"
        )
