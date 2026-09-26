# 🚀 Руководство по развертыванию

## Способ 1: использование Windows `exe`

Загрузите соответствующую версию `OutlookEmail-windows-x64-*.zip` с GitHub Releases и запустите `OutlookEmail.exe` сразу после распаковки.

Когда настольная версия ** запускается в первый раз, она автоматически: **
- Создать локальный каталог данных.
- Инициализация базы данных
- Автоматически генерировать и сохранять `SECRET_KEY`.

**Каталог данных Windows по умолчанию: **
- `%APPDATA%\OutlookEmail`

Адрес доступа по умолчанию по-прежнему `http://127.0.0.1:5000`.

## Способ 2. Используйте Docker (рекомендуется развертывание на сервере).

Непосредственно используйте изображение, автоматически созданное с помощью GitHub Actions, без локальной сборки:

```bash
# Загрузите последнее изображение.
docker pull ghcr.io/assast/outlookemail:latest

# Запустить контейнер
docker run -d \
  --name outlook-mail-reader \
  -p 5000:5000 \
  -v $(pwd)/data:/app/data \
  -e LOGIN_PASSWORD=admin123 \
  -e SECRET_KEY=your-secret-key-here \
  ghcr.io/assast/outlookemail:latest

# Посмотреть журнал
docker logs -f outlook-mail-reader

# Остановить контейнер
docker stop outlook-mail-reader
docker rm outlook-mail-reader
```

** автоматически запустится в первый раз: **
- Создать каталог данных
- Инициализация базы данных
- Создание групп по умолчанию и временных групп почтовых ящиков.
- Установить пароль по умолчанию (admin123)

## Способ 3: запуск напрямую с помощью Python

```bash
# Клонировать репозиторий
git clone https://github.com/assast/outlookEmail.git
cd outlookEmail

# Установить зависимости
pip install -r requirements.txt

# Установка переменных среды
export LOGIN_PASSWORD=admin123
export SECRET_KEY=your-secret-key-here
export PORT=5000

# Запустите приложение
python web_outlook_app.py
```

Получите доступ к `http://localhost:5000` для использования.
При развертывании серверов рекомендуется всегда явно устанавливать фиксированный `SECRET_KEY`.

## Описание режима работы

Службе необходимо поддерживать работу одного рабочего процесса. Краткосрочные задачи, такие как задачи потоковой передачи и проверка экспорта в управлении обновлением токенов, используют внутрипроцессное хранилище состояний; Если настройка развертывается в нескольких рабочих процессах, задача инициализации POST и последующая подписка SSE могут попасть в разные процессы, в результате чего задача не будет существовать или срок ее действия истечет.

Официальный образ Docker исправлен как одиночный рабочий процесс Gunicorn и обрабатывает медленные запросы через потоки:

```bash
gunicorn -k gthread -w 1 --threads ${GUNICORN_THREADS:-4} ...
```

Если вам нужно настроить параллелизм, сначала настройте `GUNICORN_THREADS` и не увеличивайте количество рабочих процессов.

## Использование Docker Compose

```yaml
version: '3.8'

services:
  outlook-mail-reader:
    image: ghcr.io/assast/outlookemail:latest
    container_name: outlook-mail-reader
    ports:
      - "5000:5000"
    volumes:
      - ./data:/app/data
    environment:
      - LOGIN_PASSWORD=admin123
      - SECRET_KEY=your-secret-key-here
      - FLASK_ENV=production
      - GPTMAIL_API_KEY=your-api-key
    restart: unless-stopped
```

```bash
# Запустить службу
docker-compose up -d

# Проверьте журнал запуска запланированного задания (должно появиться сообщение «Запланированное задание запущено»)
docker-compose logs -f

# Остановить службу
docker-compose down
```

## Инструкции по плановому обновлению

- Приложения в режимах одиночного рабочего процесса `python web_outlook_app.py`, Docker, Docker Compose и Gunicorn автоматически инициализируют запланированные задачи.
- Если вам нужно подтвердить, было ли запущено запланированное задание, вы можете выполнить `docker-compose logs -f`, и в журнале должно появиться сообщение «Запланированное задание было запущено».
- При использовании режима Cron убедитесь, что `use_cron_schedule` включен в настройках системы, и введите правильное 5-сегментное выражение Cron.

## Конфигурация переменных среды

