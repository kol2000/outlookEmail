# API 文档

本文档基于当前代码实现整理，重点覆盖对外 API、账号别名、聚合取信、验证码提取，以及和本次改动相关的完整接口。

## 认证

### 对外 API

对外 API 使用 API Key 认证，支持两种方式：

- Header: `X-API-Key: your-api-key`
- Query: `?api_key=your-api-key`

可在 Web 界面 `设置 -> 对外 API Key` 中配置。

### 完整 API

完整 API 需要先登录 Web 界面并携带 Session Cookie。

### GET `/api/csrf-token`

获取前端可提交表单用的 CSRF Token。该接口不要求登录。

成功响应示例：

```json
{
  "csrf_token": "..."
}
```

若当前未启用 CSRF，会返回：

```json
{
  "csrf_token": null,
  "csrf_disabled": true
}
```

## 邮箱别名说明

普通账号现在支持配置多个别名邮箱。

- 对外 API 和内部邮件接口传入主邮箱或别名邮箱都可以命中同一个账号
- 返回结果中可能包含：
  - `requested_email`: 请求里传入的邮箱
  - `resolved_email`: 实际命中的主邮箱
  - `matched_alias`: 若通过别名命中，则为对应别名；否则为空
- 别名邮箱支持常见特殊字符，例如 `+`、`@`、`&`
  - `@` 可以直接传
  - `+` 建议编码成 `%2B`
  - `&` 必须编码成 `%26`

典型用法：

1. 把外部邮箱 B 的邮件自动转发到本项目管理的邮箱 A
2. 在邮箱 A 下把邮箱 B 设置为别名
3. 后续直接通过本项目 API，用邮箱 B 作为 `email` 参数取邮件或取验证码

## 对外 API

### GET `/api/external/accounts`

获取当前系统中已管理的邮箱账号列表，适合外部系统先同步邮箱池，再按邮箱调用 `/api/external/emails` 取邮件。

#### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | int | 否 | 仅返回指定分组下的账号 |

#### 请求示例

```bash
curl -H "X-API-Key: your-api-key" \
  "http://localhost:5000/api/external/accounts"

curl -H "X-API-Key: your-api-key" \
  "http://localhost:5000/api/external/accounts?group_id=1"
```

#### 成功响应示例

```json
{
  "success": true,
  "total": 1,
  "accounts": [
    {
      "id": 1,
      "email": "user@outlook.com",
      "aliases": ["alias@example.com"],
      "alias_count": 1,
      "group_id": 1,
      "group_name": "默认分组",
      "group_color": "#666666",
      "remark": "主账号",
      "status": "active",
      "account_type": "outlook",
      "provider": "outlook",
      "forward_enabled": true,
      "last_refresh_at": "2026-04-09 14:20:00",
      "last_refresh_status": "success",
      "last_refresh_error": null,
      "created_at": "2026-04-09 14:00:00",
      "updated_at": "2026-04-09 14:20:00",
      "tags": [
        {
          "id": 1,
          "name": "核心",
          "color": "#1a1a1a"
        }
      ]
    }
  ]
}
```

#### 返回说明

- 该接口只返回普通邮箱账号，不包含临时邮箱列表
- 已隐藏密码、Refresh Token、IMAP 密码等敏感字段
- 如需拉取某个邮箱的邮件列表，再调用 `/api/external/emails`

### GET `/api/external/emails`

获取指定邮箱的邮件列表，支持主邮箱、别名邮箱、收件箱/垃圾箱聚合查询。

#### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `email` | string | 是 | 主邮箱或别名邮箱 |
| `folder` | string | 否 | `inbox`、`junkemail`、`deleteditems`、`all`。`all` 会同时抓取收件箱和垃圾邮件并按时间倒序合并 |
| `skip` | int | 否 | 分页偏移，默认 `0`。当 `folder=all` 时，对每个文件夹分别跳过 `skip` 封 |
| `top` | int | 否 | 返回数量，默认 `1`，最大 `50`。当 `folder=all` 时，表示每个文件夹各取 `top` 封 |
| `subject_contains` | string | 否 | 仅保留主题中包含该关键字的邮件 |
| `from_contains` | string | 否 | 仅保留发件人中包含该关键字的邮件 |
| `keyword` | string | 否 | 在主题、预览、正文中做进一步关键字过滤 |

