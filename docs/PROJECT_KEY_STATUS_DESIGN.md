# Project Key + Account Status 设计方案

## 1. 背景

当前 `project_key` 更偏向“领取时防重复”的轻量参数，不是完整的项目模型。  
新的目标是把“项目”定义为一个可重复使用的业务实体，并且对每个 `邮箱 + 项目` 单独维护状态。

核心诉求如下：

- 同一个邮箱可以参与多个不同项目。
- 同一个邮箱在同一个项目内，成功消费后不再重复分配。
- 同一个邮箱在同一个项目内，失败后进入 `failed` 状态，默认不再自动分配，需人工干预后才能再次分配。
- 项目可以不指定分组，此时对所有邮箱生效。
- 项目支持多次使用；每次使用时，都会按圈定范围补全新增邮箱。
- 不依赖标签系统，前端和接口直接查项目相关表。

## 2. 目标语义

对每个 `account_id + project_key`，维护一条独立状态。

示例：

- 邮箱 `a@example.com` 在项目 `gpt` 下：
  - 初始状态是 `toClaim`
  - 成功注册后状态变成 `done`
  - 后续再领取 `gpt` 时，这个邮箱不会再被分配

- 同一个邮箱 `a@example.com` 在项目 `google` 下：
  - 初始状态也是 `toClaim`
  - 这次注册失败，状态变成 `failed`
  - 后续不会自动再次领取
  - 只有人工重置为 `toClaim` 后，才会再次参与分配

结论：

- “是否还能分配”是按项目维度判断的，不是按邮箱全局判断。
- 同一个邮箱在不同项目之间互不影响。

## 3. 状态定义

建议只保留最小必要状态。

### 3.1 项目账号状态

- `toClaim`
  - 该邮箱在该项目下可被领取

- `claiming`
  - 该邮箱当前正被某个调用方领取中

- `done`
  - 该邮箱在该项目下已经成功消费
  - 后续不会再分配给该项目

- `failed`
  - 该邮箱在该项目下最近一次消费失败
  - 默认不再自动参与该项目分配
  - 需要人工重置后才能再次领取

- `removed`
  - 该邮箱被人工从项目范围中移除
  - 后续不会再参与该项目分配

- `deleted`
  - 该邮箱原先存在于项目中，但账号已从系统主表删除
  - 用于保留项目历史，不自动参与该项目分配
  - 需要该邮箱重新导入系统后，再由启动项目逻辑决定是否恢复关联

### 3.2 状态流转

- `toClaim -> claiming`
  - 调用项目领取接口成功

- `claiming -> done`
  - 调用消费成功接口

- `claiming -> failed`
  - 调用消费失败接口

- `claiming -> toClaim`
  - 调用释放接口
  - claim 过期回收

- `failed -> toClaim`
  - 人工重置失败邮箱

- `toClaim -> removed`
  - 人工从项目中移除

- `removed -> toClaim`
  - 人工恢复到项目

- `* -> deleted`
  - 启动项目时发现项目记录对应的账号已从系统主表删除

- `deleted -> toClaim`
  - 同一邮箱地址重新导入系统后，启动项目时恢复为可领取

- `deleted -> failed`
  - 同一邮箱地址重新导入系统后，启动项目时恢复其历史失败态

- `deleted -> done`
  - 同一邮箱地址重新导入系统后，启动项目时恢复其历史成功态

说明：

- `failed` 是显式失败态。
- `failed` 默认不进入自动可领取集合。
- `failed` 和 `removed` 一样，都需要人工干预，但语义不同：
  - `failed`：该邮箱还在项目范围内，只是本次失败，需要人工决定是否重试
  - `removed`：该邮箱被明确移出该项目范围
- `deleted` 是系统删除态：
  - 不是人工动作
  - 不是“移出项目范围”
  - 是“该项目原先认识这个邮箱，但系统主表里这个账号被删了”

## 4. 数据模型

