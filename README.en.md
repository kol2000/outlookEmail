> **Localized fork:** use the installation instructions in [README](README.md). The upstream binaries and Docker images described below do not include this translation. [Русский](README.ru.md).

# Multi-mailbox email management tool

An email management tool for multiple email account scenarios. It supports unified reading, management and forwarding of emails through Outlook/Hotmail OAuth, Microsoft Graph API and standard IMAP. It also provides a web interface and Chrome/Edge browser extension for group management, account management, email viewing and external API calls. Currently supports Outlook/Hotmail, Gmail, QQ, 163, 126, Yahoo, Alibaba mailbox and custom IMAP mailboxes, and also integrates GPTMail, DuckMail, Cloudflare Temp Email multi-provider temporary mailbox capabilities.

Note: Changing the password will cause the auth to become invalid and require re-authorization.
## 📦 Quick start
### Experience site (may not be the latest version)
https://aso.de5.net
admin123
Note: Please do not change the password or store actual data on the experience site. If it is deployed on a non-persistent service, the data may be lost and restored to the initial state at any time; and since everyone can log in and see it, and there seems to be a process scanning, there is a very high risk of account theft.

## 🌿 Version management and release

This project adopts lightweight dual-branch version management: `main` is the stable release branch, and `dev` is the daily development branch.

See [Release Notes](RELEASE.en.md) for complete release steps, workflow behaviors, and checklist.

### Method 1: Download Windows `exe` (available in win)

Download the corresponding version of `OutlookEmail-windows-x64-*.zip` from GitHub Releases, decompress it and run `OutlookEmail.exe` directly.

The desktop version will automatically:

- Generate and persist `SECRET_KEY`
- Create local data directory and SQLite database
- Start the Web service, default address `http://127.0.0.1:5000`

Description:

- Windows data is saved in `%APPDATA%\OutlookEmail` by default
- The default login password is still `admin123`. It is recommended to change it immediately after logging in for the first time.

### Method 2: Download the macOS installation package

Download `OutlookEmail-macos-*-*.dmg` of the corresponding architecture from GitHub Releases, open it and drag `OutlookEmail.app` to `Applications`.

The desktop version will automatically:

- Generate and persist `SECRET_KEY`
- Create local data directory and SQLite database
- Start the Web service, default address `http://127.0.0.1:5000`

Description:

- macOS data is saved in `~/Library/Application Support/OutlookEmail` by default
- If macOS prompts that Apple cannot verify whether "OutlookEmail" contains malware that may harm Mac security or leak privacy. You can execute the following command and try again
  `sudo xattr -rd com.apple.quarantine /Applications/OutlookEmail.app`
- The default login password is still `admin123`. It is recommended to change it immediately after logging in for the first time.

### Method 3: Use Docker (recommended server deployment)

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
```

### Method 4: Run directly using Python

```bash
git clone https://github.com/assast/outlookEmail.git
cd outlookEmail
pip install -r requirements.txt
export SECRET_KEY=your-secret-key-here
python web_outlook_app.py
```

python -m pip install -r requirements.txt; $env:SECRET_KEY = (& python -c "import secrets; print(secrets.token_hex(32))")[0]; $env:HOST="127.0.0.1"; python web_outlook_app.py

Access `http://localhost:5000` to use.
In case of server deployment, it is still recommended to set fixed `SECRET_KEY` explicitly.

### Operating mode

The service needs to keep a single worker running. The official Docker image has been fixed to Gunicorn single worker + multi-thread; if you customize the deployment, please do not increase the number of workers. When concurrency is required, give priority to adjusting the number of threads. Streaming tasks managed by token refresh will use in-process short-term state, and multiple workers will cause task initialization and SSE subscription to fall into different processes.

### Using Docker Compose

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
    restart: unless-stopped
```

```bash
docker-compose up -d
```

#### Optional: Enable interface Docker online update + use your own Client ID and callback URL

Docker online update in the interface requires access to the host Docker socket. `/var/run/docker.sock` has Docker management rights on the host and is only recommended to be enabled in a trusted environment.

This feature is only available for containers using variable image tags, such as `latest`, `main`, and `dev`. If the current container is fixed with a version label such as `v2.0.39`, the interface will refuse online updates because Watchtower will not automatically switch the fixed label to the new version label.
By default, the application will automatically retry according to the "minimum supported API version" when the daemon explicitly returns the "minimum supported API version"; if your Docker environment or socket agent has special compatibility requirements, you can also explicitly set `DOCKER_UPDATE_API_VERSION`, and its value can refer to the output of `docker version --format '{{.Server.APIVersion}}'`.
The optional environment variable `DOCKER_UPDATE_STATUS_TIMEOUT` is used to independently control the timeout (seconds) of status query and container inspect, and does not affect `DOCKER_UPDATE_TIMEOUT` of the actual update task.
If there is no new image to pull for the current `latest` / `main` / `dev` tag, the interface will display that no update has been applied this time, instead of falsely reporting that the update failed.

If you want the "Get Token" in the interface to use your own Azure application, please set `OAUTH_CLIENT_ID` and `OAUTH_REDIRECT_URI` at the same time. These two values ​​​​will be used to generate Microsoft authorization links and exchange for Refresh Token; after the exchange is successful, the Client ID returned by the interface needs to be imported into the account together with the Refresh Token. If not set, the project's built-in default Client ID and default callback address `http://localhost:8080` will be used.

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
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - LOGIN_PASSWORD=admin123
      - SECRET_KEY=your-secret-key-here
      - FLASK_ENV=production
      - DOCKER_UPDATE_ENABLED=true
      - DOCKER_UPDATE_CONTAINER=outlook-mail-reader
      # Optional: Explicitly specify the API version in newer Docker daemon/socket proxy environments
      # - DOCKER_UPDATE_API_VERSION=1.52
      # Optional: Let the interface OAuth assistant use your own Azure app
      # - OAUTH_CLIENT_ID=your-azure-application-client-id
      # - OAUTH_REDIRECT_URI=http://localhost:8080
    restart: unless-stopped
