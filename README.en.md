> This fork: portable Windows build with English/Russian. See [installation instructions](README.md). The manual below describes upstream features.

#Multiple mailbox email management tools

An email management tool for multiple email account scenarios. It supports unified reading, management and forwarding of emails through Outlook/Hotmail OAuth, Microsoft Graph API and standard IMAP. It also provides a web interface and Chrome/Edge browser extension for group management, account management, email viewing and external API calls. Currently supports Outlook/Hotmail, Gmail, QQ, 163, 126, Yahoo, Alibaba mailbox and custom IMAP mailboxes, and also integrates GPTMail, DuckMail, Cloudflare Temp Email multi-provider temporary mailbox capabilities.

Note: Changing the password will cause the auth to become invalid and require re-authorization.
## 📦 Quick Start
### Experience site (may not be the latest version)
https://aso.de5.net
admin123
Note: Please do not change the password or store actual data on the experience site. If it is deployed on a non-persistent service, the data may be lost and restored to the initial state at any time; and since everyone can log in and see it, and there seems to be a process scanning, there is a very high risk of account theft.

## 🌿 Version management and release

This project adopts lightweight dual-branch version management: `main` is the stable release branch, and `dev` is the daily development branch.

Complete release steps, workflow behaviors, and checklists are available in Release Notes (RELEASE.md).

### Method 1: Download Windows `exe` (win available)

Download the corresponding version of `OutlookEmail-windows-x64-*.zip` from GitHub Releases, decompress it and run `OutlookEmail.exe` directly.

After the Windows desktop version finds a new version, you can click "Upgrade Now" in the version entry at the top of the page. After confirmation, the application will download the existing Release ZIP to the directory where the current EXE is located, display the download percentage and speed, and automatically replace and restart after completion; the download phase can be canceled.

The desktop version will automatically:

- Generate and persist `SECRET_KEY`
- Create local data directory and SQLite database
- Start the Web service, default address `http://127.0.0.1:5000`

Description:

- Windows data is saved in `%APPDATA%\OutlookEmail` by default
- Online upgrade requires that the directory where the current EXE is located is writable, and administrator permissions will not be applied for. If the directory is not writable, please move the program to a normal writable directory first.
- If the new version fails to start, it will automatically restore the old version; if there is a power outage during the upgrade, you can manually change `*.old.exe` in the same directory back to the original file name to restore it.
- The default login password is still `admin123`. It is recommended to change it immediately after logging in for the first time.

### Method 2: Download the macOS installation package

Download `OutlookEmail-macos-*-*.dmg` of the corresponding architecture from GitHub Releases, open it and drag `OutlookEmail.app` to `Applications`.

The desktop version will automatically:

- Generate and persist `SECRET_KEY`
- Create local data directory and SQLite database
- Start the Web service, default address `http://127.0.0.1:5000`

Description:

- macOS data is saved in `~/Library/Application Support/OutlookEmail` by default
- If macOS prompts that Apple cannot verify whether "OutlookEmail" contains malware that may compromise Mac security or leak privacy. You can execute the following command and try again
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
If it is a server deployment, it is still recommended to set the fixed `SECRET_KEY` explicitly.

### Operation mode

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
By default, the application will automatically retry according to this version when the daemon clearly returns the "minimum supported API version"; if your Docker environment or socket agent has special compatibility requirements, you can also explicitly set `DOCKER_UPDATE_API_VERSION`, and its value can be referred to the output of `docker version --format '{{.Server.APIVersion}}'`.
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
      # Optional: Let the interface OAuth helper use your own Azure application
      # - OAUTH_CLIENT_ID=your-azure-application-client-id
      # - OAUTH_REDIRECT_URI=http://localhost:8080
    restart: unless-stopped
```

### Method 5: Build and run local source code (docker-compose.build.yml)

It is suitable to run after the local machine builds the image based on the source code (rather than pulling the pre-built image on `ghcr.io`), which facilitates immediate verification after local changes.

The warehouse root directory has provided `docker-compose.build.yml`, which will use `Dockerfile` in the root directory to build the image from the source code and start the container.

#### Step 1: Prepare environment variable file `.env.local`

`docker-compose.build.yml` injects environment variables through `env_file: .env.local`. If the file** does not exist, Compose will directly report an error and refuse to start**. You need to copy and modify it from the template first:

```bash
cp .env.example .env.local
```

Modify at least two of the following:

```bash
# Generate a random string and fill in the SECRET_KEY of .env.local
python -c 'import secrets; print(secrets.token_hex(32))'
```

- `SECRET_KEY`: Fill in the random string generated above (be sure to modify it, do not use placeholder values; the leading and trailing blanks will be ignored)
- `LOGIN_PASSWORD`: The login password during first initialization, the default is `admin123`, it is recommended to change it to a strong password; changing this variable after it has been written to the database will not overwrite the current password. If you forget your password, please use `scripts/reset_login_password.py` (see [Troubleshooting](docs/troubleshooting.md) / [Security Configuration](docs/security.md))

Optional: If you need to adjust the number of Gunicorn threads/timeout, add `GUNICORN_THREADS` and `GUNICORN_TIMEOUT` to `.env.local` (if left blank, use the default value of 4 / 300).

Optional: The overall timeout for reading mail lists in ordinary Outlook/IMAP mailboxes defaults to 120 seconds, which can be adjusted in "System Settings -> General Settings -> Mail Fetch Timeout" (30-300 seconds); you can also set the initial value through `MAIL_FETCH_OVERALL_TIMEOUT` of `.env.local` before starting for the first time. This value should be less than `GUNICORN_TIMEOUT` (default 300 seconds).

#### Step 2: Build and launch

```bash
docker compose -f docker-compose.build.yml up -d --build
```

- `--build` forces the image to be rebuilt from the source code (the image label is `outlookemail:local`)
- The container name is `outlook-mail` and the mapped port is `5000:5000`
- Data persistence is on the host machine `./data`; `./static` and `./templates` are mounted in read-only mode, which facilitates local editing of templates/static resources to take effect in real time

After startup, access `http://localhost:5000` and log in using `LOGIN_PASSWORD` in `.env.local`.