建议新增 4 张表。

## 4.1 `projects`

项目定义表。

建议字段：

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `name TEXT NOT NULL`
- `project_key TEXT NOT NULL UNIQUE`
- `description TEXT DEFAULT ''`
- `scope_mode TEXT NOT NULL DEFAULT 'all'`
- `status TEXT NOT NULL DEFAULT 'active'`
- `last_scope_synced_at TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

说明：

- `project_key` 是项目稳定标识，例如 `gpt`、`google`
- `scope_mode`
  - `all`：项目作用于所有邮箱
  - `groups`：项目作用于指定分组内邮箱
- `status`
  - `active`
  - `paused`
  - `archived`

## 4.2 `project_group_scopes`

项目分组范围表。

建议字段：

- `project_id INTEGER NOT NULL`
- `group_id INTEGER NOT NULL`
- `created_at TEXT NOT NULL`

约束：

- `PRIMARY KEY (project_id, group_id)`

说明：

- 当 `scope_mode = all` 时，这张表可以为空。
- 当 `scope_mode = groups` 时，这张表表示项目圈定的分组范围。

## 4.3 `project_accounts`

项目和邮箱的状态关系表，这是本方案核心。

建议字段：

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `project_id INTEGER NOT NULL`
- `account_id INTEGER`
- `normalized_email TEXT NOT NULL`
- `email_snapshot TEXT NOT NULL`
- `status TEXT NOT NULL DEFAULT 'toClaim'`
- `source_group_id INTEGER`
- `caller_id TEXT DEFAULT ''`
- `task_id TEXT DEFAULT ''`
- `claim_token TEXT`
- `claimed_at TEXT`
- `lease_expires_at TEXT`
- `last_result TEXT DEFAULT ''`
- `last_result_detail TEXT DEFAULT ''`
- `claim_count INTEGER NOT NULL DEFAULT 0`
- `first_claimed_at TEXT`
- `last_claimed_at TEXT`
- `done_at TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

约束：

- `UNIQUE(project_id, normalized_email)`

索引建议：

- `INDEX(project_id, status)`
- `INDEX(project_id, lease_expires_at)`
- `INDEX(account_id)`
- `INDEX(project_id, normalized_email)`

语义：

- 每个邮箱在每个项目下只有一条记录
- 项目内“同一个邮箱”的主身份以 `normalized_email` 为准，不以 `account_id` 为准
- `status=done` 表示该邮箱对该项目已经消费成功
- `status=toClaim` 表示该邮箱对该项目仍可领取
- `status=failed` 表示该邮箱在该项目下失败，需人工重置后才可再次领取
- `status=deleted` 表示该邮箱曾属于该项目，但当前账号主表里已不存在

## 4.4 `project_account_events`

项目账号事件表，用于排查和审计。

建议字段：

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `project_id INTEGER NOT NULL`
- `account_id INTEGER NOT NULL`
- `normalized_email TEXT NOT NULL`
- `project_account_id INTEGER`
- `action TEXT NOT NULL`
- `from_status TEXT`
- `to_status TEXT`
- `caller_id TEXT DEFAULT ''`
- `task_id TEXT DEFAULT ''`
- `claim_token TEXT`
- `detail TEXT DEFAULT ''`
- `created_at TEXT NOT NULL`

建议记录的动作：

- `sync_add`
- `claim`
- `complete_success`
- `complete_failed`
- `release`
- `expire_recycle`
- `remove`
- `restore`
- `reset_failed`

## 5. 范围规则

## 5.1 项目不指定分组

如果创建项目时不传 `group_ids`：

- `scope_mode = all`
- 该项目对所有可用邮箱生效

后续项目补全范围时：

- 扫描全量账号
- 对还没有出现在该项目中的邮箱，按 `normalized_email` 插入 `project_accounts(status='toClaim')`

## 5.2 项目指定分组

如果创建项目时传了 `group_ids`：

