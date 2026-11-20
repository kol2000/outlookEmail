#Upgrade guide

This document is intended for users who are already using this project and explains the upgrade steps, backup suggestions and rollback ideas after the new version is released.

## Suggestions before upgrading

It is recommended to complete the following operations before upgrading:

1. Back up the `data/` directory, at least retain the database files.
2. Record the currently used image tags, deployment methods and key environment variables.
3. Confirm that the current `SECRET_KEY` will continue to be retained and not replaced during upgrade.
4. If using a reverse proxy or automated script, confirm that the port, domain name, and path have not changed after the upgrade.

## Key data that must be retained

The most important thing to keep when upgrading is to retain the following:

- SQLite database: `data/outlook_accounts.db`
- Fixed `SECRET_KEY`
- Custom environment variables

If `SECRET_KEY` is changed, the saved sensitive data such as Refresh Token, API Key, and email password will not be able to be decrypted.

## 3.0.30 upgrade instructions

- Fixed the problem of incorrectly reading details, attachments or accidentally deleting other emails due to serial number changes after deleting IMAP emails. The list returns UID uniformly; when the server provides UIDVALIDITY, the ID is `imap:<UIDVALIDITY>:<UID>`, and the API client should resynchronize the list and return the ID as it is.
- Old `id_mode=sequence` requests prompt to refresh the list; return an error when the target UID does not exist, and no longer read or operate on other messages with the same number.
- The old IMAP cache tag will be invalidated and rebuilt through synchronization at first startup. The original cache body record will still be retained in the database for recovery; accounts, authorizations, Graph cache and remote mail will not be affected. Please keep the original database and SECRET_KEY.
- Gmail, Outlook IMAP and other mailboxes that do not support SORT can now use "Latest N Only" sharing. Fallback to sorting by time after reading UID and INTERNALDATE metadata, copying or importing old messages does not change the time meaning of "latest".
- The rollback scan of a large mailbox may take longer, and the entire scan shares the current IMAP timeout budget; incomplete verification or timeout will still deny access, and sharing permissions will not be expanded.

## 3.0.29 upgrade instructions

- A new Token Scope is added to the Outlook/Hotmail account addition and editing pop-up windows, and you can choose automatic, `.default`, read-only, full permissions or customization; the database fields will be automatically completed when started for the first time, and existing accounts will remain in automatic mode by default, without manual migration.
- Automatic mode remembers successful scopes in the process; when modifying the configuration or restoring automatic, the old cache will be cleared, and the account configuration will be directly applied to background forwarding. Sending, deleting, and marking as read still require corresponding permissions from Microsoft.
- Restricted email sharing is changed to lazy loading by folder, and only the latest N emails are displayed in the inbox and spam.
- **The old restricted sharing link will also change from "N posts in total for both folders" to "N posts for each folder", with a maximum of 2N posts accessible. Please review existing links before upgrading; if you do not accept the new visibility range, you should revoke the link first. **

## 3.0.28 upgrade instructions

- Forwarding rules can now set email keywords and senders separately, applicable to both ordinary mailboxes and Cloudflare sources; the SMTP sending address and target recipient configuration of the notification channel remain unchanged.
- Forwarding management supports single editing and batch editing of the same source range. Batch editing only modifies the checked fields, and unchecked fields retain their original values; leaving blank after checking a condition can clear the condition.
- The first startup will automatically complete the rule condition fields for the existing database and migrate the old global keywords to the ordinary mailbox rules that were in effect before the upgrade; Cloudflare will continue not to use the old global keywords. If the migration fails, it will be rolled back, and there is no need to manually perform database migration.
- Established deliveries will not be automatically resent due to subsequent modification of rule conditions; it is recommended to back up the `data/` directory before upgrading.

## 3.0.27 upgrade instructions

- Email forwarding settings have been restructured into an independent "Email Forwarding" management workspace. After the upgrade, configurations can be managed separately in notification channels, forwarding rules, delivery history, and running settings.
- On first startup, forwarding-related data tables will be automatically created, and old SMTP, Telegram, Enterprise WeChat, and Feishu settings will be migrated idempotently as compatible channels, eliminating the need to manually perform database migration.
- Existing ordinary mailboxes that originally turned on forwarding will be migrated to their own specific mailbox rules and associated with the original channel; accounts that originally turned off forwarding will remain unnotified; existing manual accounts, groups, or Cloudflare rules will not be overwritten.
- Migration will retain the channel effective time, forwarding cursor and success record. It is still recommended to back up the `data/` directory before upgrading; if you need to roll back, first stop the new version scheduling and confirm that the old version cannot handle new forwarding instances and Cloudflare notifications.

## 3.0.21 upgrade instructions

