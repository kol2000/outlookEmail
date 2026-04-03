# 📡 API 文档

## 对外 API（⭐ 新增）

对外 API 允许通过 API Key 直接访问邮件数据，无需登录 Web 界面。

### 配置 API Key

1. 登录 Web 界面，点击「⚙️ 设置」
2. 在「对外 API Key」处点击「🔑 随机生成」或手动输入
3. 点击「保存设置」

### GET /api/external/emails

通过 API Key 获取指定邮箱的邮件列表。

**认证方式：**
- Header: `X-API-Key: your-api-key`
- 或查询参数: `?api_key=your-api-key`

**查询参数：**

| 参数 | 类型 | 必填 | 说明 | 默认值 |
|------|------|------|------|--------|
| `email` | string | ✅ | 邮箱地址 | - |
| `folder` | string | ❌ | 邮件文件夹：`inbox`（收件箱）、`junkemail`（垃圾邮件） | `inbox` |
| `skip` | int | ❌ | 跳过的邮件数（分页用） | `0` |
| `top` | int | ❌ | 返回的邮件数（最大 50） | `20` |

**请求示例：**

```bash
# 获取收件箱邮件（Header 认证）
curl -H "X-API-Key: your-api-key" \
  "http://localhost:5000/api/external/emails?email=user@outlook.com&folder=inbox"

# 获取垃圾邮件（Header 认证）
curl -H "X-API-Key: your-api-key" \
  "http://localhost:5000/api/external/emails?email=user@outlook.com&folder=junkemail"

# 获取收件箱邮件（查询参数认证）
curl "http://localhost:5000/api/external/emails?email=user@outlook.com&folder=inbox&api_key=your-api-key"

# 获取垃圾邮件（查询参数认证）
curl "http://localhost:5000/api/external/emails?email=user@outlook.com&folder=junkemail&api_key=your-api-key"

# 分页获取
curl -H "X-API-Key: your-api-key" \
  "http://localhost:5000/api/external/emails?email=user@outlook.com&skip=20&top=10"
```

**成功响应：**

```json
{
  "success": true,
  "emails": [
    {
      "id": "AAMk...",
      "subject": "邮件主题",
      "from": "sender@example.com",
      "date": "2026-02-23T15:30:00Z",
      "is_read": false,
      "has_attachments": false,
      "body_preview": "邮件预览内容..."
    }
  ],
  "method": "Graph API",
  "has_more": true
}
```

**错误响应：**

```json
// 401 - 缺少或无效的 API Key
{ "success": false, "error": "缺少 API Key，请在 Header 中提供 X-API-Key" }
{ "success": false, "error": "API Key 无效" }

// 403 - 未配置 API Key
{ "success": false, "error": "未配置对外 API Key，请在系统设置中配置" }

// 400 - 参数错误
{ "success": false, "error": "缺少 email 参数" }
{ "success": false, "error": "folder 参数无效，支持: inbox, junkemail" }

// 404 - 邮箱不存在
{ "success": false, "error": "邮箱账号不存在" }
```

---

## 内部 API（需登录认证）

以下 API 需要通过 Web 界面登录后使用。所有的接口请求必须携带有效的 Session Cookie，以验证登录状态。
所有响应统一返回 JSON 格式：成功时包含 `"success": true`，失败时包含 `"success": false` 及 `"error"` 字段。

---

### 分组管理

#### 获取所有分组
- **接口**: `GET /api/groups`
- **响应示例**:
```json
{
  "success": true,
  "groups": [
    {
      "id": 1,
      "name": "默认分组",
      "description": "未分组的邮箱",
      "color": "#666666",
      "is_system": 0,
      "proxy_url": "http://127.0.0.1:7890",
      "account_count": 5
    }
  ]
}
```

#### 获取单个分组
- **接口**: `GET /api/groups/<id>`
- **响应示例**: 包含单个 `group` 对象，格式同上。

#### 创建分组
- **接口**: `POST /api/groups`
- **请求 Body (JSON)**:
  - `name` (string, 必填): 分组名称
  - `description` (string, 可选): 分组描述
  - `color` (string, 可选): 颜色十六进制值，默认 `#1a1a1a`
  - `proxy_url` (string, 可选): 代理地址，例如 `http://127.0.0.1:7890`
- **响应示例**:
```json
{
  "success": true,
  "message": "分组创建成功",
  "group_id": 2
}
```

#### 更新分组 / 删除分组
- **接口 (更新)**: `PUT /api/groups/<id>` (参数与创建相同)
- **接口 (删除)**: `DELETE /api/groups/<id>`

---

### 账号管理

#### 获取账号列表
- **接口**: `GET /api/accounts`
- **查询参数**:
  - `group_id` (int, 可选): 若提供则只返回该分组下的账号
- **响应示例**:
```json
{
  "success": true,
  "accounts": [
    {
      "id": 1,
      "email": "user@outlook.com",
      "client_id": "xxxxxxxx...",
      "group_id": 1,
      "group_name": "默认分组",
      "status": "active",
      "last_refresh_at": "2023-10-01 12:00:00",
      "last_refresh_status": "success",
      "remark": "个人邮箱"
    }
  ]
}
```

#### 搜索账号
- **接口**: `GET /api/accounts/search`
- **查询参数**:
  - `q` (string, 必填): 搜索关键词，支持匹配邮箱、备注、标签。

#### 添加账号
- **接口**: `POST /api/accounts`
- **请求 Body (JSON)**:
  - `account_string` (string, 必填): 批量账号字符串，支持多行，每行格式为 `邮箱----密码----ClientID----RefreshToken`
  - `group_id` (int, 可选): 默认值为 1
- **响应示例**:
```json
{
  "success": true,
  "message": "成功添加 1 个账号"
}
```

