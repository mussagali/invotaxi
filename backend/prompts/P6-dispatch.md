# P6 — Dispatch: планирование, draft-план, публикация

## Роль
Senior backend. Проект invotaxi-backend (P0–P5 готовы; движок в
`routing/` со `solve()` и `online_insert()`). Свяжи движок с продуктом:
запуск расчёта, черновик плана, правки диспетчера, публикация.

## Скоуп
1. `POST /api/v1/dispatch/jobs {service_date, district, config_overrides?}`
   (dispatcher) → создаёт routing_jobs(queued), ставит ARQ-задачу,
   отвечает 202 {job_id}. Одновременно не более одного running-job на
   (date, district) — иначе 409.
2. ARQ-задача `run_dispatch_job`:
   - грузит заказы (status in created|scheduled|exception, по дате и
     району) и водителей (is_online, регион);
   - **адаптер app → движок** (`app/services/dispatch_adapter.py`):
     нормализация, схлопывание близнецов по twin_group_id
     (представитель несёт сумму seats), координатные аномалии водителей
     (вне bbox / null) → подмена средней по району + запись в
     result_stats.anomalies;
   - вызывает `routing.solve()`;
   - в одной транзакции: route_plans(draft) + route_assignments +
     driver_lunches; заказы из плана → scheduled; unassigned →
     exception (meta: «не влез в парк ±15 мин»);
   - `needs_review = bool(bug_report непустой)`;
   - job → done (или failed с error, заказы не трогаются).
3. Работа с draft-планом (все — dispatcher):
   - `GET /plans?date=&district=` , `GET /plans/{id}` — полный план:
     по водителям блоки с расчётными временами, обеды, исключения.
     Наружу для клиента/водителя отдаётся ЗАЯВЛЕННОЕ время заказа,
     расчётное — только диспетчеру (правило «Баг №10»);
   - `POST /plans/{id}/move {order_id, to_driver_id, position?}` —
     перенос заказа; сервер пересобирает маршрут целевого водителя
     через движок и отклоняет с 422 + причиной, если нарушаются
     окна/места; source-водитель тоже пересобирается;
   - `POST /plans/{id}/unassign {order_id}` → exception;
   - `POST /plans/{id}/revalidate` → свежий ValidationReport.
4. `POST /plans/{id}/publish`:
   - запрещено, если needs_review и не передан force=true (force
     логируется с actor);
   - транзакция: план → published (архивируя прошлый published этой
     даты/района), заказы → assigned;
   - события в Redis pub/sub: каждому водителю `driver:{id}` его
     маршрут, каналу `dispatch:{district}` — факт публикации
     (доставку делает P7, здесь только publish в Redis).
5. `POST /api/v1/dispatch/insert {order_id}` (dispatcher) — дозаказ в
   опубликованный план через `routing.online_insert()` с фактическими
   позициями водителей из Redis; успех → assignment добавлен, заказ
   assigned; неуспех → exception + 200 с {placed: false, reason}.

## Definition of Done
- [ ] полный цикл в интеграционном тесте: сиды → job → draft →
      move → publish → статусы заказов assigned, события в Redis
- [ ] повторный job на тот же (date, district) при running → 409 (тест)
- [ ] draft с bug_report публикуется только с force (тест)
- [ ] move с нарушением окна → 422, план не изменился (тест)
- [ ] упавший job: статус failed, заказы остались в исходных статусах,
      мусорного draft нет (тест с моком solve, кидающим исключение)
- [ ] близнецы всегда в одном блоке одного водителя (тест)
- [ ] insert в опубликованный план работает и уважает обед (тест)
- [ ] в API-ответах клиенту/водителю нет расчётного времени, только
      заявленное (тест)
