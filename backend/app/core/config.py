from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings. All values come from environment / .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str
    redis_url: str
    secret_key: str
    env: Literal["dev", "prod"] = "dev"
    log_level: str = "INFO"
    fcm_server_key: str = ""
    reports_dir: str = "/data/reports"
    cors_allowed_origins: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:8080,http://127.0.0.1:8080"
    )
    # Local UI bootstrap only. It is rejected unless ENV=dev and this flag is true.
    dev_auto_register: bool = False
    dev_app_password: str = ""
    # Short-lived test access for the installed mobile app. Keep disabled in
    # normal production operation; the password must be explicitly configured.
    test_auto_register: bool = False
    test_app_password: str = ""

    @property
    def cors_origins(self) -> list[str]:
        return [item.strip() for item in self.cors_allowed_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
