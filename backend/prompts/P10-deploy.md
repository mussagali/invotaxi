# P10 — Продакшен-деплой

## Роль
Senior DevOps. Проект invotaxi-backend (P0–P9 готовы, целевой сервер
известен из P9). Подготовь боевой деплой на один VPS (Ubuntu 24.04,
Docker) с TLS, бэкапами и runbook'ом.

## Скоуп
1. `docker-compose.prod.yml`:
   - api (gunicorn -k uvicorn.workers.UvicornWorker, воркеров по числу
     CPU из P9), worker, postgres, redis, caddy;
   - Caddy: домен из ENV, автоматический Let's Encrypt, HSTS, gzip,
     reverse_proxy к api (включая WS), `/metrics` закрыт снаружи
     (доступ только из внутренней сети/по basic auth);
   - restart: always, лимиты ресурсов из P9, логи json-file с ротацией
     (max-size 50m, max-file 5);
   - postgres и redis НЕ публикуют порты наружу (только internal network);
   - healthchecks + `depends_on: condition: service_healthy`.
2. Бэкапы:
   - сервис-контейнер pgbackrest ИЛИ cron-скрипт: pg_dump ежедневно
     03:00 + хранение 14 дней локально; выгрузка в S3-совместимое
     хранилище (ENV: endpoint/bucket/keys), шифрование age/gpg;
   - `scripts/restore.sh` — восстановление одной командой на чистой
     машине; ПРОВЕРЕН реально (дамп → новый compose → health ok);
   - Redis: appendonly yes (позиции и очередь переживают рестарт).
3. Деплой-процесс:
   - `scripts/deploy.sh`: git pull → build → alembic upgrade →
     rolling-рестарт (api по одному) → smoke-check /health;
   - `.env.prod.example` со ВСЕМИ переменными и комментариями;
   - первичная настройка сервера `scripts/bootstrap_server.sh`: ufw
     (22, 80, 443 только), fail2ban, докер, swap 2G, unattended-upgrades,
     отдельный пользователь deploy без sudo-пароля для CI.
4. `RUNBOOK.md` (по-русски, для того, кто будет дежурить):
   - как посмотреть логи каждого сервиса; что делать при: API 5xx,
     переполнении диска, зависшем dispatch-job (как убить job и
     перезапустить), потере Redis (что теряется: живые позиции — не
     страшно, очередь — как переставить job), восстановлении из бэкапа;
   - чек-лист перед днём работы: health, место на диске, время
     последнего бэкапа, вчерашние exception-заказы.
5. CI/CD: GitHub Actions деплой-workflow по тегу `v*` (ssh → deploy.sh),
   секреты в GitHub Secrets.

## Definition of Done
- [ ] чистый VPS → bootstrap → deploy → https://домен/api/v1/health = 200,
      TLS A-рейтинг (ssllabs или testssl.sh)
- [ ] postgres/redis недоступны с внешнего IP (проверка nmap/nc)
- [ ] restore.sh реально восстановил БД на второй машине/чистом volume
- [ ] рестарт сервера (reboot) → всё поднялось само, health ok
- [ ] деплой новой версии не рвёт активные WS дольше чем на 10 с
- [ ] RUNBOOK проверен «сухим прогоном» каждого сценария
- [ ] в git нет ни одного секрета (gitleaks в CI)