#### 请求示例

```bash
curl -H "X-API-Key: your-api-key" \
  "http://localhost:5000/api/external/emails?email=user@outlook.com&folder=inbox"

curl -H "X-API-Key: your-api-key" \
  "http://localhost:5000/api/external/emails?email=alias@example.com&folder=all&top=10"

curl -H "X-API-Key: your-api-key" \
  "http://localhost:5000/api/external/emails?email=alias@example.com&folder=all&top=10&subject_contains=verify&from_contains=github&keyword=reset"

curl -H "X-API-Key: your-api-key" \
  "http://localhost:5000/api/external/emails?email=user%2Balias%40example.com"
```

#### 成功响应示例

```json
{
  "success": true,
  "requested_email": "alias@example.com",
  "resolved_email": "user@outlook.com",
  "matched_alias": "alias@example.com",
  "method": "Graph API",
  "has_more": true,
  "emails": [
    {
      "id": "AAMk...",
      "subject": "Your verification code",
      "from": "no-reply@example.com",
      "date": "2026-04-09T14:20:00Z",
      "is_read": false,
      "has_attachments": false,
      "body_preview": "Your code is 123456",
      "folder": "inbox"
    }
  ]
}
```

#### 聚合模式说明

当 `folder=all` 时：

- 后端会同时抓取 `inbox` 和 `junkemail`
- `top` 是“每个文件夹各取多少封”
- 例如 `top=1` 时，最多返回 `收件箱 1 + 垃圾邮件 1 = 2` 封
- `skip` 也是“每个文件夹各跳过多少封”
- 结果按邮件时间统一倒序排序
- 每条邮件会带上 `folder`
- 若其中一个文件夹成功、另一个失败，会返回：
  - `success: true`
  - `partial: true`
  - `details` 中包含失败文件夹的错误信息

## 内部 API

## 分组管理

| 方法 | 路径 | 参数 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/groups` | 无 | 获取所有分组，返回 `account_count`、`sort_position` |
| GET | `/api/groups/<group_id>` | 路径参数 `group_id` | 获取单个分组详情 |
| POST | `/api/groups` | JSON: `name`、`description?`、`color?`、`proxy_url?`、`sort_position?` | 创建分组 |
| PUT | `/api/groups/<group_id>` | JSON: `name`、`description?`、`color?`、`proxy_url?`、`sort_position?` | 更新分组 |
| DELETE | `/api/groups/<group_id>` | 路径参数 `group_id` | 删除分组，默认分组不能删除 |
| PUT | `/api/groups/reorder` | JSON: `group_ids: number[]` | 重新排序普通分组 |

创建或更新分组请求示例：

```json
{
  "name": "代理组",
  "description": "走香港代理",
  "color": "#1a1a1a",
  "proxy_url": "http://127.0.0.1:7890",
  "sort_position": 2
}
```

## 导出与二次验证

导出接口都会先校验一次登录密码，拿到 `verify_token` 后再发起导出。`verify_token` 当前为一次性令牌，默认 5 分钟内有效。

| 方法 | 路径 | 参数 | 返回 |
| --- | --- | --- | --- |
| POST | `/api/export/verify` | JSON: `password` | JSON，返回 `verify_token` |
| GET | `/api/groups/<group_id>/export` | Query: `verify_token` | `text/plain` 文件下载 |
| GET | `/api/accounts/export` | Query: `verify_token` | `text/plain` 文件下载 |
| POST | `/api/accounts/export-selected` | JSON: `group_ids: number[]`、`verify_token` | `text/plain` 文件下载 |

二次验证请求示例：

```json
{
  "password": "your-login-password"
}
```

二次验证成功响应示例：

```json
{
  "success": true,
  "verify_token": "..."
}
```

## 账号管理

### GET `/api/accounts`

获取账号列表。

#### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_id` | int | 否 | 仅返回指定分组下的账号 |

