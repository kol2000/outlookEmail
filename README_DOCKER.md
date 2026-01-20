# Outlook 邮件阅读器 - Docker 部署指南

## 📦 快速开始

### 使用 Docker Compose（推荐）

```bash
# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

### 使用 Docker 命令

```bash
# 构建镜像
docker build -t outlook-mail-reader .

# 运行容器
docker run -d \
  --name outlook-mail-reader \
  -p 5000:5000 \
  -v $(pwd)/data:/app/data \
  -e LOGIN_PASSWORD=your_password \
  outlook-mail-reader

# 停止容器
docker stop outlook-mail-reader
docker rm outlook-mail-reader
```

## 🔧 配置说明

### 环境变量

在 `docker-compose.yml` 中可以配置以下环境变量：

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `LOGIN_PASSWORD` | 登录密码 | `admin123` |
| `FLASK_ENV` | 运行环境 | `production` |
| `DATABASE_PATH` | 数据库路径 | `data/outlook_accounts.db` |
| `GPTMAIL_BASE_URL` | GPTMail API 地址 | `https://mail.chatgpt.org.uk` |
| `GPTMAIL_API_KEY` | GPTMail API Key | `gpt-test` |

### 数据持久化

数据库文件存储在 `./data` 目录中，通过 Docker Volume 挂载实现持久化。

### 端口映射

默认映射 5000 端口，可以在 `docker-compose.yml` 中修改：

```yaml
ports:
  - "8080:5000"  # 将容器的 5000 端口映射到主机的 8080 端口
```

## 🚀 GitHub Actions 自动构建

项目已配置 GitHub Actions，当代码推送到 `main` 或 `master` 分支时，会自动构建并推送 Docker 镜像到 GitHub Container Registry。

### 使用预构建镜像

```bash
# 拉取镜像
docker pull ghcr.io/<your-username>/<your-repo>:latest

# 运行容器
docker run -d \
  --name outlook-mail-reader \
  -p 5000:5000 \
  -v $(pwd)/data:/app/data \
  -e LOGIN_PASSWORD=your_password \
  ghcr.io/<your-username>/<your-repo>:latest
```

### 触发构建

- 推送代码到 `main` 或 `master` 分支
- 修改 `*.py`、`requirements.txt`、`Dockerfile`、`templates/**` 文件
- 手动触发（在 Actions 页面点击 "Run workflow"）

### 镜像标签

- `latest` - 最新的主分支构建
- `main` 或 `master` - 分支名称
- `main-<commit-sha>` - 分支名+提交哈希

## 🌐 生产环境部署

### 使用 Nginx + HTTPS

**1. 安装 Nginx**
```bash
sudo apt install nginx certbot python3-certbot-nginx -y
```

**2. 配置 Nginx** `/etc/nginx/sites-available/outlook-mail-reader`
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
    }
}
```

**3. 启用配置**
```bash
sudo ln -s /etc/nginx/sites-available/outlook-mail-reader /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

**4. 配置 HTTPS**
```bash
sudo certbot --nginx -d your-domain.com
```

### 使用 Caddy（更简单）

```bash
# 安装 Caddy
sudo apt install caddy -y

# 配置 /etc/caddy/Caddyfile
your-domain.com {
    reverse_proxy localhost:5000
}

# 重载（自动 HTTPS）
sudo systemctl reload caddy
```

## 🔐 安全配置

### 1. 修改默认密码

在 `docker-compose.yml` 中：
```yaml
environment:
  - LOGIN_PASSWORD=your_secure_password_here
```

### 2. 配置防火墙

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 3. 限制访问来源（Nginx）

```nginx
location / {
    allow 192.168.1.0/24;  # 允许内网
    deny all;               # 拒绝其他
    proxy_pass http://localhost:5000;
}
```

## 🛠️ 故障排查

### 容器无法启动

```bash
# 查看日志
docker-compose logs

# 检查端口占用
lsof -i :5000

# 检查数据目录权限
chmod 755 ./data
```

### 数据库问题

```bash
# 重置数据库
docker-compose down
rm ./data/outlook_accounts.db
docker-compose up -d
```

## 🔄 更新应用

### 从源码更新

```bash
git pull
docker-compose up -d --build
```

### 从镜像更新

```bash
docker pull ghcr.io/<your-username>/<your-repo>:latest
docker-compose -f docker-compose.prod.yml up -d
```

## 📚 相关文档

- [Docker 官方文档](https://docs.docker.com/)
- [Docker Compose 文档](https://docs.docker.com/compose/)
- [GitHub Actions 文档](https://docs.github.com/actions)
