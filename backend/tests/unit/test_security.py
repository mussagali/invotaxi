import pytest
from argon2 import extract_parameters

from app.core.security import (
    ARGON2_MEMORY_COST_KIB,
    ARGON2_PARALLELISM,
    ARGON2_TIME_COST,
    InvalidTokenError,
    create_token_pair,
    decode_token,
    hash_password,
    mask_phone,
    normalize_phone,
    verify_password,
)


@pytest.mark.parametrize(
    "raw",
    ["87011234567", "+77011234567", "7011234567", "8 (701) 123-45-67", "+7 701 123 45 67"],
)
def test_normalize_phone_variants_collapse(raw: str) -> None:
    assert normalize_phone(raw) == "7011234567"


@pytest.mark.parametrize("raw", ["", "123", "9701123456789012", "abc"])
def test_normalize_phone_rejects_garbage(raw: str) -> None:
    with pytest.raises(ValueError):
        normalize_phone(raw)


def test_mask_phone_hides_middle() -> None:
    masked = mask_phone("7011234567")
    assert masked == "7*******67"
    assert "1234" not in masked


def test_password_hash_roundtrip() -> None:
    h = hash_password("s3cret-pass")
    assert h.startswith("$argon2")
    parameters = extract_parameters(h)
    assert parameters.time_cost == ARGON2_TIME_COST
    assert parameters.memory_cost == ARGON2_MEMORY_COST_KIB
    assert parameters.parallelism == ARGON2_PARALLELISM
    assert verify_password(h, "s3cret-pass")
    assert not verify_password(h, "wrong")


def test_token_pair_types_enforced() -> None:
    import uuid

    access, refresh, _, _ = create_token_pair(
        user_id=uuid.uuid4(), role="client", secret_key="k"
    )
    assert decode_token(access, secret_key="k", expected_type="access")["role"] == "client"
    with pytest.raises(InvalidTokenError):
        decode_token(access, secret_key="k", expected_type="refresh")
    with pytest.raises(InvalidTokenError):
        decode_token(refresh, secret_key="k", expected_type="access")
    with pytest.raises(InvalidTokenError):
        decode_token(access, secret_key="wrong", expected_type="access")
