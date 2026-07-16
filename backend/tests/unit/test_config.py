import pytest
from pydantic import ValidationError

from app.core.config import Settings

REQUIRED_VARS = ["SECRET_KEY", "DATABASE_URL", "REDIS_URL", "ENV", "LOG_LEVEL"]


def _clear_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in REQUIRED_VARS:
        monkeypatch.delenv(var, raising=False)


def test_config_fails_without_secret_key(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@h:5432/db")
    monkeypatch.setenv("REDIS_URL", "redis://h:6379/0")

    with pytest.raises(ValidationError) as exc_info:
        Settings(_env_file=None)

    assert any(e["loc"] == ("secret_key",) for e in exc_info.value.errors())


def test_config_reads_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("SECRET_KEY", "s3cret")
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@h:5432/db")
    monkeypatch.setenv("REDIS_URL", "redis://h:6379/1")
    monkeypatch.setenv("ENV", "prod")
    monkeypatch.setenv("LOG_LEVEL", "DEBUG")

    settings = Settings(_env_file=None)

    assert settings.secret_key == "s3cret"
    assert settings.env == "prod"
    assert settings.redis_url.endswith("/1")


def test_config_rejects_unknown_env(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("SECRET_KEY", "s")
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@h:5432/db")
    monkeypatch.setenv("REDIS_URL", "redis://h:6379/0")
    monkeypatch.setenv("ENV", "staging")

    with pytest.raises(ValidationError):
        Settings(_env_file=None)