#### 响应重点字段

| 字段 | 说明 |
| --- | --- |
| `aliases` | 账号别名列表 |
| `alias_count` | 别名数量 |
| `forward_enabled` | 是否开启转发 |
| `last_refresh_at` | 最近刷新时间 |
| `last_refresh_status` | 最近刷新结果 |
| `last_refresh_error` | 最近刷新错误 |
| `tags` | 标签列表 |

### GET `/api/accounts/search`

搜索账号。

#### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `q` | string | 是 | 搜索关键词，支持主邮箱、备注、标签、别名邮箱 |

### POST `/api/accounts`

批量导入账号。

#### 请求体

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `account_string` | string | 是 | 多行账号文本 |
| `group_id` | int | 否 | 目标分组，默认 `1` |
| `account_format` | string | 否 | Outlook 导入格式：`client_id_refresh_token` 或 `refresh_token_client_id` |
| `provider` | string | 否 | `outlook`、`auto`、`qq`、`163`、`126`、`yahoo`、`aliyun`、`custom` |
| `imap_host` | string | 否 | `provider=custom` 时的 IMAP 服务器 |
| `imap_port` | int | 否 | `provider=custom` 时的 IMAP 端口 |
| `forward_enabled` | bool | 否 | 导入后是否默认启用转发 |

#### 导入格式

- Outlook: 每行 `邮箱----密码----ClientID----RefreshToken`
- Outlook 反序: 每行 `邮箱----密码----RefreshToken----ClientID`，并设置 `account_format=refresh_token_client_id`
- 非 Outlook IMAP: 每行 `邮箱----IMAP密码`
- 自定义 IMAP: 每行 `邮箱----IMAP密码----IMAP主机----IMAP端口`

#### 请求示例

```json
{
  "account_string": "user@outlook.com----password----client-id----refresh-token",
  "group_id": 1,
  "account_format": "client_id_refresh_token",
  "provider": "outlook",
  "forward_enabled": false
}
```

### GET `/api/accounts/<id>`

获取单个账号详情。

#### 响应补充字段

```json
{
  "success": true,
  "account": {
    "id": 1,
    "email": "user@outlook.com",
    "aliases": ["alias@example.com", "login@example.com"],
    "alias_count": 2,
    "matched_alias": "",
    "forward_enabled": true
  }
}
```

### PUT `/api/accounts/<id>`

更新账号信息。

- 若请求体只有 `status`，则只更新账号状态
- 支持 Outlook 账号和 IMAP 账号
- 现在支持直接在更新账号时一起保存别名

#### 请求体常用字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `email` | string | 是 | 邮箱地址 |
| `password` | string | 否 | 账号密码，Outlook 可为空 |
| `client_id` | string | Outlook 必填 | Outlook Client ID |
| `refresh_token` | string | Outlook 必填 | Outlook Refresh Token |
| `account_type` | string | 否 | `outlook` 或 `imap` |
| `provider` | string | 否 | `outlook`、`auto`、`qq`、`163`、`126`、`yahoo`、`aliyun`、`custom` |
| `imap_host` | string | 自定义 IMAP 必填 | 自定义 IMAP 服务器 |
| `imap_port` | int | 否 | IMAP 端口 |
| `imap_password` | string | IMAP 必填 | IMAP 密码 |
| `group_id` | int | 否 | 分组 ID |
| `remark` | string | 否 | 备注 |
| `status` | string | 否 | `active` 等状态值 |
| `forward_enabled` | bool | 否 | 是否开启转发 |
| `aliases` | array<string> | 否 | 账号别名列表；若传入则按新列表整体替换 |

#### 请求示例

```json
{
  "email": "user@outlook.com",
  "client_id": "xxx",
  "refresh_token": "xxx",
  "group_id": 1,
  "remark": "主账号",
  "status": "active",
  "forward_enabled": true,
  "aliases": [
    "alias@example.com",
    "login@example.com"
  ]
}
```

### POST `/api/accounts/batch-update-group`

批量修改账号分组。

#### 请求示例

