# P0 — Каркас проекта

## Роль
Ты — senior Python backend-разработчик. Создай каркас проекта
`invotaxi-backend`: бэкенд соцтакси на FastAPI (модульный монолит +
фоновый воркер ARQ), PostgreSQL 16 + PostGIS, Redis 7, Docker Compose.
Только каркас — без бизнес-логики.

## Скоуп
1. Структура репозитория:
```
app/{api/v1,core,domain,services,realtime,workers}/  (везде __init__.py)
routing/            # пустой пакет, придёт в P5, НЕ зависит от app/
tests/{unit,integration}/
loadtest/
migrations/
```
2. `pyproject.toml` (uv или poetry): fastapi, uvicorn[standard], gunicorn,
   sqlalchemy[asyncio]>=2, asyncpg, alembic, redis>=5, arq, pydantic>=2,
   pydantic-settings, structlog, orjson; dev: pytest, pytest-asyncio,
   httpx, testcontainers[postgres,redis], ruff, mypy.
3. `app/core/config.py` — Pydantic Settings, всё из ENV: DATABASE_URL,
   REDIS_URL, SECRET_KEY, ENV(dev|prod), LOG_LEVEL. `.env.example`.
4. `app/core/logging.py` — structlog, JSON в prod, читаемый в dev,
   request_id middleware.
5. `app/main.py` — фабрика приложения, роутер `/api/v1`,
   `GET /api/v1/health` → `{status, db, redis}` (реальные пинги обоих),
   обработчики ошибок (единый формат JSON-ошибки `{error: {code, message}}`).
6. `app/workers/main.py` — ARQ WorkerSettings + демо-задача `ping_task`.
7. `docker-compose.yml` (dev): api (reload), worker, postgres
   (postgis/postgis:16), redis (appendonly), volumes, healthchecks на все
   сервисы. `Dockerfile` multi-stage (build → slim runtime, non-root user).
8. Alembic инициализирован (async), первая пустая миграция прогоняется.
9. CI `.github/workflows/ci.yml`: ruff check, mypy, pytest (сервисы через
   testcontainers или services в CI).
10. `Makefile`: `make up / down / test / lint / migrate / shell`.

## Definition of Done
- [ ] `docker compose up -d` → все 4 контейнера healthy
- [ ] `GET /api/v1/health` возвращает 200 с db:ok, redis:ok
- [ ] health возвращает 503 с db:fail, если Postgres остановлен
- [ ] `make test` зелёный (минимум: тест health, тест конфига, тест ping_task через arq)
- [ ] `make lint` (ruff + mypy strict для app/core) зелёный
- [ ] alembic upgrade head работает внутри контейнера
- [ ] в коде нет ни одного захардкоженного секрета/URL

## Тесты (обязательные)
- `tests/integration/test_health.py` — оба сценария health.
- `tests/unit/test_config.py` — конфиг падает без SECRET_KEY.

Не делай: моделей БД, авторизации, эндпойнтов сверх health. Это P1–P3.