```

### Method 5: Build and run local source code (docker-compose.build.yml)

It is suitable to run after the local machine builds the image based on the source code (rather than pulling the pre-built image on `ghcr.io`), which facilitates immediate verification after local changes.

The warehouse root directory has provided `docker-compose.build.yml`, which will use `Dockerfile` in the root directory to build the image from the source code and start the container.

#### Step 1: Prepare environment variable file `.env.local`

`docker-compose.build.yml` injects environment variables through `env_file: .env.local`. When the file ** does not exist, Compose will directly report an error and refuse to start **. You need to copy and modify it from the template first:

```bash
cp .env.example .env.local
```

Modify at least two of the following:

```bash
# Generate a random string and fill in the SECRET_KEY of .env.local
python -c 'import secrets; print(secrets.token_hex(32))'
```

- `SECRET_KEY`: Fill in the random string generated above (be sure to modify it, do not use placeholder values; the leading and trailing blanks will be ignored)
- `LOGIN_PASSWORD`: The login password during first initialization, the default is `admin123`, it is recommended to change it to a strong password; ** changing this variable after ** has been written into the database will not overwrite the current password. If you forget your password, please use `scripts/reset_login_password.py` (see [Troubleshooting](docs/en/troubleshooting.md) / [Security configuration](docs/en/security.md))

Optional: If you need to adjust the number of Gunicorn threads/timeout, add `GUNICORN_THREADS` and `GUNICORN_TIMEOUT` to `.env.local` (if left blank, use the default value of 4 / 300).

Optional: The overall timeout for reading mail lists in ordinary Outlook/IMAP mailboxes defaults to 120 seconds, which can be adjusted in "System Settings -> General Settings -> Mail Fetch Timeout" (30-300 seconds); you can also set the initial value through `MAIL_FETCH_OVERALL_TIMEOUT` of `.env.local` before starting for the first time. This value should be less than `GUNICORN_TIMEOUT` (default 300 seconds).

#### Step 2: Build and launch

```bash
docker compose -f docker-compose.build.yml up -d --build
```

- `--build` forces the image to be rebuilt from the source code (the image label is `outlookemail:local`)
- The container name is `outlook-mail` and the mapped port is `5000:5000`
- Data persistence is on the host machine `./data`; `./static` and `./templates` are mounted in read-only mode, which facilitates local editing of templates/static resources to take effect in real time

After startup, visit `http://localhost:5000` and log in using `LOGIN_PASSWORD` in `.env.local`.

#### Step 3: Common operation and maintenance commands

```bash
# View log
docker compose -f docker-compose.build.yml logs -f

# View health checks and status
docker compose -f docker-compose.build.yml ps

# Rebuild and restart after changing the source code
docker compose -f docker-compose.build.yml up -d --build

# Stop and remove the container (data remains in ./data)
docker compose -f docker-compose.build.yml down
```

> Tip: `docker-compose.build.yml` does not mount the host Docker socket by default, so the "Docker Online Update" in the interface is not available - for local build scenarios, please directly use the `up -d --build` rebuild above to update.

## ✨ Features

### How to read emails

This tool currently contains three types of read links:

1. **Outlook/Hotmail OAuth + Graph API** - Priority method, suitable for Outlook / Hotmail / Live accounts
2. **Outlook/Hotmail OAuth + IMAP fallback ** - `outlook.live.com` / `outlook.office365.com`
3. ** standard IMAP** - suitable for Gmail, QQ, 163, 126, Yahoo, Alibaba mailbox and custom IMAP

#### Ordinary mailbox local retention behavior and restrictions

Ordinary mailbox local retention switch `normal_mail_local_retention_enabled` is turned off by default. Users need to explicitly turn it on in the system settings before ordinary Outlook/Hotmail and standard IMAP mailboxes can save list metadata and part of the text that has been viewed and completed to the local SQLite.

When turned on, the ordinary mailbox list will be loaded from the local retained data first, and the most recently retained email list will be displayed immediately when hit; if you continue to scroll down to load more in local priority mode, the local retained paging will also be used, so when the remote is unavailable, you can still view the retained emails beyond the first screen. The page will also continue to initiate remote synchronization to Graph API or IMAP in the background. After successful remote synchronization, the new list metadata will be written back to the local retention library; when synchronization fails, the current page will retain the local list and display a background synchronization failure prompt without clearing the list.