#### 更新账号 / 删除账号
- **接口 (更新)**: `PUT /api/accounts/<id>`
  - 请求 Body 参数 (JSON): `email`, `client_id`, `refresh_token`, `password`, `group_id`, `remark`, `status`
  - 或仅更新状态时传递 `status`
- **接口 (删除)**: `DELETE /api/accounts/<id>`
- **接口 (邮箱删除)**: `DELETE /api/accounts/email/<email_addr>`

---

### Token 刷新管理

#### 触发单个账号刷新
- **接口**: `POST /api/accounts/<id>/refresh`
- **响应示例**: `{"success": true, "message": "Token 刷新成功"}`

#### 触发全部账号刷新 (SSE 流数据)
- **接口**: `GET /api/accounts/refresh-all`
- **说明**: 该接口返回 Server-Sent Events (SSE) 流，客户端可用于实时追踪刷新进度。

#### 失败账号重试 / 日志获取
- **重试单账号**: `POST /api/accounts/<id>/retry-refresh`
- **重试所有失败**: `POST /api/accounts/refresh-failed`
- **获取所有日志**: `GET /api/accounts/refresh-logs`
- **获取失败日志**: `GET /api/accounts/refresh-logs/failed`

---

### 邮件操作

#### 获取邮件列表
- **接口**: `GET /api/emails/<email>`
- **查询参数**:
  - `folder` (string, 可选): 接收文件夹，常用 `inbox`（收件箱）或 `junkemail`（垃圾邮件）。默认 `inbox`。
  - `skip` (int, 可选): 分页跳过数量，默认 `0`
  - `top` (int, 可选): 本次返回最大邮件数量，默认 `20`
- **响应说明**: 与对外 API 响应格式完全一致。

#### 获取邮件详情
- **接口**: `GET /api/email/<email>/<message_id>`
- **响应示例**:
```json
{
  "success": true,
  "email": {
    "id": "AAMk...",
    "subject": "邮件主题",
    "from": "sender@example.com",
    "to": "user@outlook.com",
    "date": "2026-02-23T15:30:00Z",
    "body": "<html>...</html>",
    "body_type": "html"
  }
}
```

#### 批量删除邮件
- **接口**: `POST /api/emails/delete`
- **请求 Body (JSON)**:
  - `email` (string, 必填): 对应邮箱地址
  - `ids` (array<string>, 必填): 要删除的邮件 ID (`message_id`) 列表
- **响应示例**:
```json
{
  "success": true,
  "message": "成功删除 1 封邮件",
  "method": "Graph API"
}
```

---

### 临时邮箱（支持 GPTMail、DuckMail 和 Cloudflare）

#### 获取 / 导入 / 清空 临时邮箱
- **获取所有**: `GET /api/temp-emails`
- **导入邮箱**: `POST /api/temp-emails/import` (Body: `account_string`, `provider`)
- **清空某邮箱**: `DELETE /api/temp-emails/<email>/clear`
- **删除邮箱**: `DELETE /api/temp-emails/<email>`
- **获取 Cloudflare 域名**: `GET /api/cloudflare/domains`

#### 生成临时邮箱
- **接口**: `POST /api/temp-emails/generate`
- **请求 Body (JSON)**:
  - `provider` (string): 填 `gptmail`、`duckmail` 或 `cloudflare`。默认 `gptmail`。
  - 若为 `gptmail`: 可选 `prefix` 和 `domain`
  - 若为 `duckmail`: 必填 `domain`、`username` 和 `password`
  - 若为 `cloudflare`: 必填 `domain`，可选 `username`（留空则随机生成）
- **响应示例**: `{"success": true, "email": "user@domain.com", "message": "临时邮箱创建成功"}`

#### 获取临时邮件及详情
- **获取列表**: `GET /api/temp-emails/<email>/messages`
- **获取详情**: `GET /api/temp-emails/<email>/messages/<message_id>`
- **删除邮件**: `DELETE /api/temp-emails/<email>/messages/<message_id>`

---

### 标签与系统设置

- **获取标签**: `GET /api/tags`
- **添加标签**: `POST /api/tags`
- **管理多账号标签**: `POST /api/accounts/tags` (Body: `account_ids`, `tag_id`, `action`)
- **获取设置**: `GET /api/settings`
- **修改设置**: `PUT /api/settings`

---

## API 调用优先级与代理说明

### API 调用优先级

本工具在获取邮件、刷新 Token、删除邮件时，会按以下优先级自动尝试并回退：

| 优先级 | 方式 | 说明 |
|--------|------|------|
| 1️⃣ | **Graph API** | 推荐方式，功能最完整 |
| 2️⃣ | **IMAP（新服务器）** | `outlook.live.com`，Graph 失败后回退 |
| 3️⃣ | **IMAP（旧服务器）** | `outlook.office365.com`，最后尝试 |

> [!NOTE]
> 如果 Graph API 失败原因是**代理连接错误**（ProxyError），则不会继续回退 IMAP，因为代理问题与 API 方式无关。

### 分组代理支持

每个分组可配置 HTTP 或 SOCKS5 代理，分组下所有邮箱在以下操作时会走该代理：

- ✅ 获取邮件（Graph API）
- ✅ 查看邮件详情（Graph API）
- ✅ 刷新 Token
- ✅ 删除邮件（Graph API）

**代理格式示例：**
```
http://127.0.0.1:7890
socks5://127.0.0.1:7891
socks5://user:pass@proxy.example.com:1080
```

> [!IMPORTANT]
> **仅 Graph API 请求支持走代理**，IMAP 连接目前不支持代理。

> [!WARNING]
> 使用 SOCKS5 代理需要安装 `pysocks` 依赖（`pip install pysocks` 或 `pip install requests[socks]`），Docker 镜像已内置。
