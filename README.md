# InvoTaxi — конечная структура

- `backend/` — единственный FastAPI backend, PostgreSQL, Redis, ARQ, monitoring и load tests;
- `frontend/` — диспетчерский React-сайт на актуальном REST/WS контракте;
- `app/` — Flutter-приложение пассажира и водителя.

## Запуск backend и сайта

```powershell
cd backend
docker compose up -d --build
```

- сайт: `http://localhost:8080`;
- API: `http://localhost:8000/api/v1`;
- health: `http://localhost:8000/api/v1/health`.
- политика: `http://localhost:8080/privacy`;
- соглашение: `http://localhost:8080/terms`;
- удаление аккаунта: `http://localhost:8080/account-deletion`.

Для локального входа используйте любой корректный казахстанский номер и
временный пароль `1111`. Номер сохраняется на устройстве/в браузере.

Локальные сотрудники создаются автоматически при запуске compose:

- `+77755777584` — Диар, администратор;
- `+77784906550` — Айболат, администратор;
- `+77753454748` — Арсен, диспетчер;
- `+77714592754` — Бекболат, диспетчер.

Временный пароль для этих учётных записей — `1111`. Перед публикацией сервиса
в интернете пароль необходимо заменить.

## Запуск приложения

```powershell
cd app
flutter pub get
flutter run --dart-define-from-file=config/local.json
```

Локальные ключи импортируются из переданного legacy ZIP командой:

```powershell
backend\scripts\import_legacy_client_keys.ps1
```

Скрипт не выводит значения ключей и записывает их только в ignored-файлы.

Для APK, который запускается на физическом телефоне в одной Wi-Fi сети с этим
компьютером:

```powershell
backend\scripts\import_legacy_client_keys.ps1 -ApiBaseUrl "http://192.168.0.5:8000/api/v1"
```

Готовая локальная сборка находится в
`app/release/invotaxi-local-debug.apk`. Проверочный Android App Bundle —
`app/release/invotaxi-local.aab`.

Перед публикацией обязательно задайте настоящий HTTPS API, email/реквизиты
оператора и подпись магазина. Пошаговая инструкция и декларация данных:
`app/store/RELEASE_CHECKLIST.md` и `app/store/DATA_SAFETY.md`.