When background synchronization discovers new emails that have not yet been displayed locally, the page will display a non-interruptive prompt of "N new emails have been synchronized." New emails will not be merged into the current list immediately after successful synchronization; new emails will be merged into the current list only after the user clicks on the prompt, and background completion of highlighting, list cache updates, and new email body retention will be performed to prevent emails being read or selected from being suddenly replaced.

The email details will give priority to the reserved body content; if the local row does not have the body content, the body content will be backfilled with the retained data after the remote details are successfully read, for subsequent viewing when the page is refreshed, the application is restarted, or temporary network failure occurs. If the remote details fail but the local text already exists, the details page will display the local retained text as a fallback. Keyword filtering will also first check the cached text, and only if the cache is missing, the remote details will be read.

The IMAP fallback link of Outlook/Hotmail OAuth reads details and attachments by UID by default; list items, detail requests, and attachment downloads can carry `id_mode=uid|sequence` to avoid mixing UIDs and serial numbers, which may lead to incorrect email retrieval. Standard IMAP accounts continue to use their existing message ID reading logic.

At this stage, only the general mailbox list metadata and the read detail text are retained, and the download or retention of attachment binary and original MIME content is not included; attachment download still relies on the current remote provider link. The settings page displays the number of saved messages, number of cached bodies, estimated retention size, and current SQLite database size, and provides a separate "clear cache" action. When the local retention switch is turned off, the interface will first ask for confirmation; after confirmation, the local retention data of the ordinary mailbox will be deleted through a background cleanup task and the cleanup status will be displayed. Cleanup tasks reject repeated starts, limited retries on SQLite ephemeral locks, and front-end status polling uses backoff intervals to reduce pressure on long tasks. See [`docs/local-mail-retention.md`](docs/en/local-mail-retention.md) for a more complete scope description.

### Web application function

