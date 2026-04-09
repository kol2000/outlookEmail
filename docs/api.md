# API 文档

本文档基于当前代码实现整理，重点覆盖对外 API、账号别名、聚合取信、验证码提取，以及和本次改动相关的内部接口。

## 认证

### 对外 API

对外 API 使用 API Key 认证，支持两种方式：

- Header: `X-API-Key: your-api-key`
- Query: `?api_key=your-api-key`

可在 Web 界面 `设置 -> 对外 API Key` 中配置。

### 内部 API

内部 API 需要先登录 Web 界面并携带 Session Cookie。

## 邮箱别名说明

普通账号现在支持配置多个别名邮箱。

- 对外 API 传入主邮箱或别名邮箱都可以命中同一个账号
- 返回结果中会包含：
  - `requested_email`: 请求里传入的邮箱
  - `resolved_email`: 实际命中的主邮箱
  - `matched_alias`: 若通过别名命中，则为对应别名；否则为空
- 别名邮箱支持常见特殊字符，例如 `+`、`@`、`&`
  - `@` 可以直接传
  - `+` 建议编码成 `%2B`
  - `&` 必须编码成 `%26`

典型高级用法：

1. 把外部邮箱 B 的邮件自动转发到本项目管理的邮箱 A
2. 在邮箱 A 下把邮箱 B 设置为别名
3. 后续直接通过本项目 API，用邮箱 B 作为 `email` 参数取邮件或取验证码

## 对外 API

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

### GET `/api/accounts/search`

搜索账号，当前支持匹配：

- 主邮箱
- 备注
- 标签
- 别名邮箱

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

更新账号信息。现在支持直接在更新账号时一起保存别名。

#### 请求体新增字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
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

## 邮件接口

### GET `/api/emails/<email>`

内部邮件列表接口。支持主邮箱或别名邮箱。

#### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `folder` | string | 否 | `inbox`、`junkemail`、`deleteditems`、`all` |
| `skip` | int | 否 | 分页偏移 |
| `top` | int | 否 | 返回数量 |

当 `folder=all` 时，行为与对外 API 一致：同时抓取 `inbox` 与 `junkemail`，按时间合并排序。

### GET `/api/email/<email>/<message_id>`

获取单封邮件详情。`email` 参数同样支持传主邮箱或别名邮箱。

### POST `/api/emails/delete`

批量删除邮件。

#### 请求体

```json
{
  "email": "user@outlook.com",
  "ids": ["AAMk...", "AAMk..."]
}
```

## 转发设置

### GET `/api/settings`

转发相关新增返回字段：

| 字段 | 说明 |
| --- | --- |
| `forward_check_interval_minutes` | 转发轮询间隔 |
| `forward_email_window_minutes` | 仅转发最近多少分钟内收到的邮件，`0` 表示不限制 |
| `forward_include_junkemail` | 是否把垃圾箱邮件也纳入转发 |
| `smtp_provider` | SMTP 邮箱类型：`outlook` / `qq` / `163` / `126` / `yahoo` / `aliyun` / `custom` |
| `forward_channels` | 当前启用的转发渠道 |

前端设置页支持直接测试 SMTP / Telegram 链路，测试时使用当前表单值，不要求先保存设置。

### PUT `/api/settings`

转发相关新增可写字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `forward_check_interval_minutes` | int | 轮询间隔，范围 `1-60` |
| `forward_email_window_minutes` | int | 转发邮件时间范围，范围 `0-10080`，`0` 表示不限制 |
| `forward_include_junkemail` | bool | 是否把垃圾箱邮件也纳入转发轮询 |
| `smtp_provider` | string | SMTP 邮箱类型，支持 `outlook`、`qq`、`163`、`126`、`yahoo`、`aliyun`、`custom` |
| `forward_channels` | array<string> | `smtp` / `telegram` |

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
