# 🚀 Deployment Guide

## Method 1: Using Windows `exe`

Download the corresponding version of `OutlookEmail-windows-x64-*.zip` from GitHub Releases, and run `OutlookEmail.exe` directly after decompression.

When the ** desktop version is started for the first time, it will automatically: **
- Create local data directory
- Initialize database
- Automatically generate and persist `SECRET_KEY`

**Windows default data directory: **
- `%APPDATA%\OutlookEmail`

The default access address is still `http://127.0.0.1:5000`.

## Method 2: Use Docker (server deployment recommended)

Directly use the image automatically built by GitHub Actions without building locally:

```bash
# Pull the latest image
docker pull ghcr.io/assast/outlookemail:latest

# Run container
docker run -d \
  --name outlook-mail-reader \
  -p 5000:5000 \
  -v $(pwd)/data:/app/data \
  -e LOGIN_PASSWORD=admin123 \
  -e SECRET_KEY=your-secret-key-here \
  ghcr.io/assast/outlookemail:latest

# View log
docker logs -f outlook-mail-reader

# Stop the container
docker stop outlook-mail-reader
docker rm outlook-mail-reader
```

** will automatically start up for the first time: **
- Create data directory
- Initialize database
- Create default groups and temporary mailbox groups
- Set default password (admin123)

## Method 3: Run directly using Python

```bash
# Clone repository
git clone https://github.com/assast/outlookEmail.git
cd outlookEmail

# Install dependencies
pip install -r requirements.txt

# Set environment variables
export LOGIN_PASSWORD=admin123
export SECRET_KEY=your-secret-key-here
export PORT=5000

# Run the application
python web_outlook_app.py
```

Access `http://localhost:5000` to use.
Server deployments recommend always explicitly setting the fixed `SECRET_KEY`.

## Operation mode description

The service needs to keep a single worker running. Short-term tasks such as streaming tasks and export verification in token refresh management use in-process state storage; if the customization is deployed into multiple workers, the POST initialization task and subsequent SSE subscription may fall into different processes, causing the task to not exist or expire.

The official Docker image has been fixed as Gunicorn single worker, and handles slow requests through threads:

```bash
gunicorn -k gthread -w 1 --threads ${GUNICORN_THREADS:-4} ...
```

If you need to adjust concurrency, please adjust `GUNICORN_THREADS` first and do not increase the number of workers.

## Using Docker Compose

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
# Start service
docker-compose up -d

# Check the scheduled task startup log ("Scheduled task has started" should appear)
docker-compose logs -f

# Stop service
docker-compose down
```

## Scheduled refresh instructions

- Applications in `python web_outlook_app.py`, Docker, Docker Compose, and Gunicorn single worker modes will automatically initialize scheduled tasks.
- If you need to confirm whether the scheduled task has been started, you can execute `docker-compose logs -f`, and "The scheduled task has been started" should appear in the log.
- If using Cron mode, please make sure `use_cron_schedule` is turned on in the system settings and fill in the correct 5-segment Cron expression.

## Environment variable configuration

| Variable | Description | Default |
|--------|------|--------|
| `SECRET_KEY` | Session key (fixed setting is strongly recommended for server deployment) | Windows `exe` will be automatically generated and persisted on first startup; Docker/Python/production environment please set the fixed value explicitly and do not modify it at will, otherwise the stored sensitive data will not be decrypted |
| `LOGIN_PASSWORD` | Login password | `admin123` |
| `FLASK_ENV` | Operating environment | `production` |
| `LOG_LEVEL` | Global log level (`DEBUG` / `INFO` / `WARNING` / `ERROR` / `CRITICAL`). By default, `INFO` will output the outbound `[Agent]` details (including Resin Platform/Account, password has been coded). There are many logs when sending messages in batches or refreshing Tokens. If you only need alarms in the production environment, you can set `LOG_LEVEL=WARNING` for noise reduction | `INFO` |
| `PORT` | Application port | `5000` |
| `HOST` | listening address | `0.0.0.0` |
| `DATABASE_PATH` | Database path | `data/outlook_accounts.db` |
| `GPTMAIL_BASE_URL` | GPTMail API address | `https://mail.chatgpt.org.uk` |
| `GPTMAIL_API_KEY` | GPTMail API Key | `gpt-test` |
| `DUCKMAIL_BASE_URL` | DuckMail API address | `https://api.duckmail.sbs` |
| `DUCKMAIL_API_KEY` | DuckMail API Key | Empty |
| `CLOUDFLARE_WORKER_DOMAIN` | Cloudflare Temp Email Worker domain name, also compatible with reading `WORKER_DOMAIN` | empty |
| `CLOUDFLARE_EMAIL_DOMAINS` | Cloudflare temporary email domain name list, comma separated, also compatible with reading `EMAIL_DOMAIN` | empty |
| `CLOUDFLARE_ADMIN_PASSWORD` | Cloudflare management password, also compatible with reading `ADMIN_PASSWORD` | empty |
| `OAUTH_CLIENT_ID` | OAuth client ID | `It is recommended to use your own. If you really can’t get it and leave it blank, you will use the default one` |
| `OAUTH_REDIRECT_URI` | OAuth redirect URI | `It is recommended to use your own. If you really can’t get it and leave it blank, you will use the default one` |