#### Core functions
- 🔐 ** Login Verification ** - Password-protected Web interface, supports online password modification; if you forget your password, you can use the official script `scripts/reset_login_password.py` to reset it (see [Troubleshooting](docs/en/troubleshooting.md))
- 📁 ** Group Management ** - Supports up to three levels of tree mailbox grouping, creation, editing, folding and expansion, sibling sorting, cross-level drag and drop movement and cascade deletion
- 🌐 ** account/group proxy ** - Each group can be configured with an HTTP/SOCKS5 proxy, and subgroups can inherit the parent proxy. A single account can also set a proxy and override the group proxy first; the proxy URL supports the `{mail}` placeholder (interconnected with sticky proxy pools such as [Resin](https://github.com/Resinat/Resin))
- 📧 ** Multiple Email Management ** - Batch import and management of Outlook/Hotmail OAuth / IMAP email accounts
- 🪪 ** Alias Management ** - Supports configuring multiple alias mailboxes for a single mailbox. Both the main mailbox and aliases can be used to retrieve emails and call external APIs
- 🔀 Advanced usage of ** alias ** - You can automatically forward the external mailbox to the mailbox A managed by this project, and then configure the external mailbox as an alias of A, so as to uniformly read emails through this project
- 📬 ** mail viewing ** - Web interface supports viewing inbox and spam; API supports `inbox`, `junkemail`, `deleteditems`, `all`
- ✉️ ** Basic Email Writing ** - Outlook/Hotmail accounts that have completed Graph authorization can send plain text emails as themselves on the Web.
- 📎 ** attachment download ** - Email details support single attachment download, and also support packaging all attachments as ZIP downloads
- 🔍 ** full screen view ** - supports full screen mode to view emails
- 📤 ** export function ** - supports exporting email account information by group tree, selected account or all
- 🧩 **WebDAV Backup ** - Supports uploading files of "Export All Groups" to WebDAV regularly by Cron, or manually uploading
- 🎨 ** modern UI** - four-column layout, clear partitions for account list, mailing list, and mail details
- 🎭 ** system-level appearance skin ** - supports built-in classic, custom zip skin package and Git warehouse source; all login devices will be consistent after switching
- ⚡ ** performance optimization ** - Mail list and account list caching, group switching and account switching are faster
- 📄 ** pagination loading ** - scroll to the bottom to automatically load the next page (20 letters per page)
- 🔥 ** Temporary Email ** - Integrate GPTMail + DuckMail + Cloudflare Temp Email, multiple providers can generate, import, read, and view details; Cloudflare supports multi-channel configuration, each Worker/administrator password/mail pool is independently managed, and all emails can be viewed by channel
- ⚙️ ** system settings ** - change password, API Key, email acquisition timeout, etc. online
- 🔄 **OAuth2 Assistant ** - Built-in authorization process to quickly obtain Refresh Token
- 💾 ** Mail Cache ** - Intelligent caching of mail lists, switching for instant display; local retention of ordinary mailboxes is turned off by default. You can turn it on, view statistics and clear the local retention cache on the settings page
- 🏷️ ** tag management ** - supports tagging mailboxes, batch operations, and filtering by tags
- 📦 ** batch move group ** - batch select mailboxes to move to any common group level
- ✅ ** batch selection ** - Email list and mailing list support selecting all of the current list and clearing the selection
- 🗑️ ** email deletion ** - single/batch permanent deletion; both Graph and IMAP (including standard IMAP account, OAuth IMAP fallback) are supported
- 🔄 **API priority fallback ** - Outlook OAuth default Graph API → IMAP (new) → IMAP (old); the preferred channel can be recorded according to the account, and it will automatically fall back after failure and remember the actual successful channel
- 🔑 ** External API** - Obtain emails directly through API Key without logging in. Supports alias mailboxes, aggregated folders and multi-condition filtering. Additional email addresses with a + sign are automatically recognized and automatically fall back to the main mailbox/alias mailbox query; if the required function is relatively complete, it is recommended to directly connect to the complete API. The document has been changed to a shape suitable for AI reading. Directly feed it to the AI and let the AI use the login password instead of the API Key according to the complete API.

#### Email forwarding
- 📮 ** enables forwarding ** by account - each account independently controls whether to participate in automatic forwarding
- 📨 ** multi-channel forwarding ** - supports SMTP email forwarding and Telegram forwarding
- ⏱️ ** time window control ** - supports forwarding only emails received within the last X minutes
- 🗑️ ** trash can forwarding optional ** - configurable whether to include spam in the forwarding
- 📚 ** forwarding history ** - supports viewing recent forwarding records and failure records
- ▶️ ** manually triggers ** - supports manual triggering of a forwarding check from the interface

#### Token refresh management
- 🔁 ** Full Refresh ** - Refresh all Outlook/Hotmail OAuth account Token with one click
- ✅ ** complete batch operation ** - You can directly batch refresh, copy, export, forward, proxy, label, move groups and delete accounts in the Token refresh management list
- 📄 ** paged browsing ** - Token refresh management list supports page number jump and quantity per page switching, suitable for scenarios with large number of accounts
- ⏰ ** regularly refreshes ** - supports configuration by days or Cron expressions, and will automatically take effect when Docker / Docker Compose is started
- 📊 ** refresh statistics ** - displays the number of failed mailboxes in real time
- 📜 ** refreshes history ** - complete records in the past half year

#### WebDAV backup
- 🗂️ ** All Group Backup ** - The backup file reuses the "Export All Groups" format, including ordinary mailbox and temporary mailbox group data
- ⏲️ **Cron scheduled upload ** - supports 5-segment Cron expression, and uses the application time zone in the general settings to calculate the next execution time
- 🧪 ** connection test ** - test files can be uploaded and cleaned on the settings page to verify whether the WebDAV directory is writable
- 🔐 ** Sensitive operation confirmation ** - When modifying backup settings and manually uploading real backups, the login password needs to be verified again

#### Security features
- 🛡️ XSS protection | 🔒 CSRF protection | 🔐 Data encryption | 🚦 Rate limit | 📋 Audit log | 🔑 Secondary verification

### Interface layout

The web application adopts a four-column layout design:
1. ** Group Panel ** - Displays all mailbox groups in a tree structure of up to three levels. Click to switch. When the parent group is selected, the sub-group account is included.
2. ** Email Panel ** - Displays the list of email accounts under the current group and its subgroups
3. ** mailing list ** - displays the mails in the selected mailbox, supports switching folders and scrolling loading
4. ** Email Details ** - Display the complete content of the selected email (supports HTML rendering)

## 📸 Interface preview

### Email list interface
[Upstream screenshot: Email list](https://raw.githubusercontent.com/assast/outlookEmail/main/img/%E9%82%AE%E7%AE%B1%E5%88%97%E8%A1%A8.png)

### Global search function
[Upstream screenshot: Global search](https://raw.githubusercontent.com/assast/outlookEmail/main/img/%E5%85%A8%E5%B1%80%E6%90%9C%E7%B4%A2.png)

### Import email account
[Upstream screenshot: Import email account](https://raw.githubusercontent.com/assast/outlookEmail/main/img/%E5%AF%BC%E5%85%A5%E9%82%AE%E7%AE%B1%E8%B4%A6%E5%8F%B7.png)

### Token refresh management
[Upstream screenshot: Refresh all tokens](https://raw.githubusercontent.com/assast/outlookEmail/main/img/%E5%85%A8%E9%87%8F%E5%88%B7%E6%96%B0token.png)

### Tag management function
[Upstream screenshot: Tag management](https://raw.githubusercontent.com/assast/outlookEmail/main/img/%E6%A0%87%E7%AD%BE%E7%AE%A1%E7%90%86.png)

## 📖 Instructions for use

### 1. Obtain the OAuth2 credentials (this step is not necessary. If the account purchased has a token, you can skip this step; the project itself also has a built-in default client ID. If you ignore this step, the default client ID will be used, and you can start directly from step 5 of this section)

To use this tool, you need to obtain the following OAuth2 credentials:

1. **Client ID** - Client ID for Microsoft Azure application registration
2. **Refresh Token** - OAuth2 refresh token

The OAuth2 helper in the interface reads `OAUTH_CLIENT_ID` and `OAUTH_REDIRECT_URI` when the service starts. If you configure your own values ​​in Docker / Docker Compose, these values ​​will be used for authorization links and token exchanges; if not configured, the project's built-in default values ​​will be used. When importing accounts, the Client ID must be used in conjunction with the Refresh Token swapped out for the same authorization.

#### Step 1: Register an Azure application (depending on the current situation, this step requires an E3 or E5 or other developer account to create)

Visit [Azure Portal](https://portal.azure.com/) and enter "Application Registration":

[Upstream screenshot: Application registration](https://raw.githubusercontent.com/assast/outlookEmail/main/img/%E5%BA%94%E7%94%A8%E6%B3%A8%E5%86%8C.png)

#### Step 2: Create a new app

Click "New Registration" and fill in the application information:

[Upstream screenshot: Register application](https://raw.githubusercontent.com/assast/outlookEmail/main/img/%E6%B3%A8%E5%86%8C%E5%BA%94%E7%94%A8%E7%A8%8B%E5%BA%8F.png)

- ** name **: Custom application name
- ** Supported account types **: Select "Accounts in any organizational directory and personal Microsoft accounts"
- ** redirect URI**: Select "Public Client/Local" and fill in `http://localhost:8080`

#### Step 3: Get the application ID

After creation, copy the "Application (Client) ID":

[Upstream screenshot: Get application ID](https://raw.githubusercontent.com/assast/outlookEmail/main/img/%E8%8E%B7%E5%8F%96%E5%BA%94%E7%94%A8%E7%A8%8B%E5%BA%8FID.png)

#### Step 4: Configure API permissions. This step can be omitted. The current built-in client ID can be used normally without setting this step.

The manual OAuth assistant uses GraphAPI single resource permissions by default to avoid Microsoft OAuth v2 from mixing Graph and Outlook resources in the same authorization. Times `AADSTS70011`:
- `offline_access` - Get refresh token
- `Mail.Read` / `Mail.ReadWrite` / `Mail.Send` / `User.Read` - Graph reading letters, managing emails, sending letters as the current account and basic user information

`Mail.Send` is the delegation authority required to write basic emails on the Web side. History Refresh Token cannot silently increase this permission; if you are prompted with insufficient permission when writing an email, please complete the `GraphAPI` authorization for the account again. Reauthorization will not affect existing email configurations.

If you need IMAP access, please select `IMAP authorization` in the "Outlook Email Authorization" panel (automatic authorization defaults to GraphAPI). Do not put it in the same manual authorization link as Graph permissions. IMAP authorization does not include `Mail.Send`, nor does it support basic writing of emails on the web side.

#### Step 5: Obtain Refresh Token

Use the built-in OAuth2 assistant of this tool to obtain the Refresh Token:

[Upstream screenshot: Exchange for token](https://raw.githubusercontent.com/assast/outlookEmail/main/img/%E6%8D%A2%E5%8F%96token.png)

1. Click the "Get Token" button in the web interface
2. Click "Generate Authorization Link"
3. Copy the link and open it in the browser to complete the authorization
4. Copy the complete URL after authorization (for security reasons, I did not build an authorization callback service in a unified manner. All authorizations are completed within the services deployed by myself and will not be leaked, so the redirect URI is http://localhost:8080. This link will definitely not be opened, so you need to copy it and exchange it for the Refresh Token in the second half of the deployed service)
5. Paste into the "Authorized URL" input box
6. Click the "Redeem Token" button
7. Copy the obtained Refresh Token

### 2. Import email account

After clicking "Import Mailbox" in the web interface, you can select the corresponding import format according to the mailbox type.

#### Outlook/Hotmail OAuth

Two formats are supported:

```txt
Email----Password----client_id----refresh_token
Email----Password----refresh_token----client_id
```

Example:

```txt
user@outlook.com----password123----24d9a0ed-8787-4584-883c-2fd79308940a----0.AXEA...
```

#### Standard IMAP mailbox

Applicable to Gmail, QQ, 163, 126, Yahoo, Alibaba Mailbox, etc.:

```txt
Email----IMAP authorization code/application password
```

Example:

```txt
user@gmail.com----app-password
user@qq.com----imap-auth-code
```

#### Custom IMAP

Two formats are supported:

```txt
Email----IMAP password
Email----IMAP password----imap_host----imap_port
```

Example:

```txt
user@example.com----app-password
user@example.com----app-password----imap.example.com----993
```

Support batch import, one account per line. The format of the imported file remains unchanged; the import pop-up window can uniformly set notes, labels, and status for this new account, and you can choose whether to turn on email forwarding immediately. Temporary mailbox groups cannot be selected when importing ordinary mailboxes.

Grouping supports up to three levels of hierarchy. When a parent group is selected, the email account list will display the accounts under this group and all sub-groups at the same time; if the sub-group does not have an agent configured, it will inherit the parent group agent upwards. Deleting a group containing subgroups will cascade delete the subgroups and move related accounts back to the default group.

#### Proxy and Resin `{mail}` template

Group or account proxy URLs may contain the literal `{mail}`. Outbound requests (pulling letters, Token refresh, Outlook automatic authorization, etc.) will be replaced by the email address `@` at runtime. Local-part: Remove non-alphanumeric characters and convert to lowercase. Configure the library as it is, and the editing echo will not be expanded.

Recommended example (Resin default port 2260, V1 sticky identity `Platform.Account:TOKEN`):

```text
socks5h://outlook.{mail}:yourToken@127.0.0.1:2260
```

When Token is empty, the following two options are available:

```text
socks5h://outlook.{mail}:@127.0.0.1:2260
socks5h://outlook.{mail}@127.0.0.1:2260
```

Description:

- It is recommended to give priority to `socks5h://` / `socks5://`; normal HTTP proxy may not be available for IMAP token requests
- Different email prefixes may collide after purification (such as `a.b` and `ab`). This behavior is accepted by this project
- Upload account automatic authorization: Prioritize uploading to record your own `proxy_url`, otherwise inherit the group proxy template
- By default, `LOG_LEVEL=INFO` will print `[Agent]` details (password coding) when pulling a message/Token refresh/automatic authorization. When there are many batch scene logs, set `LOG_LEVEL=WARNING` to reduce noise and close this type of INFO
- Friendly project: [Resin](https://github.com/Resinat/Resin)

### 3. Check email

1. Select a group from the left
2. Select email account
3. Click the "Get Email" button
4. Switch to "Inbox" and "Spam" in the web interface to view emails
5. Scroll to the bottom of the mailing list to automatically load the next page (20 messages per page)
6. Click the email to view details, supports HTML rendering and full-screen viewing
7. When you need to view the `deleteditems` or `all` aggregation results, it is recommended to use the external API or internal API

#### Basic writing of emails on the Web side

After selecting an enabled Outlook/Hotmail master account authorized by `GraphAPI`, "Write Mail" will be displayed at the top of the mail list. This function only supports sending plain text emails to one or more recipients as the current account itself:

- If the historical account is prompted to re-authorize, please complete the `GraphAPI` authorization again according to the above to obtain `Mail.Send`.
- When Microsoft Graph returns `202 Accepted`, the interface will display "Mail submitted for sending"; this means that the service has accepted the request, which does not mean that the recipient has been delivered.
- When the sending request encounters network timeout or connection interruption, the system will not automatically resend it to avoid repeated delivery; please confirm the result before deciding whether to resend it manually.
- Currently, IMAP/SMTP manual sending, temporary mailbox, alias or shared mailbox sending, attachments, HTML/rich text, draft, reply/forward, sent list, browser extension portal, external API, batch, scheduled or automated sending of mails are not supported.

### 4. Batch selection and batch operation

#### Email account list

There is a selection box on the left side of the email account list, which is suitable for refreshing tokens, copying email addresses, modifying forwarding status, labeling, moving groups, or deleting multiple accounts at the same time.

Common selection methods:

1. ** radio selection/cancel radio selection **: Click the selection box on the left side of the account.
2. ** Enter batch selection mode **: Click the "☑" button at the top of the mailbox panel. After the button is highlighted, you can click on the account row to toggle the selected state without clicking on the selection box.
3. ** continuous range selection **: First select an account, then hold down `Shift` and click on another account or selection box, and the continuous range between the two will be selected.
4. ** drag and drop to select **: After entering the batch selection mode, press and hold the mouse/trackpad on the account line or selection box and drag up or down to continuously select the passing accounts; if the starting account has been selected, this drag will batch unselect the passing accounts.
5. ** Select all current list **: Click "Select All" or "Select All Loaded" in the batch menu. When the account list is loaded in pages, this button only works on the accounts currently loaded into the page; after continuing to scroll down to load more, you can click again to select all loaded.
6. ** Clear selection **: Click "Clear selection" to cancel all selections in the current list.

After selecting at least one account, a batch menu will appear:

- PC: The menu floats to the right of the first selected account and repositions as the account list scrolls.
- Mobile: The menu is displayed at the bottom for easy touch operation.

Batch operations supported by ordinary email accounts:

- ** Refresh Token**: Only available for Outlook/Hotmail OAuth accounts; IMAP accounts cannot be refreshed, and the button will prompt the number of refreshes.
- ** Copy email + alias **: Copy the main email and configured alias of the selected account.
- ** export **: Export the selected accounts after secondary verification. It is suitable to filter by tag or search first and then export only the currently selected accounts.
- ** Enable forwarding/Cancel forwarding **: Batch modify the account-level forwarding switch. The global forwarding channel still needs to be configured in "Settings -> Email Forwarding Settings".
- ** tag + / tag - **: Add or remove a tag in batches for the selected account.
- ** move **: Move the selected account to the specified group.
- ** delete **: Permanently delete the selected account, you will confirm again before operation.

Temporary mailbox groups also use the same set of selection methods, but the batch menu only displays operations applicable to temporary mailboxes, such as copying mailboxes, adding/removing labels, and deleting; ordinary account-specific operations such as refreshing tokens, forwarding switches, and moving groups will be hidden.

When exporting by group, the accounts of the selected group and all its sub-groups will be included; if both the parent group and the sub-group are selected, the exported content will be automatically deduplicated.

#### Token refresh management list

The email list in "Token Refresh Management" also supports the same batch selection method:

1. Click "☑" at the head of the list to enter batch selection mode.
2. Select accounts through checkboxes, account row clicks, `Shift` continuous range selection, or drag and drop.
3. Click "Select All Current List" to select only the accounts that have been displayed after current filtering.
4. When searching for keywords or switching status filtering, the selected accounts will be cleared to avoid filtering other accounts by mistake.

After selecting the account, you can directly perform these batch actions:

- ** Refresh Token**: Continue to use Token to refresh the managed streaming task log, and you can view account-level progress and results.
- ** copy mailbox + alias / export **: reuse the copy and secondary verification export process of ordinary mailbox list.
- ** enables forwarding/cancel forwarding/agent/label+/label-/move/delete **: Reuse the ordinary email account batch interface. After completion, the Token will be refreshed synchronously to refresh the management list, main mailbox list and group count.

#### Mailing list

There is also a selection box on the left side of the mail list of ordinary mailboxes, which is suitable for batch processing of mails in the current mailbox:

1. Click the selection box on the left side of the email to select or uncheck a single email.
2. Click "Select All" to select the currently loaded mailing list.
3. Click "Clear Selection" to cancel the selected emails.
4. Click "Set as Read" to batch mark the selected unread emails as read; if all the selected emails have been read, this button will be disabled.
5. Click "Delete" to permanently delete the selected emails in batches. You will be asked to confirm again before operating.

Email batch selection only applies to emails that have been loaded in the current folder/aggregation view of the current mailbox; when switching mailboxes, refreshing the email list, or the list is empty, the selected emails will be cleared.

### 5. Alias management

1. Open the "Edit Account" of an email account
2. Fill in multiple aliases by row in the "Alias Mailbox"
3. After saving, both the primary email address and the alias will point to the same account.

Suitable for these scenarios:

- The same account has multiple registered email names
- Some sites use `user+tag@example.com`
- After the external mailbox is automatically forwarded to the project management mailbox, I hope to continue to use the original mailbox name to get mail.

### 6. Email forwarding

Email forwarding is divided into two levels of control:

1. ** account level switch **
   When importing an account or editing an account, choose whether to enable forwarding for the account
2. ** global forwarding settings **
   Configure in "Settings -> Email Forwarding Settings":
   - Polling interval
   - Email forwarding time range
   - Whether to forward spam emails
   - Forwarding channel (SMTP/Telegram)
   - SMTP/Telegram specific parameters

Additional explanation:

- Forwarding polling only processes mailboxes with "forwarding enabled in the account"
- A forwarding check can be triggered manually
- You can view recent forwarding history and failure records

### 7. WebDAV Backup

Configure in "Settings -> WebDAV Backup":

1. Fill in the WebDAV directory URL, such as `https://dav.example.com/backups`
2. Fill in the WebDAV username and password / App Password as required
3. Fill in 5 Cron expressions, such as `0 3 * * *`
4. Click "Calculate next execution time" to confirm the Cron preview. The time will use the application time zone in the general settings.
5. Click "Test WebDAV" to verify that the directory is writable; the test only uploads temporary test files and does not require a login password.
6. When modifying the backup settings, enter the login password in "Sensitive Operation Confirmation" and save it.

Additional explanation:

- Scheduled backup will upload a text file consistent with "Export all groups", with a file name in the form of `all_groups_backup_YYYYMMDD_HHMMSS.txt`
- Nut Cloud needs to create a dedicated directory first, and then fill in the directory URL, such as `https://dav.jianguoyun.com/dav/mailBackup`; do not just fill in `https://dav.jianguoyun.com/dav`
- "Manual upload" will immediately upload the real backup file, and you need to enter the login password
- WebDAV backup involves sensitive data such as accounts, tokens, temporary email credentials, etc. It is recommended to use a dedicated WebDAV directory and control access permissions

### 8. Browser extension (password version)

The Chrome/Edge Manifest V3 extension is built into the warehouse, and the directory is `browser-extension/`. The extension uses the web login password and does not require an external API Key.

Installation method:

1. Open the browser extension management page, such as `chrome://extensions/` or `edge://extensions/`
2. Turn on developer mode
3. Select "Load unpacked extension"
4. Select the `browser-extension` directory of this warehouse

How to use:

1. Click on the extension icon
2. Fill in the OutlookEmail service address and Web login password
3. Click "Save Configuration", or directly click the function entrance in the sidebar

The extension will provide a native operation panel in the browser sidebar, and the current web page tab will not be cut away. Functions such as Mailbox, Import, Refresh, Token, Export, Labels and Settings are now available directly. See [Browser extension usage instructions](browser-extension/README.en.md) for complete installation, configuration, functionality, and troubleshooting instructions.

### 9. External API

Get emails directly through API Key without logging into the web interface.

Current additional support:

- Use your primary mailbox or alias mailbox to get mail
- `folder=all` aggregates inbox and spam emails at once and sorts them in reverse order of normalized email time, `top` is calculated separately for each folder
- Support filtering the list by subject, sender, and keywords
- Support special character aliases, such as `user+alias@example.com`
- When querying the `@gmail.com` / `@googlemail.com` address, if the original suffix is not hit, it will automatically fall back to another suffix.
- Default `top=1`
- `skip` / `top` will do safe parsing: non-digits use default values, negative numbers are processed as `0`; `top` is the largest `50`

** configuration steps: **
1. Click "⚙️ Settings" → click "🔑 Randomly Generate" at "External API Key" → Save

** calling example: **
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

If the email address or alias contains special characters:

- `@` can be passed directly.
- `+` is recommended to be encoded as `%2B`
- `&` must be encoded as `%26`

If you automatically forward external mailbox B to mailbox A managed by this project, and then match B as an alias of A, then you can directly use B as the `email` parameter to call the external API.

See [API documentation](docs/en/api.md) for detailed documentation.

## 📚 Detailed documentation

| Document | Description |
|------|------|
| [🚀 Deployment Guide](docs/en/deployment.md) | Docker, Docker Compose, Nginx/Caddy deployment, environment variable configuration |
| [⬆️ Upgrade Guide](docs/en/upgrade.md) | Windows, Docker, Python direct upgrade and rollback suggestions |
| [🔐 Security configuration](docs/en/security.md) | XSS/CSRF protection, data encryption, rate limit, audit log |
| [🎭 Appearance skin](docs/en/skins.md) | System-level skin, zip upload, Git warehouse source, skin package format and persistence instructions |
| [📡 API Documentation](docs/en/api.md) | External simple API, complete API, proxy configuration |
| [🛠️ Troubleshooting](docs/en/troubleshooting.md) | Frequently asked questions and troubleshooting steps |
| [📋 Update log](CHANGELOG.md) | Version update history |
| [🚢 Release Notes](RELEASE.en.md) | Standard release steps, version number rules, GitHub Release instructions |
| [🛡️ Branch protection suggestions](BRANCH_PROTECTION.en.md) | main/dev usage boundaries, protection rules and build trigger recommendations |

## 🏗️Technical architecture

### Backend technology stack
- **Flask 3.0+** - Web Framework
- **SQLite 3** - Database
- **Requests / requests[socks]** - HTTP client and proxy support
- **IMAP4_SSL** - IMAP protocol support
- **Microsoft Graph API** - Outlook/Hotmail Mail API
- **APScheduler + croniter** - scheduled refresh and forwarding polling
- **bcrypt + cryptography** - Password hashing and sensitive field encryption

### Front-end technology stack
- ** native JavaScript** - no framework dependencies
- **CSS3** - Modern styling
- **Fetch API** - Asynchronous request
- **DOMPurify 3.0.8** - HTML Purification

### System requirements
- Python 3.9+
- SQLite 3
- Docker (optional)
- 2GB+ memory

## 📝 Dependency description

```txt
flask>=3.0.0
flask-wtf>=1.2.0 # CSRF protection (recommended installation)
werkzeug>=3.0.0
requests[socks]>=2.25.0 # HTTP requests and proxy support
APScheduler>=3.10.0 # Scheduled tasks
croniter>=1.3.0 # Cron expression parsing
bcrypt>=4.0.0 # Password hash
cryptography>=41.0.0 # Data encryption
```
## FAQ
### How to get the application password for Gmail
Turn on 2fa and create an application password here

https://support.google.com/mail/answer/185833?hl=zh-Hans


### How to get the group id and user id of tg
#### Get personal ID (User ID)
Search for @userinfobot or @getmyid_bot in the Telegram search box.

Click Start.

The bot will immediately reply with your User ID (a string of numbers).

If you want to know someone else’s ID: Just forward the message they sent you to the bot and it will display that user’s ID.


#### Get group ID (Group ID)
Pull the above bots (such as @getmyid_bot) into your group.

Enter /myid (or the command specified by the robot) in the group.

The bot returns the ID of the group.

Note: Ordinary group IDs usually start with a number, while the ID of the ** supergroup or channel ** usually starts with -100.

## 🤝 Contribution

Issues and Pull Requests are welcome!

```bash
git clone https://github.com/assast/outlookEmail.git
cd outlookEmail
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python web_outlook_app.py
```

## 📄 License

MIT License - see [LICENSE](LICENSE) for details

## 🙏 Acknowledgments
This project has been released on [LINUX DO community](https://linux.do/). Thanks to the community for its support and feedback.

- [Microsoft Graph API](https://docs.microsoft.com/graph/)
- [GPTMail](https://mail.chatgpt.org.uk)
- [Flask](https://flask.palletsprojects.com/)
- [Resin](https://github.com/Resinat/Resin) — High-performance sticky proxy pool gateway

## ⭐ Star History

[![Star History Chart](https://star-history.dera.page/svg?repos=assast/outlookEmail&type=Date)](https://star-history.dera.page/#assast/outlookEmail&type=Date)

---

**⭐ If this project is helpful to you, please give a star to support it! Your Star is my motivation to keep updating! ** ⭐

Maintenance of a project for the first time. It was only at 15:45:33 on April 11, 2026 that I discovered that several pulls were not merged. I am very sorry. This is my contact information. If I don’t see it, you can remind me. If you have any good suggestions, you can also give them. Thank you ~
Email: u3794336@outlook.com

## Disclaimer
This project is only for learning, research and technical exchange. Please abide by the relevant platform and service terms and do not use it for illegal, abusive or illegal purposes.
Any risks and consequences arising from the use of this project are borne by the user.
