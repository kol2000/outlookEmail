# Upgrade Guide

This document is intended for users who are already using this project and explains the upgrade steps, backup suggestions and rollback ideas after the new version is released.

## Recommendations before upgrading

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

1. Download the new version `OutlookEmail-windows-x64-*.zip` from GitHub Releases
2. Unzip to a new directory or overwrite the program files in the old directory
3. Keep the original data directory `%APPDATA%\\OutlookEmail`
4. Start new `OutlookEmail.exe`

Description:

- The data is not in the program directory by default, but in `%APPDATA%\\OutlookEmail`
- Do not delete the database or key files in this directory at will

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
3. The original flat group is still displayed as a first-level group; creating a new sub-group and selecting the parent group to view the sub-group account are all normal.
4. Randomly check at least one Outlook account and one IMAP account to ensure normal access.
5. If the external API is enabled, check `/api/external/emails` once.
6. If automatic forwarding or scheduled refresh is enabled, check whether the task is still running normally.

## Recommended upgrade strategy

### Production environment

- Prioritize the use of `vX.Y.Z` clear version tags
- Verify in the test environment first, and then upgrade to the official environment
- Back up the database before upgrading

### Test or personal environment

- You can use `latest` directly
- If you want to track the development version, you can use `dev`

## Rollback ideas

If problems are found after the upgrade, you can roll back according to the original deployment method:

### Docker rollback

```bash
docker pull ghcr.io/assast/outlookemail:v2.0.13
docker compose down
docker compose up -d
```

### Windows rollback

- Switch back to the old version `exe`
- Keep the original data directory unchanged

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

### `latest` and Release version are inconsistent after upgrade

This is normal:

- `latest` usually corresponds to the latest qualifying build of the default branch
- `vX.Y.Z` corresponds to the version image generated when the official version is released

For the official environment, it is recommended to fix it to a clear version number.