** generates SECRET_KEY: **
```bash
python -c 'import secrets; print(secrets.token_hex(32))'
```

## Data persistence

The database file is stored in the `./data` directory and is mounted through Docker Volume for persistence.

Custom appearance skin files are stored in the `skins/` directory in the same directory as the database file. When the default database path is `data/outlook_accounts.db`, the skin directory is `data/skins/`. Docker deployments should continue to mount the entire `./data:/app/data`, do not just back up a single database file, otherwise the custom skin files will be lost and fall back to the built-in `classic` skin.

The database contains the following tables:
- `settings` - System settings (login password, API Key, etc.)
- `groups` - Mailbox grouping
- `accounts` - Outlook email account
- `account_refresh_logs` - Account refresh record
- `temp_emails` - Temporary email
- `temp_email_messages` - Email from temporary mailbox

## Port mapping

The default mapping is port 5000, which can be modified in `docker-compose.yml`:

```yaml
ports:
  - "8080:5000" # Map the container's 5000 port to the host's 8080 port
```

## Mirror description

The project uses GitHub Actions to automatically build and push Docker images, supporting stable version, development version and official version tags.

### Available image tags

- `ghcr.io/assast/outlookemail:latest` - The last eligible stable build of the default branch
- `ghcr.io/assast/outlookemail:main` - The latest eligible build of the `main` branch
- `ghcr.io/assast/outlookemail:dev` - The latest eligible build of the `dev` branch
- `ghcr.io/assast/outlookemail:vX.Y.Z` - specifies the official version image, generated by manual release workflow

Additional explanation:

- Document changes will not trigger Docker image reconstruction
- It is recommended to give priority to using `vX.Y.Z` to clarify the version label when officially releasing the version.
- For the specific release process, please see `RELEASE.md` in the root directory of the warehouse

### Update image

```bash
docker pull ghcr.io/assast/outlookemail:latest
docker-compose down
docker-compose up -d
```

### Build the image yourself (optional)

```bash
docker build -t outlook-mail-reader .
docker run -d \
  --name outlook-mail-reader \
  -p 5000:5000 \
  -v $(pwd)/data:/app/data \
  -e LOGIN_PASSWORD=admin123 \
  outlook-mail-reader
```

## Production environment deployment

### Using Nginx + HTTPS

**1. Install Nginx**
```bash
sudo apt install nginx certbot python3-certbot-nginx -y
```

**2. Configuration Nginx** `/etc/nginx/sites-available/outlook-mail-reader`
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

        # WebSocket support (if required)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

**3. Enable configuration **
```bash
sudo ln -s /etc/nginx/sites-available/outlook-mail-reader /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

**4. Configure HTTPS**
```bash
sudo certbot --nginx -d your-domain.com
```

### Using Caddy (easier)

```bash
sudo apt install caddy -y

# Configure /etc/caddy/Caddyfile
your-domain.com {
    reverse_proxy localhost:5000
}

# Reload (auto HTTPS)
sudo systemctl reload caddy
```
