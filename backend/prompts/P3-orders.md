# P3 — Orders API + state machine

## Роль
Senior backend. Проект invotaxi-backend (P0–P2 готовы). Сделай модуль
заказов: CRUD + жизненный цикл через state machine + близнецы.

## Правила домена (нарушать нельзя)
- `desired_time` — время, заявленное клиентом. Оно НИКОГДА не меняется
  системой. Расчётные времена живут только в route_assignments.
- `seats = 2`, если escort=true, иначе 1. Выставляется сервером,
  клиентский ввод seats игнорируется.
- Близнецы: `POST /orders/{id}/twin {other_order_id}` (диспетчер) —
  связывает заказы одним twin_group_id; допустимо только если совпадают
  service_date и desired_time и оба в статусе created/scheduled.
- Координаты: если заданы — обязаны попадать в bbox Атырау
  (lat 46.85–47.35, lon 51.55–52.15), иначе 422 с понятной ошибкой
  (защита от кривого геокодинга — «Баг №8» из практики проекта).

## State machine (единственная точка смены статуса)
`app/services/order_state.py`:
```
created → scheduled → assigned → driver_en_route → picked_up → completed
created|scheduled|assigned → cancelled (обязателен reason, кто отменил)
scheduled|assigned → exception (только система/диспетчер, meta: причина)
exception → scheduled (диспетчер вернул в работу)
```
Любой другой переход → доменная ошибка 409. Каждый переход пишет
order_events(actor, from, to, meta) в ТОЙ ЖЕ транзакции.

## Эндпойнты `/api/v1/orders`
- `POST /` — клиент создаёт себе; диспетчер — любому клиенту.
  service_date ≥ сегодня; лимит: у клиента ≤ 4 активных заказа на дату.
- `GET /{id}` — клиент только свой, водитель только назначенный ему
  (проверка через route_assignments опубликованного плана), диспетчер любой.
- `GET /` — фильтры: service_date, status, district, client_id;
  пагинация limit/offset (max 100); клиенту — только свои.
- `PATCH /{id}` — адреса/время/escort; только в created|scheduled;
  клиент — только свой.
- `POST /{id}/cancel {reason}` — по машине состояний.
- `POST /{id}/transition {to, meta}` — только dispatcher/admin.
- `POST /import` (dispatcher) — массовый импорт JSON-списка в формате
  колонок старой платформы: `{fio, from_addr, to_addr, time "HH:MM",
  phone, pickup_lat/lon, dropoff_lat/lon, external_id, escort_note}`;
  телефон нормализуется, клиент ищется по телефону или создаётся;
  escort парсится из note («с сопровождением»/«без»); дубликаты по
  external_id пропускаются; ответ — отчёт {created, skipped, errors[]}.

## Definition of Done
- [ ] все эндпойнты покрыты интеграционными тестами (успех + минимум
      один негативный на каждый)
- [ ] клиент не может читать/менять чужой заказ — 404 (не 403, не
      раскрываем существование) (тест)
- [ ] недопустимый переход (completed → cancelled) → 409 (тест)
- [ ] каждый переход оставляет строку в order_events (тест)
- [ ] twin с разным временем → 422 (тест)
- [ ] импорт: повторный импорт того же файла → все skipped (тест)
- [ ] UPDATE orders.status напрямую отсутствует в кодовой базе, кроме
      order_state.py (проверяемо grep'ом)
