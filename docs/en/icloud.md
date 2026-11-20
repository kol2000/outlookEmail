# iCloud primary account and hidden email address

"iCloud Management" at the top of the web allows you to add a primary Apple account, log in manually, submit two-factor verification codes, and synchronize, create, deactivate, and delete hidden email addresses. The management interface uses Apple's private Web protocol, which currently still requires real account acceptance; offline testing cannot prove that Apple currently accepts all processes or that sessions can be effective in the long term.

## Configuration sequence

1. Select **iCloud** in the normal mailbox import/edit, fill in the mailbox and **App-specific password**. Default is `imap.mail.me.com:993`, SSL; recognizes `icloud.com`, `me.com`, `mac.com`. Existing custom servers will not be replaced due to domain name recognition.
2. Add an Apple ID in "iCloud Management" and select International Zone or Mainland China. The Apple ID is not necessarily the receiving email address. Please select according to the actual area of ​​the account.
3. Select the configured receiving account, or leave it unbound for now. The primary address/manual alias of the bound account must match the forwarding target in the Apple directory; if it does not match, the hidden address will display a conflict and no mapping will be generated.
4. Select the Web channel, enter the Apple login password for this time, and click "Manual Login/Take Over". If it shows waiting for verification code, enter this six-digit double verification code and submit. When Apple requires acceptance of terms, identity verification, etc., it must first be completed on Apple's official page.
5. Click "Sync" after the Web management connection is available. Hiding your email address requires iCloud+; it is different from the `privaterelay.appleid.com` relay address for Sign in with Apple.

Apple login passwords, management cookies/tokens, and IMAP App-specific passwords are saved separately. Successful management connection does not mean that the IMAP password is available; please verify receipt separately in the general mailbox list. Apple addresses can be managed without binding, but hidden address emails cannot be read through this project.

## Address operations and email attribution

- Synchronization only uses integrity-checked Web HME directories. Failure, missing fields, and unexpected paging will not overwrite the original directory; the Apple Account directory is a supplementary view, and there is no need to confirm deletion of its missing items.
- Create candidates first and then retain them. Support labels and notes. When the write response is lost or cannot be confirmed, keep "pending verification" and perform read-only synchronization first to avoid repeated creation. Only addresses with confirmed identities, valid addresses, matching forwarding destinations, and no conflicts can be trusted and newly claimed by the project.
- Remove managed mapping after deactivation. Permanent deletion requires deactivation and reconfirmation; deletion requires a real request to Apple. Deleting the local main account or unbinding the incoming mail only clears the local mapping and does not delete the ordinary mailbox, manual alias or Apple address.
- The managed alias in ordinary account editing is read-only. Please go to iCloud management to modify it. Addresses occupied by primary email addresses, manual aliases, temporary email addresses, or other primary accounts will not be taken over.
- When querying hosted hidden addresses, the list is paginated after matching the full recipient address, and details, attachments, original emails, and local caches perform the same attribution check. Evidence comes from To, Cc, Delivered-To, X-Original-To; inclusion of an address in the text or subject does not constitute evidence.
- Reaching an overall timeout or scan limit will explicitly report `scan_incomplete` and will not return a mail-filled page for other hidden addresses. The address after deactivation, unbinding, or removal cannot be rolled back to the complete primary email address. Existing project records are retained as history, and their eligibility to receive them cannot be restored.

## Renewal and optional automatic re-login

Valid sessions are automatically renewed, independent of the Outlook Token refresh switch and the automatic re-login switch. After the Account channel is successful, the next read management resource will be scheduled randomly for 4–6 minutes, and will be executed in advance if the TTL is shorter; the Web channel uses its own validate/trust/token process. Temporary failures will be backed off in 2, 4, 8, 16, and 30 minutes, and the longer `Retry-After` will be adhered to. The password will not be re-submitted due to network errors, 429, or insufficient quota.

Automatic re-login is turned off by default. Turning on requires saving the original Apple password, the dedicated code access URL for the main account, and the area. Keep the leading and trailing spaces in the password; leave the secret field blank and delete it only after clearing it. Turn off the automatic re-login retention configuration and existing session renewal; disable the main account or bind the mailbox to stop the background request of the main account.

