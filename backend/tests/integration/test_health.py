import socket

import httpx
from asgi_lifespan import LifespanManager

from app.core.config import Settings
from app.main import create_app


def _make_settings(database_url: str, redis_url: str) -> Settings:
    return Settings(
        _env_file=None,
        database_url=database_url,
        redis_url=redis_url,
        secret_key="test-secret",
        env="dev",
        log_level="INFO",
    )


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


async def _get_health(settings: Settings) -> httpx.Response:
    app = create_app(settings)
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.get("/api/v1/health")


async def test_health_ok(pg_url: str, redis_url: str) -> None:
    response = await _get_health(_make_settings(pg_url, redis_url))

    assert response.status_code == 200
    body = response.json()
    assert body == {"status": "ok", "db": "ok", "redis": "ok"}


async def test_health_503_when_db_down(redis_url: str) -> None:
    # Postgres "stopped": nothing listens on this port.
    dead_db_url = f"postgresql+asyncpg://u:p@127.0.0.1:{_free_port()}/db"

    response = await _get_health(_make_settings(dead_db_url, redis_url))

    assert response.status_code == 503
    body = response.json()
    assert body["db"] == "fail"
    assert body["redis"] == "ok"
    assert body["status"] == "degraded"


async def test_health_returns_request_id_header(pg_url: str, redis_url: str) -> None:
    app = create_app(_make_settings(pg_url, redis_url))
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/v1/health", headers={"X-Request-ID": "abc-123"})

    assert response.headers["x-request-id"] == "abc-123"
