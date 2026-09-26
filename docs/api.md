# API documentation

This document is based on the current code implementation. The goal is to allow AI Agents, scripts or external systems to directly connect to the complete API, rather than scattered instructions that are only visible to people.

## AI docking overview

- Base address: `http(s)://<host>:<port>`
- All routes are at `/api/*`
- Interfaces are divided into two categories:
  - External API: `/api/external/*`, use API Key
  - Complete management API: For the remaining `/api/*`, log in to the Web first, and then bring Session Cookie
- The browser extension can use `POST /api/extension/login` to exchange the one-time jump address through the Web login password, and then establish a normal Web Session
- Write operations use JSON request body by default, `Content-Type: application/json`
- Most interfaces return JSON; a few return file downloads or SSE event streams

Recommended docking sequence:

1. Log in to the Web and save the Session Cookie
2. Call `GET /api/csrf-token` to obtain CSRF Token
3. Read the interface and directly adjust `GET`
4. The write interface has `X-CSRFToken` in the request header

## Interface directory

### Basics and Authentication

| method | path | authentication | return type | description |
| --- | --- | --- | --- | --- |
| POST | `/login` | None | JSON | Use password to create Web Session, you can choose the login validity period |
| GET | `/api/version-status` | Session | JSON | Current version and warehouse version status |
| GET | `/api/csrf-token` | Session | JSON | Get the CSRF Token | corresponding to the current login session
| POST | `/api/extension/login` | Web login password | JSON | Browser extension obtains one-time login jump address |
| GET | `/extension-login/<token>` | One-time token | Redirect | Consumer extended login token, jump to | after establishing Web Session

### External API

| method | path | authentication | return type | description |
| --- | --- | --- | --- | --- |
| GET | `/api/external/accounts` | API Key | JSON | Get the list of ordinary email accounts |
| GET | `/api/external/emails` | API Key | JSON | Get the specified email mailing list |
| POST | `/api/external/outlook/upload` | API Key | JSON | Upload Outlook email account password to the upload table (default is not authorized, supports single/batch) |

### Group, account, label, project

| method | path | authentication | return type | description |
| --- | --- | --- | --- | --- |
| GET | `/api/groups` | Session | JSON | Get group list |
| GET | `/api/groups/<group_id>` | Session | JSON | Get a single group |
| POST | `/api/groups` | Session + CSRF | JSON | Create group |
| PUT | `/api/groups/<group_id>` | Session + CSRF | JSON | Update group |
| DELETE | `/api/groups/<group_id>` | Session + CSRF | JSON | Delete group |
| PUT | `/api/groups/reorder` | Session + CSRF | JSON | Adjust grouping order |
| POST | `/api/export/verify` | Session + CSRF | JSON | Get exported two-step verification token |
| GET | `/api/groups/<group_id>/export` | Session | `text/plain` Download | Export single group account |
| GET | `/api/accounts/export` | Session | `text/plain` Download | Export all accounts |
| POST | `/api/accounts/export-selected` | Session + CSRF | `text/plain` Download | Export selected group or selected account |
| GET | `/api/accounts` | Session | JSON | Get account list |
| GET | `/api/accounts/search` | Session | JSON | Search account |
| GET | `/api/accounts/<account_id>` | Session | JSON | Get a single account without returning the account password and IMAP password in plain text |
| POST | `/api/accounts/<account_id>/secrets` | Session + CSRF | JSON | Obtain account password and IMAP password | after secondary verification
| POST | `/api/accounts` | Session + CSRF | JSON | Batch import account |
| PUT | `/api/accounts/<account_id>` | Session + CSRF | JSON | Update account |
| POST | `/api/accounts/<account_id>/reauthorize` | Session + CSRF | JSON | Reauthorize existing Outlook account and automatically refresh verification |
| GET | `/api/outlook-upload-accounts` | Session | JSON | Paging query Outlook automatically authorizes uploading accounts, batch returns table display with plain text password |
| POST | `/api/outlook-upload-accounts` | Session + CSRF | JSON | Add Outlook automatic authorization upload account (can bring group_id / tag_ids / proxy_url) |
| PUT | `/api/outlook-upload-accounts/<account_id>` | Session + CSRF | JSON | Modify upload account email, password or remarks |
| DELETE | `/api/outlook-upload-accounts/<account_id>` | Session + CSRF | JSON | Delete upload account |
| POST | `/api/outlook-upload-accounts/batch-delete` | Session + CSRF | JSON | Batch delete upload account |
| DELETE | `/api/accounts/<account_id>` | Session + CSRF | JSON | Delete account by ID |
| DELETE | `/api/accounts/email/<email_addr>` | Session + CSRF | JSON | Delete account by email |
| POST | `/api/accounts/batch-delete` | Session + CSRF | JSON | Batch delete account |
| POST | `/api/accounts/batch-outlook-auto-auth` | Session + CSRF | JSON | Add official Outlook accounts to the automatic authorization queue in batches |
| GET | `/api/accounts/<account_id>/aliases` | Session | JSON | Get account alias |
| PUT | `/api/accounts/<account_id>/aliases` | Session + CSRF | JSON | Overall replacement account alias |
| POST | `/api/accounts/batch-update-group` | Session + CSRF | JSON | Batch change group |
| POST | `/api/accounts/batch-update-forwarding` | Session + CSRF | JSON | Batch change forwarding switch |
| POST | `/api/accounts/batch-update-proxy` | Session + CSRF | JSON | Batch change account level agent |
| GET | `/api/tags` | Session | JSON | Get tag list |
| POST | `/api/tags` | Session + CSRF | JSON | Create tag |
| DELETE | `/api/tags/<tag_id>` | Session + CSRF | JSON | Delete tag |
| POST | `/api/accounts/tags` | Session + CSRF | JSON | Batch change account tags |
| GET | `/api/projects` | Session | JSON | Get project list |
| GET | `/api/projects/<project_key>` | Session | JSON | Get project details |
| POST | `/api/projects/start` | Session + CSRF | JSON | Create or complete project scope |
| GET | `/api/projects/<project_key>/accounts` | Session | JSON | Get project account list |
| POST | `/api/projects/<project_key>/claim-random` | Session + CSRF | JSON | Randomly receive the project email |
| POST | `/api/projects/<project_key>/complete-success` | Session + CSRF | JSON | Mark project email successfully |
| POST | `/api/projects/<project_key>/complete-failed` | Session + CSRF | JSON | Failed to mark project mailbox |
| POST | `/api/projects/<project_key>/release` | Session + CSRF | JSON | Release the project email | being collected
| POST | `/api/projects/<project_key>/reset-failed` | Session + CSRF | JSON | Reset the failed status to receive |
| POST | `/api/projects/<project_key>/remove-account` | Session + CSRF | JSON | Remove mailbox | from project
| POST | `/api/projects/<project_key>/restore-account` | Session + CSRF | JSON | Recover the moved project mailbox |

### Refresh, log, mail, settings, temporary mailbox

| method | path | authentication | return type | description |
| --- | --- | --- | --- | --- |
| POST | `/api/accounts/<account_id>/refresh` | Session + CSRF | JSON | Refresh single Outlook account |
| POST | `/api/accounts/refresh-selected` | Session + CSRF | JSON | Refresh selected account |
| POST | `/api/accounts/refresh-selected-stream` | Session + CSRF | JSON | Initialize the selected account streaming refresh task |
| GET | `/api/accounts/refresh-selected-stream/<task_id>` | Session | `text/event-stream` | Subscribe to the selected account streaming refresh task |
| GET | `/api/accounts/refresh-all` | Session | `text/event-stream` | Full refresh account |
| POST | `/api/accounts/<account_id>/retry-refresh` | Session + CSRF | JSON | Retry single failed account |
| GET | `/api/accounts/refresh-failed-stream` | Session | `text/event-stream` | Streaming retry failed account |
| POST | `/api/accounts/refresh-failed` | Session + CSRF | JSON | Batch retry failed account |
| GET | `/api/accounts/trigger-scheduled-refresh` | Session | `text/event-stream` | Manually trigger a scheduled refresh logic |
| POST | `/api/accounts/stop-full-refresh` | Session + CSRF | JSON | Request to stop the current full refresh |
| GET | `/api/accounts/refresh-logs` | Session | JSON | Refresh log list |
| GET | `/api/accounts/<account_id>/refresh-logs` | Session | JSON | Single account refresh log |
| GET | `/api/accounts/refresh-logs/failed` | Session | JSON | Current failed mailbox snapshot |
| GET | `/api/accounts/refresh-stats` | Session | JSON | Refresh statistics |
| GET | `/api/accounts/refresh-status-list` | Session | JSON | Token Refresh management page data |
| GET | `/api/accounts/forwarding-logs` | Session | JSON | Forward log list |
| GET | `/api/accounts/forwarding-logs/failed` | Session | JSON | Recent failed forwarding record |
| GET | `/api/accounts/<account_id>/forwarding-logs` | Session | JSON | Single account forwarding log |
| POST | `/api/accounts/trigger-forwarding-check` | Session + CSRF | JSON | immediately triggers a forwarding check |
| POST | `/api/accounts/<account_id>/forwarding/reset-cursor` | Session + CSRF | JSON | Reset single account forwarding cursor |
| GET | `/api/emails/<email_addr>` | Session | JSON | Get internal mailing list |
| POST | `/api/emails/mark-read` | Session + CSRF | JSON | Mark emails as read in batches |
| POST | `/api/emails/delete` | Session + CSRF | JSON | Delete emails in batches |
| GET | `/api/email/<email_addr>/<message_id>` | Session | JSON | Get email details |
| GET | `/api/email/<email_addr>/<message_id>/attachments/<attachment_id>` | Session | File stream | Download attachment |
| GET | `/api/email/<email_addr>/<message_id>/attachments/download-all` | Session | ZIP file stream | Package download all attachments |
| POST | `/api/emails/retain-bodies` | Session + CSRF | JSON | Complete the text cache for reserved ordinary mailbox list lines |
| GET | `/api/settings/normal-mail-retention/status` | Session | JSON | Get local retention statistics and cleanup status of ordinary mailbox |
| POST | `/api/settings/normal-mail-retention/clear` | Session + CSRF | JSON | Start ordinary mailbox local retention cache cleaning |
| GET | `/api/temp-emails` | Session | JSON | Get temporary mailbox list |
| POST | `/api/temp-emails/import` | Session + CSRF | JSON | Batch import temporary mailbox |
| POST | `/api/temp-emails/batch-delete` | Session + CSRF | JSON | Batch delete temporary mailbox |
| POST | `/api/temp-emails/tags` | Session + CSRF | JSON | Batch change temporary mailbox label |
| GET | `/api/duckmail/domains` | Session | JSON | Get DuckMail domain name |
| GET | `/api/cloudflare/channels` | Session | JSON | Get Cloudflare channel list |
| POST | `/api/cloudflare/channels` | Session + CSRF | JSON | Create Cloudflare channel |
| PUT | `/api/cloudflare/channels/<id>` | Session + CSRF | JSON | Update Cloudflare channel |
| DELETE | `/api/cloudflare/channels/<id>` | Session + CSRF | JSON | Delete Cloudflare channel | that is not referenced by the temporary mailbox
| GET | `/api/cloudflare/domains` | Session | JSON | Get the specified Cloudflare channel domain name |
| POST | `/api/temp-emails/generate` | Session + CSRF | JSON | Generate temporary mailbox |
| POST | `/api/temp-emails/generate-batch` | Session + CSRF | JSON | Batch generate Cloudflare temporary mailbox |
| POST | `/api/cloudflare/ai-usernames/test` | Session + CSRF | JSON | Test AI username generation using draft configuration |
| POST | `/api/cloudflare/ai-usernames/generate` | Session + CSRF | JSON | Generate Cloudflare username list | using saved configuration
| DELETE | `/api/temp-emails/<email_addr>` | Session + CSRF | JSON | Delete temporary mailbox |
| GET | `/api/temp-emails/<email_addr>/messages` | Session | JSON | Get temporary mailbox mailing list |
| GET | `/api/temp-emails/<email_addr>/messages/<message_id>` | Session | JSON | Get temporary email details |
| DELETE | `/api/temp-emails/<email_addr>/messages/<message_id>` | Session + CSRF | JSON | Delete a single temporary email, currently closed |
| DELETE | `/api/temp-emails/<email_addr>/clear` | Session + CSRF | JSON | Clear the temporary mailbox, currently closed |
| POST | `/api/temp-emails/<email_addr>/refresh` | Session + CSRF | JSON | Actively refresh temporary mailbox mail |
| GET | `/api/oauth/auth-url` | Session | JSON | Generate Microsoft OAuth authorization link |
| POST | `/api/oauth/exchange-token` | Session + CSRF | JSON | Use callback URL to Refresh Token |
| POST | `/api/settings/validate-cron` | Session + CSRF | JSON | Verify Cron expression |
| GET | `/api/settings` | Session | JSON | Get system settings |
| PUT | `/api/settings` | Session + CSRF | JSON | Update system settings |
| POST | `/api/settings/test-forward-channel` | Session + CSRF | JSON | Directly test the forwarding channel |
| GET | `/api/skins` | Session | JSON | Get system-level appearance skin list and current skin |
| POST | `/api/skins/<skin_id>/activate` | Session + CSRF | JSON | Enable specified skin |
| POST | `/api/skins/upload` | Session + CSRF | JSON | Upload zip skin package |
| POST | `/api/skins/git/install` | Session + CSRF | JSON | Install skin | from Git repository
| POST | `/api/skins/<skin_id>/git/update` | Session + CSRF | JSON | Update Git source skin |
| DELETE | `/api/skins/<skin_id>` | Session + CSRF | JSON | Delete unenabled custom skin |

