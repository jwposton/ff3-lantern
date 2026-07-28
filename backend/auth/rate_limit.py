"""In-memory per-username login rate limiting (D-12–D-14)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

_MAX_FAILURES = 5
_LOCKOUT_MINUTES = 15


class LoginRateLimiter:
    """Process-local failed-login tracker; not persisted to SQLite (D-13)."""

    def __init__(self) -> None:
        self._failures: dict[str, list[datetime]] = {}
        self._locked_until: dict[str, datetime] = {}

    def is_locked(self, username: str) -> bool:
        locked_until = self._locked_until.get(username)
        if locked_until is None:
            return False
        now = datetime.now(timezone.utc)
        if now >= locked_until:
            self.clear(username)
            return False
        return True

    def record_failure(self, username: str) -> None:
        now = datetime.now(timezone.utc)
        failures = self._failures.setdefault(username, [])
        failures.append(now)
        if len(failures) >= _MAX_FAILURES:
            self._locked_until[username] = now + timedelta(minutes=_LOCKOUT_MINUTES)

    def clear(self, username: str) -> None:
        self._failures.pop(username, None)
        self._locked_until.pop(username, None)


LOGIN_RATE_LIMITER = LoginRateLimiter()
