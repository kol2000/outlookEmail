# 🔐 Security configuration

## 1. Change the default password

** Method 1: Pass environment variables (only initialization) ** during first deployment

In `docker-compose.yml`:
```yaml
environment:
  - LOGIN_PASSWORD=your_secure_password_here
  - SECRET_KEY=your-random-secret-key-here
```

`LOGIN_PASSWORD` initializes the password hash only when the database does **not yet contain** `settings.login_password`. After initialization, changing this environment variable **does not** change the current sign-in password.

**Method 2: Modify through Web interface (need to know the current password) **

After logging in, click the "⚙️ Settings" button to change the login password online. The current password must be filled in when modifying; after success, the current session will remain logged in, and other logged-in devices/sessions need to log in again.

**Method 3: Reset through the official CLI when you forget your password (no old password required) **

When you have access to the host or data directory, you can run:

```bash
python scripts/reset_login_password.py
# Docker: docker exec -it <container> python scripts/reset_login_password.py
```

- Only supports interactive terminal input of new passwords (no `--password` / pipeline transmission)
- Write bcrypt hashes and rotate login session versions, invalidating existing sessions
- Belongs to the operation and maintenance operations on the **host trust boundary **, which is complementary to "Logged in to change the password and the current password must be verified"
- For detailed steps, see [troubleshooting.md](troubleshooting.md) "Forgot Web Login Password"

### Login session validity period

The web login page provides fixed login validity options: 7 days, 30 days, 90 days, 180 days and forever, with the default of 30 days. The limited period is fixed and calculated from the time of successful login, and will not be renewed for subsequent page visits or API calls; it is permanently valid and will not automatically expire due to the login time. All sessions will still expire after active logout, session version rotation due to login password change, SECRET_KEY change, or browser clearing cookies.

The login page only remembers the last selected period locally in the current browser and does not save passwords, session cookies or absolute expiration times. The server will still verify the expiration option, and calling the login interface directly cannot bypass the fixed option; there is no expiration option for browser extension login, and a 30-day session is established by default.

## 2. Enable CSRF protection (recommended)

CSRF protection is enabled by default. If flask-wtf is not installed, the system will degrade gracefully:

```bash
pip install flask-wtf>=1.2.0
```

**CSRF protection characteristics: **
- Automatically add CSRF Token for all status change operations
- Prevent cross-site request forgery attacks
- Fully transparent to users, no manual operations required
- Automatically downgrade when not installed, which does not affect the use of functions.

## 3. Login rate limit

The system has built-in login rate limit to prevent brute force cracking:

- ** failure limit **: locked after 5 failures
- ** lock duration **: 15 minutes
- ** based on IP**: each IP counts independently
- ** automatically unlocks **: automatically unlocks after the lock time expires

## 4. Sensitive data encryption

All sensitive data is stored encrypted:

** encrypted content: **
- Refresh Token (Fernet symmetric encryption)
- Login password (bcrypt hash)
- Email password (Fernet symmetric encryption)
- Email password in external upload temporary table (Fernet symmetric encryption; list interface and front end do not return or display plain text)
- External API Key (Fernet symmetric encryption)

** encryption key: **
- Derive encryption keys based on SECRET_KEY
- Using the PBKDF2HMAC key derivation function
- 100,000 iterations, SHA256 algorithm

** IMPORTANT NOTE: **
- SECRET_KEY must remain unchanged
- SECRET_KEY will be automatically generated and persisted when Windows `exe` is started for the first time.
- Docker, Python runtime and production environments should explicitly set fixed SECRET_KEY
- Changing SECRET_KEY results in failure to decrypt stored data
- If you need to make changes, please export the account first and then re-import it after making changes.

## 5. Secondary verification of export function

The export function requires password confirmation to prevent unauthorized export:

** protection mechanism: **
- You need to enter the login password before exporting
- One-time verification token, it will expire immediately after use.
- All export operations are recorded in audit logs
- Record operation time, IP address and export details

** audit log: **
```sql
SELECT * FROM audit_logs WHERE action = 'export' ORDER BY created_at DESC;
```

## 5.1 Second verification of account and password display

The account details interface does not return the clear text of the account password and IMAP password by default, but only returns a flag indicating whether the password has been saved. When you click "Verification Display" on the web interface, you need to enter the current login password again; the account password will be obtained and displayed only after the verification is passed.

** protection mechanism: **
- You need to enter the login password before viewing the account password.
- Saving the account without verification will not clear the saved passwords
- Successfully checking the account password will record the audit log
- The audit log only records account and operation information, not password content.

## 6. XSS protection

Multi-layer XSS protection mechanism:

** front-end protection: **
- Automatic escaping of user input (escapeHtml)
- Email content is purified using DOMPurify
- iframe sandbox isolation (sandbox="allow-same-origin")

** backend protection: **
- Input sanitization function (sanitize_input)
- HTML special character escaping
- Length limit and control character filtering

**DOMPurify configuration: **
```javascript
DOMPurify.sanitize(content, {
    ALLOWED_TAGS: ['a', 'b', 'i', 'u', 'strong', 'em', 'p', 'br', 'div', ...],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', ...],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', ...]
});
```

## 6.1 Custom skin safety boundary

The appearance skin only loads CSS and does not execute scripts or installation commands in the skin package. When uploading a zip skin package, the server will reject path traversal, symbolic links, script files, HTML files and executable files; Git source installation will also be verified according to the same set of skin formats.

Still need to be processed according to the trusted administrator function:

- CSS can change the visual appearance of the interface, hide elements, or load remote resources.
- Git source will allow the server to actively access the warehouse address filled in by the user.
- It is not recommended to open the ability to upload skins or Git installation to ordinary users.
- Multi-person deployments recommend restricting access to sources through a firewall, reverse proxy, or trusted network settings page.

## 7. Configure firewall

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 5000/tcp
sudo ufw enable
```

## 8. Restrict access sources (Nginx)

```nginx
location / {
    allow 192.168.1.0/24;
    deny all;
    proxy_pass http://localhost:5000;
}
```

## 9. Use strong passwords

- Login password must be at least 8 characters, including uppercase and lowercase letters, numbers and special characters
- **SECRET_KEY should use the randomly generated long string (at least 32 bytes) **
- Generation method: `python -c 'import secrets; print(secrets.token_hex(32))'`
- Change password regularly

## 10. Data backup

```bash
# Backup database
cp data/outlook_accounts.db data/outlook_accounts.db.backup

# Regular backup (crontab)
0 2 * * * cp /path/to/data/outlook_accounts.db /path/to/backup/outlook_accounts.db.$(date +\%Y\%m\%d)
```

## Security Best Practices

1. ** fixed SECRET_KEY**: Server deployment must be set explicitly, desktop version needs to retain the automatically generated key file
2. ** enables HTTPS**: production environment uses SSL/TLS encryption
3. ** regularly updates **: timely updated to the latest version
4. ** monitoring log **: Check audit logs and application logs regularly
5. ** restricts access to **: Use firewall and Nginx to restrict access sources
6. ** backup data **: Back up database files regularly
7. ** Strong Password Policy **: Use complex passwords and change them regularly
8. ** installation CSRF protection **: `pip install flask-wtf`
