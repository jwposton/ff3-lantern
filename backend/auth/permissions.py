"""RBAC permission level resolver and user permission checks (D-03, D-09)."""

from __future__ import annotations

import json

from auth.resources import RESOURCES
import sidecar_db

ACTIONS = frozenset({"read", "refresh", "write"})

RESOURCE_REFRESH_ACTIONS: dict[str, frozenset[str]] = {
    "payment_worksheet": frozenset({"refresh"}),
    "bill_discover": frozenset({"refresh"}),
}


def validate_resource_action(resource: str, action: str) -> None:
    if resource not in RESOURCES:
        raise ValueError(f"Unknown permission resource: {resource}")
    if action not in ACTIONS:
        raise ValueError(f"Unknown permission action: {action}")


def minimum_level_for_action(resource: str, action: str) -> str:
    validate_resource_action(resource, action)
    if action == "write":
        return "write"
    return "read"


def _limited_actions_allow_write(actions_json: str | None) -> bool:
    if not actions_json:
        return False
    try:
        parsed = json.loads(actions_json)
    except json.JSONDecodeError:
        return False
    if not isinstance(parsed, list):
        return False
    return "write" in parsed


def level_allows_action(level: str, action: str, actions_json: str | None) -> bool:
    if level == "write":
        return True
    if level == "none":
        return False
    if action == "read":
        return level in ("read", "limited")
    if action == "refresh":
        return level in ("read", "limited")
    if action == "write":
        if level == "write":
            return True
        if level == "limited":
            return _limited_actions_allow_write(actions_json)
        return False
    return False


async def user_has_permission(user_id: int, resource: str, action: str) -> bool:
    validate_resource_action(resource, action)
    user = await sidecar_db.get_user(user_id)
    if user is None or not user["enabled"]:
        return False
    role = await sidecar_db.get_role(user["role_id"])
    if role is None:
        return False
    if role["is_system"]:
        return True
    rows = await sidecar_db.list_role_permissions(role["id"])
    matrix = {row["resource"]: row for row in rows}
    row = matrix.get(resource)
    if row is None:
        return level_allows_action("none", action, None)
    return level_allows_action(row["level"], action, row.get("actions_json"))