```json
{
  "account_ids": [1, 2, 3],
  "group_id": 5
}
```

### POST `/api/accounts/batch-update-forwarding`

批量开启或关闭账号转发。

#### 请求体

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `account_ids` | array<int> | 是 | 账号 ID 列表 |
| `forward_enabled` | bool | 是 | `true` 表示开启转发，`false` 表示关闭转发 |

#### 请求示例

```json
{
  "account_ids": [1, 2, 3],
  "forward_enabled": true
}
```

#### 响应重点字段

| 字段 | 说明 |
| --- | --- |
| `updated_count` | 实际状态发生变化的账号数量 |
| `updated_accounts` | 被更新的账号列表 |
| `unchanged_count` | 原本就处于目标状态的账号数量 |
| `missing_ids` | 未命中的账号 ID |

### GET `/api/accounts/<id>/aliases`

获取某个账号的别名列表。

### PUT `/api/accounts/<id>/aliases`

整体替换某个账号的别名列表。

#### 请求示例

```json
{
  "aliases": [
    "alias@example.com",
    "login@example.com"
  ]
}
```

### DELETE `/api/accounts/<id>`

按账号 ID 删除账号。

### DELETE `/api/accounts/email/<email_addr>`

按邮箱地址删除账号。

### POST `/api/accounts/batch-delete`

批量删除账号。

#### 请求体

```json
{
  "account_ids": [1, 2, 3]
}
```

#### 响应重点字段

| 字段 | 说明 |
| --- | --- |
| `deleted_count` | 实际删除数量 |
| `deleted_accounts` | 已删除账号列表 |
| `missing_ids` | 请求中存在但未命中的账号 ID |

## 标签管理

| 方法 | 路径 | 参数 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/tags` | 无 | 获取所有标签 |
| POST | `/api/tags` | JSON: `name`、`color?` | 创建标签 |
| DELETE | `/api/tags/<tag_id>` | 路径参数 `tag_id` | 删除标签 |
| POST | `/api/accounts/tags` | JSON: `account_ids`、`tag_id`、`action` | 批量给账号加标签或移除标签 |

批量标签管理请求示例：

```json
{
  "account_ids": [1, 2, 3],
  "tag_id": 8,
  "action": "add"
}
```

## 刷新与转发运维

### Token 刷新

| 方法 | 路径 | 参数 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/accounts/<account_id>/refresh` | 路径参数 `account_id` | 刷新单个 Outlook 账号 Token |
| POST | `/api/accounts/refresh-selected` | JSON: `account_ids: number[]` | 刷新选中的 Outlook 账号，自动跳过 IMAP 或不存在的账号 |
| GET | `/api/accounts/refresh-all` | 无 | 刷新全部 Outlook 账号，返回 `text/event-stream` |
| POST | `/api/accounts/<account_id>/retry-refresh` | 路径参数 `account_id` | 重试单个失败账号刷新 |
| POST | `/api/accounts/refresh-failed` | 无 | 重试最近一次刷新失败的账号 |
| GET | `/api/accounts/trigger-scheduled-refresh` | Query: `force=true/false` | 手动触发一次“定时刷新”逻辑，返回 `text/event-stream` |

`/api/accounts/refresh-all` 和 `/api/accounts/trigger-scheduled-refresh` 都会返回 SSE 事件流，常见事件类型包括：

- `start`
- `progress`
- `delay`
- `complete`

`POST /api/accounts/refresh-selected` 请求示例：

```json
{
  "account_ids": [1, 2, 3]
}
```

该接口会返回：

- `requested_count`
- `processed_count`
- `success_count`
- `failed_count`
- `skipped_count`
- `failed_list`
- `skipped_list`

### 刷新日志与统计

