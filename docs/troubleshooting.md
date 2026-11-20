# 🛠️ Troubleshooting and FAQs

## Troubleshooting

### Container cannot be started

**Check steps:**

```bash
# 1. View container status
docker ps -a

# 2. View application logs
docker logs outlook-mail-reader

# 3. Check port occupancy
lsof -i :5000

# 4. Pull the image again and restart
docker pull ghcr.io/assast/outlookemail:latest
docker-compose down
docker-compose up -d
```

**Correct log should show:**
```
============================================================
Outlook Mail Web App initialized
Database file: data/outlook_accounts.db
GPTMail API: https://mail.chatgpt.org.uk
============================================================
```

### Database table does not exist error

**Error message:** `sqlite3.OperationalError: no such table: settings`

**Cause:** The database is not initialized or damaged

**Solution:**

```bash
# Method 1: Delete the old database and re-initialize it
docker-compose down
rm -rf data/outlook_accounts.db
docker-compose up -d

# Method 2: Manually initialize the database
docker exec outlook-mail-reader python -c "from web_outlook_app import init_db; init_db()"
docker-compose restart

# Method 3: Use the latest image
docker pull ghcr.io/assast/outlookemail:latest
docker-compose down
docker-compose up -d
```

### Unable to get mail

**Possible reasons:**
1. Refresh Token expired or invalid
2. Client ID error
3. Insufficient API permissions
4. Network connection problem

**Solution:**

1. **Reacquire Refresh Token** - Use the built-in OAuth2 helper to reacquire
2. **Check API Permissions** - Make sure the required API permissions have been added
3. **View detailed errors** - Open the browser developer tools (F12) and view the Network tab

### IMAP is slow to get the letter

`[imap]` records in the log use the same `request_id` to concatenate a list or body request, and `operation=list/detail` to differentiate operations. View the positioning time of `stage` and `elapsed_ms`:

- `connect`: DNS, TCP, TLS and server hello.
- `login`, `identify`, `select`, `search`: Authentication, client identification, folder selection and mail search.
- `fetch`, `parse`: network pulling and email parsing.
- `logout`, `total`: Close the connection and total time taken.
- Outlook IMAP list also has `token` stage for refreshing OAuth tokens.

`fetch_commands`, `response_bytes`, and `message_count` display the number of pull commands, the number of response bytes, and the number of emails respectively; the logs do not contain passwords, tokens, or email content. A normal paging list only obtains email headers and attachment structures in batches; the text is read when the email is clicked. When the server explicitly rejects a batch request, it logs `batch_rejected` and falls back to reading the headers one by one.

### 502 error (Nginx)

**Cause:** The application did not start normally or the port configuration was incorrect.

```bash
docker ps
docker-compose logs
curl http://localhost:5000/login
sudo nginx -t
docker-compose restart
sudo systemctl reload nginx
```

### The temporary mailbox function is not available

1. **Update API Key** - Update GPTMail API Key in "⚙️ Settings"
2. **Check service status** - Visit GPTMail official website to confirm service status

### Session expiration problem

1. **Set fixed SECRET_KEY during server deployment**
   ```yaml
   environment:
     - SECRET_KEY=your-fixed-secret-key-here
   ```
   Generate using `python -c 'import secrets; print(secrets.token_hex(32))'`

   If you use Windows `exe`, the program will automatically generate and save the fixed `SECRET_KEY` when it is started for the first time. Do not delete the key file in the corresponding data directory.

2. The default validity period of web login is 30 days. You can also choose 7 days, 90 days, 180 days or permanent validity on the login page; restarting the application will not cause the Session to become invalid (use fixed SECRET_KEY)

### Database lock error

**Error message:** `sqlite3.OperationalError: database is locked`

```bash
docker-compose restart
lsof data/outlook_accounts.db
cp data/outlook_accounts.db data/outlook_accounts.db.backup
docker-compose down
docker-compose up -d
```

---

## FAQ

### Q: Why can't I get the email?
A: Please check: (1) Whether the Refresh Token is valid (2) Whether the Client ID is correct (3) Azure application API permissions (4) Network connection (5) Try to obtain the Token again

### Q: How to obtain Refresh Token?
A: Use the built-in OAuth2 assistant: click "Get Token" → "Generate Authorization Link" → Browser Authorization → Copy the authorized URL → Paste to exchange for Token

### Q: How to use the temporary mailbox function?
A: Click the "Temporary Mailbox" group → "Generate Temporary Mailbox" → Select the mailbox → "Get Mail"

### Q: How to change the login password?
A: **If you still remember the current password**, change it in the web interface "⚙️ Settings" (the current password must be filled in). The environment variable `LOGIN_PASSWORD` **only writes the default value during first initialization** (the database does not yet have `login_password`); after the application has been run and the library has been written, only changing the env **will not** overwrite the current login password.

### Q: What should I do if I forget my web login password?
A: Use the official reset script (**no need** for the old password, you need host permissions to access the database/container):

```bash
# It is recommended to stop the service first (not mandatory) and confirm DATABASE_PATH (default data/outlook_accounts.db)
python scripts/reset_login_password.py

# Docker example (the container name is modified according to the actual situation; -it must be used to enter the interactive terminal)
docker exec -it outlook-mail-reader python scripts/reset_login_password.py
# If the compose service name is outlook-mail:
# docker exec -it outlook-mail python scripts/reset_login_password.py
```

Enter and confirm your new password (at least 8 digits) when prompted. After success:

- Log in with **new password**; existing web/extension sessions will become invalid
- The password is saved in the database `settings.login_password` (bcrypt), **not** restored by changing the `LOGIN_PASSWORD` environment variable
- The script does not support `--password` or piped passwords and must be run in an interactive TTY

For a more complete description of security boundaries, see [security.md](./security.md).

### Q: Where is the data stored?
A: SQLite database `data/outlook_accounts.db`, regular backup is recommended

### Q: What mail folders are supported?
A: Inbox, Junk Email, Deleted Items

### Q: How to import mailboxes in batches?
A: Default format: `Email----Password----client_id----refresh_token`, one per line; it also supports switching to `Email----Password----refresh_token----client_id` in the import pop-up window.

### Q: How to export email account?
A: (1) Export a single group (2) Export all (3) Export selected groups (4) Export selected accounts after batch selection in the mailbox list

### Q: How to drag and drop batch selection? What should I do if my Mac trackpad is unresponsive?
A: First click the "☑" at the top of the mailbox panel to enter batch selection mode, then press and drag up and down on the account row or left selection box. Just hold down `Shift` and click for continuous range selection, which is not equivalent to dragging; if you want to drag with the trackpad, you need to keep pressing to go through multiple lines of accounts.

### Q: What should I do if the Docker container cannot be started?
A: (1) `docker logs outlook-mail-reader` (2) Check port (3) Check directory permissions (4) Pull the latest image
