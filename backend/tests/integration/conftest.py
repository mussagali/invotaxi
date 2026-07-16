import os
from collections.abc import AsyncIterator, Iterator

import httpx
import pytest
from alembic import command
from alembic.config import Config
from asgi_lifespan import LifespanManager
from fastapi import FastAPI
from redis.asyncio import Redis
from testcontainers.postgres import PostgresContainer
from testcontainers.redis import RedisContainer

from app.core.config import Settings
from app.main import create_app


@pytest.fixture(scope="session")
def pg_url() -> Iterator[str]:
    with PostgresContainer("postgis/postgis:16-3.4", driver="asyncpg") as pg:
        yield pg.get_connection_url()


@pytest.fixture(scope="session")
def redis_container() -> Iterator[RedisContainer]:
    with RedisContainer("redis:7-alpine") as rc:
        yield rc


@pytest.fixture(scope="session")
def redis_url(redis_container: RedisContainer) -> str:
    host = redis_container.get_container_host_ip()
    port = redis_container.get_exposed_port(6379)
    return f"redis://{host}:{port}/0"


@pytest.fixture(scope="session")
def migrated_db(pg_url: str) -> Iterator[str]:
    """upgrade head -> downgrade base -> upgrade head: proves reversibility."""
    os.environ["DATABASE_URL"] = pg_url
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    yield pg_url


@pytest.fixture
async def app_with_client(
    migrated_db: str, redis_url: str
) -> AsyncIterator[tuple[FastAPI, httpx.AsyncClient]]:
    settings = Settings(
        _env_file=None,
        database_url=migrated_db,
        redis_url=redis_url,
        secret_key="test-secret",
        env="dev",
        log_level="INFO",
    )
    # Isolate auth state (rate limits, sessions) between tests.
    flusher = Redis.from_url(redis_url)
    await flusher.flushdb()
    await flusher.aclose()

    app = create_app(settings)
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield app, client
