"""Pydantic validation for loan profile schema v1 (LOAN-01)."""

from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

MAX_PROFILE_BYTES = 16 * 1024

_LIABILITY_TYPES = frozenset(
    {"liabilities", "liability account", "liabilities account", "debt"}
)
_EXPENSE_TYPES = frozenset({"expense", "expense account"})


def _account_type_key(acct: dict[str, Any]) -> str:
    raw_type = (acct.get("type") or "").lower()
    raw_role = (acct.get("role") or acct.get("account_role") or "").lower()
    if raw_role in ("debt",):
        return "debt"
    return raw_type


def _is_liability(acct: dict[str, Any]) -> bool:
    key = _account_type_key(acct)
    return key in _LIABILITY_TYPES or "liabilit" in key


def _is_expense(acct: dict[str, Any]) -> bool:
    return _account_type_key(acct) in _EXPENSE_TYPES


def _normalize_decimal_input(value: str | Decimal) -> str:
    """Strip whitespace and thousands separators before decimal parsing."""
    return str(value).strip().replace(",", "")


def _format_decimal(value: str | Decimal, *, places: int = 2) -> str:
    try:
        dec = Decimal(_normalize_decimal_input(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(
            f'Amount "{value}" is not valid — use digits and a decimal point only '
            f"(for example 2979.14)."
        ) from exc
    quant = Decimal("1") if places == 0 else Decimal("0." + "0" * (places - 1) + "1")
    return str(dec.quantize(quant))


class SplitComponent(BaseModel):
    role: Literal["principal", "interest", "escrow"]
    type: Literal["transfer", "withdrawal"]
    destination_account_id: str
    destination_account: str
    category: str | None = None
    budget: str | None = None


class MatchConfig(BaseModel):
    type: Literal["transfer", "withdrawal"] = "transfer"
    description_contains: str = Field(min_length=1)
    expected_amount: str
    amount_tolerance: str = "0.50"
    source_account_id: str | None = None
    source_account: str | None = None
    import_destination_account_id: str | None = None
    import_destination_account: str | None = None
    max_per_month: int | None = Field(default=None, ge=1)

    @field_validator("expected_amount", "amount_tolerance")
    @classmethod
    def _decimal_string(cls, v: str) -> str:
        return _format_decimal(v)


class SplitConfig(BaseModel):
    escrow_amount: str = "0.00"
    budget: str | None = None
    components: list[SplitComponent] = Field(default_factory=list)

    @field_validator("escrow_amount")
    @classmethod
    def _escrow_decimal(cls, v: str) -> str:
        return _format_decimal(v)


class LoanProfile(BaseModel):
    version: Literal[1] = 1
    enabled: bool = True
    match: MatchConfig
    split: SplitConfig
    rate_override: str | None = None
    notes: str | None = None


def _validate_component_accounts(
    profile: LoanProfile, accounts_by_id: dict[str, dict[str, Any]]
) -> None:
    if not profile.enabled:
        return
    escrow_amt = Decimal(profile.split.escrow_amount)
    roles_seen: set[str] = set()
    match_type = profile.match.type
    for idx, comp in enumerate(profile.split.components):
        if comp.role == "escrow" and escrow_amt <= 0:
            if not (comp.destination_account_id or "").strip():
                continue
        if comp.role in ("principal", "interest") and not (
            comp.destination_account_id or ""
        ).strip():
            raise ValueError(
                f"split.components[{idx}].destination_account_id: required for {comp.role}"
            )
        if comp.role == "escrow" and escrow_amt > 0 and not (
            comp.destination_account_id or ""
        ).strip():
            raise ValueError(
                "split.components: escrow destination required when escrow_amount > 0"
            )
        if not (comp.destination_account_id or "").strip():
            continue
        if comp.type != match_type:
            raise ValueError(
                f"split.components[{idx}].type: must match match.type ({match_type!r})"
            )
        acct = accounts_by_id.get(comp.destination_account_id)
        if acct is None:
            raise ValueError(
                f"split.components[{idx}].destination_account_id: account not found"
            )
        if comp.role == "principal":
            if not _is_liability(acct):
                raise ValueError(
                    f"split.components[{idx}]: principal destination must be liability account"
                )
        elif comp.role in ("interest", "escrow"):
            if not _is_expense(acct):
                raise ValueError(
                    f"split.components[{idx}]: {comp.role} destination must be expense account"
                )
        roles_seen.add(comp.role)
    if "principal" not in roles_seen:
        raise ValueError("split.components: at least one principal component required")
    if "interest" not in roles_seen:
        raise ValueError("split.components: at least one interest component required")


def validate_profile(
    profile: dict[str, Any], accounts_by_id: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    """Validate profile dict; return normalized dict or raise ValueError with field paths."""
    raw_size = len(json.dumps(profile).encode("utf-8"))
    if raw_size > MAX_PROFILE_BYTES:
        raise ValueError(f"profile exceeds 16KB limit ({raw_size} bytes)")
    try:
        parsed = LoanProfile.model_validate(profile)
    except Exception as exc:
        raise ValueError(str(exc)) from exc
    _validate_component_accounts(parsed, accounts_by_id)
    return parsed.model_dump()