## Certification

### External API

External API uses API Key authentication, supporting two methods:

- Header: `X-API-Key: your-api-key`
- Query: `?api_key=your-api-key`

Configurable in web interface `Settings -> External API Key`.

### Complete API

The complete API requires logging into the web interface and carrying Session Cookie.

### Web login and session validity

Call `POST /login` to establish a session using the web login password. `session_duration_days` is an optional field, only `7`, `30`, `90`, `180` or `permanent` is allowed. When omitted, `30` is used by default:

```json
{
  "password": "web-login-password",
  "session_duration_days": "permanent"
}
```

After successful login, the limited-term Session will expire according to the selected number of days from the moment of success; subsequent access will not be renewed. `permanent` does not set an absolute expiration time, but it will still expire after active logout, session version rotation due to login password change, SECRET_KEY change, or browser clearing cookies. Returning `400` when explicitly submitting other values ​​will not create or overwrite the login session. The web login page remembers the last selected expiration date locally in the current browser, but does not save passwords, session cookies, or absolute expiration times.

### Browser extension password login

Browser extensions do not use external API Keys. The extension first calls `POST /api/extension/login` and exchanges the Web login password for a one-time `launch_url` that is valid for 60 seconds; then open the URL in a browser tab, and the server will write a normal Web Session under its own domain name and jump to the Web console.

Request body:

```json
{
  "password": "web-login-password",
  "next": "/#settings"
}
```

Successful response:

```json
{
  "success": true,
  "launch_url": "/extension-login/<token>?next=/%23settings",
  "expires_in": 60
}
```

Description:

- `next` Optional, must be an intra-site path; illegal values will fall back to `/`
- `launch_url` is single-use. Expired or reused links return to the sign-in page.
- The extended login does not provide a period selection. The Web Session established by the consumption ticket is valid for 30 days by default, and is fixed from the time the Session is established.
- After the extension opens the console, subsequent web pages still work according to the Session + CSRF rules of the full management API

### CSRF

All internal write operations should carry the `X-CSRFToken` request header by default, and the value comes from `GET /api/csrf-token`.

Typical request header:

```http
Content-Type: application/json
X-CSRFToken: <csrf-token>
Cookie: session=<session-cookie>
```

### Second verification of account and password

`GET /api/accounts/<account_id>` returns only the `has_password` and `has_imap_password` flags, without plaintext passwords. To reveal a password, call `POST /api/accounts/<account_id>/secrets` and include the current web sign-in password in the JSON body. Set `field` to `password` or `imap_password` to retrieve only that field; omitting `field` returns both fields for compatibility:

```json
{
  "password": "web-login-password",
  "field": "password"
}
```

Return after successful verification:

```json
{
  "success": true,
  "secrets": {
    "password": "account-password"
  }
}
```

When updating the account, if the `password` or `imap_password` field is omitted in the request body, the backend will retain the existing value; the corresponding password will be updated only when this field is explicitly passed in.

### Common response conventions

Most JSON interfaces follow the following conventions:

- `success=true` indicates that the call was overall successful.
- `success=false` means the call failed, usually returning `error` or `message` at the same time
- Some interfaces will return:
  - `partial=true`: Partial success
  - `details`: More detailed reasons for failure
  - `total`, `count`, `items`: List or statistics
- Uncaught exceptions are returned uniformly:
  - HTTP `500`
  - `{"success": false, "error": "<Exception information>"}`
- When mail, IMAP, and Graph related interfaces fail, `error` is sometimes not a string, but a structured object:

```json
{
  "code": "IMAP_CONNECT_FAILED",
  "reason_code": "MAIL_NETWORK_FAILED",
  "message": "Network connection failed: Unable to connect to the mail service, please check DNS, firewall, proxy and service address",
  "type": "IMAPConnectError",
  "status": 502,
  "details": "",
  "trace_id": "...",
  "category": "network",
  "proxy_configured": false,
  "retryable": true
}
```

Among them, `code` maintains the original interface error code, and `reason_code` provides more detailed reasons for proxy, timeout, TLS or network failure. The AI ​​client should first determine `success`, and then be compatible with `error`. It may be a string or an object.

### GET `/api/csrf-token`

Get the CSRF Token available for the current login session. This interface requires you to be logged in, and the return value is bound to the current Session.

Example of successful response:

```json
{
  "csrf_token": "...",
  "csrf_disabled": false
}
```

If CSRF is not currently enabled, it will return:

```json
{
  "csrf_token": null,
  "csrf_disabled": true
}
```

The response header will explicitly disable caching and carry `Vary: Cookie`. The AI client should not reuse this token across sessions.

### GET `/api/version-status`

Get the comparison status of the current running version and the latest version of the warehouse.

#### Query parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `refresh` | bool-like string | No | Forcefully refresh the remote version cache when passing `1`, `true`, `yes` |

#### Example of successful response

```json
{
  "success": true,
  "version_status": {
    "current_version": "v2.0.15",
    "latest_version": "v2.0.16",
    "latest_release_version": "v2.0.16",
    "latest_repository_version": "v2.0.16",
    "status": "update_available",
    "badge_label": "updatable",
    "hint": "New version v2.0.16 found",
    "source": "release",
    "update_url": "https://...",
    "release_url": "https://...",
    "repository_url": "https://...",
    "changelog_url": "https://...",
    "checked_at": "2026-05-01T05:00:00+00:00",
    "errors": []
  }
}
```

`version_status.status` Common values:

- `update_available`
- `up_to_date`
- `ahead`
- `unknown`

## Email alias description

Ordinary accounts now support configuring multiple alias mailboxes.

- Both the external API and the internal mail interface can hit the same account if sent to the main mailbox or alias mailbox.
- The returned results may include:
  - `requested_email`: The email address passed in the request
  - `resolved_email`: The actual hit primary mailbox
  - `matched_alias`: If hit by alias, it is the corresponding alias; otherwise it is empty
- Alias mailbox supports common special characters, such as `+`, `@`, `&`
  - `@` can be passed directly.
  - `+` is recommended to be encoded as `%2B`
  - `&` must be encoded as `%26`

Typical usage:

1. Automatically forward emails from external mailbox B to mailbox A managed by this project
2. Set mailbox B as an alias under mailbox A
3. Subsequently, directly use the API of this project and use email B as the `email` parameter to get the email or verification code.

## External API

### GET `/api/external/accounts`

Obtain the list of mailbox accounts that have been managed in the current system. It is suitable for external systems to synchronize the mailbox pool first, and then call `/api/external/emails` according to the mailbox to get the mail.

#### Query parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `group_id` | int | No | only returns the direct account of the specified group; it will not recursively include the sub-group |
| `limit` | int | No | Number of items on a single page, maximum `10000`; maintain compatibility when not uploading, return all matching accounts |
| `offset` | int | No | paging offset, default `0` |
| `sort_by` | string | No | sorting field, supports `created_at`, `email`, `sort_order` |
| `sort_order` | string | No | Sorting direction, `asc` or `desc`, default `desc` |
| `tag_ids` | string | No | Comma-separated tag IDs, only accounts containing any tag | are returned
| `include_untagged` | bool | No | is used in conjunction with `tag_ids`. Does it include the unlabeled account |?

#### Request example

```bash
curl -H "X-API-Key: your-api-key" \
  "http://localhost:5000/api/external/accounts"

curl -H "X-API-Key: your-api-key" \
  "http://localhost:5000/api/external/accounts?group_id=1"
```

