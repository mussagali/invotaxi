import os
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from contextlib import asynccontextmanager

import structlog
from fastapi import APIRouter, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import ORJSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, generate_latest, multiprocess
from prometheus_fastapi_instrumentator import Instrumentator
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.cors import CORSMiddleware

from app.api.v1.auth import router as auth_router
from app.api.v1.clients import router as clients_router
from app.api.v1.dependents import router as dependents_router
from app.api.v1.devices import router as devices_router
from app.api.v1.dispatch import router as dispatch_router
from app.api.v1.drivers import router as drivers_router
from app.api.v1.health import router as health_router
from app.api.v1.orders import router as orders_router
from app.api.v1.reports import router as reports_router
from app.core.config import Settings, get_settings
from app.core.logging import RequestIDMiddleware, configure_logging
from app.metrics import CUSTOM_METRICS, HTTP_REQUESTS_INPROGRESS
from app.realtime.api import router as realtime_router
from app.realtime.hub import RealtimeHub
from app.services.event_bus import EventBus
from app.workers.push import make_push_sender

logger = structlog.get_logger(__name__)


def _error_response(
    status_code: int, code: str, message: str, headers: Mapping[str, str] | None = None
) -> ORJSONResponse:
    return ORJSONResponse(
        {"error": {"code": code, "message": message}}, status_code=status_code, headers=headers
    )


async def http_exception_handler(request: Request, exc: Exception) -> ORJSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    return _error_response(
        exc.status_code, f"http_{exc.status_code}", str(exc.detail), headers=exc.headers
    )


async def validation_exception_handler(request: Request, exc: Exception) -> ORJSONResponse:
    assert isinstance(exc, RequestValidationError)
    return _error_response(422, "validation_error", str(exc.errors()))


async def unhandled_exception_handler(request: Request, exc: Exception) -> ORJSONResponse:
    logger.error("unhandled_exception", exc_info=exc)
    return _error_response(500, "internal_error", "Internal server error")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.env, settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.settings = settings
        app.state.db_engine = create_async_engine(
            settings.database_url,
            pool_size=10,
            max_overflow=10,
            connect_args={"timeout": 5},
        )
        app.state.redis = Redis.from_url(settings.redis_url, decode_responses=True)
        app.state.event_bus = EventBus(
            app.state.redis,
            make_push_sender(app.state.redis, settings.fcm_server_key),
        )
        app.state.session_factory = async_sessionmaker(
            app.state.db_engine,
            expire_on_commit=False,
            info={"event_bus": app.state.event_bus},
        )
        app.state.realtime_hub = RealtimeHub(
            app.state.redis, app.state.session_factory, settings.secret_key
        )
        await app.state.realtime_hub.start()
        logger.info("app.started", env=settings.env)
        try:
            yield
        finally:
            await app.state.realtime_hub.stop()
            await app.state.redis.aclose()
            await app.state.db_engine.dispose()
            logger.info("app.stopped")

    app = FastAPI(
        title="InvoTaxi Backend",
        version="0.1.0",
        default_response_class=ORJSONResponse,
        lifespan=lifespan,
    )
    app.add_middleware(RequestIDMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    metrics_registry = CollectorRegistry()
    multiprocess_enabled = bool(os.getenv("PROMETHEUS_MULTIPROC_DIR"))
    if not multiprocess_enabled:
        for metric in CUSTOM_METRICS:
            metrics_registry.register(metric)

    Instrumentator(
        excluded_handlers=["/metrics"],
        should_group_status_codes=True,
        registry=metrics_registry,
    ).instrument(app)

    @app.middleware("http")
    async def track_inprogress(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        HTTP_REQUESTS_INPROGRESS.inc()
        try:
            return await call_next(request)
        finally:
            HTTP_REQUESTS_INPROGRESS.dec()

    @app.get("/metrics", include_in_schema=False)
    async def prometheus_metrics() -> Response:
        registry = metrics_registry
        if multiprocess_enabled:
            registry = CollectorRegistry()
            multiprocess.MultiProcessCollector(registry)  # type: ignore[no-untyped-call]
        return Response(generate_latest(registry), media_type=CONTENT_TYPE_LATEST)

    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)

    api_v1 = APIRouter(prefix="/api/v1")
    api_v1.include_router(health_router)
    api_v1.include_router(auth_router)
    api_v1.include_router(clients_router)
    api_v1.include_router(dependents_router)
    api_v1.include_router(drivers_router)
    api_v1.include_router(orders_router)
    api_v1.include_router(dispatch_router)
    api_v1.include_router(devices_router)
    api_v1.include_router(realtime_router)
    api_v1.include_router(reports_router)
    app.include_router(api_v1)
    return app


app = create_app()