- `scope_mode = groups`
- 只对这些分组中的邮箱生效

后续项目补全范围时：

- 只扫描这些分组下的账号
- 对新增且未进入过该项目的邮箱，按 `normalized_email` 插入 `project_accounts(status='toClaim')`

## 5.3 范围补全是“增量补全”，不是“强制同步删除”

补全规则建议为：

- 只新增缺失的 `project_accounts`
- 不自动删除已有 `project_accounts`

原因：

- 历史 `done` 记录不能因为邮箱后续换分组就消失
- 失败邮箱和成功邮箱一样，都不应因范围变化被自动抹掉
- 删除后又重新导入的同邮箱，必须复用同一条项目记录，不能因为 `account_id` 变化而变成“新邮箱”

如果需要移除，应走明确的“项目移除账号”接口。

## 6. 项目可重复使用的定义

项目不是一次性任务，而是长期可复用的业务容器。

以 `gpt` 项目为例：

1. 第一次使用前执行范围补全
2. 已有邮箱全部进入 `project_accounts`
3. 成功的邮箱变 `done`
4. 失败的邮箱进入 `failed`
5. 过一段时间新增了一批邮箱
6. 第二次使用前再次执行范围补全
7. 仅把新增邮箱补进来，状态初始化为 `toClaim`
8. 旧的 `done` 保持 `done`
9. 旧的 `toClaim` 继续可领取，`failed` 保持待人工处理

这就满足：

- 项目可多次使用
- 每次使用都能补新邮箱
- 已成功消费过的邮箱不会在同项目里再次被分配

## 7. 核心接口设计

## 7.1 启动项目

`POST /api/projects/start`

请求示例：

```json
{
  "name": "GPT 注册",
  "project_key": "gpt",
  "description": "GPT 注册项目",
  "group_ids": [1, 2]
}
```

如果不指定分组：

```json
{
  "name": "Google 注册",
  "project_key": "google",
  "description": "Google 注册项目"
}
```

行为：

- 如果 `project_key` 不存在：
  - 创建 `projects`
  - 如果有 `group_ids`，写入 `project_group_scopes`
  - 立即执行一次范围补全
- 如果 `project_key` 已存在：
  - 视为“再次启动同一个项目”
  - 默认沿用项目当前已保存的范围配置
  - 如果请求里显式传入 `group_ids`，则更新项目范围后再补全
  - 只补全新增邮箱，不改已有邮箱状态
- 启动过程中先扫描项目内历史记录：
  - 对应账号已从系统主表删除的，标记为 `deleted`
- 随后按当前范围扫描系统账号：
  - 以 `normalized_email` 匹配项目历史
  - 如果是第一次出现该邮箱，则新增 `project_accounts`
  - 如果是历史上已存在、但当前 `account_id` 已变化，则复用旧记录并更新新的 `account_id`
- 将项目状态设置为 `active`

返回：

- 项目基础信息
- 补入账号数量
- 本次启动是否为首次创建
- 本次补入账号数量
- 本次标记为 `deleted` 的账号数量

返回示例：

```json
{
  "success": true,
  "data": {
    "project_key": "gpt",
    "created": true,
    "added_count": 128,
    "deleted_count": 3,
    "total_count": 560
  }
}
```

说明：

- 推荐每次项目开始使用前都调用一次
- 该接口同时承担“首次创建项目”和“按范围补全新增邮箱”两种职责
- 前端按钮文案应改为“启动项目”或“再次启动项目”，而不是单独暴露 `sync-scope`

## 7.2 领取项目邮箱

`POST /api/projects/{project_key}/claim-random`

请求示例：

```json
{
  "caller_id": "reg-worker-001",
  "task_id": "task-20260415-0001",
  "lease_seconds": 600
}
```

行为：