#### Example of successful response

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
      "group_name": "Default group",
      "group_color": "#666666",
      "remark": "main account",
      "status": "active",
      "account_type": "outlook",
      "provider": "outlook",
      "authorization_type": "graph",
      "forward_enabled": true,
      "last_refresh_at": "2026-04-09 14:20:00",
      "last_refresh_status": "success",
      "last_refresh_error": null,
      "created_at": "2026-04-09 14:00:00",
      "updated_at": "2026-04-09 14:20:00",
      "tags": [
        {
          "id": 1,
          "name": "core",
          "color": "#1a1a1a"
        }
      ]
    }
  ]
}
```

#### Return instructions

- This interface only returns ordinary email accounts and does not include temporary email lists.
- Sensitive fields such as password, Refresh Token, and IMAP password have been hidden
- If you need to pull the mailing list of a certain mailbox, call `/api/external/emails`

### GET `/api/external/emails`

Obtain the mail list of the specified mailbox, and support aggregate query of the main mailbox, alias mailbox, and inbox/trash can.

#### Query parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `email` | string | is the main mailbox or alias mailbox of |; if it contains `+`, it will be matched according to the complete address first, and if there is no hit, `+suffix` fallback matching will be removed step by step from right to left according to the local part; if the domain name is `gmail.com` or `googlemail.com`, if the original suffix candidate fails to hit, it will fall back to another suffix |
| `folder` | string | No | `inbox`, `junkemail`, `deleteditems`, `all`. `all` will grab the inbox and spam at the same time and merge them in reverse chronological order |
| `skip` | int | No | paging offset, default `0`; non-digits use the default value, negative numbers are processed as `0`. When `folder=all`, skip `skip` seal | for each folder respectively
| `top` | int | No | returns the quantity, the default is `1`, the maximum is `50`; non-digits use the default value, and negative numbers are processed as `0`. When `folder=all`, it means that each folder takes `top` and |
| `subject_contains` | string | No | Only keep emails containing this keyword in the subject |
| `from_contains` | string | No | Only keep emails containing this keyword in the sender |
| `keyword` | string | No | Further keyword filtering in the theme, preview, and text |

#### Request example

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

#### Example of successful response

```json
{
  "success": true,
  "requested_email": "alias@example.com",
  "resolved_email": "user@outlook.com",
  "resolved_query_email": "alias@example.com",
  "fallback_used": false,
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

#### Aggregation mode description

When `folder=all`:

- The backend will capture `inbox` and `junkemail` at the same time
- `top` is "how many letters are taken from each folder"
- For example, when `top=1`, at most `Inbox 1 + Spam 1 = 2` envelopes will be returned.
- `skip` is the number of messages skipped in each folder.
- `top=0` is a legal safe parsing result and will return an empty list instead of falling back to the default number.
- The results are sorted in reverse order by standardized email time.
- The IMAP scenario will give priority to `INTERNALDATE` returned by the server; it is also compatible with time formats such as `Tue, 14 Apr 2026 08:20:50 +0000 (UTC)`
- Each email will contain `folder`
- If one folder succeeds and the other fails, it will return:
  - `success: true`
  - `partial: true`
  - `details` contains error message for failed folder

#### Gmail / Googlemail suffix fallback

When the query address is `@gmail.com` or `@googlemail.com`, the account resolution will first fall back to the candidate search based on the original address and the original suffix plus-address; after both misses, try again with another suffix. For example, the candidate order for `user+code@gmail.com` is:

1. `user+code@gmail.com`
2. `user@gmail.com`
3. `user+code@googlemail.com`
4. `user@googlemail.com`

If a fallback candidate hit is used, the response will contain fields such as `resolved_query_email`, `fallback_used`, `fallback_email`, etc.

### POST `/api/external/outlook/upload`

Upload the Outlook email account and password and save them to the independent upload temporary table `outlook_upload_accounts`. The default value of the "Authorized or Not" field in the warehousing record is not authorized (`is_authorized = 0`). Supports uploading notes at once or in batches.

> Note: This interface is only responsible for storage and does not trigger the authorization process; the uploaded password will be encrypted and stored, and the interface response will not echo the password.

#### Request body

Single item:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `email` | string | is the email account of |. It will be converted to lowercase and remove leading and trailing spaces before entering the database; duplicates will be skipped |
| `password` | string | is | email password |
| `remark` | string | No | Remarks |

Batch (choose one of the two above):

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `accounts` | array | is an array whose | elements are `{email, password, remark?}`; if it is not empty, it will be processed in batches |

#### Request example

```bash
# Single
curl -X POST -H "X-API-Key: your-api-key" -H "Content-Type: application/json" \
  -d '{"email":"user@outlook.com","password":"pwd123","remark":"optional"}' \
  "http://localhost:5000/api/external/outlook/upload"

# Batch
curl -X POST -H "X-API-Key: your-api-key" -H "Content-Type: application/json" \
  -d '{"accounts":[{"email":"a@outlook.com","password":"p1"},{"email":"b@outlook.com","password":"p2"}]}' \
  "http://localhost:5000/api/external/outlook/upload"
```

#### Example of successful response

```json
{
  "success": true,
  "total": 2,
  "added": 1,
  "duplicate": 1,
  "invalid": 0,
  "results": [
    { "email": "a@outlook.com", "status": "added", "id": 5 },
    { "email": "b@outlook.com", "status": "duplicate" }
  ]
}
```

#### Return instructions

- `total` / `added` / `duplicate` / `invalid`: The total number of this processing and the count of each status
- Values of `results[].status`:
  - `added`: Added successfully, with `id`
  - `duplicate`: `email` already exists and is skipped (the original record will not be overwritten)
  - `invalid`: `email` is missing `@` or `password` is empty and not included in the library
- The upload password is encrypted and stored, and the response is not echoed `password`
- Incoming records `is_authorized` are always `0` (unauthorized)
- HTTP 400 is returned when the request body has neither `email` nor empty `accounts`
- When the API Key is missing/invalid, the authentication layer returns HTTP 401/403

### Outlook upload account management

These interfaces are used for the Web management terminal to maintain the Outlook automated authorization account in `outlook_upload_accounts`.

Security constraints:

- The backend retains the encrypted email password.
- The list response returns `password` plain text in batches, which can be used to switch the display/hide of the management-side table.
- New/modified responses do not return `password` plain text.
- The front end uses `has_password` / `password_length` to determine whether the password has been saved, and uses `password` to perform display switching in the table.

#### GET `/api/outlook-upload-accounts`

Query the upload account by page.

Query parameters:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `page` | integer | No | page number, default `1` |
| `page_size` | integer | No | Number per page, API default is `20`, maximum is `1000`; management side defaults to `20`, providing `10`, `20`, `50`, `100` gears |
| `keyword` | string | No | Fuzzy search by email or note |
| `auth_status` | string | No | Authorization status: `all` (default), `authorized`, `unauthorized`; unknown values are treated as `all` |

When `keyword` and `auth_status` are input at the same time, they are filtered by AND combination. `total` and `total_pages` in the response are calculated based on the results of the combined filtering.

`items[]` in the response contains the decrypted `password` field; `proxy_url` is the account-level agent saved in the temporary record, and does not include the group inheritance agent. The user name, password, path and query parameters in the URL will be removed during list serialization; `tags` comes from the official account of the same email address in `account_tags` / `tags` The tag bound in is an empty array when it has not yet matched the official account:

```json
{
  "success": true,
  "items": [
    {
      "id": 42,
      "email": "user@outlook.com",
      "password": "secret",
      "has_password": true,
      "password_length": 6,
      "is_authorized": false,
      "status": "active",
      "remark": "note",
      "source": "external_api",
      "group_id": 1,
      "proxy_url": "socks5://host:1080",
      "tag_ids": [1],
      "tags": [
        {
          "id": 1,
          "name": "Key point",
          "color": "#0078d4",
          "created_at": "2026-07-06 12:00:00"
        }
      ],
      "created_at": "2026-07-06 12:00:00",
      "updated_at": "2026-07-06 12:00:00"
    }
  ],
  "total": 1,
  "page": 1,
  "page_size": 20,
  "total_pages": 1
}
```

#### POST `/api/outlook-upload-accounts`

Add a single upload account. Request body:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `email` | string | is the email address of |. Convert it to lowercase before entering into the database and remove the leading and trailing spaces |
| `password` | string | is | email password, encrypted storage |
| `remark` | string | No | Remarks |
| `group_id` | int | No | The target group written when the authorization is successful and a new official account is created; default `1` |
| `tag_ids` | int[] / string | No | List of tag IDs attached when creating a new official account |
| `proxy_url` | string | No | Account agent written when creating a new official account (excluding fallback agent) |

Duplicate mailboxes return HTTP 400, and the response will not echo the password. The fields `group_id` / `tag_ids` / `proxy_url` will be saved in the temporary table; they will only be applied when the Graph authorization is successful and ** creates a ** official account. When updating an existing official account, only the authorization fields will still be overwritten.

#### PUT `/api/outlook-upload-accounts/<account_id>`

Modify the upload account. The request body fields are all optional:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `email` | string | No | updates the mailbox when it is not empty; after modification, `is_authorized` is reset to `0` |
| `password` | string | No | Update the password when it is not empty; after modification, `is_authorized` is reset to `0` |
| `remark` | string | No | Update remarks; only change the remarks without changing `is_authorized` |

`password` Omitting or passing an empty string means retaining the original password. Duplicate emails will return HTTP 400, and if the account does not exist, HTTP 404 will be returned.

#### DELETE `/api/outlook-upload-accounts/<account_id>`

Delete upload account. If the account does not exist, HTTP 404 will be returned.

#### POST `/api/outlook-upload-accounts/batch-delete`

Delete upload accounts in batches. Request body:

```json
{ "account_ids": [1, 2, 3] }
```

A successful response contains the `deleted` / `not_found` count.

## Internal API

## Group management

| method | path | parameter | description |
| --- | --- | --- | --- |
| GET | `/api/groups` | None | Get all groups, return `parent_id`, `level`, `account_count`, `descendant_account_count`, `sort_position` |
| GET | `/api/groups/<group_id>` | Path parameter `group_id` | Get single group details |
| POST | `/api/groups` | JSON: `name`, `description?`, `color?`, `proxy_url?`, `sort_position?`, `parent_id?` | Create group |
| PUT | `/api/groups/<group_id>` | JSON: `name`, `description?`, `color?`, `proxy_url?`, `sort_position?`, `parent_id?` | Update grouping or move parent |
| DELETE | `/api/groups/<group_id>` | Path parameters `group_id` | Delete the group; if there are subgroups, cascade delete the subgroups and move the account back to the default group |
| PUT | `/api/groups/reorder` | JSON: `group_ids: number[]`, `parent_id?` | Reorder ordinary groupings under the same parent |

Example of create or update group request:

```json
{
  "name": "Agent Group",
  "description": "Go to Hong Kong agent",
  "color": "#1a1a1a",
  "proxy_url": "http://127.0.0.1:7890",
  "sort_position": 2,
  "parent_id": null
}
```

Grouping supports up to three tree levels:

- `parent_id=null` represents the first-level grouping; specifying the first-level grouping as the parent will create a second-level grouping, and specifying the second-level grouping as the parent will create a third-level grouping.
- Subgroups cannot be created under third-level groups; temporary mailbox groups cannot be used as parent groups, nor can they be moved to other groups.
- `sort_position` applies only within the same `parent_id`; `PUT /api/groups/reorder` also reorders only `group_ids` with the same parent.
- `account_count` is the number of direct accounts of the current group, and `descendant_account_count` is the number of accounts of the current group and all descendant groups.
- Deleting the parent group will delete all descendant groups and move the ordinary email accounts in the deleted group to the default group.

## Export and secondary verification

The export interface will first verify the login password once, and then initiate the export after obtaining `verify_token`. `verify_token` is currently a one-time token, valid within 5 minutes by default. When exporting by group, the group and all sub-group accounts will be included; when parent-child groups are passed in at the same time, the accounts will only be exported once.

| method | path | parameter | return |
| --- | --- | --- | --- |
| POST | `/api/export/verify` | JSON: `password` | JSON, return `verify_token` |
| GET | `/api/groups/<group_id>/export` | Query: `verify_token` | `text/plain` File Download |
| GET | `/api/accounts/export` | Query: `verify_token` | `text/plain` File Download |
| POST | `/api/accounts/export-selected` | JSON: `group_ids: number[]` or `account_ids: number[]`, `verify_token` | `text/plain` File download |

Example of two-step verification request:

```json
{
  "password": "your-login-password"
}
```

Example of successful response to second-step verification:

```json
{
  "success": true,
  "verify_token": "..."
}
```

## Account management

### GET `/api/accounts`

Get the account list.

#### Query parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `group_id` | int | No | Returns the account | under the specified group and all subgroups
| `tag_ids` | string | No | Comma-separated tag IDs, only accounts containing any tag | are returned
| `exclude_tag_ids` | string | No | Tag ID to be excluded; supports `exclude_tag_ids=1,2` or repeated delivery of `exclude_tag_ids=1&exclude_tag_ids=2`, the returned account must not have any of the tags |
| `include_untagged` | bool | No | is used in conjunction with `tag_ids`. Does it include the unlabeled account |?

When `tag_ids` and `exclude_tag_ids` are input at the same time, the account must have at least one tag in `tag_ids` and not own any tag in `exclude_tag_ids`. `include_untagged` will first take the union with the containing label condition, and then execute the exclusion condition.

#### Response key fields

| Field | Description |
| --- | --- |
| `accounts` | Current page account list |
| `total` | Total number of accounts under the current query conditions |
| `limit` | Actual number of single pages used |
| `offset` | Current page offset |
| `has_more` | Is there a next page |
| `aliases` | Account alias list |
| `alias_count` | Number of aliases |
| `authorization_type` | Outlook OAuth preferred/most recently successful channel: `graph`, `imap` or empty string (not set, default Graph takes precedence) |
| `forward_enabled` | Whether to enable forwarding |
| `last_refresh_at` | Last refresh time |
| `last_refresh_status` | Recent refresh results |
| `last_refresh_error` | Recent refresh error |
| `tags` | tag list |

### GET `/api/accounts/search`

Search account.

#### Query parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `q` | string | is the search keyword of |, which supports the main mailbox, notes, labels, and alias mailboxes; when entering multiple keywords, they can be separated by spaces or newlines. If any keyword is hit, it will be returned. Up to `200` keywords |
| `limit` | int | No | Number of items on a single page, maximum `10000` |
| `offset` | int | No | paging offset, default `0` |
| `sort_by` | string | No | sorting field, supports `created_at`, `email`, `sort_order` |
| `sort_order` | string | No | Sorting direction, `asc` or `desc`, default `desc` |
| `group_id` | int | No | Only searches the accounts in the specified group and all subgroups. If not, all groups are searched. |
| `tag_ids` | string | No | Comma-separated tag IDs, only search accounts containing any tag |
| `exclude_tag_ids` | string | No | Tag ID to be excluded; supports `exclude_tag_ids=1,2` or repeated delivery of `exclude_tag_ids=1&exclude_tag_ids=2`, the returned account must not have any of the tags |
| `include_untagged` | bool | No | is used in conjunction with `tag_ids`. Does it include the unlabeled account |?

When `tag_ids` and `exclude_tag_ids` are input at the same time, the account must have at least one tag in `tag_ids` and not own any tag in `exclude_tag_ids`. `include_untagged` will first take the union with the containing label condition, and then execute the exclusion condition.

### POST `/api/accounts`

Import accounts in batches.

#### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `account_string` | string | is | multi-line account text |
| `group_id` | int | No | target group, default `1` |
| `account_format` | string | No | Outlook import format: `client_id_refresh_token` or `refresh_token_client_id` |
| `provider` | string | No | `outlook`, `auto`, `qq`, `163`, `126`, `yahoo`, `aliyun`, `custom` |
| `imap_host` | string | No | `provider=custom` IMAP server |
| `imap_port` | int | no | `provider=custom` IMAP port |
| `forward_enabled` | bool | No | Whether to enable forwarding | by default after importing
| `remark` | string | No | The newly added account will have unified remarks and will not change the format of each line `account_string` |
| `status` | string | No | The unified status of this new account: `active` or `inactive` |
| `tag_ids` | array | No | Tag ID list | that is bound to the newly added account
| `proxy_url` | string | No | The account-level main agent used by this new account; leave it blank to inherit the group agent |
| `fallback_proxy_url_1` | string | No | The account-level fallback agent used uniformly for this new account 1 |
| `fallback_proxy_url_2` | string | No | The account-level fallback agent used uniformly for this new account 2 |

#### Response key fields

| Field | Description |
| --- | --- |
| `added_count` | Number of new accounts this time |
| `skipped_count` | Number of accounts skipped due to duplication etc. |
| `invalid_count` | Number of input lines with invalid format |
| `tagged_count` | The number of new accounts successfully bound to the tag this time |

#### Import format

- Outlook: `Email----Password----ClientID----RefreshToken` per line
- Outlook reverse order: `Email----Password----RefreshToken----ClientID` for each line, and set `account_format=refresh_token_client_id`
- Non-Outlook IMAP: `Email----IMAP password` per line
- Custom IMAP: `Email----IMAP password----IMAP host----IMAP port` per line

#### Request example

```json
{
  "account_string": "user@outlook.com----password----client-id----refresh-token",
  "group_id": 1,
  "account_format": "client_id_refresh_token",
  "provider": "outlook",
  "forward_enabled": false,
  "remark": "Batch A",
  "status": "active",
  "tag_ids": [1, 2],
  "proxy_url": "socks5://127.0.0.1:1080",
  "fallback_proxy_url_1": "direct",
  "fallback_proxy_url_2": ""
}
```

### GET `/api/accounts/<account_id>`

Get individual account details.

Account details will not return `password` or `imap_password` plain text, only `has_password` and `has_imap_password` tokens. When you need to view the saved account password, you must call `POST /api/accounts/<account_id>/secrets` and pass in the current web login password to complete the second verification.

#### Response supplementary fields

```json
{
  "success": true,
  "account": {
    "id": 1,
    "email": "user@outlook.com",
    "has_password": true,
    "has_imap_password": false,
    "client_id": "xxx",
    "authorization_type": "graph",
    "refresh_token": "xxx",
    "aliases": ["alias@example.com", "login@example.com"],
    "alias_count": 2,
    "matched_alias": "",
    "forward_enabled": true,
    "proxy_url": "socks5://127.0.0.1:1080",
    "fallback_proxy_url_1": "direct",
    "fallback_proxy_url_2": "",
    "proxy_override_enabled": true
  }
}
```

#### View password

```http
POST /api/accounts/1/secrets
Content-Type: application/json
```

```json
{
  "password": "web-login-password",
  "field": "password"
}
```

`field` accepts `password` or `imap_password`. Omitting it returns both password fields for compatibility. After successful verification:

```json
{
  "success": true,
  "secrets": {
    "password": "account-password"
  }
}
```

### PUT `/api/accounts/<account_id>`

Update account information.

- If the request body is only `status`, only the account status will be updated.
- Support Outlook account and IMAP account
- Now supports saving aliases directly when updating accounts
- `proxy_url`, `fallback_proxy_url_1`, `fallback_proxy_url_2` retain the existing proxy configuration of the account if not passed; explicitly passing an empty string can clear the account override
- `authorization_type` retains the existing channel when not passed; explicitly passing an empty string can clear it to the preferred Graph. Legal values ​​are `graph`, `imap`, or an empty string; illegal values ​​return an error. Ordinary IMAP accounts are always saved as empty

#### Common fields in request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `email` | string | is | email address |
| `password` | string | No | Account password, Outlook can be empty |
| `client_id` | string | Outlook required | Outlook Client ID |
| `refresh_token` | string | Outlook required | Outlook Refresh Token |
| `account_type` | string | No | `outlook` or `imap` |
| `authorization_type` | string | No | Outlook OAuth preferred channel: `graph`, `imap` or empty string; if not passed, the existing value | is retained
| `provider` | string | No | `outlook`, `auto`, `qq`, `163`, `126`, `yahoo`, `aliyun`, `custom` |
| `imap_host` | string | Custom IMAP required | Custom IMAP server |
| `imap_port` | int | No | IMAP port |
| `imap_password` | string | IMAP required | IMAP password |
| `group_id` | int | No | Group ID |
| `remark` | string | No | Remarks |
| `status` | string | No | `active` and other status values |
| `forward_enabled` | bool | No | Whether to enable forwarding |
| `proxy_url` | string | No | Account level main agent; when left blank and the fallback agent is also empty, the group agent | is inherited
| `fallback_proxy_url_1` | string | No | Account level fallback agent 1, supports `direct` / `Direct connection` |
| `fallback_proxy_url_2` | string | No | Account level fallback agent 2, supports `direct` / `Direct connection` |
| `aliases` | array<string> | No | Account alias list; if passed in, | will be replaced as a whole with the new list

#### Request example

```json
{
  "email": "user@outlook.com",
  "client_id": "xxx",
  "refresh_token": "xxx",
  "authorization_type": "graph",
  "group_id": 1,
  "remark": "main account",
  "status": "active",
  "forward_enabled": true,
  "proxy_url": "socks5://127.0.0.1:1080",
  "fallback_proxy_url_1": "direct",
  "fallback_proxy_url_2": "",
  "aliases": [
    "alias@example.com",
    "login@example.com"
  ]
}
```

### POST `/api/accounts/<account_id>/reauthorize`

Reauthorize an existing Outlook OAuth account. This interface only supports Outlook accounts and does not support IMAP accounts.

Request body:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `redirected_url` | string | is the complete callback URL | in the browser address bar after | Microsoft authorization is completed.

The interface will parse the authorization code from `redirected_url`, exchange it for a new Refresh Token from Microsoft, and then only update the `client_id`, encrypted `refresh_token`, `refresh_token_updated_at` and refresh status fields of the target account. Fields such as email, password, group, status, forwarding, proxy, remarks, alias, label, etc. will not be modified by this interface.

After the authorization information is successfully saved, the interface will clear old refresh failure errors and immediately trigger a single-account Token refresh verification. `success` in the response indicates that the authorization information has been saved; `validation.success` indicates whether the automatic refresh verification is passed.

Request example:

```json
{
  "redirected_url": "http://localhost:8080/?code=..."
}
```

Refresh verification successful response example:

```json
{
  "success": true,
  "message": "Reauthorization successful, Token refresh verification passed",
  "authorization_updated": true,
  "validation": {
    "success": true,
    "status": "success",
    "message": "Token refreshed successfully",
    "authorization_type": "graph"
  }
}
```

Refresh verification failure response example:

```json
{
  "success": true,
  "message": "Reauthorization saved, but automatic refresh verification failed",
  "authorization_updated": true,
  "validation": {
    "success": false,
    "status": "failed",
    "error": {
      "code": "TOKEN_REFRESH_FAILED",
      "message": "Token refresh failed",
      "type": "RefreshTokenError",
      "status": 400
    },
    "error_message": "Graph refresh failed: ..."
  }
}
```

Common mistakes:

- `ACCOUNT_NOT_FOUND`: Account does not exist
- `ACCOUNT_REAUTH_UNSUPPORTED`: IMAP account does not support re-authorization
- `OAUTH_EXCHANGE_FAILED`: The callback URL is invalid or Microsoft failed to exchange Token.
- `ACCOUNT_REAUTH_SAVE_FAILED`: Failed to save new authorization information

### POST `/api/accounts/<account_id>/outlook-auto-auth`

Add the existing official Outlook account to the Outlook automated authorization queue. This interface reads the email address and password of the official account from the server, writes it into the `outlook_upload_accounts` temporary table, and does not return the plain text password. Only Outlook accounts are supported, IMAP accounts are not supported.

This interface will not start the Graph automated authorization task immediately; the user still needs to perform authorization in the Outlook automated authorization pop-up window. A temporary record that already exists for the same mailbox will overwrite the password and reset it to an unauthorized state.

Request body: no parameters required.

Example of successful response:

```json
{
  "success": true,
  "message": "Automatic authorization has been added",
  "upload_account_id": 42,
  "email": "user@outlook.com",
  "status": "added"
}
```

Values of `status`:

- `added`: Added temporary record
- `updated`: Overwriting existing temporary records (re-queuing)

Common mistakes:

- `ACCOUNT_NOT_FOUND` (404): Account does not exist
- `ACCOUNT_AUTO_AUTH_UNSUPPORTED` (400): IMAP accounts do not support joining Outlook automated authorization
- `ACCOUNT_PASSWORD_MISSING` (400): The account password is empty or cannot be decrypted
- `ACCOUNT_AUTO_AUTH_INVALID` (400): Invalid email or password

> ** Security constraint **: This interface does not return the password in the response. The password is only read from the encrypted data saved on the server and written to the staging table encrypted.

When adding automatic authorization, `group_id`, tags and `proxy_url` of the official account will be copied simultaneously to the temporary table for easy use when creating a new official account later.

### POST `/api/accounts/batch-outlook-auto-auth`

Add official Outlook accounts to the automated authorization queue in batches. Request body:

```json
{ "account_ids": [1, 2, 3] }
```

Reuse single account join logic one by one: skip IMAP / passwordless account and count `failed`. Response example:

```json
{
  "success": true,
  "message": "3 accounts processed: 2 added, 0 re-enlisted, 1 failed",
  "total": 3,
  "added": 2,
  "updated": 0,
  "failed": 1,
  "results": []
}
```

### POST `/api/accounts/batch-update-group`

Modify account groups in batches.

#### Request example

```json
{
  "account_ids": [1, 2, 3],
  "group_id": 5
}
```

### POST `/api/accounts/batch-update-forwarding`

Enable or disable account forwarding in batches.

#### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `account_ids` | array<int> | is | account ID list |
| `forward_enabled` | bool | is | `true` means forwarding is turned on, `false` means forwarding is turned off |

#### Request example

```json
{
  "account_ids": [1, 2, 3],
  "forward_enabled": true
}
```

#### Response key fields

| Field | Description |
| --- | --- |
| `updated_count` | Number of accounts whose actual status has changed |
| `updated_accounts` | Updated account list |
| `unchanged_count` | Number of accounts that were originally in the target state |
| `missing_ids` | Missed account ID |

### POST `/api/accounts/batch-update-proxy`

Set or clear account-level proxies in batches. When all three items of the account-level agent are empty, the account will continue to inherit the group agent it belongs to; when any item is non-empty, the account-level configuration takes precedence over the group configuration.

The proxy URL can contain the literal `{mail}`: expand according to the local-part of the account email address (only alphanumeric and lowercase letters are retained) when outbound; the storage and API echo maintain the original template string. It is recommended to connect with sticky agents such as Resin in the form of `socks5h://outlook.{mail}:TOKEN@host:2260`.

#### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `account_ids` | array<int> | is | account ID list |
| `proxy_url` | string | No | account level master agent, supports `direct` / `Direct connection` and `{mail}` template |
| `fallback_proxy_url_1` | string | No | Fallback agent 1 |
| `fallback_proxy_url_2` | string | No | Fallback agent 2 |

#### Request example

```json
{
  "account_ids": [1, 2, 3],
  "proxy_url": "socks5://127.0.0.1:1080",
  "fallback_proxy_url_1": "direct",
  "fallback_proxy_url_2": ""
}
```

#### Response key fields

| Field | Description |
| --- | --- |
| `updated_count` | Number of accounts with actual proxy configuration changes |
| `updated_accounts` | Updated account list |
| `unchanged_count` | Number of accounts originally configured in the target proxy |
| `missing_ids` | Missed account ID |

### GET `/api/accounts/<account_id>/aliases`

Get the alias list of an account.

### PUT `/api/accounts/<account_id>/aliases`

Replace the entire alias list of an account.

#### Request example

```json
{
  "aliases": [
    "alias@example.com",
    "login@example.com"
  ]
}
```

### DELETE `/api/accounts/<account_id>`

Delete account by account ID.

### DELETE `/api/accounts/email/<email_addr>`

Delete account by email address.

### POST `/api/accounts/batch-delete`

Delete accounts in batches.

#### Request body

```json
{
  "account_ids": [1, 2, 3]
}
```

#### Response key fields

| Field | Description |
| --- | --- |
| `deleted_count` | Actual deleted quantity |
| `deleted_accounts` | Deleted account list |
| `missing_ids` | Account ID | that exists in the request but is not hit

## Tag management

| method | path | parameter | description |
| --- | --- | --- | --- |
| GET | `/api/tags` | None | Get all tags |
| POST | `/api/tags` | JSON: `name`, `color?` | Create tag |
| DELETE | `/api/tags/<tag_id>` | Path parameter `tag_id` | Delete label |
| POST | `/api/accounts/tags` | JSON: `account_ids`, `tag_id`, `action` | Add or remove tags from accounts in batches |
| POST | `/api/temp-emails/tags` | JSON: `temp_email_ids`, `tag_id`, `action` | Add or remove labels from temporary mailboxes in batches |

Example of batch tag management request:

```json
{
  "account_ids": [1, 2, 3],
  "tag_id": 8,
  "action": "add"
}
```

Temporary mailbox batch label request example:

```json
{
  "temp_email_ids": [11, 12],
  "tag_id": 8,
  "action": "remove"
}
```

## Project management

The project interface is used to manage the "independent status of the mailbox under a certain project" by `project_key`.

- The same mailbox can exist in multiple projects at the same time
- The status within the project is maintained independently and does not affect each other.
- Current project status includes:
  - `toClaim`：can be collected
  - `claiming`: Receiving
  - `done`: Successfully consumed, no longer automatically allocated
  - `failed`: The latest consumption failed and needs to be manually reset before it can be allocated again.
  - `removed`: Manually move out of the project scope
  - `deleted`: The account in the system main table has been deleted, but the project history is still retained.

### GET `/api/projects`

Get the project list.

#### Example of successful response

```json
{
  "success": true,
  "data": {
    "projects": [
      {
        "id": 1,
        "name": "GPT registration",
        "project_key": "gpt",
        "description": "GPT registration project",
        "scope_mode": "groups",
        "use_alias_email": false,
        "status": "active",
        "group_ids": [1, 2],
        "total_count": 500,
        "to_claim_count": 120,
        "claiming_count": 5,
        "failed_count": 8,
        "done_count": 360,
        "removed_count": 15,
        "deleted_count": 3,
        "last_scope_synced_at": "2026-04-15T09:30:00+00:00",
        "created_at": "2026-04-10 08:00:00",
        "updated_at": "2026-04-15T09:30:00+00:00"
      }
    ]
  }
}
```

### GET `/api/projects/<project_key>`

Get individual project details.

### POST `/api/projects/start`

Start the project.

This interface combines the two semantics of "create project" and "complete project scope":

- If `project_key` does not exist:
  - Create new project
  - Save project scope
  - Add the email addresses within the range to the project
- If `project_key` already exists:
  - Treated as starting the same project again
  - The original range is used by default
  - If `group_ids` is passed explicitly this time, the range will be updated and then completed.
  - Only the new email address will be added and the status of existing projects will not be reset.

Delete compensation rules:

- When starting the project, the lost accounts in the project history will be checked.
- If the account corresponding to the project record has been deleted from the `accounts` main table, the project record will be marked as `deleted`
- If the same email address is later re-imported into the system, the old project record will be reused by email address when starting the project, rather than treating it as a brand new email address

Alias mailbox rules:

- When `use_alias_email=false`, the project is entered into the pool according to the primary email address
- When `use_alias_email=true`, priority is given to entering the pool according to the account alias and email address.
- If an account is not configured with an alias, it will still fall back to using the primary email address when `use_alias_email=true`
- When restarting an existing project, if `use_alias_email` is not passed explicitly, the current project configuration will be used.

#### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `project_key` | string | is the | project identifier, which will be converted internally to lowercase and remove the leading and trailing spaces |
| `name` | string | No | Project name. If not passed when first created, `project_key` | will be used by default.
| `description` | string | No | Item description |
| `group_ids` | array<int> | No | Project range grouping list; will include each group and all subgroup accounts; when not uploaded for the first time, the default is the full mailbox range |
| `use_alias_email` | bool | No | Whether to add the alias mailbox to the project first; default `false` |

#### Request example

Create a group scope project for the first time:

```json
{
  "project_key": "gpt",
  "name": "GPT registration",
  "description": "GPT registration project",
  "group_ids": [1, 2],
  "use_alias_email": true
}
```

Create full scope project for the first time:

```json
{
  "project_key": "google",
  "name": "Google Registration"
}
```

Start the existing project again:

```json
{
  "project_key": "gpt"
}
```

#### Example of successful response

```json
{
  "success": true,
  "message": "Project has been started",
  "data": {
    "id": 1,
    "name": "GPT registration",
    "project_key": "gpt",
    "description": "GPT registration project",
    "scope_mode": "groups",
    "use_alias_email": true,
    "status": "active",
    "group_ids": [1, 2],
    "total_count": 560,
    "to_claim_count": 120,
    "claiming_count": 5,
    "failed_count": 8,
    "done_count": 360,
    "removed_count": 15,
    "deleted_count": 3,
    "created": false,
    "added_count": 128
  }
}
```

#### Return to key fields

| Field | Description |
| --- | --- |
| `created` | Is this the first time to create this project? |
| `added_count` | The number of newly added mailboxes in this launch |
| `deleted_count` | The number of project mailboxes marked as `deleted` during this startup process |
| `use_alias_email` | Whether the current project is put into the pool according to the alias mailbox |

### GET `/api/projects/<project_key>/accounts`

Get the email list under a certain project.

#### Query parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `status` | string | No | Filter by project status, such as `toClaim`, `failed`, `done` |
| `group_id` | int | No | Filter by current group or project source group; this group and all sub-groups | will be included
| `provider` | string | No | Filter by email provider |
| `keyword` | string | No | Do fuzzy search in email address and notes |

#### Example of successful response

```json
{
  "success": true,
  "data": {
      "project": {
        "id": 1,
        "name": "GPT registration",
        "project_key": "gpt",
        "description": "GPT registration project",
        "scope_mode": "groups",
        "use_alias_email": true,
        "status": "active",
        "group_ids": [1, 2],
      "total_count": 560,
      "to_claim_count": 120,
      "claiming_count": 5,
      "failed_count": 8,
      "done_count": 360,
      "removed_count": 15,
      "deleted_count": 3
    },
    "accounts": [
      {
        "project_account_id": 101,
        "account_id": 12,
        "email": "alias@example.com",
        "primary_email": "user@example.com",
        "normalized_email": "alias@example.com",
        "provider": "outlook",
        "account_type": "outlook",
        "group_id": 1,
        "group_name": "Default group",
        "remark": "",
        "project_status": "failed",
        "account_status": "active",
        "caller_id": "",
        "task_id": "",
        "claim_token": "",
        "claimed_at": "",
        "lease_expires_at": "",
        "last_result": "failed",
        "last_result_detail": "provider blocked",
        "claim_count": 2,
        "first_claimed_at": "2026-04-15T09:30:00+00:00",
        "last_claimed_at": "2026-04-15T09:35:00+00:00",
        "done_at": "",
        "created_at": "2026-04-15T09:20:00+00:00",
        "updated_at": "2026-04-15T09:36:00+00:00"
      }
    ]
  }
}
```

### POST `/api/projects/<project_key>/claim-random`

Randomly receive an available email address from the project.

The current implementation will select one of the mailboxes of `status='toClaim'` in the project and ensure that the mailbox is not occupied by `claiming` records in other projects.

#### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `caller_id` | string | is | caller identifier |
| `task_id` | string | is | current task identification |
| `lease_seconds` | int | No | Lease seconds, default `600`, maximum `3600` |

#### Request example

```json
{
  "caller_id": "worker-1",
  "task_id": "task-001",
  "lease_seconds": 600
}
```

#### Example of successful response

```json
{
  "success": true,
  "data": {
    "project_key": "gpt",
    "project_account_id": 101,
    "account_id": 12,
    "email": "alias@example.com",
    "primary_email": "user@example.com",
    "group_id": 1,
    "provider": "outlook",
    "account_type": "outlook",
    "remark": "",
    "claim_token": "pclm_xxx",
    "claimed_at": "2026-04-15T10:00:00+00:00",
    "lease_expires_at": "2026-04-15T10:10:00+00:00"
  }
}
```

When there is no mailbox to receive, the current implementation returns:

```json
{
  "success": false,
  "error": "There is no project email address available for collection"
}
```

### POST `/api/projects/<project_key>/complete-success`

Mark the project mailbox currently being collected as successful.

#### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `account_id` | int | is | account ID |
| `claim_token` | string | is the token | returned when receiving |
| `caller_id` | string | No | Caller ID |
| `task_id` | string | No | Task ID |
| `detail` | string | No | Success description |

### POST `/api/projects/<project_key>/complete-failed`

Mark the project mailbox currently being collected as failed.

- The status will change from `claiming` to `failed`
- `failed` will not automatically participate in distribution again
- You need to manually call `/reset-failed` before you can receive it again

#### Request example

```json
{
  "account_id": 12,
  "claim_token": "pclm_xxx",
  "caller_id": "worker-1",
  "task_id": "task-001",
  "detail": "provider blocked"
}
```

### POST `/api/projects/<project_key>/release`

Actively release the project mailbox being collected.

- The status will return from `claiming` to `toClaim`
- Suitable for scenarios such as task interruption and voluntary abandonment.

### POST `/api/projects/<project_key>/reset-failed`

Manually reset the `failed` mailbox back to `toClaim`.

#### Request example

```json
{
  "account_id": 12,
  "detail": "Manually allow retry"
}
```

### POST `/api/projects/<project_key>/remove-account`

Manually move the project mailbox out of the project scope.

- The target state becomes `removed`
- If the current status is `claiming`, removal will be refused

#### Request example

```json
{
  "account_id": 12,
  "detail": "Manually remove items"
}
```

### POST `/api/projects/<project_key>/restore-account`

Manually restore the `removed` project mailbox back to `toClaim`.

#### Request example

```json
{
  "account_id": 12,
  "detail": "Manual restore to project"
}
```

## Refresh and forwarding operation and maintenance

### Token refresh

| method | path | parameter | description |
| --- | --- | --- | --- |
| POST | `/api/accounts/<account_id>/refresh` | Path parameter `account_id` | Refresh a single Outlook account Token |
| POST | `/api/accounts/refresh-selected` | JSON: `account_ids: number[]` | Refresh the selected Outlook account, automatically skip IMAP or non-existent account |
| POST | `/api/accounts/refresh-selected-stream` | JSON: `account_ids: number[]` | Initialize the selected account streaming refresh task and return `task_id` and `stream_url` |
| GET | `/api/accounts/refresh-selected-stream/<task_id>` | Path parameter `task_id` | Subscribe to the selected account streaming refresh task and return `text/event-stream` |
| GET | `/api/accounts/refresh-all` | None | Refresh all Outlook accounts and return `text/event-stream` |
| POST | `/api/accounts/<account_id>/retry-refresh` | Path parameters `account_id` | Retry single failed account refresh |
| GET | `/api/accounts/refresh-failed-stream` | None | Streaming retry the current failed account and return `text/event-stream` |
| POST | `/api/accounts/refresh-failed` | None | Retry the account that failed the latest refresh |
| GET | `/api/accounts/trigger-scheduled-refresh` | Query: `force=true/false` | Manually trigger the "scheduled refresh" logic once and return `text/event-stream` |
| POST | `/api/accounts/stop-full-refresh` | None | Requests to stop the current full refresh task |

`/api/accounts/refresh-all`, `/api/accounts/refresh-failed-stream`, `/api/accounts/refresh-selected-stream/<task_id>`, and `/api/accounts/trigger-scheduled-refresh` will all return SSE event streams. Common event types include:

- `start`
- `progress`
- `delay`
- `complete`

To select account streaming refresh, you need to initialize the task first:

```json
{
  "account_ids": [1, 2, 3]
}
```

`POST /api/accounts/refresh-selected-stream` Returns on success:

```json
{
  "success": true,
  "task_id": "task-token",
  "stream_url": "/api/accounts/refresh-selected-stream/task-token"
}
```

Then use `EventSource` to subscribe to `stream_url`. This task uses in-process short-term state preservation, and service deployment needs to maintain a single worker; if the task does not exist or has expired, SSE will return the `type=error` event.

`POST /api/accounts/stop-full-refresh` Returns on success:

```json
{
  "success": true,
  "message": "Requested to stop the current full refresh task"
}
```

If there is no full refresh task currently in progress, HTTP `409` will be returned:

```json
{
  "success": false,
  "message": "There is currently no full refresh task in progress"
}
```

`POST /api/accounts/refresh-selected` request example:

```json
{
  "account_ids": [1, 2, 3]
}
```

This interface will return:

- `requested_count`
- `processed_count`
- `success_count`
- `failed_count`
- `skipped_count`
- `failed_list`
- `skipped_list`

### Refresh logs and statistics

| method | path | parameter | description |
| --- | --- | --- | --- |
| GET | `/api/accounts/refresh-logs` | Query: `limit`, `offset` | Get all refresh logs |
| GET | `/api/accounts/<account_id>/refresh-logs` | Query: `limit`, `offset` | Get single account refresh log |
| GET | `/api/accounts/refresh-logs/failed` | None | Get the current failure status mailbox snapshot |
| GET | `/api/accounts/refresh-stats` | None | Get the current refresh statistics snapshot |
| GET | `/api/accounts/refresh-status-list` | Query: `q`, `status`, `page`, `page_size` | Get Token Refresh the management mailbox list |

`GET /api/accounts/refresh-logs/failed` returns the "mailbox snapshot that is still in a failed state" and is no longer a historical failure log list.

`GET /api/accounts/refresh-status-list` query parameters:

- `q`
- `status=all|success|failed|never`
- `page`: minimum is `1`
- `page_size`: The minimum is `1`, the maximum is `10000`

### Forwarding logs and triggering

| method | path | parameter | description |
| --- | --- | --- | --- |
| GET | `/api/accounts/forwarding-logs` | Query: `limit`, `offset` | Get the latest forwarding record |
| GET | `/api/accounts/forwarding-logs/failed` | Query: `limit` | Get the latest failed forwarding record |
| GET | `/api/accounts/<account_id>/forwarding-logs` | Query: `limit`, `offset`, `failed_only` | Get single account forwarding record |
| POST | `/api/accounts/trigger-forwarding-check` | None | Triggers a forwarding check immediately |
| POST | `/api/accounts/<account_id>/forwarding/reset-cursor` | JSON: `mode?`, `lookback_minutes?`, `trigger_check?` | Roll back or clear the forwarding cursor of a single account, and optionally trigger a rescan immediately |

`POST /api/accounts/<account_id>/forwarding/reset-cursor` request example:

```json
{
  "mode": "window",
  "lookback_minutes": 30,
  "trigger_check": true
}
```

Field description:

- `mode=window`: Press lookback window to reset cursor
- `mode=clear`: Clear cursor
- `lookback_minutes`: The number of minutes to review, if not transmitted, it will be processed according to the system window logic.
- `trigger_check`: Whether to trigger a forwarding check immediately after reset, default `true`

## Mail interface

### GET `/api/emails/<email_addr>`

Internal mailing list interface. Supports main mailbox or alias mailbox; if the mailbox contains `+`, it will be matched according to the complete address first. If there is no hit, `+suffix` will be removed step by step from right to left according to the local part. The fallback matching is compatible with the main mailbox and alias mailbox. If the domain name is `gmail.com` or `googlemail.com`, it will continue to fall back to another suffix after none of the original suffix candidates are matched.

#### Query parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `folder` | string | No | `inbox`, `junkemail`, `deleteditems`, `all` |
| `skip` | int | No | paging offset, default `0`; non-digits use the default value, negative numbers are processed as `0` |
| `top` | int | No | returns the quantity, the default is `20`; non-digits use the default value, and negative numbers are processed as `0`. The maximum remote read is `50`, and the local reserved read is not truncated to |.
| `source` | string | No | When passing `local`, only the local reservation list of the ordinary mailbox is read; `normal_mail_local_retention_enabled=true` | is required
| `local_only` | bool | no | `1` / `true` / `yes` / `on` is equivalent to `source=local` |
| `subject_contains` | string | No | Only keep emails containing this keyword in the subject, and keep `+` characters when reading |
| `from_contains` | string | No | Only keep emails containing this keyword in the sender, and keep `+` characters when reading |
| `keyword` | string | No | Perform further keyword filtering in the theme, preview, and text, and retain the `+` character | when reading

When `folder=all`, the behavior is consistent with the external API: grab `inbox` and `junkemail` at the same time, merge and sort by time.

A successful response will additionally contain `requested_email` and `resolved_email`; when the request mailbox hits an alias, it will also contain `matched_alias`. If you use Gmail/Googlemail or plus-address fallback candidate hits, fields `resolved_query_email`, `fallback_used`, `fallback_email`, etc. are also included.

#### List item field

Each object in the `emails` array contains at least the following fields:

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Email ID |
| `subject` | string | Email subject |
| `from` | string | Sender address |
| `to` | string | recipient address, multiple addresses are spliced with `, ` |
| `date` | string | Receiving time |
| `is_read` | bool | Has | been read?
| `has_attachments` | bool | Is there any attachment |
| `body_preview` | string | Email preview |
| `folder` | string | belongs to the folder |
| `id_mode` | string | Message ID mode: Graph is `graph`, OAuth IMAP is commonly `uid` or `sequence`, used for details, marking as read, and attachment downloading to reuse the same ID semantics |

### GET `/api/email/<email_addr>/<message_id>`

Get the details of a single email. The `email` parameter also supports passing the primary mailbox or alias mailbox.

#### Query parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `folder` | string | No | The folder where the current email is located, default `inbox` |
| `method` | string | No | The method of obtaining details first. If the account has recorded `authorization_type`, press the channel to give priority and automatically fall back; if it is not recorded, `graph` will take priority, and `imap` will only use OAuth IMAP |.
| `id_mode` | string | No | OAuth IMAP message ID mode, supports `uid`, `sequence`; default or illegal values are treated as `uid` |
| `source` | string | No | When passing `local`, the cached local reserved details text | will be returned first.
| `prefer_local` | bool | no | `1` / `true` / `yes` / `on` is equivalent to `source=local` |

#### Return field

The `email` object contains at least the following fields:

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Email ID |
| `subject` | string | Email subject |
| `from` | string | sender |
| `to` | string | recipient, multiple addresses are spliced with `, ` |
| `cc` | string | CC, may be empty |
| `date` | string | Receiving time |
| `body` | string | Email text |
| `body_type` | string | `html` or `text` |
| `has_attachments` | bool | Is there any attachment |
| `attachments` | array<object> | attachment list |

Each object in `attachments` contains:

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | attachment ID, use | when downloading attachments
| `name` | string | Attachment file name |
| `content_type` | string | MIME type |
| `size` | int | Attachment size, unit byte |
| `is_inline` | bool | is an inline attachment |
| `content_id` | string | Content-ID of the inline attachment, empty if not |

### GET `/api/email/<email_addr>/<message_id>/attachments/<attachment_id>`

Download individual email attachments. Return the file stream with the `Content-Disposition: attachment` response header.

#### Query parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `folder` | string | No | The folder where the current email is located, default `inbox` |
| `method` | string | No | Outlook account preferentially uses `graph`, and when sending `imap`, use IMAP to download |
| `id_mode` | string | No | Message ID mode used for OAuth IMAP attachment download, supports `uid`, `sequence`; the default is `uid` to process |

### GET `/api/email/<email_addr>/<message_id>/attachments/download-all`

Package and download all attachments of the current email. Returns the `application/zip` file stream and downloads the file named `attachments.zip`.

The file name in the ZIP uses the original file name of the attachment; if multiple attachments have the same name, serial numbers will be automatically appended to avoid overwriting.

#### Query parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `folder` | string | No | The folder where the current email is located, default `inbox` |
| `method` | string | No | Outlook account preferentially uses `graph`, and when sending `imap`, use IMAP to download |
| `id_mode` | string | No | Message ID mode used for OAuth IMAP attachment download, supports `uid`, `sequence`; the default is `uid` to process |

### POST `/api/emails/mark-read`

Mark emails in bulk as read.

#### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `email` | string | is | primary mailbox or alias mailbox |
| `method` | string | No | Default `graph`, can be passed `imap` |
| `folder` | string | No | Default folder, default `inbox` |
| `ids` | array<string> | condition is required | abbreviation mode, directly transmit the email ID array |
| `items` | array<object> | Condition required | Complete mode, you can specify the folder and ID mode for each email separately |

Each item supported in `items` mode:

| Field | Type | Description |
| --- | --- | --- |
| `id` / `message_id` | string | Email ID |
| `folder` | string | `inbox`、`junkemail`、`deleteditems`、`all` |
| `id_mode` | string | `graph`、`uid`、`sequence` |

#### Request example

Abbreviation mode:

```json
{
  "email": "user@outlook.com",
  "ids": ["AAMk...", "AAMk..."],
  "folder": "inbox"
}
```

Complete mode:

```json
{
  "email": "user@outlook.com",
  "method": "imap",
  "items": [
    {
      "id": "12345",
      "folder": "inbox",
      "id_mode": "uid"
    },
    {
      "id": "AAMk...",
      "folder": "junkemail",
      "id_mode": "graph"
    }
  ]
}
```

#### Response key fields

| Field | Description |
| --- | --- |
| `success` | Only if all are successful is `true` |
| `success_count` | Number of emails successfully marked as read |
| `failed_count` | Failure quantity |
| `updated_ids` | Successfully updated email ID list |
| `errors` | Failure details list |
| `error` | The first failure message, compatible with the old front-end logic |

### POST `/api/emails/retain-bodies`

Complete the detail text cache for reserved general mailbox list lines for local priority lists, new mail prompts after merging, and subsequent offline detail rollback. This interface is only executed when `normal_mail_local_retention_enabled=true`; when closed, it returns `local_retention_enabled=false` and skips all items.

#### Request fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `email` | string | is | ordinary email account address or alias address |
| `folder` | string | No | Default folder, default `inbox`; a single `items` item can overwrite |
| `method` | string | No | Default reading method, default `graph`; a single `items` item can cover |
| `items` | array | No | List items to be completed. Each item can include `id` / `message_id`, `folder`, `method`, `id_mode` |
| `ids` | array | No | is compatible with old calls; when `items` is not passed, it is used as the ID list to be completed |

#### Response field

| Field | Description |
| --- | --- |
| `cached_count` | The number of texts successfully completed this time |
| `skipped_count` | The number of | skipped due to existing cache, incomplete parameters or exceeding the upper limit of the server
| `failed_count` | Number of failed remote detail reads |
| `limit` | The upper limit of the server that can be filled in a single time |
| `results` | Single completion result |
| `errors` | Single failure reason |

### POST `/api/emails/delete`

Delete emails in batches (permanent deletion).

#### Request body

```json
{
  "email": "user@outlook.com",
  "method": "graph",
  "folder": "inbox",
  "items": [
    {
      "id": "AAMk...",
      "folder": "inbox",
      "id_mode": "graph"
    }
  ]
}
```

Compatible with old formats:

```json
{
  "email": "user@outlook.com",
  "ids": ["AAMk...", "AAMk..."]
}
```

Description:

- It is recommended to pass `items` (including `id` / `folder` / `id_mode`) and `method`, consistent with `/api/emails/mark-read`
- Outlook accounts are split according to `id_mode`/`method`: `graph` uses Graph API, `uid`/`sequence` uses OAuth IMAP
- Standard IMAP account permanently deleted via IMAP `STORE \\Deleted` + `EXPUNGE`
- Still accept old clients that only pass `ids`; at this time, the default is Graph processing

## Temporary mailbox

### List, import, channel domain name

| method | path | parameter | description |
| --- | --- | --- | --- |
| GET | `/api/temp-emails` | None | Gets all temporary mailboxes, the list item contains the `tags` field |
| POST | `/api/temp-emails/import` | JSON: `account_string`, `provider`, `tag_ids?` | Import temporary mailboxes in batches; mailboxes imported successfully by Cloudflare can be synchronously bound to the label |
| POST | `/api/temp-emails/batch-delete` | JSON: `temp_email_ids` | Delete temporary mailboxes in batches |
| GET | `/api/duckmail/domains` | None | Get DuckMail available domain name |
| GET | `/api/cloudflare/channels` | None | Get Cloudflare channel list |
| POST | `/api/cloudflare/channels` | JSON: Channel configuration | Create Cloudflare channel |
| PUT | `/api/cloudflare/channels/<id>` | JSON: Channel configuration | Update Cloudflare channel |
| DELETE | `/api/cloudflare/channels/<id>` | None | Delete unreferenced Cloudflare channel |
| POST | `/api/cloudflare/channels/<id>/test` | None | Test Cloudflare Channel Manager API Connection |
| GET | `/api/cloudflare/domains` | Query: `channel_id` | Get the domain name | available for the specified Cloudflare channel
| GET | `/api/cloudflare/messages` | Query: `channel_id?`, `limit?`, `offset?`, `address?` | Use the administrator interface of the specified or default Cloudflare channel to view all emails of the channel, optionally filter by recipient address |
| POST | `/api/temp-emails/import-cloudflare-addresses` | JSON: `cloudflare_channel_id`, `tag_ids?`, `page_size?`, `stream?` | Automatically pulls and imports the address list from the specified Cloudflare channel, and manages it through the administrator API; when `stream=true` returns the Server-Sent Events streaming progress |
| POST | `/api/temp-emails/generate-batch` | JSON: `provider=cloudflare`, `count`, `channel_id?`, `domain?`, `usernames?`, `tag_ids?` | Generate Cloudflare temporary mailboxes in batches and manage | through the administrator API
| POST | `/api/cloudflare/ai-usernames/test` | JSON: AI draft configuration, `count` | Testing AI username generation with unsaved or saved configuration |
| POST | `/api/cloudflare/ai-usernames/generate` | JSON: `count` | Generate strictly equivalent username | using saved and enabled AI configuration

Import format of `/api/temp-emails/import`:

- `provider=gptmail`: One mailbox per line
- `provider=duckmail`: `Email----Password` per line
- `provider=cloudflare`: One email address per line, use `cloudflare_channel_id` in the request to bind the channel; all Cloudflare emails are managed uniformly through the channel administrator API, and JWT is no longer used; compatible with the old format `Email----JWT`, the email part will be automatically extracted

### POST `/api/temp-emails/generate`

Generate a new temporary mailbox.

#### Request body

| provider | requires field | description |
| --- | --- | --- |
| `gptmail` | `prefix?`, `domain?` | will be randomly generated by default |
| `duckmail` | `domain`, `username`, `password` | The username is at least 3 digits and the password is at least 6 digits |
| `cloudflare` | `channel_id`, `domain?`, `username?` | `channel_id` specifies the Cloudflare channel; `username` can be left blank to randomly generate |

#### Request example

```json
{
  "provider": "duckmail",
  "domain": "example.com",
  "username": "demo123",
  "password": "secret123"
}
```

### POST `/api/temp-emails/generate-batch`

Generate Cloudflare temporary mailboxes in batches. Currently only `provider=cloudflare` is supported.

#### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `provider` | string | is | fixed to `cloudflare` |
| `count` | int | is the creation quantity of |, range `1-50` |
| `channel_id` | int/string | No | Cloudflare channel ID; use the default channel if not transmitted |
| `domain` | string | No | specifies the email domain name; if not transmitted, the first domain name of the channel is used |
| `usernames` | array<string> | No | Explicit username list. Randomly generated when empty or not passed; when not empty, the number after cleaning must be equal to `count`, and cannot be repeated |
| `tag_ids` | array<int> | No | Bind the existing label | to the successfully created temporary mailbox

Username cleaning rules: Convert to lowercase; use `@` prefix when containing `@`; delete all non-`a-z0-9` characters; the length after cleaning must be at least 3; a maximum of 32 characters can be retained.

#### Request example

```json
{
  "provider": "cloudflare",
  "channel_id": 1,
  "domain": "mail.example.com",
  "count": 3,
  "usernames": ["alpha", "beta@example.com", "sales.ops"],
  "tag_ids": [2, 5]
}
```

#### Examples of successful or partially successful responses

```json
{
  "success": true,
  "emails": [
    "alpha@mail.example.com",
    "beta@mail.example.com"
  ],
  "created_count": 2,
  "failed_count": 1,
  "failures": [
    {
      "index": 3,
      "username": "salesops",
      "error": "upstream rejected"
    }
  ],
  "tagged_count": 2,
  "message": "2 Cloudflare temporary mailboxes created"
}
```

If all creation fails, `success=false`, and the first failure reason is returned to `error`.

### POST `/api/cloudflare/ai-usernames/test`

Use draft configuration to test AI username generation without creating a mailbox or saving the generation results. Can be used to test the settings page before saving it.

#### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `api_url` | string | is the | OpenAI-compatible API address; the basic `/v1` address can be passed, and the backend will supplement `/chat/completions` |
| `model` | string | is | model name |
| `api_key` | string | No | AI API Key; when omitted, try to use the saved key |
| `prompt` | string | No | prompt word template, supports `{count}` and `{seed}` |
| `count` | int | No | Expected quantity, range `1-50`, default `5` |

### POST `/api/cloudflare/ai-usernames/generate`

Generate a list of usernames using a saved and enabled Cloudflare AI username configuration. This interface only returns the user name, does not create an email or bind a label.

#### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `count` | int | is | expected quantity, range `1-50` |

This interface requires that both the original AI returned quantity and the cleaned quantity are strictly equal to `count`. Insufficient, excessive, duplicate, or invalid after cleaning will return `success=false` and will not be randomly supplemented or truncated.

### Temporary mailbox mail interface

| method | path | parameter | description |
| --- | --- | --- | --- |
| DELETE | `/api/temp-emails/<email_addr>` | Path parameter `email_addr` | Delete temporary mailbox |
| GET | `/api/temp-emails/<email_addr>/messages` | Path parameter `email_addr` | Get temporary mailbox mailing list |
| GET | `/api/temp-emails/<email_addr>/messages/<message_id>` | Path parameter | Get temporary email details |
| DELETE | `/api/temp-emails/<email_addr>/messages/<message_id>` | Path parameter | Currently returns "Single letter deletion function has been temporarily closed" |
| DELETE | `/api/temp-emails/<email_addr>/clear` | Path parameter | Currently returns "The clearing function has been temporarily turned off" |
| POST | `/api/temp-emails/<email_addr>/refresh` | Path parameter | Actively refresh temporary mailbox mail |

Both `GET /messages` and `POST /refresh` will return the `emails` list with a unified structure. `POST /refresh` will also contain `new_count`, indicating the number of newly saved emails this time.

### Cloudflare channel management

Cloudflare Temp Email supports multi-channel configuration. Each channel contains `name`, `worker_domain`, `email_domains`, `admin_password`, `enabled`, `is_default`. `email_domains` is optional. If left blank, the channel can still be saved but the domain name cannot be automatically selected when generating the email; the administrator password is only submitted when saving; only `admin_password_configured` is returned in the list response.

Create channels:

```http
POST /api/cloudflare/channels
```

```json
{
  "name": "cfmail-us",
  "worker_domain": "cfmail-us.example.workers.dev",
  "email_domains": "mail-us.example.com, alt-us.example.com",
  "admin_password": "ADMIN_PASSWORD",
  "enabled": true,
  "is_default": true
}
```

When updating existing channels, `admin_password` can be left blank, indicating that the original password is retained; `email_domains` can also be left blank, and the domain name query interface will return a successful response and an empty list. Before deleting a channel, the system will check whether there is still a Cloudflare temporary mailbox referencing the channel; the referenced channel cannot be deleted and can be deactivated first.

### GET `/api/cloudflare/messages`

View all emails of the specified Cloudflare channel Worker; use the default Cloudflare channel when `channel_id` is not transmitted. This interface requires a Web login session and does not use an external API Key; it is different from the `folder=all` of an ordinary email account, which only aggregates the inbox and spam of an ordinary email account. This interface does not provide aggregated views across Cloudflare channels.

#### Query parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `channel_id` | int | No | Cloudflare channel ID; use the default channel if not transmitted |
| `limit` | int | No | returns the quantity, default `50`, maximum `100` |
| `offset` | int | No | paging offset, default `0` |
| `address` | string | No | Recipient address filtering; check this channel when not transmitting Worker All emails |

When `address` is `@gmail.com` or `@googlemail.com` and the first address filtering query succeeds but returns 0 emails, it will automatically retry with another suffix within the same channel. `channel_id`, `channel_name`, `requested_email`, `queried_email`, `fallback_used` in the response will indicate the actual query range and address.

#### Example of successful response

```json
{
  "success": true,
  "method": "Cloudflare Admin",
  "channel_id": 1,
  "channel_name": "cfmail-us",
  "requested_email": "user@gmail.com",
  "queried_email": "user@googlemail.com",
  "fallback_used": true,
  "limit": 50,
  "offset": 0,
  "count": 1,
  "total_count": 1,
  "has_more": false,
  "emails": [
    {
      "id": "cf-admin-123",
      "from": "sender@example.com",
      "to": "user@googlemail.com",
      "subject": "Verification code",
      "body_preview": "Your code is 123456",
      "date": 1770000000,
      "timestamp": 1770000000,
      "body_type": "text",
      "folder": "cloudflare"
    }
  ]
}
```

## OAuth auxiliary interface

| method | path | parameter | description |
| --- | --- | --- | --- |
| GET | `/api/oauth/auth-url` | None | Generate Microsoft OAuth authorization link |
| POST | `/api/oauth/exchange-token` | JSON: `redirected_url` | Parse `code` from the callback URL and exchange for Refresh Token |
| POST | `/api/accounts/<account_id>/reauthorize` | JSON: `redirected_url` | Reauthorize existing Outlook account and automatically refresh verification |

Example of request in exchange for Token:

```json
{
  "redirected_url": "http://localhost:8080/?code=..."
}
```

Note: Microsoft authorization codes can usually only be used once. When re-authorizing an existing account, you should call `/api/accounts/<account_id>/reauthorize` directly. Do not call `/api/oauth/exchange-token` to preview first and then submit the same callback URL repeatedly.

## Set interface

### POST `/api/settings/validate-cron`

Validate the Cron expression and return the next execution time and the next 5 execution times.

#### Request example

```json
{
  "cron_expression": "0 */6 * * *",
  "time_zone": "America/Los_Angeles"
}
```

The optional field `time_zone` is used to preview the next execution time in the specified IANA time zone; if not passed, `app_timezone` in the current system settings is used.

### GET `/api/settings`

Get system settings.

In addition to the original key values in the database `settings` table, the interface will additionally organize and return the following common fields:

| Field | Description |
| --- | --- |
| `login_password_masked` | Login password mask |
| `external_api_key` | Current external API Key |
| `duckmail_base_url` | DuckMail API address |
| `duckmail_api_key` | DuckMail API Key |
| `cloudflare_worker_domain` | Old single-channel Cloudflare Worker domain name, mainly used for upgrade and migration |
| `cloudflare_email_domains` | Old single-channel Cloudflare email domain name list, mainly used for upgrade and migration |
| `cloudflare_admin_password` | Old single-channel Cloudflare management password, mainly used for upgrade and migration |
| `cloudflare_ai_username_enabled` | Whether to enable Cloudflare AI username generation |
| `cloudflare_ai_username_api_url` | Cloudflare AI username generation API address |
| `cloudflare_ai_username_model` | Cloudflare AI username generation model |
| `cloudflare_ai_username_prompt` | Cloudflare AI username generation prompt word template |
| `cloudflare_ai_username_api_key_configured` | Has Cloudflare AI API Key | been saved?
| `cloudflare_ai_username_api_key_masked` | Cloudflare AI API Key mask, does not return plain text |
| `app_timezone` | Current system time zone, IANA time zone name, such as `Asia/Shanghai` |
| `mail_fetch_timeout_seconds` | The overall timeout seconds for ordinary Outlook/IMAP to read the mail list, range `30-300`, default `120` |
| `show_account_created_at` | Whether to display the creation time | in the mailbox list
| `show_account_sort_order` | Whether to display the custom sort value | in the mailbox list
| `active_skin_id` | The currently effective skin ID; when the configuration is unavailable, `classic` | will be returned
| `configured_skin_id` | Currently saved skin ID; may differ from `active_skin_id` due to skin unavailability |
| `active_skin` | The currently effective skin object |
| `active_skin_asset_hash` | Current skin CSS resource version, used to refresh `/assets/active-skin.css` |
| `forward_channels` | Currently enabled forwarding channel |
| `forward_check_interval_seconds` | Forward polling interval seconds |
| `forward_check_interval_minutes` | Forwarding check interval minutes compatible with old clients |
| `forward_execution_mode` | forwarding execution mode, `serial` or `parallel` |
| `forward_parallel_workers` | Parallel mode worker number |
| `forward_account_delay_seconds` | Account interval seconds in serial mode; parallel mode returns `0` |
| `forward_email_window_minutes` | forwarding time window |
| `forward_include_junkemail` | Whether to forward the trash can |
| `email_forward_recipient` | SMTP forward recipient |
| `smtp_host` | SMTP host |
| `smtp_port` | SMTP port |
| `smtp_username` | SMTP username |
| `smtp_password` | SMTP password |
| `smtp_from_email` | SMTP sending email |
| `smtp_provider` | SMTP type |
| `smtp_use_tls` | Whether to enable TLS |
| `smtp_use_ssl` | Whether to enable SSL |
| `telegram_bot_token` | Telegram Bot Token |
| `telegram_chat_id` | Telegram Chat ID |
| `telegram_topic_id` | Telegram Topic ID (optional, message_thread_id of the topic group) |
| `normal_mail_local_retention_enabled` | Whether to enable local retention of ordinary mailboxes |

### PUT `/api/settings`

Update system settings. The main writable fields supported by the current implementation are as follows.

#### Basic and scheduling related fields

| Field | Type | Description |
| --- | --- | --- |
| `login_password` | string | New login password, at least 8 digits; `current_login_password` | must be provided when submitting
| `current_login_password` | string | Current login password; required when modifying `login_password`, used for secondary confirmation |
| `gptmail_api_key` | string | GPTMail API Key |
| `refresh_interval_days` | int | refresh cycle, range `1-90` |
| `refresh_delay_seconds` | int | Refresh interval seconds, range `0-60` |
| `refresh_cron` | string | Cron expression |
| `use_cron_schedule` | bool | Whether to use Cron to schedule |
| `enable_scheduled_refresh` | bool | Whether to enable scheduled refresh |
| `app_timezone` | string | system time zone, use IANA time zone name, such as `Asia/Shanghai` |
| `mail_fetch_timeout_seconds` | int | Normal Outlook/IMAP mail list acquisition timeout, range `30-300`; if not transmitted, the existing value is retained. When the setting has not been saved, fall back to the environment variable `MAIL_FETCH_OVERALL_TIMEOUT`, and then fall back to `120` |
| `show_account_created_at` | bool | Whether to display the creation time | in the mailbox list
| `show_account_sort_order` | bool | Whether to display the custom sort value | in the mailbox list
| `active_skin_id` | string | Current system-level appearance skin ID; all logged-in devices share the same setting |
| `external_api_key` | string | External API Key, you can pass an empty string to clear |
| `normal_mail_local_retention_enabled` | bool/string | Whether to enable local retention of ordinary mailboxes; updating through `/api/settings` will synchronously refresh the backend in-process read cache |

Note: The correct `current_login_password` must be provided when modifying `login_password`; after the password change is successful, the server will rotate the login session version. Other logged-in Web Sessions need to log in again, and the current password change session remains valid.

#### Temporary mailbox service related fields

| Field | Type | Description |
| --- | --- | --- |
| `duckmail_base_url` | string | DuckMail API address |
| `duckmail_api_key` | string | DuckMail API Key |
| `cloudflare_worker_domain` | string | Old single-channel Cloudflare Worker domain name; please use `/api/cloudflare/channels` | for new configurations
| `cloudflare_email_domains` | string | Old single-channel Cloudflare email domain name; please use `/api/cloudflare/channels` | for new configuration
| `cloudflare_admin_password` | string | Old single-channel Cloudflare management password; please use `/api/cloudflare/channels` | for new configurations
| `cloudflare_ai_username_enabled` | bool/string | Whether to enable Cloudflare AI username generation |
| `cloudflare_ai_username_api_url` | string | OpenAI-compatible API address |
| `cloudflare_ai_username_model` | string | model name |
| `cloudflare_ai_username_prompt` | string | prompt word template, supports `{count}` and `{seed}` |
| `cloudflare_ai_username_api_key` | string | AI API Key; encrypted and saved when non-empty, empty string will retain the existing value |
| `cloudflare_ai_username_clear_api_key` | bool | clears the saved AI API Key | when passing `true`

#### Forwarding SMTP/Telegram related fields

| Field | Type | Description |
| --- | --- | --- |
| `forward_check_interval_seconds` | int | Polling interval seconds, range `20-3600` |
| `forward_check_interval_minutes` | int | Compatible with the old client’s polling interval minutes, range `1-60`; when seconds is not transmitted at the same time, the second-level configuration | will be written synchronously
| `forward_execution_mode` | string | `serial` or `parallel`; when saved as `parallel`, the account interval will be reset to zero |
| `forward_parallel_workers` | int | Parallel mode worker number, range `1-10` |
| `forward_account_delay_seconds` | int | Account interval in serial mode, range `0-60`; parallel mode will be saved as `0` |
| `forward_email_window_minutes` | int | Mail forwarding time range, `0-10080`, `0` means no limit |
| `forward_include_junkemail` | bool | Whether to include spam emails in forwarding polling |
| `forward_channels` | array<string> | `smtp` / `telegram` / `wecom` |
| `email_forward_recipient` | string | SMTP forward recipient |
| `smtp_host` | string | SMTP host |
| `smtp_port` | int | SMTP port |
| `smtp_username` | string | SMTP username |
| `smtp_password` | string | SMTP password |
| `smtp_from_email` | string | SMTP sending email |
| `smtp_provider` | string | `outlook`、`qq`、`163`、`126`、`yahoo`、`aliyun`、`custom` |
| `smtp_use_tls` | bool | Whether to enable TLS |
| `smtp_use_ssl` | bool | Whether to enable SSL |
| `telegram_bot_token` | string | Telegram Bot Token |
| `telegram_chat_id` | string | Telegram Chat ID |
| `telegram_topic_id` | string | Telegram Topic ID (optional, message_thread_id of the topic group, pure number) |

#### Request example

```json
{
  "forward_check_interval_seconds": 20,
  "forward_execution_mode": "parallel",
  "forward_parallel_workers": 4,
  "forward_account_delay_seconds": 0,
  "forward_email_window_minutes": 30,
  "forward_include_junkemail": true,
  "smtp_provider": "outlook",
  "forward_channels": ["smtp", "telegram"]
}
```

### GET `/api/skins`

Obtain the system-level appearance skin list, current configuration values ​​and currently effective skins. This interface requires you to be logged in.

Example of successful response:

```json
{
  "success": true,
  "configured_skin_id": "midnight-sample",
  "active_skin_id": "midnight-sample",
  "asset_hash": "a1b2c3d4e5f6a7b8",
  "active_skin": {
    "id": "midnight-sample",
    "name": "Midnight Sample",
    "version": "1.0.0",
    "source_type": "upload",
    "builtin": false,
    "active": true,
    "status": "ok",
    "asset_hash": "a1b2c3d4e5f6a7b8",
    "last_error": ""
  },
  "skins": []
}
```

Field description:

| Field | Description |
| --- | --- |
| `configured_skin_id` | `settings` Skin ID | saved in table
| `active_skin_id` | The currently effective skin ID; when the configuration is unavailable, it will fall back to `classic` |
| `asset_hash` | Current skin CSS version, can be used as `/assets/active-skin.css?v=...` parameter |
| `skins` | List of installed skins, always includes built-in `classic` |

Common fields of skin objects:

| Field | Description |
| --- | --- |
| `id` | Skin ID |
| `name` | Display name |
| `version` | version |
| `description` | Description |
| `source_type` | `builtin`, `upload` or `git` |
| `builtin` | Whether there is built-in skin |
| `active` | Is | currently in effect?
| `status` | `ok` or `invalid` |
| `last_error` | The latest check or read error |
| `git_url` | Git source address, only Git source skin returns |
| `git_ref` | Git ref, only Git source skin returns |

### POST `/api/skins/<skin_id>/activate`

Enable the specified skin. This setting is a system-level setting. After saving, all logged-in devices will use the same current skin.

Example of successful response:

```json
{
  "success": true,
  "message": "Skin is enabled",
  "active_skin": {
    "id": "classic",
    "source_type": "builtin",
    "active": false,
    "status": "ok"
  },
  "asset_hash": "classic"
}
```

Common errors when failing:

- `Invalid skin ID`
- `Skin does not exist`
- `Skin not available`

You can also submit `active_skin_id` through `PUT /api/settings` to achieve the same effect.

### POST `/api/skins/upload`

Upload the zip skin package. The form field name supports `skin` or `file`.

Request example:

```bash
curl -X POST \
  -H "X-CSRFToken: <csrf-token>" \
  -b "session=<session-cookie>" \
  -F "skin=@skin.zip" \
  "http://localhost:5000/api/skins/upload"
```

Example of successful response:

```json
{
  "success": true,
  "message": "Skin has been installed",
  "skin": {
    "id": "midnight-sample",
    "name": "Midnight Sample",
    "version": "1.0.0",
    "source_type": "upload",
    "status": "ok"
  }
}
```

See [`docs/skins.md`](skins.md) for format requirements. Failure to upload will not change the currently enabled skin.

### POST `/api/skins/git/install`

Install the skin from the Git repository. The warehouse root directory must contain `skin.json` and CSS entry files.

Request example:

```json
{
  "git_url": "https://github.com/user/outlook-skin.git",
  "git_ref": "main"
}
```

Description:

- `git_url` is required.
- `git_ref` is optional: a branch, tag, or another ref accepted by `git clone --branch`.
- `git` must be installed in the operating environment.
- There is no special management entrance for private warehouse credentials, and it is not recommended to write the credentials directly into a URL visible to multiple people.

The successful response is consistent with the upload interface. Failure to install will not change the currently enabled skin.

### POST `/api/skins/<skin_id>/git/update`

Update installed Git source skin. The server will use the `git_url` and `git_ref` saved by the skin to pull it again, and require the updated `skin.json.id` to be consistent with the original skin ID.

Example of successful response:

```json
{
  "success": true,
  "message": "Git skin has been updated",
  "skin": {
    "id": "midnight-sample",
    "source_type": "git",
    "status": "ok"
  }
}
```

Existing skin files will not be overwritten when updates fail.

### DELETE `/api/skins/<skin_id>`

Remove unenabled custom skins. The built-in `classic` cannot be deleted, nor can the currently enabled skin be deleted directly; you need to switch to other skins or `classic` first.

Example of successful response:

```json
{
  "success": true,
  "message": "Skin has been deleted"
}
```

### GET `/assets/active-skin.css`

Returns the CSS of the currently effective skin. This resource is used for page loading and does not require a Session; returns empty classic fallback CSS when configuration is not available or CSS reading fails.

The client can use `asset_hash` / `active_skin_asset_hash` returned by `GET /api/skins` or `GET /api/settings` as query parameters to refresh the cache:

```txt
/assets/active-skin.css?v=<asset_hash>
```

### GET `/api/settings/normal-mail-retention/status`

Obtain local retention statistics and cleanup task status of ordinary mailboxes.

#### Example of successful response

```json
{
  "success": true,
  "status": {
    "enabled": true,
    "saved_message_count": 128,
    "cached_body_count": 42,
    "estimated_retained_bytes": 1048576,
    "db_file_bytes": 5242880,
    "clear_status": {
      "state": "idle",
      "message": ""
    }
  }
}
```

`clear_status.state` can be `idle`, `running`, `succeeded`, or `failed`. These statistics support display and cleanup decisions; they are not exact quotas.

### POST `/api/settings/normal-mail-retention/clear`

Start the background cleaning task to delete the local retained data of the ordinary mailbox in `retained_normal_mail_messages`. This interface will not automatically shut down `normal_mail_local_retention_enabled`; the shutdown switch is done independently by `PUT /api/settings`.

Cleanup tasks are in-process state: repeated requests do not start a second delete thread, but instead return the current `running` state with `already_running=true`. When background deletion encounters a short-term SQLite `database is locked`, it will be retried in a limited manner; the final result is polled through the status interface.

#### Example of successful response

```json
{
  "success": true,
  "already_running": false,
  "status": {
    "state": "running",
    "message": "Clearing the local retention cache of ordinary mailboxes"
  }
}
```

### POST `/api/settings/test-forward-channel`

Test the forwarding channel directly using the current front-end form configuration, without requiring the settings to be saved first.

#### Request example

SMTP test:

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

Telegram test:

```json
{
  "channel": "telegram",
  "config": {
    "telegram": {
      "bot_token": "123:abc",
      "chat_id": "123456",
      "topic_id": "789"
    }
  }
}
```

## Description

### Proxy use

The API related to the account mailbox will currently give priority to the account-level proxy configuration; only when the account `proxy_url`, `fallback_proxy_url_1`, and `fallback_proxy_url_2` are all empty, the proxy configuration of the group to which the account belongs will be inherited. If the current group does not have a proxy configured, it will continue to search upwards for the parent group proxy until it finds an ancestor group with a proxy configuration or reaches the first-level group:

- Graph token acquisition
- Graph mailing list
- Graph email details
- Outlook OAuth IMAP token acquisition
- Outlook OAuth IMAP List/Details/Delete
- Password IMAP List/Details/Delete
- Forward polling to capture messages/details capture

### Alias conflict rules

The alias will be verified when saving:

- It cannot be the same as the main email address of this account.
- It cannot be the same as the main email address of other accounts.
- Cannot be repeated with other account aliases
- Cannot conflict with temporary email address

### Special response types

The following interfaces are not ordinary JSON data interfaces:

- `GET /api/accounts/refresh-all`: `text/event-stream`
- `GET /api/accounts/refresh-failed-stream`: `text/event-stream`
- `GET /api/accounts/trigger-scheduled-refresh`: `text/event-stream`
- `GET /api/groups/<group_id>/export`: `text/plain` file download
- `GET /api/accounts/export`: `text/plain` file download
- `POST /api/accounts/export-selected`: `text/plain` file download
