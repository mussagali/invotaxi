# P9 load test

Полная матрица запускается из корня backend одной командой:

```bash
./loadtest/run_matrix.sh
```

Скрипт создаёт отдельный Compose project и чистые volumes для каждого профиля,
применяет миграции, загружает 250 водителей, 1100 клиентов и ровно 600 заказов
для dispatch, проверяет provisioned Grafana dashboard, затем запускает k6.
Существующий dev-стек и его volumes не затрагиваются.

Параметры через ENV: `TEST_DURATION`, `RAMP_DURATION`, `STEADY_DURATION`,
`DISPATCH_DELAY`, `DISPATCH_MAX_DURATION`, `DRIVERS_VU`, `CLIENTS_VU`,
`DISPATCHER_RPM`, `BASE_URL`, `WS_URL`. Для штатного прогона используются 30
минут суммарно: ramp-up 3 минуты + steady 27 минут.

Короткая проверка контура (не является результатом замера):

```bash
VUS=20 DISPATCHER_RPM=6 TEST_DURATION=40s RAMP_DURATION=5s \
STEADY_DURATION=35s DISPATCH_DELAY=10s DISPATCH_MAX_DURATION=30s \
./loadtest/run_matrix.sh
```

Артефакты каждого полного прогона находятся в `loadtest/results/`:
Markdown-отчёт, k6 summary/log, docker stats и строка dispatch из PostgreSQL.
`loadtest/CONCLUSION.md` всегда пересобирается только из этих отчётов.
