# P1 — Схема БД, миграции, сиды

## Роль
Senior backend. Проект: invotaxi-backend (каркас P0 готов: FastAPI,
SQLAlchemy 2 async, Alembic, PostgreSQL 16 + PostGIS). Создай полную
схему данных.

## Контекст домена
Соцтакси для инвалидов (Атырау). Заказы на день с желаемым временем
(окно ±15 мин), у клиента может быть сопровождающий (тогда занимает
2 места). «Близнецы» — заказы, которые обязаны ехать одной машиной
одновременно. Водители: седаны (4 места) и минивэны (6 мест), привязаны
к району. Распределение считается движком и сохраняется как план
(draft → published). Заявленное клиентом время НИКОГДА не
перезаписывается расчётным.

## Скоуп — таблицы (SQLAlchemy 2 typed models + alembic-миграция)

```
users: id uuid pk, phone text unique not null (нормализован: 10 цифр),
  password_hash, role enum(client,driver,dispatcher,admin),
  status enum(active,blocked), created_at, updated_at
client_profiles: user_id pk fk, full_name, needs_escort bool default false,
  notes text, default_addresses jsonb default '[]'
drivers: user_id pk fk, full_name, region text not null,
  vehicle_model, plate, capacity int not null check in (4,6),
  is_online bool default false, shift_start time, shift_end time,
  home_lat float8, home_lon float8
orders: id uuid pk, client_id fk client_profiles, created_by fk users,
  service_date date not null, desired_time time not null,
  pickup_addr text, pickup_lat float8, pickup_lon float8,
  dropoff_addr text, dropoff_lat float8, dropoff_lon float8,
  escort bool default false, seats int not null default 1 check in (1,2),
  twin_group_id uuid null,
  status enum(created,scheduled,assigned,driver_en_route,picked_up,
              completed,cancelled,exception) default 'created',
  cancel_reason text, external_id text unique null, created_at, updated_at
route_plans: id uuid pk, service_date, district text,
  status enum(draft,published,archived) default 'draft',
  needs_review bool default false, stats jsonb, created_by fk users null,
  routing_job_id uuid null, created_at, published_at null
route_assignments: id uuid pk, plan_id fk cascade, driver_id fk drivers,
  seq int not null, kind enum(trip,run),
  order_ids uuid[] not null,
  planned_pickup_at timestamptz, planned_dropoff_at timestamptz,
  pickup_seq jsonb, dropoff_seq jsonb,
  unique(plan_id, driver_id, seq)
driver_lunches: plan_id fk, driver_id fk, start_min int, end_min int,
  is_full bool, pk(plan_id, driver_id)
driver_track_history: id bigserial, driver_id fk, ts timestamptz,
  lat float8, lon float8 — ПАРТИЦИОНИРОВАНИЕ по дню (range on ts),
  функция/механизм создания партиций + индекс (driver_id, ts)
order_events: id bigserial, order_id fk, ts default now(), actor_id fk
  users null, from_status, to_status, meta jsonb default '{}'
routing_jobs: id uuid pk, service_date, district,
  status enum(queued,running,done,failed), params jsonb,
  result_stats jsonb, unassigned_order_ids uuid[], bug_report jsonb,
  error text, created_at, started_at, finished_at
```

Индексы: orders(service_date, status), orders(client_id),
orders(twin_group_id) where not null, route_assignments(plan_id),
order_events(order_id, ts), users(phone).

## Дополнительно
- `app/domain/repositories.py` — репозитории (async) для orders, drivers,
  plans: get/list с фильтрами, create, тонкие — без бизнес-логики.
- Сид-скрипт `scripts/seed_dev.py`: 3 района Атырау, 20 водителей
  (4 минивэна) с реальными координатами города (bbox 46.85–47.35 lat,
  51.55–52.15 lon), 60 клиентов, 150 заказов на завтра c разбросом
  времени 07:00–19:00, 2 близнецовые пары (одинаковый twin_group_id),
  диспетчер и админ (пароль из ENV).

## Definition of Done
- [ ] alembic upgrade head с нуля → все таблицы, enum'ы, партиции
- [ ] alembic downgrade base → чисто (миграция обратима)
- [ ] seed_dev.py идемпотентен (второй запуск не падает и не дублирует)
- [ ] mypy зелёный на app/domain
- [ ] тесты: вставка заказа с seats=3 падает (check), дубль phone падает,
      партиция для track_history создаётся на нужную дату
- [ ] в моделях НЕТ бизнес-логики (только структура)

Не делай: эндпойнтов, авторизации, state machine (P2/P3).
