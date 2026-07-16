# InvoTaxi Backend — полная архитектура

Цель: бэкенд соцтакси (Атырау) с автоматическим распределением заказов,
подключаемый к мобильному/веб-приложению. Нагрузка: 1000–1500 человек
онлайн одновременно (клиенты + водители + диспетчеры). Уровень — senior:
простая, наблюдаемая, масштабируемая при необходимости система без
преждевременных микросервисов.

---

## 1. Общий принцип

**Модульный монолит + фоновый воркер.** 1500 онлайн — это малая нагрузка
(пиково ~100–300 RPS API + GPS-пинги). Микросервисы здесь дадут только
накладные расходы. Разделение ровно одно, и оно обязательное:

- **API-процесс** — быстрые запросы (< 100 мс), никаких тяжёлых расчётов.
- **Worker-процесс** — оптимизатор маршрутов (портированный toolkit),
  отчёты, рассылки. Расчёт дня на 600 заказов может занимать минуты —
  он НИКОГДА не выполняется в HTTP-запросе.

```
                        ┌──────────────────────────────────────────┐
                        │                 VPS / сервер             │
 Mobile app (клиент) ─┐ │  ┌───────┐   ┌─────────────────────────┐ │
 Mobile app (водитель)┼─┼─▶│ Caddy │──▶│ API: FastAPI (uvicorn)  │ │
 Web (диспетчер/админ)┘ │  │ (TLS) │   │  REST + WebSocket       │ │
                        │  └───────┘   └───────┬─────────▲───────┘ │
                        │                      │         │pub/sub  │
                        │              ┌───────▼───┐ ┌───┴───────┐ │
                        │              │ PostgreSQL│ │  Redis 7  │ │
                        │              │ 16+PostGIS│ │ geo/cache │ │
                        │              └───────▲───┘ │ /queue    │ │
                        │                      │     └───▲───────┘ │
                        │              ┌───────┴─────────┴───────┐ │
                        │              │ Worker: ARQ (asyncio)   │ │
                        │              │  ├─ routing engine      │ │
                        │              │  ├─ Excel-отчёты        │ │
                        │              │  └─ push-уведомления    │ │
                        │              └─────────────────────────┘ │
                        └──────────────────────────────────────────┘
```

## 2. Стек и обоснование