| Переменная | Описание | По умолчанию |
|--------|------|--------|
| `SECRET_KEY` | Сеансовый ключ (для развертывания сервера настоятельно рекомендуется использовать фиксированную настройку) | Windows `exe` будет автоматически создан и сохранен при первом запуске; Docker/Python/производственная среда, пожалуйста, задайте фиксированное значение явно и не изменяйте его по своему желанию, иначе сохраненные конфиденциальные данные не будут расшифрованы |
| `LOGIN_PASSWORD` | Пароль для входа | `admin123` |
| `FLASK_ENV` | Операционная среда | `production` |
| `LOG_LEVEL` | Глобальный уровень журнала (`DEBUG` / `INFO` / `WARNING` / `ERROR` / `CRITICAL`). По умолчанию `INFO` выводит исходящие данные `[Агент]` (включая платформу/учетную запись Resin, пароль закодирован). При пакетной отправке сообщений или обновлении токенов ведется множество журналов. Если вам нужны сигналы тревоги только в производственной среде, вы можете настроить `LOG_LEVEL=WARNING` для снижения шума. | `INFO` |
| `PORT` | Порт приложения | `5000` |
| `HOST` | адрес прослушивания | `0.0.0.0` |
| `DATABASE_PATH` | Путь к базе данных | `data/outlook_accounts.db` |
| `GPTMAIL_BASE_URL` | Адрес API GPTMail | `https://mail.chatgpt.org.uk` |
| `GPTMAIL_API_KEY` | GPTMail API Key | `gpt-test` |
| `DUCKMAIL_BASE_URL` | Адрес API DuckMail | `https://api.duckmail.sbs` |
| `DUCKMAIL_API_KEY` | API-ключ DuckMail | Пустой |
| `CLOUDFLARE_WORKER_DOMAIN` | Доменное имя Cloudflare Temp Email Worker, также совместимое с чтением `WORKER_DOMAIN` | пусто |
| `CLOUDFLARE_EMAIL_DOMAINS` | Временный список доменных имен электронной почты Cloudflare, через запятую, также совместим с чтением `EMAIL_DOMAIN` | пусто |
| `CLOUDFLARE_ADMIN_PASSWORD` | Пароль управления Cloudflare, также совместим с чтением `ADMIN_PASSWORD` | пустой |
| `OAUTH_CLIENT_ID` | Идентификатор клиента OAuth | `Рекомендуется использовать свой собственный. Если вы действительно не можете его получить и оставить его пустым, вы будете использовать значение по умолчанию. |
| `OAUTH_REDIRECT_URI` | URI перенаправления OAuth | `Рекомендуется использовать свой собственный. Если вы действительно не можете его получить и оставить его пустым, вы будете использовать значение по умолчанию. |

** генерирует SECRET_KEY: **
```bash
python -c 'import secrets; print(secrets.token_hex(32))'
```

## Сохранение данных

Файл базы данных хранится в каталоге `./data` и монтируется через Docker Volume для постоянного хранения.

Файлы скинов пользовательского внешнего вида хранятся в каталоге `skins/` в том же каталоге, что и файл базы данных. Если путь к базе данных по умолчанию — `data/outlook_accounts.db`, каталог скина — `data/skins/`. При развертывании Docker следует продолжать монтировать весь `./data:/app/data`, а не просто создавать резервную копию одного файла базы данных, иначе файлы пользовательского скина будут потеряны и вернутся к встроенному скину `classic`.

База данных содержит следующие таблицы:
- `settings` - Настройки системы (пароль для входа, API-ключ и т. д.)
- `groups` — группировка почтовых ящиков
- `accounts` — учетная запись электронной почты Outlook
- `account_refresh_logs` — запись обновления учетной записи.
- `temp_emails` — временный адрес электронной почты.
- `temp_email_messages` — электронная почта из временного почтового ящика.

## Сопоставление портов

По умолчанию используется порт 5000, который можно изменить в `docker-compose.yml`:

```yaml
ports:
  - "8080:5000" # Сопоставьте порт 5000 контейнера с портом 8080 хоста
```

## Описание зеркала

Проект использует GitHub Actions для автоматического создания и отправки образов Docker, поддерживая теги стабильной версии, версии для разработки и официальной версии.

### Доступные теги изображений

- `ghcr.io/assast/outlookemail:latest` — последняя подходящая стабильная сборка ветки по умолчанию.
- `ghcr.io/assast/outlookemail:main` — последняя подходящая сборка ветки `main`.
- `ghcr.io/assast/outlookemail:dev` — последняя подходящая сборка ветки `dev`.
- `ghcr.io/assast/outlookemail:vX.Y.Z` — указывает образ официальной версии, созданный в ходе рабочего процесса выпуска вручную.

Дополнительное объяснение:

- Изменения документа не приводят к реконструкции образа Docker.
- Рекомендуется отдавать приоритет использованию `vX.Y.Z` для уточнения метки версии при официальном выпуске версии.
- Подробную информацию о процессе выпуска см. в `RELEASE.md` в корневом каталоге хранилища.

### Обновить изображение

```bash
docker pull ghcr.io/assast/outlookemail:latest
docker-compose down
docker-compose up -d
```

### Создайте образ самостоятельно (необязательно)

```bash
docker build -t outlook-mail-reader .
docker run -d \
  --name outlook-mail-reader \
  -p 5000:5000 \
  -v $(pwd)/data:/app/data \
  -e LOGIN_PASSWORD=admin123 \
  outlook-mail-reader
```

## Развертывание производственной среды

### Использование Nginx + HTTPS

**1. Установите Nginx**.
```bash
sudo apt install nginx certbot python3-certbot-nginx -y
```

**2. Конфигурация Nginx** `/etc/nginx/sites-available/outlook-mail-reader`
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Поддержка WebSocket (при необходимости)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

**3. Включить конфигурацию **
```bash
sudo ln -s /etc/nginx/sites-available/outlook-mail-reader /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

**4. Настроить HTTPS**
```bash
sudo certbot --nginx -d your-domain.com
```

### Использование Caddy (проще)

```bash
sudo apt install caddy -y

# Настройте /etc/caddy/Caddyfile.
your-domain.com {
    reverse_proxy localhost:5000
}

# Перезагрузка (автоматический HTTPS)
sudo systemctl reload caddy
```