Code receiving interface agreement:

```text
AppleID login verification code:123456
```

or JSON with explicit fields:

```json
{"otp":"123456","received_at":"2026-10-25T00:00:00+08:00"}
```

Supports `otp`, `smsCode`, `verificationCode`, `securityCode`, `appleCode`, and `message/text/content` with verification code semantics can also be used. Ordinary `code` status fields, HTML, unsemantic numbers, and multiple sets of ambiguity codes will not be submitted. The time can be in ISO 8601 or Unix seconds/milliseconds with time zone, and cannot be earlier than this validation trigger or clearly from the future; when not present it must be different from the pre-login baseline.

Baseline read once before login and up to 18 times every 5 seconds after verification is triggered. The link must be directly connected to the public network, redirection is prohibited, timeout and response size are limited, the actual DNS and the connection target both verify the public network address; no Apple proxy is used, and Apple cookies are not carried. URL query parameters are treated as secret and are not echoed or logged. Each primary account must configure its own link.

Automatic login fails temporarily and is retried after about 5–6 minutes, gradually increasing to 30–31 minutes; the number of failures and the period are retained across restarts. If the password is incorrect, the identity is inconsistent, or the account operation is suspended, manual processing will be performed; it will be restored after replacing relevant credentials or manual login, and ordinary remarks will not be cleared and retreated. Manual login, disabling, turning off automatic re-login, and replacing credentials will cancel old tasks, and late verification codes/sessions cannot overwrite manual results.

Exiting an Apple session clears the administrative snapshot. **When automatic re-login is still enabled, you will log in again later; if you continue to log out, please turn off automatic re-login first. ** Page reading only displays local status and does not trigger upstream detection.

## Management interface and backup

The main account resource is `/api/icloud/accounts`, and `/login`, `/verify`, `/logout` and `/aliases` are provided under a single main account. All management interfaces require Web login; write operations are protected by CSRF, and ordinary external API Keys do not have Apple management permissions. Passwords, code access URLs, and management sessions are all encrypted and saved, and only configuration tags are returned when read; verification codes are not stored in the database.

Normal account text export and WebDAV text backup are not complete iCloud backups and do not include Apple passwords, access URLs, or sessions. A complete recovery needs to retain both the SQLite database and the original `SECRET_KEY`; the desktop version also needs to retain `secret_key.txt` in the running directory. Please copy the database after stopping the application, or use a SQLite consistent backup, and keep the keys safe. Inconsistent keys or damaged ciphertext will require reconfiguration/login, and the ciphertext should not be used as a password.

## Downgrade to an older version

The old version does not have the ability to isolate emails with hidden addresses. Before downgrading you must:

1. Stop the current application and back up the database and original encryption key.
2. Execute the following short transaction in the database to stop the background qualification and remove the mapping owned by this function:

```sql
BEGIN IMMEDIATE;
UPDATE icloud_accounts SET enabled = 0, config_version = config_version + 1;
DELETE FROM account_aliases WHERE icloud_alias_id IS NOT NULL;
COMMIT;
```

3. Restart the old version. Keep the normal receiving account, manual alias and iCloud independent table; you can re-enable, log in and synchronize after upgrading without deleting the history.

Do not import the hidden address as a normal manual alias to replace the hosting relationship in the old version, otherwise it will not have the recipient attribution restrictions of this change.

## Troubleshooting and acceptance boundaries

"Management connection is available", "IMAP can receive messages" and "hidden address can receive messages" are different states. Prioritize checking the channel's recent errors, number of failures, next attempts, address conflicts, and receiving bindings; do not click Create repeatedly to troubleshoot uncertain results.

The reference project observed that the management state may fail after about eight hours. This is its operational observation, not Apple's official fixed period, nor the continuous running results of this project. The real login, address life cycle, cross-restart and cross-observation window renewal acceptance of this project have not yet been completed, and we cannot promise to permanently exempt from verification. See OpenSpec change `add-icloud-mail-management/research.md` for protocol basis and offline/build results.