| Слой | Выбор | Почему |
|---|---|---|
| Язык | Python 3.12 | Алгоритм уже на Python — переносится как пакет, а не переписывается на другой язык |
| API | FastAPI + uvicorn (2-4 воркера за gunicorn) | async, автоматическая OpenAPI-схема для мобильных разработчиков, WebSocket из коробки |
| ORM/DB-слой | SQLAlchemy 2 (async) + Alembic | миграции обязательны с первого дня |
| БД | PostgreSQL 16 + PostGIS | единственный источник истины; PostGIS для гео-запросов и истории треков |
| Кэш/realtime | Redis 7 | GEOADD/GEOSEARCH для живых позиций водителей, pub/sub для WebSocket fan-out, очередь задач, rate-limit |
| Очередь задач | ARQ (Redis-based, asyncio) | легче Celery, тот же Redis, достаточно для 1 воркера; Celery — если появятся сложные цепочки |
| Realtime | WebSocket в FastAPI + Redis pub/sub | при 2+ API-процессах события доставляются во все процессы через pub/sub |
| Reverse proxy | Caddy | TLS автоматом (Let's Encrypt), проще nginx в поддержке |
| Деплой | Docker Compose (prod-профиль) | один сервер, воспроизводимо; k8s не нужен на этом масштабе |
| Наблюдаемость | structlog (JSON) + Prometheus + Grafana + Sentry | без этого «держит ли сервер 1500» — гадание |
| Тесты | pytest + pytest-asyncio + testcontainers; k6 для нагрузки | |

## 3. Домены и модель данных (ядро)

```
users(id, phone, password_hash, role[client|driver|dispatcher|admin], status, created_at)
client_profiles(user_id, full_name, needs_escort bool, default_addresses jsonb, notes)
drivers(user_id, full_name, phone, region, vehicle_model, plate,
        capacity int,           -- мест: 4 седан / 6 минивэн
        is_online bool, shift_start, shift_end,
        home_lat, home_lon)
orders(id, client_id, created_by, service_date date,
       pickup_addr, pickup_lat, pickup_lon,
       dropoff_addr, dropoff_lat, dropoff_lon,
       desired_time time,                      -- заявленное клиентом, НЕ меняется (Баг №9/№10 README)
       escort bool, seats int,                 -- 1 или 2
       twin_group_id uuid null,                -- близнецы: по клиенту/заявке, не по строкам
       status order_status,                    -- см. lifecycle ниже
       external_id text null)                  -- ID на старой платформе на переходный период
route_plans(id, service_date, district, status[draft|published|archived],
            created_by_job_id, stats jsonb, created_at, published_at)
route_assignments(id, plan_id, driver_id, seq int,
                  kind[trip|run], order_ids uuid[],
                  planned_pickup_at, planned_dropoff_at,
                  pickup_seq jsonb, dropoff_seq jsonb)   -- для рейсов минивэна
driver_lunches(plan_id, driver_id, start_min, end_min, is_full bool)
driver_locations_live  -- НЕ таблица: Redis GEOADD drivers:live
driver_track_history(driver_id, ts, lat, lon)  -- партиционирована по дням, флаш из Redis раз в 30-60 c
order_events(order_id, ts, actor, from_status, to_status, meta jsonb)  -- аудит всего
routing_jobs(id, service_date, district, status[queued|running|done|failed],
             params jsonb, result_stats jsonb, unassigned uuid[], bug_report jsonb)
```

### Lifecycle заказа
```
created → scheduled(в draft-плане) → assigned(план опубликован)
        → driver_en_route → picked_up → completed
   любые →  cancelled(кем/причина) ;  assigned → exception(не влез, честный список)
```
Все переходы — через один сервис `OrderStateMachine` с проверкой
допустимости и записью в `order_events`. Никаких «UPDATE status» напрямую.

## 4. Ключевые потоки

### 4.1 Плановое распределение (главный сценарий, как сейчас руками)
1. Диспетчер (или cron в 18:00) вызывает `POST /dispatch/jobs
   {service_date, district, n_rental}`.
2. API кладёт задачу в ARQ, отвечает `202 {job_id}` мгновенно.
3. Worker: грузит заказы+водителей из PG → запускает портированный
   движок (пакет `routing/`) → пишет `route_plans(draft)` +
   `route_assignments` + `routing_jobs.result_stats/bug_report`.
4. **Gate:** если `bug_report` не пуст — план остаётся draft с флагом
   `needs_review`, автопубликация запрещена (правило из README §5).
5. Диспетчер смотрит draft в панели, руками двигает заказы
   (`PATCH /plans/{id}/assignments` — с повторной валидацией окон/мест
   на сервере), жмёт «Опубликовать».
6. Publish: статусы заказов → assigned, водителям уходят push/WS
   уведомления с их маршрутом на день.

### 4.2 GPS водителей (самый частый запрос в системе)
- Приложение водителя шлёт позицию раз в 5–10 с (HTTP POST батчем или
  по открытому WS).
- API: `GEOADD drivers:live` + `HSET driver:{id} ts lat lon` в Redis.
  В PG — НИЧЕГО синхронно.
- Worker раз в 30–60 с сбрасывает срез в `driver_track_history`.
- Клиент, ожидающий машину, получает позицию своего водителя по WS
  (канал `order:{id}`), диспетчер — всю карту (`GEOSEARCH`).
- Это же чинит Баг №7 (кривые координаты из выгрузок): координаты
  берутся из живого потока, аномалии (вне bbox Атырау) отбрасываются
  на входе с логированием по водителю.

### 4.3 Realtime
- Каналы: `driver:{id}` (его маршрут/изменения), `order:{id}` (статус,
  позиция машины), `dispatch:{district}` (для панели диспетчера).
- Публикация только через Redis pub/sub → все API-процессы раздают
  своим WS-подключениям. Fallback для слабых клиентов — polling
  `GET /orders/{id}/status` (дёшево, из Redis-кэша).

### 4.4 Дозаказ в течение дня (онлайн-вставка)
Отдельный лёгкий путь: `POST /dispatch/insert {order_id}` → worker
пробует `find_driver_for_order` по опубликованному плану с учётом
фактического положения водителей (Redis) и уже назначенных обедов (B6).
Не нашлось — заказ в exception-список диспетчеру. Полный пересчёт дня
по требованию — отдельной кнопкой, всегда как новый draft.

## 5. Пакет `routing/` (порт toolkit)

- Переносится 1-в-1 по логике стадий, но: без pandas в горячем пути
  (dataclass + dict), `Order`/`Driver` — frozen dataclasses, вход/выход —
  чистые структуры (никакого знания о БД внутри движка).
- Обязательные фиксы B1–B5 из [01-CODE-REVIEW.md](01-CODE-REVIEW.md),
  для онлайн-вставки — B6, B7.
- `geo_utils` остаётся (haversine + мосты + 1.35); интерфейс
  `DistanceProvider` — одна точка подмены на OSRM позже, как и
  задумано в исходном доке.
- Движок детерминирован: одинаковый вход → одинаковый выход
  (важно для тестов и разбора инцидентов). Все константы
  (TIME_WINDOW_SLACK и т.д.) — в конфиге плана, а не в коде.
- Golden-тесты: зафиксированные входные датасеты (анонимизированные
  реальные дни) + snapshot результата.

## 6. Безопасность
- JWT access (15 мин) + refresh (30 дн, ротация); роли в токене,
  проверка на каждом эндпойнте (dependency).
- Водитель видит ТОЛЬКО свой маршрут; клиент — только свои заказы;
  телефоны клиентов водителю отдаются только по активному назначению.
- Rate-limit на авторизацию и GPS-ингест (Redis).
- Персональные данные (ФИО, телефоны, адреса инвалидов) — это
  чувствительные данные: TLS везде, доступ к проду по SSH-ключам,
  бэкапы шифруются, логи без ПД (маскирование телефонов).

## 7. Оценка нагрузки (1000–1500 онлайн)

| Источник | Оценка | RPS |
|---|---|---|
| GPS-пинги, ~150–250 водителей × 1 пинг/7с | основной поток | 20–40 RPS (Redis-only, <1мс) |
| Клиенты: статус/позиция (WS-push, редкий polling) | 1000+ подключений | ~10–30 RPS |
| CRUD заказов, авторизация, панель | | ~10–50 RPS |
| **Итого пик** | | **~100–150 RPS**, WS ~1500 соединений |

Это спокойно держит один процессорный узел: uvicorn 2–4 воркера,
PgBouncer/пул 20–40 коннектов, Redis — тысячные доли загрузки.
Оптимизатор (минуты CPU) идёт в worker и не влияет на латентность API.
Точные минимальные требования сервера подтверждаются нагрузочным
тестом в P9 — см. [04-SERVER-REQUIREMENTS.md](04-SERVER-REQUIREMENTS.md).

## 8. Интеграция с приложением
- Контракт — OpenAPI (FastAPI генерирует автоматически), версия в пути
  `/api/v1`. Мобильные клиенты генерируют SDK из схемы.
- Переходный период со старой платформой: `orders.external_id` +
  import-эндпойнт `POST /import/orders` (принимает тот же формат
  колонок, что сейчас в Excel) — позволяет запустить бэк до полного
  переезда приложения.
- Push: FCM (водители и клиенты), отправка из worker.

## 9. Структура репозитория
```
invotaxi-backend/
├─ app/
│  ├─ api/v1/          # роутеры: auth, orders, drivers, dispatch, plans, ws
│  ├─ core/            # config, security, deps, logging
│  ├─ domain/          # модели SQLAlchemy, state machine, схемы Pydantic
│  ├─ services/        # бизнес-логика (тонкие роутеры, толстые сервисы)
│  ├─ realtime/        # ws-менеджер + redis pub/sub
│  └─ workers/         # ARQ-задачи: dispatch_job, gps_flush, reports, push
├─ routing/            # портированный движок, БЕЗ зависимостей от app/
├─ tests/              # unit / integration (testcontainers) / golden
├─ loadtest/           # k6-сценарии
├─ migrations/         # alembic
├─ docker-compose.yml  # dev
├─ docker-compose.prod.yml
└─ .github/workflows/ci.yml
```
