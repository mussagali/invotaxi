# InvoTaxi frontend

Единая диспетчерская для `../backend`. Использует только актуальные REST/WS
контракты FastAPI: клиенты, заказы, водители, dispatch jobs, планы, аналитика
и авторизованный WebSocket.

```bash
npm ci
npm run dev
```

Локальный адрес: `http://localhost:5173`. Backend: `http://localhost:8000`.
Номер диспетчера сохраняется в браузере; временный dev-пароль — `1111`.

Production build:

```bash
npm run build
```

На главном экране отображается живая Яндекс-карта из `/drivers/live`. Ключи
берутся из ignored-файла `.env.local`; в Docker их передаёт `../backend/.env`,
который заполняется скриптом импорта.

Публичные страницы для магазинов приложений: `/privacy`, `/terms`,
`/account-deletion`, `/support`. Перед production-развёртыванием задайте
реальный `VITE_LEGAL_CONTACT_EMAIL`.