- Automatically add refresh rotation result and latest successful refresh time fields when starting for the first time, eliminating the need to manually perform database migration.
- The most recent success time of an existing account will be restored based on the success log and account status; the rotation result that is not recorded in the old log is displayed as "Unrecorded", and the time that cannot be confirmed is displayed as `-`.
- "Recent Refresh" contains successful and failed attempts; "Recent Successful Refresh" contains cases where the request was not rotated but was successful; "Recent Rotation" is only updated when a new Refresh Token is saved successfully.

## Docker upgrade

### Upgrade to the latest stable branch build

```bash
docker pull ghcr.io/assast/outlookemail:latest
docker compose down
docker compose up -d
```

### Upgrade to the specified official version

It is recommended that the official environment give priority to using clear version numbers:

```bash
docker pull ghcr.io/assast/outlookemail:v2.0.15
docker compose down
docker compose up -d
```

If you use `docker-compose.yml`, you can also directly change the image to the specified version:

```yaml
services:
  outlook-mail-reader:
    image: ghcr.io/assast/outlookemail:v2.0.15
```

Execute after completion:

```bash
docker compose up -d
```

## Windows `exe` upgrade

### Online upgrade

1. Log in to the app and open the version information at the top of the page.
2. After discovering the new version, click "Upgrade Now" to confirm the start.
3. Wait for the download, decompression and restart to complete; the download phase will display the percentage, size and speed, and allow cancellation.
4. The current page will automatically refresh and display the new version after the service is restored.

Online upgrade continues to use the existing `OutlookEmail-windows-x64-X.Y.Z.zip` in GitHub Release, and no additional installer will be downloaded. The upgrade file is temporarily saved in the directory where the current EXE is located, so the directory must allow the current user to create, rename, and delete files; the program will not apply for UAC privilege escalation.

If the warehouse version has been updated, but the corresponding Release ZIP has not yet been released, the page will prompt you to try again later, and the current program will not exit.

### Manual upgrade

When online upgrade is unavailable, you can still use the original method:

1. Download the new version `OutlookEmail-windows-x64-*.zip` from GitHub Releases.
2. Exit the old program.
3. Extract to a new directory or overwrite the program files in the old directory.
4. Keep the original data directory `%APPDATA%\\OutlookEmail`.
5. Start the new `OutlookEmail.exe`.

Description:

- The data is not in the program directory by default, but in `%APPDATA%\\OutlookEmail`
- Do not delete database or key files in this directory
- Online upgrade will first back up the old program to `*.old.exe` in the same directory, and then delete it after confirming that the new version successfully listens to the Web port.
- When the new version cannot be started, the old version will be automatically restored; if there is a power outage or the process is forcibly terminated by the system during the replacement, you can exit the relevant process and manually change `*.old.exe` back to the original EXE file name

## Python direct upgrade

```bash
git pull origin main
pip install -r requirements.txt
python web_outlook_app.py
```

If you use a virtual environment, please activate the corresponding environment before executing.

## Check after upgrade

It is recommended to confirm at least the following after upgrading:

1. The login page can be opened normally.
2. The original accounts, groups, labels, and settings still exist.
3. The original flat group is still displayed as a first-level group; creating a new sub-group and selecting the parent group to view the sub-group account are normal.
4. Randomly check at least one Outlook account and one IMAP account for normal access.
5. If the external API is enabled, check `/api/external/emails` once.
6. If automatic forwarding or scheduled refresh is enabled, check whether the task is still running normally.

## Recommended upgrade strategy

### Production environment

- Prefer using `vX.Y.Z` explicit version tag
- Verify in the test environment first, then upgrade to the official environment
- Back up the database before upgrading

### Test or personal environment

- can be used directly `latest`
- If tracking development versions, use `dev`

## Rollback ideas

If problems are found after the upgrade, you can roll back according to the original deployment method:

### Docker rollback

```bash
docker pull ghcr.io/assast/outlookemail:v2.0.13
docker compose down
docker compose up -d
```

### Windows Rollback

- Switch back to the old version `exe`
- Leave the original data directory unchanged

### Python rollback

```bash
git checkout <Old version corresponding commit or tag>
pip install -r requirements.txt
python web_outlook_app.py
```

If the database structure changes during the upgrade process, you should first confirm whether the old version is compatible with the current database before rolling back.

## FAQ

### Login failure or sensitive data abnormality after upgrade

Prioritize checking whether `SECRET_KEY` has been changed. This is the most common reason.

### After the upgrade, the `latest` and Release versions are inconsistent.

This is normal:

- `latest` usually corresponds to the latest qualifying build of the default branch
- `vX.Y.Z` corresponds to the version image generated when the official version is released

For the official environment, it is recommended to fix it to a clear version number.
