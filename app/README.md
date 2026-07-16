# InvoTaxi app

Единое Flutter-приложение пассажира и водителя, подключённое к
`../backend`. Mock-данные удалены. Из FastAPI загружаются сессия, профиль,
заказы и история; статусы обновляются через WebSocket.

## Локальный запуск

Сначала запустите backend из `../backend`, затем:

```bash
flutter pub get
flutter run --dart-define-from-file=config/local.json
```

На Android Emulator `localhost` автоматически заменяется на `10.0.2.2`.
Для физического телефона укажите LAN-адрес компьютера в `config/local.json`.

Номер телефона сохраняется на устройстве. В локальном dev-режиме временный
пароль — `1111`; backend создаёт профиль при первом входе. В production этот
режим выключается через `DEV_AUTO_REGISTER=false`.

Водитель переводится online после входа и отправляет GPS каждые 7 секунд.
Передаются только точки с заявленной горизонтальной точностью не хуже 5 м.

## Проверка и сборка

```bash
flutter analyze
flutter test
flutter build apk --release --dart-define-from-file=config/local.json
```

Ключи находятся только в ignored-файле `config/local.json`; шаблон —
`config/local.example.json`.

Переданный legacy-ключ работает с Яндекс Картами и Geocoder API, но отдельный
Suggest API отвечает `403`. Поэтому поиск адреса автоматически использует
Geocoder и всё равно возвращает реальные координаты без моков. Для ускоренных
подсказок достаточно заменить `YANDEX_MAPS_SUGGEST_API_KEY` на ключ с доступом
к Suggest API.
