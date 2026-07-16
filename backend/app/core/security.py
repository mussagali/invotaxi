"""Passwords (argon2), JWT (HS256), phone normalization, masking."""
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError

ACCESS_TOKEN_TTL = timedelta(minutes=15)
REFRESH_TOKEN_TTL = timedelta(days=30)
JWT_ALGORITHM = "HS256"

# OWASP's minimum Argon2id profile is intentionally explicit. The library's
# RFC 9106 default (64 MiB, t=3, p=4) is excellent for low-volume services but
# exhausted the measured 4-vCPU API during the 1,350-user login ramp.
ARGON2_TIME_COST = 2
ARGON2_MEMORY_COST_KIB = 19 * 1024
ARGON2_PARALLELISM = 1
_password_hasher = PasswordHasher(
    time_cost=ARGON2_TIME_COST,
    memory_cost=ARGON2_MEMORY_COST_KIB,
    parallelism=ARGON2_PARALLELISM,
)


class InvalidTokenError(Exception):
    """Raised when a JWT is missing, malformed, expired or of the wrong type."""


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError):
        return False


def normalize_phone(raw: str) -> str:
    """8/+7/7-prefixed KZ numbers -> canonical 10 digits ('7011234567').

    Raises ValueError for anything that is not a valid phone.
    """
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 11 and digits[0] in ("7", "8"):
        digits = digits[1:]
    if len(digits) != 10:
        raise ValueError(f"invalid phone: expected 10 digits, got {len(digits)}")
    return digits


def mask_phone(phone: str) -> str:
    """'7011234567' -> '7*******67' — safe for logs."""
    if len(phone) < 3:
        return "*" * len(phone)
    return phone[0] + "*" * (len(phone) - 3) + phone[-2:]


def create_token_pair(
    *, user_id: uuid.UUID, role: str, secret_key: str
) -> tuple[str, str, str, str]:
    """Returns (access_token, refresh_token, access_jti, refresh_jti)."""
    now = datetime.now(UTC)
    access_jti = uuid.uuid4().hex
    refresh_jti = uuid.uuid4().hex
    access = jwt.encode(
        {
            "sub": str(user_id),
            "role": role,
            "jti": access_jti,
            "rjti": refresh_jti,
            "type": "access",
            "iat": now,
            "exp": now + ACCESS_TOKEN_TTL,
        },
        secret_key,
        algorithm=JWT_ALGORITHM,
    )
    refresh = jwt.encode(
        {
            "sub": str(user_id),
            "role": role,
            "jti": refresh_jti,
            "type": "refresh",
            "iat": now,
            "exp": now + REFRESH_TOKEN_TTL,
        },
        secret_key,
        algorithm=JWT_ALGORITHM,
    )
    return access, refresh, access_jti, refresh_jti


def decode_token(
    token: str, *, secret_key: str, expected_type: Literal["access", "refresh"]
) -> dict[str, Any]:
    try:
        payload: dict[str, Any] = jwt.decode(token, secret_key, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise InvalidTokenError(str(exc)) from exc
    if payload.get("type") != expected_type:
        raise InvalidTokenError(f"expected {expected_type} token")
    if not payload.get("sub") or not payload.get("jti"):
        raise InvalidTokenError("token missing sub/jti")
    return payload