#### Step 3: Common operation and maintenance commands

```bash
# View log
docker compose -f docker-compose.build.yml logs -f

# View health check and status
docker compose -f docker-compose.build.yml ps

# Rebuild and restart after changing the source code
docker compose -f docker-compose.build.yml up -d --build

# Stop and remove the container (data remains in ./data)
docker compose -f docker-compose.build.yml down
```

> Tip: `docker-compose.build.yml` does not mount the host Docker socket by default, so the "Docker Online Update" in the interface is not available - for local build scenarios, please directly use the `up -d --build` rebuild above to update.

## ✨ Features

### Email reading method

This tool currently contains three types of read links:

1. **Outlook/Hotmail OAuth + Graph API** - Priority method, suitable for Outlook / Hotmail / Live accounts
2. **Outlook/Hotmail OAuth + IMAP Fallback** - `outlook.live.com` / `outlook.office365.com`
3. **Standard IMAP** - Applicable to Gmail, QQ, 163, 126, Yahoo, Alibaba Mailbox and custom IMAP

#### Ordinary mailbox local retention behavior and restrictions

Ordinary mailbox local retention switch `normal_mail_local_retention_enabled` is turned off by default. Users need to explicitly turn it on in the system settings before ordinary Outlook/Hotmail and standard IMAP mailboxes can save list metadata and part of the text that has been viewed and completed to the local SQLite.

When turned on, the ordinary mailbox list will be loaded from the local retained data first, and the most recently retained email list will be displayed immediately when hit; if you continue to scroll down to load more in local priority mode, the local retained paging will also be used, so when the remote is unavailable, you can still view the retained emails beyond the first screen. The page will also continue to initiate remote synchronization to Graph API or IMAP in the background. After successful remote synchronization, the new list metadata will be written back to the local retention library; when synchronization fails, the current page will retain the local list and display a background synchronization failure prompt without clearing the list.

When background synchronization discovers new emails that have not yet been displayed locally, the page will display a non-interruptive prompt of "N new emails have been synchronized." New emails will not be merged into the current list immediately after successful synchronization; new emails will be merged into the current list only after the user clicks on the prompt, and background completion of highlighting, list cache updates, and new email body retention will be performed to prevent emails being read or selected from being suddenly replaced.

The email details will give priority to the reserved body content; if the local row does not have the body content, the body content will be backfilled with the retained data after the remote details are successfully read, for subsequent viewing when the page is refreshed, the application is restarted, or temporary network failure occurs. If the remote details fail but the local text already exists, the details page will display the local retained text as a fallback. Keyword filtering will also first check the cached text, and only if the cache is missing, the remote details will be read.

Standard IMAP and Outlook/Hotmail OAuth IMAP lists uniformly return `id_mode=uid`. When the server returns UIDVALIDITY, the email ID is `imap:<UIDVALIDITY>:<UID>`; when calling the details, original email, attachment, read and delete interfaces, please return it as it is without converting it into a number. The serial number is only used for paging within the current connection and is no longer used as a cross-request email ID; the old `id_mode=sequence` request will prompt to refresh the list, and the same number will not be used to fall back on reading other emails when the UID does not exist.

After the upgrade, the old serial number and the IMAP cache that is not bound to UIDVALIDITY will be marked as invalid at one time and rebuilt through remote synchronization; the original cache text record will be retained in the database for recovery, and the Graph cache, account number, and remote mail will not be affected. Old API clients should re-fetch the list and not just change the old record's `id_mode` from `sequence` to `uid`.

At this stage, only the general mailbox list metadata and the read detail text are retained, and the download or retention of attachment binary and original MIME content is not included; attachment download still relies on the current remote provider link. The settings page displays the number of saved messages, number of cached bodies, estimated retention size, and current SQLite database size, and provides a separate "clear cache" action. When the local retention switch is turned off, the interface will first ask for confirmation; after confirmation, the local retention data of the ordinary mailbox will be deleted through a background cleanup task and the cleanup status will be displayed. Cleanup tasks reject repeated starts, limited retries on SQLite ephemeral locks, and front-end status polling uses backoff intervals to reduce pressure on long tasks. See [`docs/local-mail-retention.md`](docs/local-mail-retention.md) for a more complete scope description.

### Web application functions

