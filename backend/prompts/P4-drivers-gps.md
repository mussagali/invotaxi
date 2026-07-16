# P4 — Водители и GPS-ингест

## Роль
Senior backend. Проект invotaxi-backend (P0–P3 готовы). Модуль водителей:
смены, онлайн-статус, приём GPS-позиций. Это самый частый запрос в
системе (~250 водителей × пинг каждые 5–10 с) — путь должен быть
Redis-only, без обращений к Postgres в запросе.

## Скоуп
1. Эндпойнты `/api/v1/drivers`:
   - `GET /me` (driver) — профиль + текущая смена;
   - `POST /me/online` / `POST /me/offline` (driver) — is_online в БД
     + событие в Redis pub/sub `dispatch:{region}`;
   - `POST /me/location {lat, lon, ts, speed?, heading?}` (driver) —
     допускается батч (массив до 20 точек);
   - `GET /` (dispatcher) — список с фильтром по region/is_online;
   - `GET /live?district=` (dispatcher) — живые позиции всех онлайн
     водителей из Redis (GEOSEARCH по bbox района или весь город);
   - `PATCH /{id}` (dispatcher/admin) — регион, вместимость, смена.
2. Ингест позиции (сервис `app/services/telemetry.py`):
   - валидация: bbox Атырау (46.85–47.35 / 51.55–52.15); точка вне
     bbox НЕ сохраняется, а логируется
     `gps_anomaly driver_id=... lat=... lon=...` и инкрементит счётчик
     `anomaly:{driver_id}:{date}` в Redis — это защита от «Бага №7»
     (у отдельных водителей выгрузка стабильно даёт координаты за
     50–80 км от города);
   - ts не старше 5 минут и не из будущего (> +30 c) — иначе отбросить;
   - запись: `GEOADD drivers:live` + `HSET driver:pos:{id}
     {lat, lon, ts, speed}` с TTL 120 с (протухшие позиции исчезают);
   - rate-limit: не чаще 1 батча/с на водителя.
3. Флаш истории: ARQ cron-задача каждые 60 с — снять текущие позиции
   всех онлайн водителей и bulk-insert в driver_track_history (bulk,
   одна транзакция). Плюс cron очистки партиций старше 30 дней.
4. `GET /api/v1/orders/{id}/driver-position` (client, только по своему
   заказу в статусе assigned/driver_en_route/picked_up) — позиция
   назначенного водителя из Redis; 204 если позиции нет/протухла.

## Definition of Done
- [ ] POST location НЕ делает ни одного SQL-запроса (проверить echo/
      фикстурой-счётчиком) (тест)
- [ ] точка вне bbox отклонена, счётчик аномалий вырос (тест)
- [ ] позиция протухает через 120 с (тест с fakeredis/testcontainers,
      манипуляция TTL)
- [ ] flush-задача переносит позиции в track_history (тест)
- [ ] клиент не получает позицию водителя по чужому заказу — 404 (тест)
- [ ] батч из 20 точек обрабатывается одним pipeline'ом Redis (тест/ревью)
- [ ] p95 POST /me/location < 20 мс локально на 100 параллельных
      запросах (быстрый sanity-бенч скриптом, приложить вывод)