1. 校验项目存在且 `status=active`
2. 从 `project_accounts` 中挑选 `status='toClaim'` 的账号
3. 同时要求全局 `accounts.pool_status='available'`
4. 事务内更新：
   - `accounts.pool_status='claimed'`
   - `project_accounts.status='claiming'`
   - 写入 `claim_token / caller_id / task_id / claimed_at / lease_expires_at`
   - `claim_count + 1`
5. 写事件日志

返回：

- `project_key`
- `account_id`
- `email`
- `claim_token`
- `claimed_at`
- `lease_expires_at`

## 7.3 消费成功

`POST /api/projects/{project_key}/complete-success`

请求示例：

```json
{
  "account_id": 123,
  "claim_token": "clm_xxx",
  "caller_id": "reg-worker-001",
  "task_id": "task-20260415-0001",
  "detail": "注册成功"
}
```

行为：

- 校验 `project_accounts.status='claiming'`
- 将 `project_accounts.status` 改为 `done`
- 写 `done_at`
- 记录 `last_result='success'`
- 将全局 `accounts.pool_status` 按既有规则更新为已消费后的状态
- 写事件日志

结果：

- 同一邮箱在该项目下不再进入可领取集合

## 7.4 消费失败

`POST /api/projects/{project_key}/complete-failed`

请求示例：

```json
{
  "account_id": 123,
  "claim_token": "clm_xxx",
  "caller_id": "reg-worker-001",
  "task_id": "task-20260415-0001",
  "detail": "注册失败"
}
```

行为：

- 校验 `project_accounts.status='claiming'`
- 将 `project_accounts.status` 改为 `failed`
- 清空当前 claim 现场字段
- 记录 `last_result='failed'`
- 将全局 `accounts.pool_status` 恢复为 `available` 或按现有失败策略处理
- 写事件日志

结果：

- 同一邮箱在该项目下不会自动再次领取
- 需要人工执行重置后，才能再次进入可领取集合

## 7.5 主动释放

`POST /api/projects/{project_key}/release`

行为和“消费失败”相似：

- `claiming -> toClaim`
- 用于任务取消、worker 中断、人工放弃

## 7.6 人工重置失败邮箱

`POST /api/projects/{project_key}/reset-failed`

请求示例：

```json
{
  "account_id": 123,
  "detail": "人工允许重试"
}
```

行为：

- 校验 `project_accounts.status='failed'`
- 将状态改回 `toClaim`
- 保留历史 `last_result='failed'`
- 写事件日志

结果：

- 该邮箱重新进入该项目的可领取集合

## 7.7 人工移出项目范围

`POST /api/projects/{project_key}/remove-account`

请求示例：

```json
{
  "account_id": 123,
  "detail": "人工移出项目"
}
```

行为：

- 校验项目账号存在
- 如果当前是 `claiming`，则拒绝移出，要求先释放
- 将 `project_accounts.status` 改为 `removed`
- 清空当前 claim 现场字段
- 写事件日志

结果：

- 该邮箱不再参与该项目分配

## 7.8 人工恢复到项目范围

`POST /api/projects/{project_key}/restore-account`

请求示例：

```json
{
  "account_id": 123,
  "detail": "人工恢复到项目"
}
```

行为：

- 校验 `project_accounts.status='removed'`
- 将状态改回 `toClaim`
- 写事件日志

结果：

- 该邮箱重新进入该项目的可领取集合

## 7.9 过期回收

后台定时任务：

- 扫描 `project_accounts.status='claiming' AND lease_expires_at < now`
- 将其改回 `toClaim`
- 同步恢复 `accounts.pool_status`
- 写 `expire_recycle` 事件

## 7.10 项目详情 / 项目账号列表

`GET /api/projects`

返回每个项目的聚合统计：

- `total_count`
- `to_claim_count`
- `claiming_count`
- `failed_count`
- `done_count`
- `removed_count`

`GET /api/projects/{project_key}/accounts`

支持筛选：

- `status`
- `group_id`
- `provider`
- `keyword`

