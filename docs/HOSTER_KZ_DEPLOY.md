# Развёртывание backend InvoTaxi на Hoster.kz

Схема для тарифа Cloud `1 vCPU / 2 ГБ RAM / 50 ГБ`:

- сайт загружается отдельно;
- APK распространяется отдельно;
- на облачном сервере работают API, PostgreSQL, Redis и фоновый worker;
- `api.marzha.kz` направляется на сервер и получает автоматический HTTPS.

Этот тариф рассчитан только на временный тест с небольшим числом пользователей.

## Что нужно взять из кабинета Hoster.kz

Нужны публичный IP, логин `root`, пароль root и установленная ОС Ubuntu 24.04.
Hoster.kz отправляет доступы на контактную почту. IP также отображается в
основной информации об облачном сервере.

## DNS

В управлении DNS домена `marzha.kz` добавьте запись:

| Тип | Имя | Значение |
|---|---|---|
| A | api | публичный IP облачного сервера |

После обновления DNS команда `nslookup api.marzha.kz` должна показать IP сервера.

## Подключение и подготовка сервера

На Windows PowerShell:

```powershell
ssh root@SERVER_IP
```

На сервере:

```bash
apt-get update
apt-get install -y ca-certificates curl git openssl
curl -fsSL https://get.docker.com -o /root/get-docker.sh
sh /root/get-docker.sh
```

Добавьте swap, иначе сборка Docker на 2 ГБ может завершиться из-за нехватки памяти:

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Откройте только SSH и веб-порты:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
```

## Загрузка backend

В корне проекта уже подготовлен архив `invotaxi-hoster-backend.tar.gz` без
локального `.env`, тестовых кешей и других лишних файлов. Загрузите его из
Windows PowerShell:

```powershell
ssh root@SERVER_IP "mkdir -p /opt/invotaxi"
scp invotaxi-hoster-backend.tar.gz root@SERVER_IP:/opt/invotaxi/
```

Распакуйте на сервере:

```bash
cd /opt/invotaxi
tar -xzf invotaxi-hoster-backend.tar.gz
rm invotaxi-hoster-backend.tar.gz
```

Локальный `backend/.env` намеренно не включён в архив.

## Настройка `.env`

```bash
cd /opt/invotaxi/backend
cp .env.example .env
nano .env
```

Минимальные параметры:

```dotenv
POSTGRES_USER=invotaxi
POSTGRES_PASSWORD=СЛУЧАЙНЫЙ_ПАРОЛЬ
POSTGRES_DB=invotaxi
DATABASE_URL=postgresql+asyncpg://invotaxi:ТОТ_ЖЕ_ПАРОЛЬ@postgres:5432/invotaxi
REDIS_URL=redis://redis:6379/0
SECRET_KEY=СЛУЧАЙНЫЙ_СЕКРЕТ_64_СИМВОЛА
ENV=prod
API_WORKERS=1
DEV_AUTO_REGISTER=false
VITE_ALLOW_DEV_LOGIN=false
API_DOMAIN=api.marzha.kz
CORS_ALLOWED_ORIGINS=https://marzha.kz,https://www.marzha.kz,https://server.marzha.kz
```

Сгенерировать пароль и секрет:

```bash
openssl rand -hex 24
openssl rand -hex 32
```

Задайте также новые `SEED_ADMIN_PASSWORD` и `SEED_USER_PASSWORD`.

## Запуск

```bash
cd /opt/invotaxi/backend
docker compose -f docker-compose.hoster.yml config --quiet
docker compose -f docker-compose.hoster.yml up -d --build
docker compose -f docker-compose.hoster.yml ps
```

Первая сборка на одном vCPU может идти 10–20 минут. Проверка:

```bash
curl https://api.marzha.kz/api/v1/health
docker compose -f docker-compose.hoster.yml logs --tail=100 api
```

## Подключение сайта и APK

Перед сборкой сайта задайте:

```dotenv
VITE_API_BASE_URL=https://api.marzha.kz/api/v1
VITE_WS_BASE_URL=wss://api.marzha.kz
```

В `app/config/local.json` перед сборкой APK задайте:

```json
{
  "API_BASE_URL": "https://api.marzha.kz/api/v1",
  "ALLOW_DEV_LOGIN": "false",
  "YANDEX_MAPS_API_KEY": "YOUR_KEY",
  "YANDEX_MAPS_SUGGEST_API_KEY": "YOUR_KEY"
}
```

## Обновление

Соберите свежий архив, повторно скопируйте и распакуйте его, затем выполните:

```bash
cd /opt/invotaxi/backend
docker compose -f docker-compose.hoster.yml up -d --build
```

Данные PostgreSQL сохраняются в Docker volume и при обновлении не удаляются.
Не запускайте `docker compose down -v`, если данные нужно сохранить.