#### Core functions
- 🔐 **Login Verification** - Password-protected Web interface, supports online password modification; if you forget your password, you can use the official script `scripts/reset_login_password.py` to reset it (see [Troubleshooting](docs/troubleshooting.md))
- 📁 **Group Management** - Supports up to three levels of tree mailbox grouping, creation, editing, folding and expansion, same-level sorting, cross-level drag and drop movement and cascade deletion
- 🌐 **Account/Group Proxy** - Each group can be configured with an HTTP/SOCKS5 proxy, and subgroups can inherit the parent proxy. A single account can also set a proxy and override the group proxy first; the proxy URL supports the `{mail}` placeholder (interconnected with sticky proxy pools such as [Resin](https://github.com/Resinat/Resin))
- 📧 **Multiple Email Management** - Batch import and manage Outlook/Hotmail OAuth / IMAP email accounts
- 🪪 **Alias Management** - Supports configuring multiple alias mailboxes for a single mailbox. Both the main mailbox and aliases can be used to retrieve emails and call external APIs
- 🔀 **Advanced usage of aliases** - You can automatically forward the external mailbox to the mailbox A managed by this project, and then configure the external mailbox as an alias of A, so that the mails can be read uniformly through this project
- 📬 **Mail View** - Web interface supports viewing inbox and spam; API supports `inbox`, `junkemail`, `deleteditems`, `all`
- 🔗 **Email Sharing Link** - You can create a limited-time or permanent read-only sharing link, and you can choose to display only the latest `1–50` emails in your inbox and spam respectively.
- ✉️ **Basic email writing** - Outlook/Hotmail accounts that have completed Graph authorization can send plain text emails as themselves on the Web.
- 📎 **Attachment Download** - Email details support single attachment download, and also support packaging all attachments as ZIP downloads
- 🔍 **Full Screen View** - Supports viewing emails in full screen mode
- 📤 **Export function** - Supports exporting email account information by group tree, selected account or all
- 🧩 **WebDAV Backup** - Supports scheduled uploading of "Export All Groups" files to WebDAV by Cron, or manual uploading
- 🎨 **Modern UI** - Four-column layout with clear partitions for account list, mailing list, and mail details
- 🎭 **System-level appearance skin** - Supports built-in classic, custom zip skin package and Git warehouse source; all login devices will be consistent after switching
- ⚡ **Performance Optimization** - Mail list and account list caching, group switching and account switching are faster
- 📄 **Page Loading** - Scroll to the bottom to automatically load the next page (20 letters per page)
- 🔥 **Temporary Email** - Integrate GPTMail + DuckMail + Cloudflare Temp Email, multiple providers can generate, import, read, and view details; Cloudflare supports multi-channel configuration, each Worker/administrator password/mail pool is independently managed, and all emails can be viewed by channel
- ⚙️ **System Settings** - Change password, API Key, email acquisition timeout, etc. online
- 🔄 **OAuth2 Assistant** - Built-in authorization process to quickly obtain Refresh Token
- 💾 **Mail Caching** - Intelligent caching of mail lists, switching for instant display; local retention of ordinary mailboxes is turned off by default, and can be turned on, viewed statistics and clear the local retention cache on the settings page
- 🏷️ **Label Management** - Supports labeling mailboxes, batch operations, and filtering by labels
- 🧮 **Project Management** - Receive/return mailboxes (independent state machines) according to project dimensions. The entrance is hidden by default. You can create projects from the web page, view each status count, deactivate/restore and delete after opening "Settings → General Settings"
- 📦 **Batch Move Groups** - Batch select mailboxes to move to any common group level
- ✅ **Batch Selection** - Email lists and mailing lists support selecting all of the current list and clearing selections
- 🗑️ **Email deletion** - single/batch permanent deletion; supported by both Graph and IMAP (including standard IMAP account, OAuth IMAP fallback)
- 🔄 **API priority fallback** - Outlook OAuth default Graph API → IMAP (new) → IMAP (old); the preferred channel can be recorded by account, and it will automatically fall back after failure and remember the actual successful channel
- 🔑 **External API** - Obtain emails directly through API Key without logging in. Supports alias mailboxes, aggregated folders and multi-condition filtering. Additional email addresses with a + sign are automatically recognized and automatically fall back to the main mailbox/alias mailbox query; if the required function is relatively complete, it is recommended to directly connect to the complete API. The document has been changed to a shape suitable for AI reading. Directly feed it to the AI and let the AI use the login password instead of the API Key according to the complete API.

#### Email forwarding
- 📮 **Associated notifications by source** - Active mailboxes are configured with automatic notifications by account or group, no need to enable additional forwarding
- 📨 **Multi-channel forwarding** - Supports multiple SMTP, Telegram, Enterprise WeChat and Feishu targets, and is notified separately by specific email address, group or CF domain name
- 👥 **Actual Recipients** - The forwarding summary displays the actual recipients and CC addresses of the email to facilitate identification of alias recipients.
- 🔎 **Keyword Filter** - You can set one keyword per line. Only forward if the topic or complete text hits any keyword, leave it blank to forward all
- ⏱️ **Time Window Control** - Supports forwarding only emails received within the last X minutes
- 🗑️ **Trash forwarding optional** - Configurable whether to forward spam emails together
- 📚 **Forwarding History** - Supports viewing recent forwarding records and failure records
- ▶️ **Manual Trigger** - Supports manual triggering of a forwarding check from the interface

#### Token refresh management
- 🔁 **Full Refresh** - Refresh all Outlook/Hotmail OAuth account Tokens with one click
- 🔄 **Rotation Result** - Distinguish between Token updated and verified successfully but not rotated, refresh the log to permanently record the rotation results, and display the two types of quantities in the batch completion prompt
- 🕒 **Refresh time** - Displays the latest refresh, the latest successful refresh and the latest rotation respectively; non-rotation can also be regarded as a successful refresh, and failure will not overwrite the last successful time
- ✅ **Complete batch operations** - You can directly batch refresh, copy, export, forward, proxy, label, move groups and delete accounts in the Token refresh management list
- 📄 **Page browsing** - Token refresh management list supports page number jump and number per page switching, suitable for scenarios with large number of accounts
- ⏰ **Scheduled refresh** - Supports configuration by days or Cron expressions, and will automatically take effect when Docker / Docker Compose is started
- 📊 **Refresh statistics** - Display the number of failed mailboxes in real time
- 📜 **Refresh history** - complete records in the past half year

#### WebDAV Backup
- 🗂️ **All Group Backup** - The backup file reuses the "Export All Groups" format, including ordinary mailbox and temporary mailbox group data
- ⏲️ **Cron scheduled upload** - Supports 5-segment Cron expressions and uses the application time zone in general settings to calculate the next execution time
- 🧪 **Connection Test** - You can upload and clean test files on the settings page to verify whether the WebDAV directory is writable
- 🔐 **Sensitive Operation Confirmation** - When modifying backup settings and manually uploading real backups, the login password needs to be verified again

#### Security features
- 🛡️ XSS protection | 🔒 CSRF protection | 🔐 Data encryption | 🚦 Rate limit | 📋 Audit log | 🔑 Two-step verification

### Interface layout

The web application adopts a four-column layout design:
1. **Group Panel** - Displays all mailbox groups in a tree structure of up to three levels. Click to switch. When the parent group is selected, the sub-group account is included.
2. **Email Panel** - Displays the list of email accounts under the current group and its subgroups
3. **Mail List** - Displays emails from the selected mailbox, supports switching folders and scrolling loading
4. **Email Details** - Display the complete content of the selected email (supports HTML rendering)

## 📸 Interface preview

### Email list interface
[Upstream screenshot: Email List](https://raw.githubusercontent.com/assast/outlookEmail/v3.0.32/img/%E9%82%AE%E7%AE%B1%E5%88%97%E8%A1%A8.png)

### Global search function
[Upstream screenshot: Global Search](https://raw.githubusercontent.com/assast/outlookEmail/v3.0.32/img/%E5%85%A8%E5%B1%80%E6%90%9C%E7%B4%A2.png)

### Import email account
[Upstream screenshot: Import email account](https://raw.githubusercontent.com/assast/outlookEmail/v3.0.32/img/%E5%AF%BC%E5%85%A5%E9%82%AE%E7%AE%B1%E8%B4%A6%E5%8F%B7.png)

### Token refresh management
[Upstream screenshot: Full Refresh Token](https://raw.githubusercontent.com/assast/outlookEmail/v3.0.32/img/%E5%85%A8%E9%87%8F%E5%88%B7%E6%96%B0token.png)

### Tag management function
[Upstream screenshot: Tag management](https://raw.githubusercontent.com/assast/outlookEmail/v3.0.32/img/%E6%A0%87%E7%AD%BE%E7%AE%A1%E7%90%86.png)

## 📖 Instructions for use

### 1. Obtain OAuth2 credentials (this step is not necessary. If the account purchased has a token, you can skip this step; the project itself also has a built-in default client ID. If you ignore this step, the default client ID will be used, and you can start directly from step 5 of this section)

To use this tool, you need to obtain the following OAuth2 credentials:

1. **Client ID** - The client ID registered by the Microsoft Azure application
2. **Refresh Token** - OAuth2 refresh token

The OAuth2 helper in the interface reads `OAUTH_CLIENT_ID` and `OAUTH_REDIRECT_URI` when the service starts. If you configure your own values ​​in Docker / Docker Compose, these values ​​will be used for authorization links and token exchanges; if not configured, the project's built-in default values ​​will be used. When importing accounts, the Client ID must be used in conjunction with the Refresh Token swapped out for the same authorization.

#### Step 1: Register Azure application (depending on the current situation, this step requires an E3 or E5 or other developer account to create)

Visit [Azure Portal](https://portal.azure.com/) and enter "Application Registration":

[Upstream screenshot: Application Registration](https://raw.githubusercontent.com/assast/outlookEmail/v3.0.32/img/%E5%BA%94%E7%94%A8%E6%B3%A8%E5%86%8C.png)

#### Step 2: Create a new application

Click "New Registration" and fill in the application information:

[Upstream screenshot: Register Application](https://raw.githubusercontent.com/assast/outlookEmail/v3.0.32/img/%E6%B3%A8%E5%86%8C%E5%BA%94%E7%94%A8%E7%A8%8B%E5%BA%8F.png)

- **Name**: Custom application name
- **Supported account types**: Select "Accounts in any organizational directory and personal Microsoft accounts"
- **Redirect URI**: Select "Public Client/Local" and fill in `http://localhost:8080`

#### Step 3: Get the application ID

After creation, copy the "Application (Client) ID":

[Upstream screenshot: Get Application ID](https://raw.githubusercontent.com/assast/outlookEmail/v3.0.32/img/%E8%8E%B7%E5%8F%96%E5%BA%94%E7%94%A8%E7%A8%8B%E5%BA%8FID.png)

#### Step 4: Configure API permissions. This step should be omitted. The current built-in client ID can be used normally without setting this step.

The manual OAuth assistant uses GraphAPI single resource permissions by default to avoid Microsoft OAuth v2 from mixing Graph and Outlook resources in the same authorization. Times `AADSTS70011`:
- `offline_access` - Get refresh token
- `Mail.Read` / `Mail.ReadWrite` / `Mail.Send` / `User.Read` - Graph reading letters, managing emails, sending letters as the current account and basic user information

`Mail.Send` is the delegation authority required to write basic emails on the Web side. History Refresh Token cannot silently increase this permission; if you are prompted with insufficient permission when writing an email, please complete the `GraphAPI` authorization for the account again. Reauthorization will not affect existing email configurations.

When adding or editing an Outlook/Hotmail account, you can select automatic, `.default`, read-only, full permissions or custom through "Token Scope". The automatic mode remembers the most recent successful scope in the process, and the old cache will be cleared when the configuration is modified or restored to automatic; the account configuration is also applied to background forwarding. Scope is the parameter preference in exchange for Token. For sending messages, deleting and marking as read, candidates will be selected according to the required permissions. The actual permissions are still determined by Microsoft authorization.

If you need IMAP access, please select `IMAP authorization` in the "Outlook Email Authorization" panel (automatic authorization defaults to GraphAPI). Do not put it in the same manual authorization link as Graph permissions. IMAP authorization does not include `Mail.Send`, nor does it support basic writing of emails on the web side.

#### Step 5: Obtain Refresh Token

Use the built-in OAuth2 assistant of this tool to obtain the Refresh Token:

[Upstream screenshot: Exchange for token](https://raw.githubusercontent.com/assast/outlookEmail/v3.0.32/img/%E6%8D%A2%E5%8F%96token.png)

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

iCloud supports `imap.mail.me.com:993` and App-specific passwords, and provides an independent Apple main account, hidden email address management, and optional automatic re-login. See the iCloud Instructions for Use (docs/icloud.md) for configuration, email quarantine, backup, and downgrade steps. Apple private agreements and long-term renewals still require real account acceptance.

Applicable to Gmail, QQ, 163, 126, Yahoo, Alibaba Mailbox, etc.:

```txt
Email----IMAP authorization code/application password
```

Example:

```txt
user@gmail.com----app-password
user@qq.com----imap-auth-code
```

#### Customize IMAP

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

Supports batch import, one account per line. The format of the imported file remains unchanged; the import pop-up window can uniformly set notes, labels and status for the new account, and notify the effective rules of the group where it is automatically used. Temporary mailbox groups cannot be selected when importing ordinary mailboxes.

Grouping supports up to three levels of hierarchy. When a parent group is selected, the email account list will display the accounts under this group and all sub-groups at the same time; if the sub-group does not have an agent configured, it will inherit the parent group agent upwards. Deleting a group containing subgroups will cascade delete the subgroups and move related accounts back to the default group.

#### Agent and Resin `{mail}` template

The group or account proxy URL can contain the literal `{mail}`. Outbound requests (pulling letters, Token refresh, Outlook automatic authorization, etc.) will be replaced by the email address `@` at runtime. Local-part: Remove non-alphanumeric characters and convert to lowercase. Configure the library as it is, and the editing echo will not be expanded.

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

- Recommended to prioritize `socks5h://` / `socks5://`; normal HTTP proxy may not be available for IMAP token requests
- Different email prefixes may collide after purification (such as `a.b` and `ab`), this project accepts this behavior
- Upload account automatic authorization: Prioritize uploading to record your own `proxy_url`, otherwise inherit the group agent template
- By default, `LOG_LEVEL=INFO` will print `[Agent]` details (password coding) when pulling messages/Token refresh/automatic authorization. When there are many batch scene logs, set `LOG_LEVEL=WARNING` to reduce noise and close this type of INFO
- Friendly project: [Resin](https://github.com/Resinat/Resin)

### 3. Check email

1. Select the group from the left
2. Select email account
3. Click the "Get Email" button
4. Switch to "Inbox" and "Spam" on the web interface to view emails.
5. Scroll to the bottom of the mailing list to automatically load the next page (20 messages per page)
6. Click the email to view details, supports HTML rendering and full-screen viewing
7. When you need to view the `deleteditems` or `all` aggregation results, it is recommended to use the external API or internal API

#### Basic writing of emails on the Web side

After selecting an enabled Outlook/Hotmail master account authorized by `GraphAPI`, "Write Mail" will be displayed at the top of the mail list. This function only supports sending plain text emails to one or more recipients as the current account itself:

- If the historical account is prompted to re-authorize, please complete the `GraphAPI` authorization again as above to obtain `Mail.Send`.
- When Microsoft Graph returns `202 Accepted`, the interface will display "Mail submitted for sending"; this means that the service has accepted the request, which does not mean that the recipient has been delivered.
- When the sending request encounters network timeout or connection interruption, the system will not automatically resend it to avoid repeated delivery; please confirm the result before deciding whether to manually resend it.
- Currently IMAP/SMTP manual sending, temporary mailbox, alias or shared mailbox sending, attachments, HTML/rich text, draft, reply/forward, sent list, browser extension portal, external API, batch, scheduled or automated sending of mails are not supported.

#### Email sharing link

A revocable read-only link can be created in the sharing operation of the email account. When creating, you can choose "Unlimited" or "Only the latest N messages"; the latter can be set to `1-50`, and the inbox and spam will only display the latest N messages (whichever folder is opened).

- Servers that do not support SORT, such as Gmail and Outlook IMAP, will read the UID and INTERNALDATE metadata in batches and verify the "latest N" based on the actual email time; importing old emails will not expand the visibility range due to larger UIDs. Verification of large mailboxes may be slower, and incomplete data or timeouts may continue to deny access.
- From 3.0.29 onwards, the old restricted links also take effect according to "N seals per folder", and a maximum of 2N seals can be accessed; if you do not accept the new visibility range, please revoke the relevant links before upgrading.
- Optional setting access code: `4–32` English letters or numbers, case-sensitive; leave it blank or existing links without access codes can still be accessed directly. Once set up, visitors must be authenticated to view email information, mailing lists and details.
- You can copy the link and access code after successful creation. The access code is only displayed when creating it, please save it yourself; sharing management only shows whether the access code is set. If you forget it, please cancel the old link and create it again.
- The same browser session will remember the 20 most recently verified shared links; after the access code is entered incorrectly 5 times in a row, the IP will suspend verification for this link for 5 minutes. After verification, you are still subject to the validity period, revocation status and email quantity limit.
- "Latest N Only" is a dynamic window: after new messages arrive, older messages may no longer be visible through the link.
- The restricted link that never expires will continue to display the latest N emails in the future; please cancel the link in the sharing management when you no longer need it.
- The restriction only restricts the number of accessible emails, and does not desensitize the email body, attachment metadata, etc. that are allowed to be viewed.

### 4. Batch selection and batch operation

#### Email account list

There is a selection box on the left side of the email account list, which is suitable for refreshing tokens, copying email addresses, modifying forwarding status, labeling, moving groups, or deleting multiple accounts at the same time.

Common selection methods:

1. **Single selection/cancel single selection**: Click the selection box on the left side of the account.
2. **Enter batch selection mode**: Click the "☑" button at the top of the mailbox panel. After the button is highlighted, you can click on the account row to toggle the selected state without clicking on the selection box.
3. **Continuous range selection**: First select an account, then hold down `Shift` and click on another account or selection box, and the continuous range between the two will be selected.
4. **Drag selection**: After entering the batch selection mode, hold down the mouse/trackpad on the account row or selection box and drag it up or down to continuously select the passing accounts; if the starting account has been selected, this drag will batch unselect the passing accounts.
5. **Select all current list**: Click "Select All" or "Select All Loaded" in the batch menu. When the account list is loaded in pages, this button only works on the accounts currently loaded into the page; after continuing to scroll down to load more, you can click again to select all loaded.
6. **Clear Selection**: Click "Clear Selection" to cancel all selections in the current list.

After selecting at least one account, a batch menu will appear:

- PC: The menu floats to the right of the first selected account and repositions as the account list scrolls.
- Mobile: The menu is displayed at the bottom for easy touch operation.

Batch operations supported by ordinary email accounts:

- **Refresh Token**: Only available for Outlook/Hotmail OAuth accounts; IMAP accounts cannot be refreshed, and the button will prompt you with the number that can be refreshed.
- **Copy Email+Alias**: Copy the primary email address and configured alias of the selected account.
- **Export**: Export the selected account after the second verification. It is suitable to filter by label or search first and then export only the currently selected account.
- **Notification Configuration**: Select multiple mailboxes, groups or workers in "More Functions -> Email Forwarding -> Forwarding Rules" at the top to uniformly specify notification channels or turn off notifications; the mobile version entrance is in the "Operation" menu.
- **Tag+ / Tag-**: Add or remove a tag in batches for the selected account.
- **Move**: Move the selected account to the specified group.
- **Enable Account/Deactivate Account**: Modify account status in batches, retain passwords, tokens and project records. Deactivated accounts will no longer participate in new project collection, token refresh and automatic forwarding; when you need to reuse them, you can select them on the homepage and enable them in batches.
- **Delete**: Permanently delete the selected account and will confirm again before operation.

Temporary mailbox groups also use the same set of selection methods, but the batch menu only displays operations applicable to temporary mailboxes, such as copying mailboxes, adding/removing labels, and deleting; ordinary account-specific operations such as refreshing tokens and moving groups will be hidden.

When exporting by group, the accounts of the selected group and all its sub-groups will be included; if both the parent group and the sub-group are selected, the exported content will be automatically deduplicated.

#### Token refresh management list

The email list in "Token Refresh Management" also supports the same batch selection method:

1. Click the "☑" at the head of the list to enter batch selection mode.
2. Select the account through check box, click on the account line, `Shift` continuous range selection or drag and drop.
3. Click "Select All Current List" to select only the accounts that have been displayed after current filtering.
4. When searching for keywords or switching status filtering, the selected accounts will be cleared to avoid accidentally filtering other accounts.

After selecting the account, you can directly perform these batch actions:

- **Refresh Token**: Continue to use Token to refresh the managed streaming task log to view account-level progress and results.
- **Copy Email+Alias/Export**: Reuse the copy and secondary verification export process of the ordinary email list.
- **Deactivate accounts**: You can first filter the accounts that failed to refresh, and then select the accounts that need to be deactivated for batch operation. After deactivation, it will be removed from the Token refresh management list and can still be found on the homepage and enabled in batches.
- **Agent/Tag+/Tag-/Move/Delete**: Reuse the ordinary email account batch interface. After completion, the Token will be refreshed synchronously to refresh the management list, main email list and group count.

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
2. Fill in multiple aliases by row in the "Alias ​​Mailbox"
3. After saving, the main email address and alias will point to the same account

Suitable for these scenarios:

- The same account has multiple registered email names
- Some sites use `user+tag@example.com`
- After the external mailbox is automatically forwarded to the project management mailbox, I hope to continue to use the original mailbox name to get mail.

### 6. Email forwarding

Open "Mail Forwarding" under "Project Management" in the "More Functions" drop-down menu at the top ("Operation" menu on the mobile phone), or directly access `/forwarding`. Forwarding management is independent of system settings. Rules, channels and delivery history are displayed in tables; polling parameters are saved separately in "Run Settings", and email filtering conditions are configured in each rule and will not be overwritten by saving system settings. First configure the **notification channel**, then add the **forwarding rule**, and finally confirm the destination of the notification through preview:

1. **Notification Channel**: Create a named SMTP, Telegram, Business WeChat or Feishu target. Multiple targets of the same type can be created, multiple channels can be selected from one source, or one channel can be shared by multiple sources. The credentials are encrypted and saved. The new channel form only displays the configured tags and leaves them blank to retain the original values. The current draft is used for testing and is not automatically saved.
2. **Common mailbox source**: Press "Specific account → Immediate and ancestor group → Common default configuration" to select the most recent clear configuration. Mailboxes and subgroups that are not separately configured automatically use the upper-level configuration, and there is no need to choose to inherit or enable additional forwarding; the notification method can specify the channel or turn off the notification. "Delete forwarding rules" in the rule list deletes the independent rules of this source and restores the use of the upper-layer configuration; after deleting the default rules, no notification will be given by default. The account must still be active; the moved group retains its own explicit configuration, and if it is not overwritten, it will follow the new group.
3. **CF source**: Select Worker, then configure the complete domain name or complete receiving address, and resolve by "Specific address → Complete domain name → Worker default configuration". Supports addresses that have not been imported locally; just specify a channel for an address to notify the address without opening the entire domain name. Worker is initially closed by default and does not inherit ordinary mailbox configuration. `example.com` does not automatically include subdomain names; the full address retains the `+` suffix and dot, and does not merge aliases.
4. **Multiple Selection and Preview**: Mailboxes, groups, and workers use searchable drop-down checkboxes, and you can enter email addresses or names to filter and check items one by one. Switch the filter conditions to retain the selected sources, "Select all filter results" to select only the current matching items, and "Clear all" to cancel all selections. Rules support new addition, single editing, and batch editing of the same source range; new additions will not overwrite existing rules. If any of the selected sources already has independent rules, they will be rejected in batches. You can directly use the list pencil icon to edit. In the preview, you can select a specific mailbox or Worker from the selected source to view the automatic inheritance path and actual target; the history can be queried by source, complete address, channel and status.
5. **Rule filtering and batch operation**: The rule table can be filtered by combining keywords, source range, notification channels and notification methods, and the conditions will be retained after refreshing. Check the current filter results one by one or select them all, and delete them in batches after confirmation; changing the filter conditions will clear the check box to avoid accidentally deleting hidden rules. The same source range (for example, both are specific ordinary mailboxes, or both are CF complete domain names) supports batch editing; check the notification method, channel, keyword or sender to be modified in the form, unchecked fields retain their original values, and leave blank after checking to clear the conditions. Edit the fixed source identity; different types of sources can still be mixed and deleted. If any rule is invalid, the entire batch will be rejected. If the write fails, the entire batch will be rolled back. Unselected rules will remain unchanged. List trash icon with delete prompt and retain confirmation.

Each forwarding rule can be independently configured with **email keywords** and **mail sender**, applicable to both ordinary mailboxes and CF. Keywords should be one per line. The subject or the complete visible text can contain any one of them. It is not case-sensitive. The sender has a complete email address per line, ignoring case and matching any sending email address exactly, and does not match the display name or similar suffix. When both types of conditions are filled in, they must be hit at the same time. If one item is left blank, there is no limit; if both items are blank, all will be forwarded. When inheriting, the entire set of targets and filtering conditions of the most recently specified rule are used, and do not overlap with upper-level conditions; both the preview and the rule table display the effective conditions. The SMTP sending address and target recipients are still configured uniformly by the notification channel.

The polling interval, serial/parallel and ordinary mailbox time windows, and trash bin options are still saved independently in "Run Settings"; CF does not apply the ordinary mailbox folders and time windows. Mail that does not match the rule conditions will not be delivered, but the scanning progress will be advanced normally; the condition adjustment will not automatically re-deliver the processed mail, nor will it re-screen the failed deliveries that have been established.

- Only one delivery is created for the same email + the same specific notification channel in the same mailbox; multiple associations, repeated scanning, and repeated reading of imported CF addresses will not generate a second notification. Different new emails are notified separately, and different channels of the same type record results separately.
- Only failed targets are retried when one target succeeds and the other fails; retry backoff is doubled from 30 seconds to a maximum of 1 hour, subject to later upstream cooldowns. Deactivated targets will not be redirected to other channels, and cannot be deleted if they are still referenced by sources or have not completed delivery.
- By default, the new association will only process new emails after taking effect, and will not automatically reissue history; ordinary accounts can explicitly roll back the cursor through the existing forwarding log entry, and rescan unprocessed historical emails. Successful targets will still be deduplicated, and new targets will not be added to existing events.
- The CF background reads the actual recipient address by Worker paging, and continues to work even if the web page is closed. It does not automatically create a local mailbox or write to the temporary mail cache. Scan progress and failed delivery are persisted; service restarts will continue to obtain letters within the upstream retention period. Actively disabling the Worker will pause scanning and sending, and re-enabling it will not resend emails during the active suspension period by default.
- Modifying the actual receiving destination will cancel the backlog of the old destination version, and you can continue to try again by updating the same destination authentication information. Removing the mailbox-level override restores inheritance, and closing it stops notifications from that source.
- Unified checks can be triggered manually and CF scan errors, specific channel results and blocking reasons can be viewed in history.
- The forwarding summaries of Telegram, WeChat Business, Feishu and SMTP will show the actual recipients; the CC address will also be displayed when the email has a CC address, and "Not provided" will be displayed when the recipient information is missing.

The upgrade will idempotently migrate the old configuration to compatible channels and specific mailbox rules, and will not automatically generate "general mailbox default" rules. For the existing accounts that originally enabled forwarding, each established a "specific ordinary mailbox" rule and designated the original activation channel; the old closed accounts will remain without notification. `auto` uses the original available channels, `none` remains without notification, and explicitly chooses to continue to use the old entrance to parse aliases such as `email/tg/qywx` and spaces. Ordinary default rules that have been automatically migrated will be split into accounts and removed, while the channel effective time, cursor, and success record will be retained; manually added or modified rules will not be affected. There is also a one-time upgrade of rule conditions: the old global keywords are copied to the ordinary mailbox rules that were in effect before the upgrade. CF maintains the original behavior that is not restricted by ordinary global keywords; the default for new sender filtering is unlimited, and the old SMTP sending address, target recipients, credentials, and historical deliveries retain their original values. The database that has completed the migration of the old version will also be upgraded. The migration mark and data will be submitted in the same transaction. If it fails, the entire database will be rolled back; restarting will not cover subsequent user modifications. The old keyword interface is only compatible with migrated accounts and does not modify manual rules. The migration is only performed once, and the scheduled check does not re-establish the association; newly imported mailboxes can still use grouping rules automatically. CF is not enabled automatically. The old setting interface only adjusts the compatible channels for migrating accounts and does not change manual accounts, groups or CF rules; ordinary default configurations can still be created manually by users. The old `PUT` update interface is compatible and retained, new pages use `POST`, and single/same range batch editing uses `PATCH` according to the stable ID.

When you need to roll back the version, first stop the new schedule and back up the database and keys. The new success record of the compatible instance is synchronized with the old `forward_logs` transaction and can be used to deduplicate the old version; first confirm the old settings mirror and compatible channel selection before starting the old schedule. Older versions cannot handle new instances and CF notifications; restoring a pre-migration backup will lose post-backup configuration and records, and a rollback-only procedure should not be considered a lossless data rollback.

#### Feishuqun Robot

1. Add a custom robot in "Settings -> Robots" of the target Feishu group and copy its `https://open.feishu.cn/open-apis/bot/v2/hook/...` Webhook address.
2. In this project, create a new Feishu channel in "More Functions -> Email Forwarding -> Notification Channels" and fill in the Webhook; when the robot has enabled signature verification, fill in the signature key at the same time.
3. If the robot uses keyword security verification, you can configure the keyword "email forwarding", and both the test message and the official email summary contain this word; when using the IP whitelist, you need to allow the export IP of this service.
4. Click "Send Test Message" to check the configuration, then save the channel and select it in "Source Association"; the test uses the current form and will not be saved automatically. Active regular email addresses and CF addresses are automatically notified according to valid source rules.

Webhook and signature key are encrypted and saved. The settings will not be echoed when reopened. Leave blank to retain the existing value. After checking "Explicitly clear existing signature keys", the test will be sent immediately as a no-signature configuration. After saving, the signature will no longer be used for formal forwarding; this will not modify the security settings on the Feishu robot side.

When Feishu sends a plain text email summary, the request body is limited to 20 KB in UTF-8 bytes, and overlong content will be truncated. Official forwarding and testing share the rate limit of the same webhook (up to 5 times per second, up to 100 times per minute); Feishu will record the failure and comply with the valid `Retry-After` when returning the rate limit.

The forwarding history shows Feishu business errors, such as signature failure or keyword mismatch; HTTP 200 does not mean successful transmission. Failed channels will be retried in subsequent forwarding checks, and other successful channels will not be sent repeatedly. After a network interruption or timeout, it may not be possible to confirm whether Feishu has received the notification. Subsequent retries may still result in repeated notifications. You can check the group message first.

### 7. WebDAV backup

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

1. Click the extension icon
2. Fill in the OutlookEmail service address and Web login password
3. Click "Save Configuration", or directly click the function entrance in the sidebar

The extension will provide a native operation panel in the browser sidebar, and the current web page tab will not be cut away. Functions such as Mailbox, Import, Refresh, Token, Export, Labels and Settings are now available directly. Complete installation, configuration, functionality, and troubleshooting instructions are available in [browser extension usage instructions](browser-extension/README.md).

### 9. External API

Get emails directly through API Key without logging into the web interface.

Current additional support:

- Use primary mailbox or alias mailbox to get mail
- `folder=all` aggregates inbox and spam at once and sorts them in reverse chronological order after normalization, `top` calculates them separately for each folder
- Supports filtering the list by subject, sender, and keywords
- Support special character aliases, such as `user+alias@example.com`
- When querying the `@gmail.com` / `@googlemail.com` address, if the original suffix is not hit, it will automatically fall back to another suffix.
- Default `top=1`
- `skip` / `top` will do safe parsing: non-digits use default values, negative numbers are processed as `0`; `top` is the largest `50`

**Configuration steps:**
1. Click "⚙️ Settings" → click "🔑 Randomly Generate" under "External API Key" → Save

**Call example:**
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

- `@` can be transmitted directly
- `+` is recommended to be encoded as `%2B`
- `&` must be encoded as `%26`

If you automatically forward external mailbox B to mailbox A managed by this project, and then match B as an alias of A, then you can directly use B as the `email` parameter to call the external API.

For detailed documentation, see [API Documentation](docs/api.md).

## 📚 Detailed documentation

| Documentation | Description |
|------|------|
| [🚀 Deployment Guide](docs/deployment.md) | Docker, Docker Compose, Nginx/Caddy deployment, environment variable configuration |
| [⬆️ Upgrade Guide](docs/upgrade.md) | Windows, Docker, Python direct upgrade and rollback suggestions |
| [🔐 Security Configuration](docs/security.md) | XSS/CSRF protection, data encryption, rate limit, audit log |
| [🎭Appearance skin](docs/skins.md) | System-level skin, zip upload, Git warehouse source, skin package format and persistence instructions |
| [📡API Document](docs/api.md) | External simple API, complete API, proxy configuration |
| [🛠️ Troubleshooting](docs/troubleshooting.md) | Frequently Asked Questions, Troubleshooting Steps |
| [📋 Change log](CHANGELOG.md) | Version update history |
| [🚢 Release Instructions](RELEASE.md) | Standard release steps, version number rules, GitHub Release instructions |
| [🛡️ Branch protection suggestions](BRANCH_PROTECTION.md) | main/dev usage boundaries, protection rules and build trigger suggestions |

## 🏗️ Technical architecture

### Backend technology stack
- **Flask 3.0+** - Web framework
- **SQLite 3** - Database
- **Requests / requests[socks]** - HTTP client and proxy support
- **IMAP4_SSL** - IMAP protocol support
- **Microsoft Graph API** - Outlook/Hotmail email API
- **APScheduler + croniter** - scheduled refresh and forwarding polling
- **bcrypt + cryptography** - Password hashing and sensitive field encryption

### Front-end technology stack
- **Native JavaScript** - No framework dependencies
- **CSS3** - modern style
- **Fetch API** - Asynchronous request
- **DOMPurify 3.0.8** - HTML purification

### System requirements
- Python 3.9+
- SQLite 3
- Docker (optional)
- 2GB+ RAM

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

Note: Normal group IDs usually start with a number, while supergroup or channel IDs usually start with -100.

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
This project has been released in [LINUX DO Community](https://linux.do/). Thanks to the community for its support and feedback.

- [Microsoft Graph API](https://docs.microsoft.com/graph/)
- [GPTMail](https://mail.chatgpt.org.uk)
- [Flask](https://flask.palletsprojects.com/)
- [Resin](https://github.com/Resinat/Resin) — High-performance sticky proxy pool gateway
- [icloud-mail](https://github.com/t508708/icloud-mail) — iCloud Mail protocol reference; part of the implementation is adapted based on its MIT licensed code, see [Third Party License Description](third_party/icloud-mail-LICENSE.txt) for details

## ⭐ Star History

[![Star History Chart](https://star-history.dera.page/svg?repos=assast/outlookEmail&type=Date)](https://star-history.dera.page/#assast/outlookEmail&type=Date)

---

**⭐ If this project is helpful to you, please give a star to support it! Your Star is my motivation to keep updating! ** ⭐

Maintenance of a project for the first time. It was only at 15:45:33 on April 11, 2026 that I discovered that several pulls were not merged. I am very sorry. This is my contact information. If I don’t see it, you can remind me. If you have any good suggestions, you can also give them. Thank you ~
Email: u3794336@outlook.com

## Disclaimer
This project is only for learning, research and technical exchange. Please abide by the relevant platform and service terms and do not use it for illegal, abusive or illegal purposes.
Any risks and consequences arising from the use of this project are borne by the user.