| 方法 | 路径 | 参数 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/accounts/refresh-logs` | Query: `limit`、`offset` | 获取所有刷新日志 |
| GET | `/api/accounts/<account_id>/refresh-logs` | Query: `limit`、`offset` | 获取单个账号刷新日志 |
| GET | `/api/accounts/refresh-logs/failed` | 无 | 获取最近失败刷新记录 |
| GET | `/api/accounts/refresh-stats` | 无 | 获取刷新统计汇总 |

### 转发日志与触发

| 方法 | 路径 | 参数 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/accounts/forwarding-logs` | Query: `limit`、`offset` | 获取最近转发记录 |
| GET | `/api/accounts/forwarding-logs/failed` | Query: `limit` | 获取最近失败转发记录 |
| GET | `/api/accounts/<account_id>/forwarding-logs` | Query: `limit`、`offset`、`failed_only` | 获取单个账号转发记录 |
| POST | `/api/accounts/trigger-forwarding-check` | 无 | 立即触发一次转发检查 |
| POST | `/api/accounts/<account_id>/forwarding/reset-cursor` | JSON: `mode?`、`lookback_minutes?`、`trigger_check?` | 回退或清空单个账号的转发游标，并可选立即触发一次重扫 |

`POST /api/accounts/<account_id>/forwarding/reset-cursor` 请求示例：

```json
{
  "mode": "window",
  "lookback_minutes": 30,
  "trigger_check": true
}
```

字段说明：

- `mode=window`：按回看窗口重置游标
- `mode=clear`：清空游标
- `lookback_minutes`：回看分钟数，未传时按系统窗口逻辑处理
- `trigger_check`：是否在重置后立即触发一次转发检查，默认 `true`

## 邮件接口

### GET `/api/emails/<email>`

内部邮件列表接口。支持主邮箱或别名邮箱。

#### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `folder` | string | 否 | `inbox`、`junkemail`、`deleteditems`、`all` |
| `skip` | int | 否 | 分页偏移，默认 `0` |
| `top` | int | 否 | 返回数量，默认 `20` |
| `subject_contains` | string | 否 | 仅保留主题中包含该关键字的邮件 |
| `from_contains` | string | 否 | 仅保留发件人中包含该关键字的邮件 |
| `keyword` | string | 否 | 在主题、预览、正文中做进一步关键字过滤 |

当 `folder=all` 时，行为与对外 API 一致：同时抓取 `inbox` 与 `junkemail`，按时间合并排序。

#### 列表项字段

`emails` 数组中的每个对象至少包含以下字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 邮件 ID |
| `subject` | string | 邮件主题 |
| `from` | string | 发件人地址 |
| `to` | string | 收件人地址，多个地址用 `, ` 拼接 |
| `date` | string | 收件时间 |
| `is_read` | bool | 是否已读 |
| `has_attachments` | bool | 是否有附件 |
| `body_preview` | string | 邮件预览 |
| `folder` | string | 所属文件夹 |

### GET `/api/email/<email>/<message_id>`

获取单封邮件详情。`email` 参数同样支持传主邮箱或别名邮箱。

#### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `folder` | string | 否 | 当前邮件所在文件夹，默认 `inbox` |
| `method` | string | 否 | 优先取详情的方式，常见为 `graph` |

### POST `/api/emails/delete`

批量删除邮件。

#### 请求体

```json
{
  "email": "user@outlook.com",
  "ids": ["AAMk...", "AAMk..."]
}
```

说明：

- Outlook 账号会优先走 Graph API，失败后按逻辑回退 IMAP
- IMAP 账号当前不支持批量删除

## 临时邮箱

### 列表、导入、渠道域名

