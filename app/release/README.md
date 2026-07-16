# Локальные Android-сборки InvoTaxi

- `invotaxi-local-debug.apk` — установка напрямую на Android;
- `invotaxi-local.aab` — проверка формата Android App Bundle;
- временный пароль: `1111`;
- API: `http://192.168.0.5:8000/api/v1`.

Телефон и сервер должны находиться в одной Wi-Fi сети. Эти файлы не следует
загружать в магазин: production-манифест запрещает HTTP. Production AAB нужно
пересобрать с настоящим HTTPS API и upload key по инструкции
`store/RELEASE_CHECKLIST.md`.
