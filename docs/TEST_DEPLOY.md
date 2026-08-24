# Тестовый запуск InvoTaxi на VPS (1–3 дня)

Для нескольких тестировщиков достаточно Ubuntu 24.04, 2 vCPU, 4 ГБ RAM и
60–80 ГБ SSD. Для нагрузочного теста используйте минимум 4 vCPU / 8 ГБ RAM.

## 1. Создание сервера

Создайте VPS с Ubuntu 24.04 и добавьте свой SSH-ключ. В firewall провайдера
оставьте входящие TCP-порты 22, 80 и 443, а также UDP 443. PostgreSQL, Redis и
API наружу в тестовом compose-файле не публикуются.

Скопируйте публичный IPv4 сервера. Бесплатное временное доменное имя можно
получить без регистрации: `<IP-с-дефисами>.sslip.io`. Например, адресу
`203.0.113.10` соответствует `203-0-113-10.sslip.io`.

## 2. Установка Docker

Подключитесь к серверу:

```bash
ssh root@SERVER_IP
```

Установите Docker из официального репозитория:

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
apt-get install -y git
```

## 3. Загрузка проекта

Если проект находится в Git:

```bash
git clone YOUR_REPOSITORY_URL /opt/invotaxi
cd /opt/invotaxi/backend
```

Если Git-репозитория нет, на Windows выполните из папки проекта:

```powershell
scp -r . root@SERVER_IP:/opt/invotaxi
```

Затем снова подключитесь по SSH и перейдите в `/opt/invotaxi/backend`.

## 4. Настройка

```bash
cp .env.example .env
nano .env
```

Обязательно замените `POSTGRES_PASSWORD`, `SECRET_KEY`, пароли seed-пользователей
и укажите:

```dotenv
ENV=prod
DEV_AUTO_REGISTER=false
VITE_ALLOW_DEV_LOGIN=false
CORS_ALLOWED_ORIGINS=https://203-0-113-10.sslip.io
TEST_DOMAIN=203-0-113-10.sslip.io
```

Сгенерировать секреты можно так:

```bash
openssl rand -hex 32
```

`TEST_DOMAIN` читается Docker Compose из `.env`, а Caddy автоматически получает
TLS-сертификат. Замените примерный IP на IP своего VPS.

## 5. Запуск и проверка

```bash
docker compose -f docker-compose.test.yml up -d --build
docker compose -f docker-compose.test.yml ps
docker compose -f docker-compose.test.yml logs -f api
```

Проверки:

```bash
curl https://YOUR_TEST_DOMAIN/api/v1/health
```

Сайт будет доступен по `https://YOUR_TEST_DOMAIN`. Тот же адрес с суффиксом
`/api/v1` укажите при сборке мобильного приложения как API base URL.

На компьютере разработчика откройте `app/config/local.json` и задайте:

```json
{
  "API_BASE_URL": "https://YOUR_TEST_DOMAIN/api/v1",
  "ALLOW_DEV_LOGIN": "false",
  "YANDEX_MAPS_API_KEY": "YOUR_KEY",
  "YANDEX_MAPS_SUGGEST_API_KEY": "YOUR_KEY"
}
```

Затем соберите APK:

```powershell
cd app
flutter pub get
flutter build apk --release --dart-define-from-file=config/local.json
```

Файл для установки появится в
`app/build/app/outputs/flutter-apk/app-release.apk`. Его можно отправить
тестировщикам или установить на подключённый Android-телефон командой
`adb install -r build/app/outputs/flutter-apk/app-release.apk`.

## 6. Обновление

```bash
cd /opt/invotaxi
git pull
cd backend
docker compose -f docker-compose.test.yml up -d --build
```

## 7. Удаление через 1–3 дня

Если данные больше не нужны:

```bash
docker compose -f docker-compose.test.yml down -v
```

После этого удалите сам VPS в панели провайдера: остановленный, но не удалённый
VPS у многих провайдеров продолжает тарифицироваться.