| 方法 | 路径 | 参数 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/temp-emails` | 无 | 获取所有临时邮箱 |
| POST | `/api/temp-emails/import` | JSON: `account_string`、`provider` | 批量导入临时邮箱 |
| GET | `/api/duckmail/domains` | 无 | 获取 DuckMail 可用域名 |
| GET | `/api/cloudflare/domains` | 无 | 获取 Cloudflare 可用域名 |

`/api/temp-emails/import` 的导入格式：

- `provider=gptmail`: 每行一个邮箱
- `provider=duckmail`: 每行 `邮箱----密码`
- `provider=cloudflare`: 每行 `邮箱----JWT`

### POST `/api/temp-emails/generate`

生成新的临时邮箱。

#### 请求体

| provider | 需要字段 | 说明 |
| --- | --- | --- |
| `gptmail` | `prefix?`、`domain?` | 不传则走默认随机生成 |
| `duckmail` | `domain`、`username`、`password` | 用户名至少 3 位，密码至少 6 位 |
| `cloudflare` | `domain?`、`username?` | `username` 可留空随机生成 |

#### 请求示例

```json
{
  "provider": "duckmail",
  "domain": "example.com",
  "username": "demo123",
  "password": "secret123"
}
```

### 临时邮箱邮件接口

| 方法 | 路径 | 参数 | 说明 |
| --- | --- | --- | --- |
| DELETE | `/api/temp-emails/<email_addr>` | 路径参数 `email_addr` | 删除临时邮箱 |
| GET | `/api/temp-emails/<email_addr>/messages` | 路径参数 `email_addr` | 获取临时邮箱邮件列表 |
| GET | `/api/temp-emails/<email_addr>/messages/<message_id>` | 路径参数 | 获取临时邮件详情 |
| DELETE | `/api/temp-emails/<email_addr>/messages/<message_id>` | 路径参数 | 当前返回“单封删信功能已暂时关闭” |
| DELETE | `/api/temp-emails/<email_addr>/clear` | 路径参数 | 当前返回“清空功能已暂时关闭” |
| POST | `/api/temp-emails/<email_addr>/refresh` | 路径参数 | 主动刷新一次临时邮箱邮件 |

`GET /messages` 与 `POST /refresh` 都会返回统一结构的 `emails` 列表。`POST /refresh` 还会包含 `new_count`，表示本次新保存的邮件数量。

## OAuth 辅助接口

| 方法 | 路径 | 参数 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/oauth/auth-url` | 无 | 生成 Microsoft OAuth 授权链接 |
| POST | `/api/oauth/exchange-token` | JSON: `redirected_url` | 从回调 URL 中解析 `code` 并换取 Refresh Token |

换取 Token 请求示例：

```json
{
  "redirected_url": "http://localhost:8080/?code=..."
}
```

## 设置接口

### POST `/api/settings/validate-cron`

验证 Cron 表达式，并返回下一次执行时间与未来 5 次执行时间。

#### 请求示例

```json
{
  "cron_expression": "0 */6 * * *"
}
```

### GET `/api/settings`

获取系统设置。

除数据库 `settings` 表中的原始键值外，接口还会额外整理并返回以下常用字段：

| 字段 | 说明 |
| --- | --- |
| `login_password_masked` | 登录密码掩码 |
| `external_api_key` | 当前对外 API Key |
| `duckmail_base_url` | DuckMail API 地址 |
| `duckmail_api_key` | DuckMail API Key |
| `cloudflare_worker_domain` | Cloudflare Worker 域名 |
| `cloudflare_email_domains` | Cloudflare 邮箱域名列表，逗号分隔字符串 |
| `cloudflare_admin_password` | Cloudflare 管理密码 |
| `forward_channels` | 当前启用的转发渠道 |
| `forward_check_interval_minutes` | 转发检查间隔 |
| `forward_email_window_minutes` | 转发时间窗口 |
| `forward_include_junkemail` | 是否转发垃圾箱 |
| `email_forward_recipient` | SMTP 转发收件人 |
| `smtp_host` | SMTP 主机 |
| `smtp_port` | SMTP 端口 |
| `smtp_username` | SMTP 用户名 |
| `smtp_password` | SMTP 密码 |
| `smtp_from_email` | SMTP 发件邮箱 |
| `smtp_provider` | SMTP 类型 |
| `smtp_use_tls` | 是否启用 TLS |
| `smtp_use_ssl` | 是否启用 SSL |
| `telegram_bot_token` | Telegram Bot Token |
| `telegram_chat_id` | Telegram Chat ID |

### PUT `/api/settings`

更新系统设置。当前实现支持的主要可写字段如下。