这将成为前端项目页的主要查询接口。

## 8. 事务与并发

`claim-random` 必须使用数据库事务保证原子性。

推荐流程：

1. `BEGIN IMMEDIATE`
2. 查找一个满足条件的项目账号：
   - `project_accounts.status = 'toClaim'`
   - `accounts.pool_status = 'available'`
   - `accounts.status = 'active'`
3. 更新全局账号表 `accounts`
4. 更新项目账号表 `project_accounts`
5. 写事件日志
6. `COMMIT`

这样可以保证：

- 同一邮箱不会被两个 worker 同时领到
- 同一邮箱在不同项目里虽然逻辑上独立，但物理上同一时刻仍只能被一个任务占用

## 9. 为什么不和标签挂钩

本方案明确不依赖标签，原因如下：

- 标签更适合辅助分类，不适合作为强业务状态
- 标签容易出现互斥状态并存
- 标签改名和项目改名耦合太强
- 并发领取时，标签方案更难做严格原子控制
- 前端项目页完全可以直接查 `projects + project_accounts`

因此：

- 项目状态只存在于 `project_accounts.status`
- 项目定义只存在于 `projects.project_key`
- 前端和接口只查项目表，不查标签

## 10. 与旧 `project_key` 逻辑的关系

旧逻辑更像：

- 外部请求直接传一个 `project_key`
- 系统只记录“这个 caller + project 用过哪些账号”
- 主要解决同项目排重

新逻辑则是：

- 先启动项目；首次启动时自动创建项目定义
- 每个邮箱在每个项目下维护显式状态
- 成功后不再分配，失败后进入 `failed`
- 支持项目列表、项目详情、项目复用、范围补全

建议兼容策略：

- 保留旧接口一段时间
- 新业务改走项目接口
- 后续再决定是否废弃旧 `project_key` 直传模式

## 11. 示例 SQL 草案

### 11.1 创建 `projects`

