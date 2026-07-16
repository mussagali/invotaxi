import asyncio

import structlog
from fastapi import APIRouter, Request
from fastapi.responses import ORJSONResponse
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

router = APIRouter(tags=["health"])
logger = structlog.get_logger(__name__)

PING_TIMEOUT = 2.0


async def _check_db(engine: AsyncEngine) -> bool:
    try:
        async with asyncio.timeout(PING_TIMEOUT):
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        return True
    except Exception:
        logger.warning("health.db_check_failed", exc_info=True)
        return False


async def _check_redis(redis: Redis) -> bool:
    try:
        async with asyncio.timeout(PING_TIMEOUT):
            return bool(await redis.ping())
    except Exception:
        logger.warning("health.redis_check_failed", exc_info=True)
        return False


@router.get("/health")
async def health(request: Request) -> ORJSONResponse:
    engine: AsyncEngine = request.app.state.db_engine
    redis: Redis = request.app.state.redis

    db_ok, redis_ok = await asyncio.gather(_check_db(engine), _check_redis(redis))
    all_ok = db_ok and redis_ok
    return ORJSONResponse(
        {
            "status": "ok" if all_ok else "degraded",
            "db": "ok" if db_ok else "fail",
            "redis": "ok" if redis_ok else "fail",
        },
        status_code=200 if all_ok else 503,
    )