#### 基础与调度相关字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `login_password` | string | 登录密码，至少 8 位 |
| `gptmail_api_key` | string | GPTMail API Key |
| `refresh_interval_days` | int | 刷新周期，范围 `1-90` |
| `refresh_delay_seconds` | int | 刷新间隔秒数，范围 `0-60` |
| `refresh_cron` | string | Cron 表达式 |
| `use_cron_schedule` | bool | 是否使用 Cron 调度 |
| `enable_scheduled_refresh` | bool | 是否开启定时刷新 |
| `external_api_key` | string | 对外 API Key，可传空字符串清空 |

#### 临时邮箱服务相关字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `duckmail_base_url` | string | DuckMail API 地址 |
| `duckmail_api_key` | string | DuckMail API Key |
| `cloudflare_worker_domain` | string | Cloudflare Worker 域名 |
| `cloudflare_email_domains` | string | Cloudflare 邮箱域名，逗号分隔 |
| `cloudflare_admin_password` | string | Cloudflare 管理密码 |

#### 转发与 SMTP / Telegram 相关字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `forward_check_interval_minutes` | int | 轮询间隔，范围 `1-60` |
| `forward_email_window_minutes` | int | 转发邮件时间范围，范围 `0-10080`，`0` 表示不限制 |
| `forward_include_junkemail` | bool | 是否把垃圾箱邮件也纳入转发轮询 |
| `forward_channels` | array<string> | `smtp` / `telegram` |
| `email_forward_recipient` | string | SMTP 转发收件人 |
| `smtp_host` | string | SMTP 主机 |
| `smtp_port` | int | SMTP 端口 |
| `smtp_username` | string | SMTP 用户名 |
| `smtp_password` | string | SMTP 密码 |
| `smtp_from_email` | string | SMTP 发件邮箱 |
| `smtp_provider` | string | `outlook`、`qq`、`163`、`126`、`yahoo`、`aliyun`、`custom` |
| `smtp_use_tls` | bool | 是否启用 TLS |
| `smtp_use_ssl` | bool | 是否启用 SSL |
| `telegram_bot_token` | string | Telegram Bot Token |
| `telegram_chat_id` | string | Telegram Chat ID |

#### 请求示例

```json
{
  "forward_check_interval_minutes": 5,
  "forward_email_window_minutes": 30,
  "forward_include_junkemail": true,
  "smtp_provider": "outlook",
  "forward_channels": ["smtp", "telegram"]
}
```

### POST `/api/settings/test-forward-channel`

使用当前前端表单配置直接测试转发渠道，不要求先保存设置。

#### 请求示例

SMTP 测试：

```json
{
  "channel": "smtp",
  "config": {
    "smtp": {
      "recipient": "demo@example.com",
      "host": "smtp.office365.com",
      "port": 587,
      "username": "demo@example.com",
      "password": "secret",
      "from_email": "demo@example.com",
      "provider": "outlook",
      "use_tls": true,
      "use_ssl": false
    }
  }
}
```

Telegram 测试：

```json
{
  "channel": "telegram",
  "config": {
    "telegram": {
      "bot_token": "123:abc",
      "chat_id": "123456"
    }
  }
}
```

## 说明

### 代理使用

账号邮箱相关 API 当前会优先继承账号所属分组的 `proxy_url`：

- Graph token 获取
- Graph 邮件列表
- Graph 邮件详情
- Outlook OAuth IMAP token 获取
- Outlook OAuth IMAP 列表 / 详情 / 删除回退
- 密码型 IMAP 列表 / 详情
- 转发轮询抓信 / 详情抓取

### 别名冲突规则

别名保存时会校验：

- 不能与本账号主邮箱重复
- 不能与其他账号主邮箱重复
- 不能与其他账号别名重复
- 不能与临时邮箱地址冲突

### 特殊响应类型

以下接口不是普通 JSON 数据接口：

- `GET /api/accounts/refresh-all`: `text/event-stream`
- `GET /api/accounts/trigger-scheduled-refresh`: `text/event-stream`
- `GET /api/groups/<group_id>/export`: `text/plain` 文件下载
- `GET /api/accounts/export`: `text/plain` 文件下载
- `POST /api/accounts/export-selected`: `text/plain` 文件下载