```sql
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    project_key TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    scope_mode TEXT NOT NULL DEFAULT 'all',
    status TEXT NOT NULL DEFAULT 'active',
    last_scope_synced_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

### 11.2 创建 `project_group_scopes`

```sql
CREATE TABLE IF NOT EXISTS project_group_scopes (
    project_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (project_id, group_id)
);
```

### 11.3 创建 `project_accounts`

```sql
CREATE TABLE IF NOT EXISTS project_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    account_id INTEGER,
    normalized_email TEXT NOT NULL,
    email_snapshot TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'toClaim',
    source_group_id INTEGER,
    caller_id TEXT DEFAULT '',
    task_id TEXT DEFAULT '',
    claim_token TEXT,
    claimed_at TEXT,
    lease_expires_at TEXT,
    last_result TEXT DEFAULT '',
    last_result_detail TEXT DEFAULT '',
    claim_count INTEGER NOT NULL DEFAULT 0,
    first_claimed_at TEXT,
    last_claimed_at TEXT,
    done_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, normalized_email)
);
```

### 11.4 创建 `project_account_events`

```sql
CREATE TABLE IF NOT EXISTS project_account_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    normalized_email TEXT NOT NULL,
    project_account_id INTEGER,
    action TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    caller_id TEXT DEFAULT '',
    task_id TEXT DEFAULT '',
    claim_token TEXT,
    detail TEXT DEFAULT '',
    created_at TEXT NOT NULL
);
```

## 12. 推荐实施顺序

第一阶段：

- 建表
- 启动项目接口
- 项目列表 / 项目详情 / 项目账号列表接口

第二阶段：

- 项目领取接口
- 成功 / 失败 / 释放接口
- 过期回收任务

第三阶段：

- 前端项目管理页
- 项目统计面板
- 与旧 `project_key` 直传模式的兼容或迁移

## 13. 最终结论

这套设计满足你的最新要求：

- 不和标签挂钩
- 每个邮箱在每个项目下独立维护状态
- 同项目成功后不再分配
- 同项目失败后进入 `failed`，需人工重置后才可再次分配
- 删除后又重新导入的同邮箱，会按邮箱地址复用原项目状态
- 不指定分组时可对所有邮箱生效
- 项目支持反复使用
- 每次使用前可按范围补全新增邮箱

如果后续开始实现，核心落点应以 `project_accounts` 为中心，而不是继续扩展现有的轻量 `project_key` 排重表。

## 14. 结合当前仓库的落地方式

当前仓库不是 controller / repository 分层，而是 `web_outlook_app.py` 主文件 + `outlook_web/segments/*.py` 分段注入式结构。

相关现状：

- Flask App 和数据库主配置在 `web_outlook_app.py` / `outlook_web/segments/01_bootstrap.py`
- 分组、账号、标签等数据访问函数集中在 `outlook_web/segments/02_groups_accounts.py`
- 路由主要集中在 `outlook_web/segments/04_routes_groups_accounts.py`

因此，推荐的落地位置如下。

### 14.1 建表与迁移

放在：

- `web_outlook_app.py` 当前数据库初始化逻辑
- 或者 `outlook_web/segments/01_bootstrap.py` 中与 DB 初始化相关的位置

建议：

- 在现有 DB 初始化流程中追加 4 张表的 `CREATE TABLE IF NOT EXISTS`
- 不需要单独引入复杂迁移框架
- 如果仓库已经有 schema version 管理，则同步加一个版本号；如果没有，则先沿用幂等建表

### 14.2 项目相关数据访问函数

放在：

- `outlook_web/segments/02_groups_accounts.py`

建议新增函数：

- `start_project(...)`
- `get_project_by_key(project_key)`
- `load_projects()`
- `load_project_accounts(project_id, ...)`
- `sync_project_scope(project_id)`
- `claim_project_account(project_id, caller_id, task_id, lease_seconds)`
- `complete_project_account_success(...)`
- `complete_project_account_failed(...)`
- `reset_project_account_failed(...)`
- `remove_project_account(...)`
- `restore_project_account(...)`
- `release_project_account(...)`
- `recycle_expired_project_claims()`
- `add_project_event(...)`

理由：

- 当前仓库的分组、账号、标签操作本来就集中在这个 segment
- 第一版不需要强行拆 repository 层，保持当前项目风格更稳

### 14.3 项目 API 路由

放在：

- `outlook_web/segments/04_routes_groups_accounts.py`

建议新增路由：

- `GET /api/projects`
- `POST /api/projects/start`
- `GET /api/projects/<project_key>`
- `GET /api/projects/<project_key>/accounts`
- `POST /api/projects/<project_key>/claim-random`
- `POST /api/projects/<project_key>/complete-success`
- `POST /api/projects/<project_key>/complete-failed`
- `POST /api/projects/<project_key>/reset-failed`
- `POST /api/projects/<project_key>/release`
- `POST /api/projects/<project_key>/remove-account`
- `POST /api/projects/<project_key>/restore-account`

### 14.4 前端页面

当前首页是单页式结构，前端逻辑拆在：

- `static/js/index/*.js`
- `templates/index.html`

建议新增一个项目管理模块：

- `static/js/index/11-projects.js`

主要职责：

- 项目列表
- 启动项目弹窗
- 项目详情弹窗 / 侧栏
- 项目账号列表
- 启动项目 / 再次启动项目按钮
- 项目领取与状态查看

模板层建议：

- 在 `templates/index.html`
- 或 `templates/partials/index/` 下新增项目面板

## 15. 当前仓库下的接口返回建议

为了和现有接口风格统一，建议继续使用：

```json
{
  "success": true,
  "message": "操作成功",
  "data": {}
}
```

失败时：

```json
{
  "success": false,
  "error": "项目不存在"
}
```

### 15.1 项目列表

```json
{
  "success": true,
  "data": {
    "projects": [
      {
        "id": 1,
        "name": "GPT 注册",
        "project_key": "gpt",
        "description": "GPT 注册项目",
        "scope_mode": "groups",
        "status": "active",
        "group_ids": [1, 2],
        "total_count": 500,
        "to_claim_count": 120,
        "claiming_count": 5,
        "failed_count": 8,
        "done_count": 360,
        "removed_count": 15,
        "last_scope_synced_at": "2026-04-15T09:30:00Z",
        "created_at": "2026-04-10T08:00:00Z"
      }
    ]
  }
}
```

### 15.2 项目账号列表

```json
{
  "success": true,
  "data": {
    "project": {
      "project_key": "gpt",
      "name": "GPT 注册"
    },
    "accounts": [
      {
        "account_id": 101,
        "email": "a@example.com",
        "provider": "outlook",
        "group_id": 1,
        "group_name": "默认分组",
        "project_status": "done",
        "caller_id": "reg-worker-01",
        "task_id": "task-001",
        "claim_count": 2,
        "last_result": "success",
        "last_result_detail": "注册成功",
        "claimed_at": "2026-04-15T10:00:00Z",
        "lease_expires_at": "2026-04-15T10:10:00Z",
        "done_at": "2026-04-15T10:02:00Z"
      }
    ]
  }
}
```

## 16. 领取逻辑的精确定义

为了满足你的规则，这里把“同项目成功不再分配、同项目失败需人工确认后才可重试”写成精确规则。

### 16.1 可分配条件

某个邮箱可被项目 `project_key=X` 分配，当且仅当：

- 在 `project_accounts` 中存在一条 `(project_id, account_id)` 记录
- 该记录 `status = 'toClaim'`
- 对应全局账号 `accounts.status = 'active'`
- 对应全局账号当前未被别的任务占用

### 16.2 成功后

当 `complete-success` 被调用后：

- 该 `project_accounts.status` 更新为 `done`
- 该邮箱以后不会再出现在该项目的可分配集合中
- 但在其他项目下仍然可根据该项目自己的状态独立判断

### 16.3 失败后

当 `complete-failed` 被调用后：

- 该 `project_accounts.status` 改为 `failed`
- 该邮箱以后不会自动出现在该项目的可分配集合中
- 只有人工重置为 `toClaim` 后，才会再次参与分配

这正好对应你要的：

- `gpt` 成功后不再分给 `gpt`
- `google` 失败后会停在 `failed`，等人工决定是否继续

## 17. “项目多次使用”在接口上的建议

为了让项目复用语义明确，建议不要增加“项目运行批次表”。

第一版可以直接约定：

- 项目本身就是长期复用对象
- 每次开始新一轮使用前，调用一次“启动项目”接口
- 启动项目接口在项目已存在时，只补新增邮箱，不改历史状态

这样模型更简单。

### 17.1 典型使用流程

#### GPT 项目第一次使用

1. 调用“启动项目”接口创建 `gpt`
3. 大量邮箱进入 `toClaim`
4. worker 循环调用 `claim-random`
5. 成功则 `complete-success`
6. 失败则 `complete-failed`

#### GPT 项目第二次使用

1. 新增了一批邮箱到系统
2. 再次调用“启动项目”接口
3. 新邮箱被补入 `project_accounts(status='toClaim')`
4. 老的 `done` 保持不变
5. 老的 `toClaim` 继续可用
6. 老的 `failed` 继续保留，等待人工处理

## 18. 边界情况处理

### 18.1 邮箱被删除

建议：

- 如果一个账号已存在于 `project_accounts` 中，不要因为账号主表删除就级联清空项目历史
- 启动项目时，应扫描项目历史中已失联的账号：
  - 如果 `project_accounts.account_id` 在 `accounts` 中已不存在，则将其状态标为 `deleted`
  - 保留 `normalized_email / email_snapshot / last_result / done_at` 等历史信息
- `deleted` 不等于 `removed`
  - `removed` 是人工移出项目
  - `deleted` 是系统主表已删号，但项目仍保留历史

推荐规则：

- 项目补全和重建关联时，按 `normalized_email` 而不是 `account_id` 判断“是否是同一个邮箱”
- 如果同一邮箱地址被重新导入系统，启动项目时应复用原有项目记录并更新新的 `account_id`
- 不允许因为“删除再导入”绕过之前的 `done / failed` 状态

### 18.2 分组变化

如果项目是按分组建的，而邮箱后来被移动到其他分组：

- 已存在于 `project_accounts` 的记录保留
- 以后再次启动项目时，只对当前范围内新增邮箱做补全
- 不反向删除旧记录

### 18.3 删除后又重新导入同邮箱

如果邮箱 `a@example.com` 之前已在项目 `gpt` 中：

- 即使它原来的 `account_id` 被删除
- 只要后来重新导入的仍然是同一个邮箱地址
- 启动项目时就应按 `normalized_email` 命中旧记录

恢复规则建议：

- 旧状态是 `done`
  - 保持 `done`
  - 不重新进入可领取集合

- 旧状态是 `failed`
  - 保持 `failed`
  - 仍需人工重置

- 旧状态是 `toClaim`
  - 恢复为 `toClaim`

- 旧状态是 `removed`
  - 保持 `removed`

- 旧状态是 `deleted`
  - 如果此前没有更明确的历史终态，则恢复为 `toClaim`

### 18.4 项目暂停

如果 `projects.status='paused'`：

- 不允许 `claim-random`
- 允许查看项目列表和项目账号
- 允许手动执行“启动项目”接口

### 18.5 项目归档

如果 `projects.status='archived'`：

- 不允许 claim
- 不允许 sync
- 仅保留查询能力

### 18.6 claim 异常中断

如果 worker 在领取后崩溃：

- 依赖 `lease_expires_at` 回收
- 后台任务将 `claiming -> toClaim`

## 19. 测试方案

建议在 `tests/` 下新增一组项目测试。

建议测试点：

- `test_start_project_all_scope`
- `test_start_project_group_scope`
- `test_sync_scope_adds_missing_accounts_only`
- `test_claim_random_only_from_to_claim`
- `test_complete_success_marks_done`
- `test_complete_failed_marks_failed`
- `test_failed_is_not_claimable_until_reset`
- `test_reset_failed_returns_to_to_claim`
- `test_same_account_done_in_gpt_but_to_claim_in_google`
- `test_project_without_groups_applies_to_all_accounts`
- `test_sync_scope_replenishes_new_accounts`
- `test_deleted_account_is_marked_deleted_on_start`
- `test_reimported_same_email_reuses_existing_project_record`
- `test_reimported_done_email_does_not_reenter_claimable_set`
- `test_expired_claim_returns_to_to_claim`
- `test_paused_project_cannot_claim`

其中最关键的是这个回归场景：

1. 邮箱 A 在 `gpt` 下成功
2. `gpt` 下状态变 `done`
3. 再领取 `gpt` 时不再返回 A
4. 在 `google` 下同步范围后，A 初始状态仍是 `toClaim`
5. `google` 仍可以正常领取 A

失败回归场景：

1. 邮箱 B 在 `google` 下领取成功
2. 调用 `complete-failed`
3. `google` 下状态变 `failed`
4. 再次调用 `claim-random`，不会自动返回 B
5. 调用 `reset-failed`
6. B 重新回到 `toClaim`

## 20. 实施建议

如果接下来要开始编码，建议按下面顺序来，不容易返工。

1. 先建表并实现 `start_project + list_projects + list_project_accounts`
2. 再实现 `claim-random + complete-success + complete-failed + reset-failed + release`
3. 再加后台过期回收
4. 最后接前端项目面板

暂时不实现前端，只做接口流程，并补接口文档，供外部对接
