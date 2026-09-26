# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning (`MAJOR.MINOR.PATCH`).

## [Unreleased]

## [3.0.9] - 2026-09-22

### Added
- The web side supports the Outlook/Hotmail master account that has completed GraphAPI authorization to manually send basic plain text emails: after filling in one or more recipients, subject and body, call Microsoft Graph as the current account itself to submit for sending.
- Added `Mail.Send` to the Graph OAuth authorization scope; the email writing entry is only displayed for Outlook/Hotmail accounts that are enabled and have non-OAuth IMAP channels.
- The sending interface provides recipient verification, prevention of repeated clicks during submission, re-authorization of the Graph when permissions are insufficient, and prompts for Graph current limiting and uncertain network results.

### Changed
- Graph Refresh Token refreshes and adds read-write/read-only scope fallback without `Mail.Send`, trying to maintain the original email reading and email management capabilities of historical accounts.

### Important
- **Reauthorization required:** Existing Graph Refresh Token will not obtain `Mail.Send` silently. If you need to use the historical Outlook/Hotmail account to write emails on the web, please complete the `GraphAPI` authorization again.
- When Graph returns `202 Accepted`, the interface displays "Mail submitted for sending", which does not mean that the mail has been confirmed to be delivered. When the network times out or the connection is interrupted, the system will not automatically resend to avoid repeated delivery.
- The first version does not support IMAP/SMTP manual sending, temporary mailbox, alias or shared mailbox sending, attachments, HTML/rich text, draft, reply/forward, sent list, browser extension portal, external API, batch, scheduled or automated sending of mails.

## [3.0.8] - 2026-09-18

### Added
- Account list label filtering supports "yes/no" dual status: multiple "yes" labels are matched according to any one, multiple "no" labels must not be included at all, and the two types of conditions can be used in combination.
- `GET /api/accounts` and `GET /api/accounts/search` add `exclude_tag_ids`, which supports comma separation, repeated parameters and mixed transmission of the two forms.

### Important
- **Behavior changes:** After the upgrade, the `__untagged__` value in the browser's local old tag filter preference will be cleared; the original "no tag" filter will not be automatically migrated to the new filter condition.

## [3.0.7] - 2026-09-15

### Added
- A new "Show group description" switch is added to the grouping panel: keep the compact list by default, display non-empty group descriptions when turned on, and display preferences according to browser memory; long descriptions can display up to two lines, and hover to view the full text (#82).

## [3.0.6] - 2026-08-20

### Added
- The overall timeout for reading mail lists in ordinary Outlook/IMAP mailboxes has been changed to system configurable: "General Settings -> Mail Retrieval Timeout" on the settings page, with a range of 30-300 seconds and a default of 120 seconds (PR #79).
- Compatible environment variable `MAIL_FETCH_OVERALL_TIMEOUT` as the initial/bottom value before first startup; after saving the system settings, the database configuration shall prevail.
- The front-end mailing list request timeout automatically increases the buffer by 10 seconds according to the back-end configuration.

### Changed
- `folder=all` When pulling the inbox and trash bin in parallel, the overall wait timeout is changed to read the current system configuration, and the timeout details will show the actual number of seconds used.
- Default overall timeout adjusted from ~50 seconds (`max(HTTP_REQUEST_TIMEOUT, IMAP_TIMEOUT) + 5`) to 120 seconds when no system settings are configured.

## [3.0.5] - 2026-08-18

### Added
- Outlook OAuth account adds `authorization_type` (`graph` / `imap`, empty value means not set): records the preferred or recently successful email authorization channel.
- The edit account pop-up window allows you to view and modify the authorization type; if it is not set, the default Graph will be given priority to get the trust and Token refresh.
- Send messages, email details, and token refreshes are tried first according to the record channel. After failure, it will automatically fall back to another channel and write back to the actual successful channel.

### Changed
- `authorization_type` will be cleared when changing the account to normal IMAP.
- Automatically add `authorization_type` (default empty string) to the `accounts` table at startup; existing accounts will not be backfilled based on old credentials.

## [3.0.4] - 2026-08-16

### Added
- A new "Permanent Valid" option is added to the login page; this session does not automatically expire according to the login time, but is still affected by active logout, login password modification, SECRET_KEY changes, and browser clearing cookies.

## [3.0.3] - 2026-08-08

### Added
- The login page supports selecting a fixed login validity period: 7 days, 30 days, 90 days or 180 days, the default is 30 days; the validity period is calculated from the successful login, and subsequent visits will not be renewed.
- The login page will remember the last selected login validity period locally in the current browser. The browser extension login uses 30 days by default.

## [3.0.2] - 2026-08-01

### Fixed
- Decrypt `refresh_token` when exporting upload accounts (PR #73): No longer leaks encrypted `refresh_token` when exporting a TXT file (which triggers Microsoft `AADSTS9002313 / invalid_grant`). The export logic is consistent with `password`, decrypt first and leave blank if failed.
- Supplement corresponding unit tests.

## [3.0.1] - 2026-07-28

### Added
- A new "Batch Export" is added to the batch operation bar of the Outlook authorization pop-up window: select the upload account and then export TXT after secondary verification.
- Added `POST /api/outlook-upload-accounts/export-selected`: query `outlook_upload_accounts`, decrypt the password, and `LEFT JOIN accounts` with `client_id` / `refresh_token` of the authorized account; the export format is consistent with the homepage: `email----password----client_id----refresh_token` (the last two fields of the unauthorized account are empty).
- Added official operation and maintenance script `scripts/reset_login_password.py`: When you forget your web login password, you can interactively reset it in the host or container (no old password is required); write bcrypt hash, rotate `login_session_version` to invalidate the existing session, and record audit logs.
- Added unit tests related to `tests/test_reset_login_password.py` uploading account export.

### Fixed
- Fixed the issue where Outlook authorization pop-up batch export mistakenly enters the main account export interface and prompts "The selected account does not exist or there is no email account that can be exported"; the front end is routed to the new interface by uploading the account ID.

### Changed
- Built-in default `OAUTH_CLIENT_ID` updated to `9e5f94bc-e8a4-4e73-b8be-63364c29d753` when no environment variable is set (still overridable via `OAUTH_CLIENT_ID`).
- The documentation makes it clear that `LOGIN_PASSWORD` **will only write the default value during first initialization** (there is no `settings.login_password` in the library yet); changing the environment variable after the instance has written the library will not overwrite the current login password.
- README/`docs/security.md`/`docs/troubleshooting.md` Adds forgotten password reset steps and Docker `docker exec -it` example, and explains that the script only supports interactive TTY (no `--password`/pipeline transmission).

### Important
- Deployment of new OAuth authorization relies on the default Client ID. The default application ID has been changed after the upgrade; the `client_id` / refresh token of the imported account is not affected. Deployment of custom `OAUTH_CLIENT_ID` is hassle-free.

## [3.0.0] - 2026-07-27

### Added
- Group/account proxy URL supports `{mail}` placeholder: Expand according to the local-part of the email address (only alphanumeric and lowercase letters are retained) when outbound, configure the original inventory, API/edit echo and do not expand; can be connected to sticky proxy pools such as [Resin](https://github.com/Resinat/Resin).
- Upload account automatic authorization: Prioritize using the upload record itself `proxy_url`, otherwise inherit the group proxy template, and the main proxy is fixed throughout the OAuth process (no midway failover).
- The environment variable `LOG_LEVEL` (`DEBUG` / `INFO` / `WARNING` / `ERROR` / `CRITICAL`, default `INFO`) controls the global log level; the default INFO outputs outbound `[Agent]` details (password coding, including Resin Platform/Account).
- Outbound proxy usage logs cover paths such as pull messages, token refresh, IMAP socket, and Outlook automatic authorization.

### Fixed
- Fixed the issue where Token refresh did not respect the account-level agent override and only read the group agent; now it is consistent with the mail pull: account override → group inheritance → `{mail}` expansion; `db` is correctly passed in when there is no Flask context for scheduled refresh.
- Fixed the problem of PySocks degenerating to NO AUTH and Resin not receiving Platform.Account when the SOCKS proxy "has a username and an empty password": the transport layer fills in the placeholder password to force UserPass.
- Fixed the issue where editing the default group (front-end submission `parent_id=null` and parent unchanged) was misjudged as "immovable".
- Token/batch refresh related query by-select account `proxy_url`/fallback column to avoid account override due to resolved configuration loss.

### Changed
- `get_account_proxy_url` / `get_account_proxy_failover_urls` instead return the outbound proxy expanded at runtime; storage and display still use the unexpanded config path.
- Graph automatic authorization: `trust_env=False` when the application proxy is configured to avoid overlapping with the environment proxy.
- The interface and documentation prompt give priority to `socks5h://`, and explain `{mail}`, Resin examples and `LOG_LEVEL=WARNING` noise reduction.

### Important
- **Behavior changes:** For the mailbox configured with an account-level agent, token refresh will now also use the agent (previously, it may still use grouping/direct connection).
- **Behavior changes:** SOCKS URLs in the form `user:@host` / `user@host` will send UserPass (use placeholder for empty password); non-Resin proxies that rely on "username but NO AUTH" may not be compatible.
- Batch pulling/refreshing has more logs under the default `LOG_LEVEL=INFO`; production can set `LOG_LEVEL=WARNING` to turn off `[Agent]` and other INFO output.
- `{mail}` different prefixes may collide after purification (such as `a.b` and `ab`); purely non-alphanumeric local-part may expand into an empty account segment.

## [2.9.1] - 2026-07-27

### Added
- Mail deletion supports standard IMAP accounts and Outlook OAuth IMAP fallback: `EXPUNGE` is permanently deleted after folder mark `\\Deleted`.
- `POST /api/emails/delete` It is recommended to use the `items` / `method` / `folder` request body that is consistent with the target read; the browser extension and the web front end transmit `id_mode` synchronously.

### Fixed
- Fixed the problem of CSRF verification failure being swallowed by the global 400 processor as "request format error" (common when importing accounts under Docker/manual OAuth token replacement). Now return `csrf_error: true` and clear copy, the front end can automatically refresh the CSRF and try again.
- Fixed the problem that the Graph deletion result did not return `deleted_ids`, and the IMAP deletion directly prompted "not supported yet" before deletion; when partially successful, the front end updated the list according to the actual deletion ID.

### Changed
- README / API document synchronization instructions: Email deletion is available in both Graph and IMAP paths; compatible with old clients that only transmit `ids`.

## [2.9.0] - 2026-07-27

### Changed
- The manual OAuth assistant defaults to **GraphAPI** single resource permissions: `offline_access` + `Mail.Read` + `Mail.ReadWrite` + `User.Read` (no longer applies for IMAP by default).
- The default mode of Outlook mailbox automatic authorization is changed to **GraphAPI**; the authorization panel and log copy are adjusted from `Graph-only (excluding IMAP permissions)` to `GraphAPI`, and the IMAP options are unified to `IMAP authorization`.
- The automatic authorization GraphAPI mode scope is aligned with `OAUTH_GRAPH_SCOPES`, and `Mail.ReadWrite` and `User.Read` are added to the original `Mail.Read`.
- README synchronization instructions: Manually authorize the default GraphAPI; when IMAP is required, please explicitly select `IMAP authorization` in the "Outlook Mailbox Authorization" panel.

### Fixed
- Fixed the problem that the GraphAPI authorized account can read the letter but fails to mark it as read (Graph returns `403 ErrorAccessDenied` / `EMAIL_MARK_READ_FAILED`). The root cause is that `Mail.ReadWrite` was not applied for during authorization.

### Important
- **Accounts that have been authorized by the old Graph-only (`Mail.Read` only) need to be re-authorized** to obtain write permissions (marked as read, etc.).
- The token obtained by manual OAuth/default GraphAPI **cannot be used for IMAP**; for IMAP, please use the `IMAP authorization` mode of automatic authorization.

## [2.8.10] - 2026-07-26

### Changed
- The paging gear of the Outlook upload account management side is adjusted to `10` / `20` / `50` / `100`, and the default is `20` (aligned with the API default); the illegal old gear of local memory will fall back to the default value.
- The "Add New Account" form is changed to a single-line layout, the authorization pop-up window is widened and the table column width is fine-tuned; the instructions for use are collapsed by default.
- The width of the tag filter pop-up window is adjusted from `320px` to `250px`.

### Fixed
- Fixed the issue where the label drop-down pop-up window in the add account panel was cropped by the parent `overflow: hidden`.

## [2.8.9] - 2026-07-25

### Fixed
- Fixed the loss of error details when Outlook email details fail: Graph / OAuth IMAP details are changed to return structured errors (code / type / status / details / trace_id), and Graph fails to fall back to IMAP and transparently transmits the results of each protocol attempt to avoid the interface HTTP 200 but the page only displays "Loading failed".
- The email details front-end is compatible with `error` as a string or object, and provides a "click to view details" entry when protocol-level `details` exists, and reuses the failure pop-up window on the list side.

### Changed
- Outlook OAuth IMAP details automatic limited retries for proxy/timeout/connection and other transmission errors (authentication failure, folder non-existence, token invalidation, etc. will not be retried) to reduce the probability of intermittent letter reading failures.

## [2.8.8] - 2026-07-23

### Fixed
- Fixed the loss of error details when "all mails" failed to be pulled: `merge_folder_results` will now transparently transmit the structural errors (code / type / status / trace_id / details) of each Graph / IMAP protocol to avoid the pop-up window only showing "Unable to get mail, all methods failed" and the fields are all `-`.
- The email retrieval failure details pop-up window supports expanding protocol-level errors by folder (such as "Inbox/Graph API" "Inbox/IMAP (new server)"), which is convenient for troubleshooting issues such as token refresh success but email reading failure.

## [2.8.7] - 2026-07-19

### Changed
- Group proxy, account proxy, batch proxy and upload account proxy interface supplement SOCKS5 suggestion: IMAP token request only supports HTTPS CONNECT / SOCKS5 proxy, ordinary HTTP proxy is not available; placeholder gives priority to display `socks5://` example.

## [2.8.6] - 2026-07-19

### Added
- Telegram forwarding supports optional Topic ID (`telegram_topic_id` / `message_thread_id`), which can send messages to the specified topic of the topic group; when not filled in, the behavior is the same as before.
- Outlook upload account list supports filtering by authorization status (all/unauthorized/authorized), and filtering in combination with keyword search.
- Added the "Account Agent" column to the uploaded account management form to display the desensitized agent address (removing credentials, paths and query parameters).
- The upload account pagination provides `100` / `200` / `500` / `1000` gears. The management terminal defaults to `200` and locally stores the preference.

### Changed
- `GET /api/outlook-upload-accounts` supports `auth_status`; `page_size` is upgraded to `1000`; list serialization returns desensitized `proxy_url`.
- Added `reason_code`, `category`, `proxy_configured`, `retryable` and other fields to the email retrieval error response, so that the front end can more clearly display network/proxy/TLS and other reasons.

### Fixed
- Improve IMAP/mail retrieval error classification and user prompts to avoid general failure messages.
- Only the latest response is applied to concurrent requests for uploading account lists to prevent old paginated results from overwriting the current filtered results.

## [2.8.5] - 2026-07-14


### Added
- Outlook upload account supports setting target groups, labels and account agents; Graph is automatically written when authorization is successful and a new official account is created.
- Upload account management supports multi-select batch deletion and serial batch authorization based on the current authorization mode.
- The official account list supports batch "join automatic authorization"; when joining the team, groups, labels and agents are copied to the upload temporary table simultaneously.
- New interfaces: `POST /api/outlook-upload-accounts/batch-delete`, `POST /api/accounts/batch-outlook-auto-auth`.

### Changed
- When Graph authorization updates an existing official account, only the authorization fields such as password and token will be covered, and the original groups, labels, agents and remarks will be retained.
- `POST /api/outlook-upload-accounts` can receive `group_id` / `tag_ids` / `proxy_url`; list serialization returns these fields synchronously.

## [2.8.4] - 2026-07-14

### Security
- When changing the login password, the current password (`current_login_password`) must be verified to prevent the logged-in session from being used to change the password.
- Rotate the login session version after the password change is successful: the current password change session remains valid, and other logged-in Web Sessions need to log in again.

### Changed
- The login password in the system settings pop-up window is changed to "current password + new password" double input; if the new password is not filled in, it still does not need to be modified.
- When `PUT /api/settings` modifies `login_password`, the synchronization requires the correct `current_login_password`; the extended login one-time token will also be bound to the session version.

### Fixed
- Old Sessions for which the session version has not been written before the upgrade: it will only continue to be valid when the password rotation has not occurred to avoid accidental damage; once the password is changed, it will become invalid.

## [2.8.3] - 2026-07-14

### Added
- The Outlook mailbox authorization pop-up window adds four new addition/authorization method descriptions: batch import, 🔑 authorize and save, re-authorize and refresh, as well as the entry location and difference of automatic authorization on the current page.
- The description area provides shortcut buttons that can jump directly to the batch import mailbox or 🔑 authorization and save pop-up window.

## [2.8.2] - 2026-07-10

### Changed
- The account details interface `GET /api/accounts/<id>` now directly returns the plaintext `password` and `imap_password` fields, removing the secondary verification process. The front-end small eye button directly switches between mask and plaintext.
- Removed the `/api/accounts/<id>/secrets` two-step verification endpoint and its front-end verification pop-up window to simplify the password viewing process.
- Added `view_account_detail` audit log record when viewing account details to ensure that access to the password field is traceable.
- The password field in the OAuth re-authorization pop-up window is changed to mask display + small eye switch + click to copy, which is consistent with the password display method in the account edit pop-up window.
- The browser extension edit account pop-up window directly echoes the saved plain text password, and removes the "need to be viewed after verification on the Web" placeholder prompt.
- The `.secret-reveal-btn` button style is unified to 24×24px and centered, consistent with the Outlook upload account and password switch button.

### Fixed
- Fixed the fallback logic of additionally requesting account details to obtain the password when re-authorizing if the password is not passed in.

## [2.8.1] - 2026-07-07

### Added
- Outlook automatically authorizes the upload account form to add the official account label display, and supports switching to display/hide saved passwords in the management side form.
- Added Windows `start.bat` / `start.ps1` local startup script and project collaboration instructions.

### Changed
- The manual OAuth assistant is adjusted to only request Outlook IMAP single resource permissions, and the Graph token fallback is switched to an independent Graph scope to avoid errors when Microsoft OAuth v2 is mixed across resources.
- Optimize the column width, button copy, editing state and authorization operation layout stability of Outlook's automated authorization account table.
- The upload account list interface will return the decrypted `password` field to the logged-in management terminal, which is used to switch the front-end table display; the new/modified response will still not return the clear text password.
- When reading the `SECRET_KEY` environment variable, leading and trailing spaces will be ignored and the README configuration instructions will be synchronized.
- Clean up outdated OAuth and project design documents, retaining current API and security instructions.

### Fixed
- Fixed the problem that manual OAuth authorization link and authorization code exchange token request may be mixed into Graph scope.
- Fixed the jittering issue in the display of the Outlook automated authorization account form under the label, password and action columns.

## [2.8.0] - 2026-07-06

### Added
- Outlook automated authorization pop-up window supports `Outlook IMAP` and `Graph-only` dual-mode authorization, and embeds the authorization log on the right side of the upload account management panel.
- Upload account management supports top inline addition, table inline editing and authorized account re-authorization entry.
- Added folding, search title and sorting interactive optimization to the grouping panel.
- README and Docker configuration supplement local source code build and run instructions.

### Changed
- Added `https://outlook.office.com/IMAP.AccessAsUser.All` permission to OAuth authorization scope, which is used to allow IMAP authorization mode to obtain IMAP access capabilities.
- The Outlook upload account list interface no longer returns plain text passwords, and the front-end list only shows whether the password has been saved.
- Modifying the email address or password of the Outlook upload account will reset `is_authorized` to `0`; only modifying the remarks will not change the authorization status.
- The Graph authorization mode copy is adjusted to `Graph-only`, and it is clearly stated that IMAP permissions are not included.
- Optimize upload account table column width, button display, authorization log height and scrolling style.

### Fixed
- Fixed the problem that the RefreshToken exported after OAuth authorization cannot be used to obtain emails through IMAP (IMAP permission was not applied for during authorization).
- Fixed the unstable issue of Graph OAuth login failure detection.
- Fixed an issue where the uploaded account list might return to the front end and display the clear text password.

### Security
- The temporary password of the account uploaded by Outlook continues to be encrypted and kept in the backend. The list API, front-end form and authorization log will not return or display the clear text password.

**Important Note**: Authorized accounts need to be re-authorized to obtain IMAP access permissions; `Graph-only` mode does not include IMAP permissions. If you need IMAP access, please select the `Outlook IMAP` authorization mode.

## [2.7.0] - 2026-07-04

### Added
- A new "Add to Automatic Authorization" entry has been added to the official email account operation menu, which allows existing Outlook accounts to be directly added to the automated authorization queue; rejoining the queue with the same email address will overwrite the temporary password and reset it to an unauthorized state.
- Added the `POST /api/accounts/<account_id>/outlook-auto-auth` interface and `upsert_upload_account_for_auto_auth` data layer helper to read the official account email and password from the server and write them into the temporary table without returning the plain text password.
- Outlook automated authorization supports repeated authorization: after successful authorization, the password, `client_id`, `refresh_token`, and authorization update time of the official account will be overwritten, while business fields such as grouping, notes, aliases, labels, agents, forwarding, sorting, and start and stop will be retained; when authorization fails, the existing official account data will not be overwritten.

### Changed
- Graph OAuth automatic extraction no longer defines the `GRAPH_EXTRACT_CLIENT_ID` / `GRAPH_EXTRACT_REDIRECT_URI` environment variables separately, but instead reuses `OAUTH_CLIENT_ID` / `OAUTH_REDIRECT_URI` in `01_bootstrap.py`; `scope` and `authority` are still dedicated to Graph automatic extraction and remain independent.

### Security
- Added automatic authorization interface does not return plain text password from the response. The password is only read from the server-side encrypted data and encrypted and written to the temporary table.

## [2.6.0] - 2026-07-02

### Added
- Support echoing and saving account labels when editing email accounts.

### Changed
- The tag selector of the imported account is changed to reuse the unified searchable tag drop-down component.

## [2.5.0] - 2026-06-29

### Added
- Sharing management is changed to table view, which supports searching by email, filtering by status, and sorting by email/status/validity/creation time.
- Sharing management adds single deletion, batch cancellation and batch deletion capabilities, corresponding to the new sharing deletion and batch operation API.
- The account list label pill has a new hover removal entry, which can directly remove the label from the email account.

### Fixed
- The account label removal entry is no longer displayed when the temporary mailbox list reuses the label summary to avoid accidentally calling the account label interface.

## [2.4.0] - 2026-06-29

### Added
- Account list search keywords, search scope, sorting method and tag filter will now be saved locally in the browser and will be automatically restored next time you open or switch groups.

### Changed
- The account search scope is changed to "current group" by default to avoid misjudgment caused by default search across all groups.
- The Outlook automated authorization list no longer echoes the uploaded password to the front end, but only displays whether the password exists and the mask length.
- The Outlook upload account module incorporates the front-end resource hash, and the browser will automatically refresh the module cache after publishing.
- Clean up the old version of Graph OAuth comparison, implementation and Token extraction migration documents, and retain the current testing guide and API documentation.

### Fixed
- Fixed the problem that following the localhost callback redirection during the Graph OAuth login process resulted in the inability to reliably extract the authorization code.
- Fixed the issue where the online update container name in the Docker build example is inconsistent with the default compose service name.

### Security
- The Outlook temporary password uploaded by external API is changed to Fernet encrypted storage, and the temporary password is cleared after successful authorization.

## [2.3.2] - 2026-06-28

### Changed
- The homepage and mailbox sharing page use the light theme by default when no user saves the theme, and no longer follow the system's dark preference.

## [2.3.1] - 2026-06-28

### Changed
- Add content hash version parameters to the homepage CSS and JavaScript resource URLs, and the browser will automatically refresh the front-end resource cache after publishing.
- The home page HTML response is changed to disable caching to avoid continuing to load the old entry page after the upgrade.

### Fixed
- Fixed the issue where the built-in Editorial skin uses a fixed cache flag, causing CSS to not take effect after update.

## [2.3.0] - 2026-06-28

### Added
- Added system skin management function, which supports uploading, switching, and deleting custom skins (CSS themes) through API. The skin configuration is stored in the `data/skins/` directory.
- Added API endpoints related to skin management: upload skin, get current skin, switch skin, delete skin, reset to default skin.
- Added skin sample files (`docs/skin-example/skin.json`, `docs/skin-example/theme.css`) and skin development documents (`docs/skins.md`).
- Added dark/light theme switching function, supports automatic detection and manual switching of system preferences, and persists the state to localStorage.
- Added a new account list refresh button, which supports one-click refresh of the account list from the current group title bar, with rotation animation feedback.
- The navigation bar adds independent settings button, exit button and GitHub link icon button (desktop), replacing the original drop-down menu integrated layout.
- Added `editorial.css` skin file, providing Editorial style layout and color scheme.
- The browser extension popup and sidepanel are redesigned to a dark theme, introducing Plus Jakarta Sans font and gradient button style.
- Note: If you find that the color scheme is strange, please clear your browser cache.
### Changed
- Navigation bar layout reconstruction: the GitHub Star button is migrated to the navigation bar icon button, the operation menu is split into an independent icon button + "More Functions" drop-down menu on the desktop, and the original menu layout is retained on the mobile terminal.
- The mail list refresh button is changed to an SVG icon + rotation animation, replacing the original text and switching the display mode.
- The "Add Group" button and authorization button in the grouping panel are replaced with SVG icons to unify the visual style.
- Account panel toolbar, mailing list, modal box, Toast and other components are adapted to skin variables and support custom theme overrides.
- A new skin management interface is added to the settings page, which supports uploading, previewing, switching and deleting skins.

### Fixed
- Fixed the issue where the account list refresh button is incorrectly displayed when no group is selected, and is changed to be displayed only when a group is selected.

## [2.2.0] - 2026-06-27

### Added
- A new parallel execution mode is added to email forwarding, which supports scanning multiple email accounts at the same time. The number of parallel workers can be configured (1-10).
- The forwarding polling interval is changed to second-level precision (20-3600 seconds), replacing the original minute-level interval, retaining backward compatibility.
- User pill on the email sharing page supports clicking to copy the email address, and adds a new Toast prompt.
- Automatically ignore the account interval in parallel mode, and retain the original interval behavior in serial mode.
- Added `forwarding_run_lock` to forwarding scheduling to prevent concurrent execution.

### Changed
- Reconstruct `process_forwarding_job` into a modular architecture, extracting independent functions such as database connection, account decryption, task configuration construction, and channel sending.
- The browser extension sidebar settings page synchronizes the forwarding second-level interval, execution mode, and parallel worker configuration.
- The settings page forwarding configuration UI is changed to second-level interval input, execution mode selection, parallel worker input, and automatic linkage to disable/enable related controls when switching modes.

## [2.1.0] - 2026-06-27

### Added
- Added new email sharing function to support the creation of time-limited or never-expired read-only sharing links for a single email account.
- Added a new sharing management portal to view, copy and cancel created email sharing links.
- After the shared party opens the link through a browser, he can only read-only view the inbox and spam of the mailbox. Mailing lists and email details are supported, but the display of attachment information is not currently supported.

### Changed
- The email details reading logic is reused as an account-level helper for login pages and anonymous sharing pages.

## [2.0.75] - 2026-06-25

### Fixed
- Fixed an issue where Cloudflare's streaming progress request to auto-import mailboxes returned 500 after losing the Flask app context in production.

## [2.0.74] - 2026-06-25

### Added
- A new minimalist display mode is added to the email account panel, which can hide auxiliary information such as notes, labels, refresh status, etc. to increase list density.
- Added folding/expanding controls to the desktop grouping bar, and remembers the user's last selected folding state.

### Changed
- Optimize the icon display of tool buttons in the account panel and replace some emoji buttons with consistent SVG icons.

### Fixed
- Fixed the issue where HTTP exceptions such as unmatched routes were incorrectly converted to 500 by the global exception handler, retaining the original HTTP status code.

## [2.0.73] - 2026-06-25

### Added
- Cloudflare temporary mailbox import supports automatic recognition and compatibility with the old format `Mailbox----JWT`, and automatically extracts the mailbox part without manually modifying the old export file.
- A new "Test Connection" function has been added to Cloudflare channel settings, which supports one-click testing of three administrator APIs: domain name list, address list, and mailing list, and displays detailed test results.
- Added Cloudflare automatic mailbox import function, supports real-time progress display, and uses Server-Sent Events to stream import progress, percentage and statistics.

### Changed
- When automatically importing a large amount of data, it will be displayed in real time on the interface: imported quantity/total quantity (percentage) - Add, update, and skip statistics.
- Optimize the Cloudflare import user experience, providing a smooth migration path to old formats and visible import progress.

## [2.0.72] - 2026-06-19

### Changed
- The temporary mailbox generation pop-up window is changed to Cloudflare, GPTMail, and DuckMail segment switching layout, and Cloudflare channels, domain names, quantities, username generation methods, and label binding controls are optimized.
- The temporary mailbox configuration order on the settings page is adjusted to Cloudflare, GPTMail, and DuckMail, and the side navigation and front-end test contract are synchronized.

### Added
- Added password show/hide button in DuckMail temporary mailbox creation form.

## [2.0.71] - 2026-06-19

### Added
- Cloudflare has a new batch generation entry for temporary mailboxes, which supports creation by quantity, partial failure details, and automatic label binding for successfully created mailboxes.
- Cloudflare temporary mailbox adds AI username generation configuration, supports OpenAI-compatible API, test generation before saving, and explicitly generates and edits username list in the generation pop-up window.

### Changed
- The Cloudflare temporary mailbox generation pop-up window is changed to a multi-line username input, one per line; only an explicit username list or a random username is used when submitting the creation, and AI is no longer implicitly called during the creation phase.
- Cloudflare temporary mailbox import retains the label selection, and shows the `[cloudflare:<channel_name>]` segment and `mailbox----JWT----channel name` writing method in the interface example.

### Fixed
- Fixed the problem of desktop layout misalignment when the same section of the settings page contains multiple panels.

## [2.0.70] - 2026-06-18

### Added
- Group management adds up to three levels of tree hierarchy, supporting creation, editing, folding and expansion, sibling sorting, and dragging and moving groups across levels.
- The add/edit group pop-up window adds a new parent group selection, and group drop-down, batch move, export selection and browser extension export are all adapted to tree display.

### Changed
- When a group is selected, the account list, account search, group export, all group export and project grouping range will include the group and all sub-group accounts.
- When a child group is not configured with a proxy, it will inherit the parent group proxy upwards; the account-level proxy still takes precedence over the group proxy.
- When deleting a group containing subgroups, the subgroups will be deleted cascading and all related accounts will be moved back to the default group.

### Fixed
- The `group_id` account filtering of external API maintains direct grouping semantics to avoid changing the scope of the existing external API after tree grouping upgrade.
- Group export will remove duplicate accounts when selecting parent and child groups at the same time to avoid repeatedly exporting child group accounts.

## [2.0.69] - 2026-06-15

### Fixed
- Fixed an issue where Microsoft Graph attachment metadata query failed to obtain the attachment list due to selecting the unsupported `contentId` field.
- Fixed the issue where the Graph email details lost the `has_attachments` mark when the attachment metadata is empty, ensuring that the local retention cache can recognize that the attachment metadata is incomplete and complete it back to the source.
- Fixed the issue where `id_mode` is not stably carried in ordinary mailbox detail requests, to avoid the mixed use of Graph, UID and sequence message ID semantics resulting in failure to read details or attachments.

## [2.0.68] - 2026-06-14

### Fixed
- Fixed an issue where the local retained details of an ordinary mailbox are directly returned to the local cache when the cache is marked with an attachment but the attachment metadata is empty, resulting in the email details not displaying the attachment; now the remote details are returned to fill in the attachment metadata and the local cache is backfilled.

## [2.0.67] - 2026-06-08

### Added
- Token refresh management mailbox list adds a new paging control, supports switching between 100 and 10,000 items per page, previous page/next page and page number jump, and remembers the number of each page selected by the user.

### Changed
- The upper limit of `page_size` for `/api/accounts/refresh-status-list` is increased from 500 to 10000, and the front-end list summary is changed to display the project range of the current page.

## [2.0.66] - 2026-06-08

### Added
- Token refresh management mailbox list completely transplants the batch operation of ordinary mailbox list, supporting selection mode, row click, `Shift` continuous selection, drag and drop selection, as well as refreshing Token, copying mailbox + alias, export, forwarding switch, proxy, label, move grouping and deletion.

### Changed
- Batch account changes in Token refresh management will synchronously refresh the Token list, primary email account list, group count and related front-end cache to avoid inconsistency in the status of the two lists.

## [2.0.65] - 2026-06-07

### Added
- Outlook OAuth account has a new re-authorization entry, which supports updating existing account authorization from the edit account pop-up window and refresh failure prompt and automatically triggers single account refresh verification.
- Added `POST /api/accounts/<account_id>/reauthorize` interface, which only updates existing account authorization fields and retains email, password, group, agent, label and other business information.

### Fixed
- Reauthorize and save the new authorization information before submitting the database transaction and then performing automatic refresh verification to avoid holding SQLite write locks during external refresh requests.

## [2.0.64] - 2026-06-07

### Added
- Cloudflare Temp Email adds multi-channel management, supporting the configuration of channels for multiple sets of workers, administrator passwords and independent mail pools.
- The settings page adds a Cloudflare channel list and the ability to create, edit, activate/deactivate, delete, and display the number of channel references.
- Cloudflare temporary mailbox creation, reading, deletion and all email views support execution by channel; all email entries are displayed independently by channel.
- Cloudflare temporary mailbox import and export supports the `[cloudflare:<channel_name>]` segmented format, and the old format continues to fall into the default channel.

### Changed
- The old single-channel Cloudflare configuration will be migrated to the default channel at startup, and the existing Cloudflare temporary mailbox will be automatically bound to the default channel.
- Cloudflare channel email domain name is changed to optional; the channel can still be saved when no domain name is configured, and domain name query returns an empty list.
- `/api/cloudflare/messages` uses the default Cloudflare channel instead when `channel_id` is not transmitted.
- Cloudflare channel names remain unique according to case-insensitive rules, and duplicates after old case-conflicting data are automatically renamed during migration.

### Fixed
- Fixed an issue where the "New Channel" button in the Cloudflare channel form actually only clears the form, causing misoperation.
- Fixed the issue of repeated display of channel names in all Cloudflare email portals.

## [2.0.63] - 2026-06-04

### Added
- The new version prompt pop-up box is changed to be displayed when a new remote version is detected, and the latest 3 update records are displayed.
- The new version pop-up box adds "Go to Download" and Docker online update entrance; the configuration instructions are retained when Docker online update is not enabled.

### Changed
- The version status interface adds remote update description parsing, giving priority to extracting the latest 3 version sections from the remote `CHANGELOG.md`, and retaining the original `release_notes.items` compatibility field.
- The new version prompts to deduplicate the latest remote version, and no longer pops up according to the current running version after the user has updated.

## [2.0.62] - 2026-06-04

### Changed
- Reconstruct the layout of the edit email account pop-up window to display basic information, authentication information, proxy settings, notes and aliases in partitions to reduce scrolling of long forms.
- The edit account pop-up window is changed to a wider, compact two-column layout on the desktop, and automatically falls back to a single column on the mobile.
- The alias prompt copy is changed to "API available alias query" to avoid misunderstanding that only external API supports aliases.

## [2.0.61] - 2026-06-04

### Added
- Added two-step verification for account password and IMAP password on the account editing page. Saved passwords are hidden by default and will only be displayed after entering the current login password.

### Changed
- `GET /api/accounts/<id>` no longer returns the clear text of the account password and IMAP password, but only returns the `has_password` / `has_imap_password` mark; to view the password, you must call `/api/accounts/<id>/secrets` and complete the second verification of the login password.
- The entrance to display the account and password on the web side is changed to the small eye button in the input box. The verification pop-up window will cover the top of the editing pop-up window. After verification, the password can be viewed directly in the original editing pop-up window.
- The browser extension account editing page adapts the password hiding logic and retains the saved password when the password is not filled in.

### Fixed
- Fixed the issue where omitting the `password` or `imap_password` field when editing the account will clear the saved password.

## [2.0.60] - 2026-06-01

### Fixed
- Fixed the problem of lack of available exit entrance after the desktop application installed by macOS DMG is opened; the macOS package runtime now reuses the controllable desktop service, and can stop the background service when exiting through the status bar menu.

## [2.0.59] - 2026-06-01

### Added
- Added macOS DMG installation package building script to support generating `OutlookEmail.app` installation package that can be dragged and dropped.
- GitHub Release workflow adds macOS x64 and arm64 installation package products, and verifies the binary architecture before uploading.

### Changed
- The search box retains the ability to input multiple lines, but the default display height is condensed to one line, and the placeholder prompt copy is reduced and compressed.
- The PyInstaller packaging configuration is changed to `.app` bundle under macOS, and the Windows `exe` build maintains the original onefile behavior.

## [2.0.58] - 2026-06-01

### Added
- Account search supports multiple keywords separated by spaces or newlines. If any keyword hits the main mailbox, alias mailbox, notes or tags, the results will be returned.
- The search box is changed to multi-line input to facilitate batch pasting of emails or keywords, and is limited to a maximum of `200` unique keywords.

### Changed
- The `q` parameter of `/api/accounts/search` is changed to multi-keyword OR search semantics, and an explicit error is returned when the keyword limit is exceeded.
- Temporary mailbox list search reuses multi-keyword matching logic and keeps Cloudflare global entries case-insensitive.
- API document synchronization explains multi-keyword search rules and quantity limit.

## [2.0.57] - 2026-05-29

### Added
- Added account-level proxy configuration. Ordinary email accounts can set the main proxy, fallback proxy 1 and fallback proxy 2 separately.
- Added "Agent" to the email account batch operation column, which supports batch setting or clearing of account-level proxies for selected accounts.
- `/api/accounts/batch-update-proxy` supports batch setting of account-level agents, and the import and update account interface also supports account-level agent fields.

### Changed
- Ordinary mailbox links such as mailbox reading, token refreshing, attachment, deletion and forwarding capture now preferentially use account-level agents; when the account agent is empty, the group agent will continue to be inherited.
- A new account agent input item has been added to the account editing pop-up window, and the agent error prompt has been changed to point to both account agents and group agents.
- API documentation supplements account-level agent fields, batch agent interface and agent inheritance priority.

### Fixed
- Fixed the problem that when the secondary confirmation is triggered in the batch proxy setting pop-up window, the confirmation pop-up window is blocked by the proxy setting pop-up window.

## [2.0.56] - 2026-05-29

### Added
- Added "Export" to the batch operation column of email accounts, which can directly export the checked ordinary email accounts after filtering by label, search or current list.
- `/api/accounts/export-selected` supports exporting specified accounts through `account_ids`, while retaining the original `group_ids` ability to export selected groups.

### Changed
- The exported secondary verification process reuses the existing security confirmation pop-up window and automatically submits the selected account or selected group according to the source.
- API documentation, README and troubleshooting documentation supplement selected account export instructions.

## [2.0.55] - 2026-05-29

### Added
- Added the local retention function of ordinary mailboxes, which can cache the ordinary mailbox list metadata and read body of Outlook/Hotmail, OAuth IMAP fallback link and standard IMAP to native SQLite.
- Ordinary mailbox lists support local priority rendering, and then synchronize remote Graph/IMAP data in the background; display non-interruptive prompts when new emails are discovered simultaneously, and can be merged into the current list after user confirmation.
- Email details support priority reading of the local reserved body. After the remote details are read successfully, the body cache is automatically backfilled. When the remote failure fails, the cached body can be displayed back.
- Added local retention settings, storage statistics, cleanup status and cache cleanup operations for ordinary mailboxes.
- Added `/api/emails/retain-bodies`, `/api/settings/normal-mail-retention/status` and `/api/settings/normal-mail-retention/clear` interfaces.
- Added `docs/local-mail-retention.md` to explain the local retention range, synchronization behavior, detail text retention, cleanup strategy and stage restrictions of ordinary mailboxes.

### Changed
- Ordinary mailbox list, details, mark read and delete operations will maintain the local retention status synchronously, and the retention data is controlled by the `normal_mail_local_retention_enabled=false` switch by default.
- Outlook/Hotmail OAuth's IMAP fallback details and attachment download support `id_mode=uid|sequence`, which is read by UID by default to avoid mixing UID and serial numbers.
- Ordinary mailbox keyword filtering will give priority to checking the cached text, and only make up for remote reading when remote details are needed.
- Ordinary mailbox paging parameters are changed to safe parsing, non-numbers use default values, negative numbers are processed as `0`, and the maximum remote list `top` is `50`.
- The settings page displays the number of saved messages, cached text, estimated retention size and SQLite database size retained locally in ordinary mailboxes, and prompts to confirm cleanup when the retention switch is turned off.
- README, local retention instructions and API documentation supplement general mailbox local retention, text completion, cleanup status, `id_mode` and attachment download behavior.

### Fixed
- Fixed the problem that when interface paging parameters such as refresh logs and forwarding logs are not boundary protected, errors may be reported due to illegal input or excessive paging requests.
- Fixed the problem that external API Key comparison does not perform stable string normalization and constant time comparison.
- Fixed the problem that local retention of duplicate messages in ordinary mailboxes under different `id_mode` may affect list deduplication, detail backfill and refresh query.
- Fixed the issue where limited retries are missing when cleaning the local retention cache of a general mailbox when encountering a short-lived SQLite lock, and repeated cleaning requests may start multiple cleaning tasks.
- Fixed the problem that subject, sender and keyword filtering is applied only after paging the local reserved list of ordinary mailboxes, resulting in the first screen missing and `count` and `has_more` being inaccurate when matching emails are located on subsequent pages.
- Fixed an issue where more emails may be duplicated or skipped due to offset drift during background synchronization inserting new emails during local retention list display and continuing to load more emails.
- Fixed an issue where the front-end memory cache may continue to display the cleaned local mailing list after cleaning or turning off local retention of ordinary mailboxes.

## [2.0.54] - 2026-05-23

### Added
- Added Chrome/Edge browser extension to support common functions such as mailbox, import, refresh, token, export, tags and settings in the sidebar.
- Added browser extension password login bridge interface `/api/extension/login` and one-time login jump `/extension-login/<token>`. The extension can use the web login password to establish a normal Web Session.
- A new version update prompt pop-up box has been added to the homepage. When users open the interface for the first time after updating, they will see a description of the new features of this version, and each version is only prompted once.

### Changed
- README adds browser extension entry description and converges the complete release process to `RELEASE.md`.
- API documentation complements the browser extension password login process.

## [2.0.53] - 2026-05-21

### Added
- A new batch selection mode is added to the email account list, which supports batch selection of accounts through account row selection, multi-select box selection, `Shift` continuous range selection and drag and drop selection after clicking "☑".

### Changed
- The PC mailbox account batch operation menu is changed to float on the right side of the first selected account, and is repositioned as the account list scrolls, reducing the space occupied at the bottom.
- README adds detailed instructions for batch selection, drag-and-drop selection, batch menu and email batch operations.

### Fixed
- Batch selection gesture initialization adds function existence protection to avoid blocking the home page initialization when the old page status or script loading order is abnormal.
- Fixed the issue where continuous selection cannot be made when pressing and dragging from the account selection box in batch selection mode, and added troubleshooting instructions for Mac trackpad drag selection.

## [2.0.52] - 2026-05-20

### Added
- Importing email accounts supports the unified setting of notes, labels and status of new accounts without changing the account text format.

### Changed
- Reconstruct the PC layout of the pop-up window for importing email accounts, dividing the account information and import settings into two columns for display.
- The import tag drop-down supports automatic closing when clicking outside the drop-down area.

## [2.0.51] - 2026-05-19

### Fixed
- Fixed the problem of misjudgment that there is no next page on the first screen of the custom IMAP mailing list, ensuring that bottoming out the drop-down can continue to trigger paging loading, and adding paging boundary regression testing.

## [2.0.50] - 2026-05-19

### Changed
- The "Settings Navigation" on the left side of the settings pop-up layer supports independent scrolling under the desktop width, preventing the navigation from exceeding one screen when the number of setting items increases.

## [2.0.49] - 2026-05-19

### Changed
- The WebDAV backup settings page moves the "Test WebDAV" button next to the URL, username, and password configuration areas to reduce cross-screen operations when testing connections.
- The WebDAV directory URL prompt adds a description of "the directory needs to be created first" and gives an example path to Nut Cloud `mailBackup`.

### Fixed
- Fixed the issue where Outlook Refresh Token did not continue to fall back to the old `.default` or scope-less refresh mode when it encountered the `AADSTS70000` scope unauthorized/expired response.
- Outlook Refresh Token will continue to try IMAP OAuth refresh after a Graph refresh fails, and save the rotation `refresh_token` returned by IMAP.
- WebDAV tests and manual uploads return actionable directory creation and path checking prompts when encountering HTTP 404/409, to avoid showing just a status code.

## [2.0.48] - 2026-05-18

### Fixed
- Fixed the issue where some Outlook Refresh Token failed to refresh under `.default` Graph scope and returned `AADSTS90023`; Graph token obtains the explicit delegation scope when authorization is now preferred, and retains scope-less compatible fallback in refresh detection.

## [2.0.47] - 2026-05-18

### Added
- Cloudflare Temp Email adds a new "Cloudflare All Mail" view, which allows you to view all Worker mails through the administrator interface, and supports filtering by recipient address and bottom paging loading.
- Email query supports mutual fallback of `gmail.com` and `googlemail.com` suffixes; when the original address does not match, another suffix will be automatically tried.

### Changed
- All Cloudflare mailing lists reuse existing mailing list details for rendering, and display recipient addresses and source identifiers in the list.
- Added stable `resolved_query_email`, `fallback_used`, and `fallback_email` fields to email query responses to indicate the actual hit query address.

## [2.0.46] - 2026-05-14

### Added
- A new range selection is added to the mailbox list search box, which can switch the filtering range between "all groups" and "current group".
- The account search interface `/api/accounts/search` adds the optional `group_id` parameter to support searching only accounts in the specified group.

### Changed
- The title of the current group search results will indicate the group scope, and the global search results will continue to display the group information to which the account belongs.

## [2.0.45] - 2026-05-12

### Added
- A new "Show Email Source" entry has been added to email details, allowing you to view the original MIME email source code on demand.
- The original email viewer supports copying source code and downloading `.eml` files, and prompts that the complete email header contains sensitive routing information.
- Added `/api/email/<email>/<message_id>/raw` interface to the backend, supporting Graph `$value`, Outlook IMAP `RFC822` and custom IMAP accounts to obtain email sources.

### Changed
- The email details toolbar returns the trust mode text to "Trust this email" and names the original email entry as "Show Mail Source".

## [2.0.44] - 2026-05-08

### Added
- Added server-side paging parameters and rolling loading to the mailbox list. The maximum number of items on a single page is `10000`.
- The mailbox list supports filtering by tags on the server side, and returns `total`, `offset`, `limit` and `has_more` paging status.

### Changed
- The batch import of ordinary mailboxes is changed to batch writing of single transactions, which improves the import performance of 10,000-level accounts and returns the number of new, skipped duplicates and invalid rows.
- Mailbox list loading is changed to batch preloading of labels and aliases, and a frequently used account query index is added to reduce the cost of querying large lists.
- Tag filtering and single-page article number control are compressed and displayed in the same row, and batch selection of copywriting is changed to "loaded" accounts.

## [2.0.43] - 2026-05-08

### Added
- Token refresh management adds current list selection, clear selection, refresh selected and delete selected batch operations.
- Added a new interface for streaming refresh tasks of selected accounts: first initialize the task through `POST /api/accounts/refresh-selected-stream`, and then subscribe to the SSE progress through the returned `stream_url`.

### Changed
- "Refresh Selected" in Token refresh management no longer puts `account_ids` into SSE GET query, but instead POST initializes the task and then subscribes to the task flow.
- The deployment document makes it clear that the service needs to keep a single worker running; the official Docker image continues to use Gunicorn single worker + multi-thread mode.

### Fixed
- After deleting accounts in batches, the Token will be refreshed synchronously, and the management list, main account list, and related local cache will be refreshed to prevent the deleted accounts from still being displayed on the interface.

## [2.0.42] - 2026-05-07

### Added
- A new "Show Group ID" switch has been added to the system settings, which can uniformly control the display of group ID logos in group lists, account summaries, etc.
- When the version button on the home page detects that a higher version exists in the warehouse, it will display an upgrade arrow prompt icon that shares the click entry with the version button.

### Changed
- The settings page puts the login password and external API Key into "General Settings", and moves the three temporary mailbox settings of GPTMail, DuckMail, and Cloudflare to the bottom of the settings page.
- The homepage upgrade prompt is changed from text to an upward arrow icon, and follows the golden color scheme of the GitHub Star logo.
- Supplementary instructions for the version elastic layer: Only the Docker version supports online updates, and guides you to view the corresponding configuration documents in the README.

### Fixed
- Fixed the problem that the version upgrade prompt on the homepage is still displayed when the versions are the same, added the style cover in the `hidden` state, and only displays the upgrade icon when the current version is lower than the warehouse version.

## [2.0.41] - 2026-05-06

### Fixed
- Fixed the problem of Docker online update being unable to obtain container status on newer Docker daemons because the API version is too old; when the daemon explicitly returns the minimum supported version, the application will automatically retry according to that version.
- Fixed the issue where the Watchtower container pulled up by Docker online update did not inherit the Docker API version, causing the check/update to directly fail.
- Fixed the issue where Watchtower's log summary with ANSI color code could not be parsed correctly, to avoid mistakenly reporting the "no update required" result of `Failed=0 / Updated=0` as an update failure.

## [2.0.40] - 2026-05-06

### Changed
- Docker online update status adds file persistence, retaining only the latest result; after the container is restarted from the update, the new process will restore the latest task status.
- Docker online update adds an independent `DOCKER_UPDATE_STATUS_TIMEOUT` for status query and container inspect to avoid reusing the actual update task timeout.
- Documentation supplement Docker online update only applies to restrictions on variable image tags such as `latest`, `main`, and `dev`.

### Fixed
- Fixed the problem of Docker online update losing task status after the current container is restarted. After the service is restarted, the interrupted task will be restored to the final state of "unknown result".
- Fixed the problem of Docker online update front-end polling ending silently at `success == null`, instead explicitly prompting "The service may have been restarted, please refresh and check the current version/image".

## [2.0.39] - 2026-05-06

### Added
- Added "Download All" in the email details attachment area, which can package multiple attachments of the same email into ZIP downloads.
- A new Docker online update portal has been added to the version elastic layer, which can trigger container updates from the interface after enabling `DOCKER_UPDATE_ENABLED`.
- Added `/api/docker-update/status` and `/api/docker-update`, which are used to query Docker update capabilities and start update tasks protected by login and CSRF.

### Changed
- Docker online updates are performed via a one-time Watchtower container instead, and the corresponding `DOCKER_HOST` is injected for the custom `DOCKER_UPDATE_SOCKET`.
- README moves the Docker online update configuration into an optional section and provides a complete `docker-compose.yml` example to avoid the default example from directly mounting the Docker socket.

### Fixed
- Completely read the Docker pull response stream and detect `error` / `errorDetail.message` to avoid misjudgment that the update task has been started when the Watchtower image pull fails.

## [2.0.38] - 2026-05-03

### Added
- Added WebDAV backup configuration to system settings, supporting 5-segment Cron using the time zone in general settings to calculate the next execution time.
- WebDAV backup supports test connection and manual upload; testing only uploads temporary test files, manual upload will immediately upload the real backup file of "Export All Groups".

### Changed
- The login password needs to be verified when modifying WebDAV backup related settings and manually uploading real backups to reduce the risk of sensitive export data being uploaded by mistake.
- The generation logic of "Export selected group" is extracted and reused, and WebDAV backup uses the same group file format as the export function.

### Fixed
- Fixed the issue where the non-existent `selectedTagIds` was referenced when rendering the empty result of the temporary mailbox list, causing the front-end to report an error after saving the settings.
- Fixed the issue where "Failed to save settings" would be incorrectly displayed if the list failed to be refreshed after successfully saving the settings. Instead, it was clearly prompted that the settings had been saved but the list refresh failed.

## [2.0.37] - 2026-04-29

### Added
- A new "Show sorting value" switch has been added to the system settings to control whether custom sorting values ​​are displayed at the bottom of the ordinary mailbox list.

### Changed
- "Show sorting value" is changed to off by default; under new installation or default configuration, ordinary mailbox lists no longer display sorting values ​​by default.

### Fixed
- Complete the setting persistence, startup recovery, list instant refresh, API documentation and regression testing of the sort value display switch.

## [2.0.36] - 2026-04-29

### Fixed
- Added "account interval" second-level configuration to forwarding settings. When forwarding polling processes multiple enabled forwarding accounts, it will wait between accounts as configured to avoid pulling multiple accounts continuously in a short period of time.
- Complete the setting persistence and regression testing of the forwarding account interval, covering the setting interface echo and the waiting behavior between multiple accounts.

## [2.0.35] - 2026-04-29

### Fixed
- Fixed an issue where automatic replenishment pull requests may still be triggered when switching cached mailboxes. Switching to ordinary mailbox accounts will only display the current cache, and the next page will no longer be implicitly refreshed due to the list display action.
- Fixed the problem of paging baseline misalignment when caching `All Mail` to derive `Inbox/Spam` view, added `fetched_count / has_more / success` metadata by folder dimension and added corresponding regression tests.

## [2.0.34] - 2026-04-28

### Added
- Token refresh management adds a full refresh task log panel and a stop task button to support viewing account-level progress and results during execution.

### Changed
- Token refresh management removes the "Latest Full Refresh" card display, and the top statistics area converges to three items: total number of mailboxes, successful mailboxes, and failed mailboxes.
- The Token refresh confirmation box is changed to an overlay display, and the Token refresh management pop-up window is no longer closed when a full refresh is triggered.
- Token refresh management removes the running progress card and changes it to continuously display the task log in the pop-up window.

### Fixed
- Fixed the encoding exception triggered when the Windows console outputs Unicode symbols, and unified the scheduler, forwarding and error log output with encoding safety.
- Fixed the SchedulerNotRunningError caused by repeatedly calling shutdown() during the exit phase of the scheduler. The atexit callback uniformly reuses the idempotent shutdown_scheduler(), and added regression testing.
- Fixed the problem that the pop-up window context could not be retained during the full refresh process, and added the stop task interface, stop event callback and related regression tests.
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
## [2.0.33] - 2026-04-28

### Added
- A new persistent custom sorting value `sort_order` is added to the account. The list supports viewing by sorting value, creation time or email name.
- A new "Show creation time" switch has been added to the system settings, which is turned on by default; the account creation time can be displayed in the lower left corner of the email list according to the application time zone.
- Token refresh management adds a new workbench mailbox list, supports search by mailbox/notes/group, and filters by `all/success/failure/never refreshed` status.

### Changed
- Token refresh management removes the running progress card and changes it to continuously display the task log in the pop-up window.
- The "Last Refresh" time display and corresponding sorting entry are removed from the mailbox list. When `sort_order` is not set, the default falls back to sorting by creation time.
- Reconstruct the side navigation of the desktop settings page, remove the `Control Center` / Save reminder card, add a top "General Settings" partition, and move the time zone and creation time display switches into this partition.
- The display of serial numbers has been removed from ordinary mailboxes and temporary mailbox lists. The list card only retains the main mailbox information and status content.
- The main read path of Token refresh status converges to `accounts + token_refresh_state`, the refresh management pop-up window is changed to a single workbench of "Snapshot + Filter + Mailbox List", and the independent "Failed Mailbox/Refresh History" block is removed.
- The mailbox list in Token refresh management is further condensed into a table view, which uniformly displays mailbox, group, recent refresh, status and operation columns.

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed the problem of dynamic coverage route of account update not being synchronized and transparently transmitting `sort_order` to avoid custom sorting from invalidating after editing and saving.
- Unify the `sort_order` return structure in the account list, search results and details interface, and complete the corresponding regression tests.
- Fixed the problem of generating illegal `*/60` Cron expression when the email forwarding polling interval is set to `60` minutes. It is triggered on the hour instead and the corresponding regression test is added.
- Fixed the issue where the snapshot status mistakenly dropped to `idle` when the full token refresh was abnormally terminated. Instead, `failed / partial_failed` was recorded correctly, and the failure status of the current account was recorded.
- Fixed the problem that full token refresh can be triggered repeatedly, and added backend mutual exclusion and frontend conflict prompts to avoid concurrent tasks from overwriting the latest snapshot of the same round.
- Restore `account_refresh_logs` half-year history cleanup to avoid long-term unlimited growth of refresh logs, and update refresh-related API documents synchronously.

## [2.0.32] - 2026-04-24

### Added
- A new "unlabeled" virtual item is added to label filtering, which supports separate filtering of unlabeled accounts and temporary mailboxes, and maintains the OR filtering semantics with existing labels.


## [2.0.31] - 2026-04-24

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed the problem that the internal mail-retrieval interface would mistakenly update the account `last_refresh_at` to prevent the "last refresh time" from being contaminated by ordinary mail-receiving actions, and added corresponding regression tests.


## [2.0.30] - 2026-04-24

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed the problem that the Outlook account did not persist the new `refresh_token` returned by Microsoft after successful manual refresh, batch refresh and scheduled refresh, to avoid the subsequent use of the old token resulting in `AADSTS70000 grant is expired` type failure errors, and added corresponding regression tests.


## [2.0.29] - 2026-04-23

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed the event timing problem when multiple modal boxes and full-screen email details are clicked to close on the background layer. The background closing is processed uniformly in the `mousedown` stage to reduce accidental touches and abnormal closing.


## [2.0.28] - 2026-04-22

### Added
- Added application time zone selection in system settings, supports previewing Cron's next running time according to the saved time zone, and unifies log and OAuth related time display.
- During the page initialization phase, `/api/settings` will be actively read to restore the global time zone, and there is no need to open the setting pop-up window first.

### Changed
- Token refresh management removes the running progress card and changes it to continuously display the task log in the pop-up window.
- The scheduled refresh and mail forwarding scheduler is changed to create triggers based on `app_timezone`; when the old library is upgraded, it falls back to `Asia/Shanghai` by default.
- Added a new GitHub Actions workflow that automatically merges `main` into `dev` after being pushed to reduce branch offset after release.

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed the time zone update statement mistakenly inserted in the account adding process to avoid the front-end error after successfully saving the account.
- Corrected the prompt for successful saving of settings, clarifying that "time display takes effect immediately, scheduled tasks need to be restarted to take effect."
- Completed the regression verification of loading the front-end startup time zone, refreshing the display after saving the non-default time zone, and the default behavior of `app_timezone` upgrade in the old library.
- Synchronously update the `app_timezone` and `time_zone` field descriptions of the interface set in `docs/api.md`.


## [2.0.27] - 2026-04-20

### Added
- Added unread status display and batch "set as read" operations to the mailing list, supporting unified update of read status after selecting multiple emails on the front end.

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed the issue of occasional `The CSRF session token is missing` when saving settings or importing mailboxes in Docker deployment scenarios. Instead, obtain a non-cacheable CSRF token based on the current login session, and automatically refresh and retry when the front end encounters a CSRF mismatch.
- Fixed the issue where Gmail in `IMAP (Generic)` mode caused all emails to be displayed as unread for a long time due to `FETCH` response fragmentation, and changed to parse IMAP `FLAGS` and `INTERNALDATE` as a whole package.

## [2.0.26] - 2026-04-19

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed the issue where the next page of emails was not loaded after the desktop email list was scrolled to the end, and enhanced the paging offset calculation and automatic reloading check after list re-rendering.

## [2.0.25] - 2026-04-19

### Added
- Added tag capabilities to the temporary mailbox list, supporting displaying tags, filtering by tags, and adding or removing tags in batches within temporary mailbox groups.
- Added temporary mailbox batch deletion interface and front-end selection operation to facilitate the unified cleaning of temporary mailboxes in the same batch toolbar.

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed the problem that the tag system only supports ordinary accounts in the temporary mailbox scenario, and completed the database association, interface return and front-end search linkage of the temporary mailbox.
- Supplement back-end regression testing for the temporary mailbox label interface, covering label echo and batch adding and subtracting labels process.

## [2.0.24] - 2026-04-19

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed the problem that the grouping order may be lost after the application is restarted, ensured that the grouping order after dragging can be stable and persisted, and added corresponding back-end regression testing.
- Fixed the line-breaking display of sample text in the account import pop-up window to prevent the sample format from being squeezed into a single line and affecting the batch import judgment.
- Fixed the problem that the "By Days"/"Cron Expression" and other tabs in the desktop settings page covered the "System Settings" title bar when scrolling down. Instead, the content area scrolled independently and the sidebar linkage logic was adjusted simultaneously.

## [2.0.23] - 2026-04-19

### Added
- A new version information display is added to the top navigation, which supports viewing the current version, copying the version number and jumping to the update log.

### Changed
- Token refresh management removes the running progress card and changes it to continuously display the task log in the pop-up window.
- Adjust the layout of the navigation brand area and organize the version information and GitHub entrance into a more unified product meta information area.
- Redraw the GitHub Star button style and change it to a capsule button that is more in line with the current console style, and add hover, active, and focus feedback.

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed the problem of unresponsiveness when clicking on the top version information in some browser environments, and changed it to a more stable global triggering method.

## [2.0.22] - 2026-04-17

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed the problem of missing authentication decorator for `PUT /api/accounts/<id>`, `GET /api/emails/<email>`, and `GET /api/external/emails` after dynamic overwriting to avoid bypassing access control when not logged in or not carrying API Key.
- Add a startup protection assertion for dynamic routing coverage. If a key endpoint is replaced by an unwrapped function, an error will be reported directly when the application starts, preventing the authentication from silently failing again.
- Supplement regression testing of external email interface, internal email interface, account update interface and dynamic endpoint protection tag, covering actual 401 behavior and routing registration status.

## [2.0.21] - 2026-04-17

### Added
- Added attachment list display and download capabilities for email details, supporting Graph and IMAP mailboxes to directly view and download email attachments.

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed the problem that IMAP plain text email details were incorrectly spliced ​​into the body content with the literal `<br>`. Now the plain text is returned correctly.

## [2.0.20] - 2026-04-16

### Added
- Added the "Copy Email + Alias" batch operation to the account list on the left, which can copy the main email address and all alias email addresses of the selected account at once, and automatically remove duplicates and write them to the clipboard.

## [2.0.19] - 2026-04-15

### Added
- Added built-in `2925 mailbox` type, using `imap.2925.com:993` by default, and added automatic recognition of domain names to providers and front-end import/edit drop-down items.

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed an issue where some custom IMAP / 2925 IMAP servers could not correctly return `SEARCH` / `UID SEARCH` results, and the list was empty even though there were emails in the inbox.
- Added `UID SEARCH -> SEARCH -> Direct FETCH by EXISTS number' multi-layer fallback for IMAP list and detail query, which is compatible with servers that implement non-standard implementations.

## [2.0.18] - 2026-04-15

### Added
- Added a new project runtime backend model that supports managing the independent status of mailboxes within the project by `project_key`, and provides complete interfaces for starting projects, project lists, project account lists, receiving, success, failure, release, reset failure, moving out of projects, and restoring projects.
- Supplement back-end regression testing when the project is running, covering key paths such as starting the project, completing the group range, requiring manual reset after failure, deleting and re-importing to the same mailbox to inherit the old project status.

### Changed
- Token refresh management removes the running progress card and changes it to continuously display the task log in the pop-up window.
- The "create project + range completion" design is converged into a single "start project" semantics. When the same project is started repeatedly, only newly added mailboxes will be added, and the status of existing projects will not be reset.
- The mailbox identity within the project is changed to be maintained by email address instead of pure `account_id` to avoid re-importing the same mailbox after deletion and bypassing the existing `done` / `failed` status.

### Documentation
- Supplemented the project management interface documentation in `docs/api.md`, covering status descriptions, startup project semantics, query parameters, key request/response examples, and `deleted` and re-import reuse rules.

## [2.0.17] - 2026-04-15

### Added
- Added enterprise WeChat group robot Webhook forwarding channel. Just fill in the Webhook address to use it as an independent forwarding channel.
- Supplement setting persistence, test sending and basic regression testing for enterprise WeChat forwarding, covering setting saving and actual sending call.

### Changed
- Token refresh management removes the running progress card and changes it to continuously display the task log in the pop-up window.
- Modify the release process to support automatic triggering of the GitHub Release workflow after pushing the `vX.Y.Z` version tag, and change manual triggering to a cover-up solution.
- Adjust Docker build parameters, turn off provenance / SBOM attestation, and avoid additional `unknown/unknown` platform entries in GHCR releases.


## [2.0.16] - 2026-04-15

### Changed
- Token refresh management removes the running progress card and changes it to continuously display the task log in the pop-up window.
- Reconstruct the desktop settings interface to a wider two-column layout, and add left-hand quick positioning navigation to the main settings module.
- Add click positioning and scroll linkage highlighting to the settings navigation to reduce the cost of searching back and forth in the long settings form.
- Condensed "Email Forwarding Settings" into a more control-oriented compact layout, and organized polling parameters, action buttons and channel configurations into high-density desktop panels.

### Added
- Add module-level quick jump entry to "Current Contains" on the left side of the desktop settings page, supporting direct jump to Access, DuckMail, Cloudflare, refresh policy and email forwarding.
- Add a default foldable drawer panel for "Recent forwarding history" and "Recent forwarding failure", expand the log list as needed, and shorten the default page height.


## [2.0.15] - 2026-04-15

### Documentation
- Added Chinese release instructions, supplemented version number rules, standard release process, GitHub Actions behavior and post-release checklist.
- Added a new upgrade guide, covering the upgrade, rollback and precautions for Docker, Windows `exe`, and Python direct running scenarios.
- Adjust the image tag description and release process description in `README.md` and deployment documents to make them consistent with the current workflow.

## [2.0.14] - 2026-04-14

### Added
- Added progressive `+suffix` fallback matching for mailbox and alias lookups so internal and external mail APIs can resolve addresses such as `user+work@gmail.com` back to the managed primary mailbox or alias.

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed aggregated `folder=all` ordering for IMAP/Gmail mailboxes by normalizing RFC822 timestamps that include trailing timezone labels such as `(UTC)`.
- Fixed IMAP all-mail merging to prefer the server-reported `INTERNALDATE` when available so merged results are sorted by received time instead of unreliable header `Date`.
- Fixed the mobile mail list layout so very long sender addresses no longer push the card outside the viewport, and folder badges now wrap to a new line on narrow screens.

## [2.0.11] - 2026-04-14

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed the manual GitHub release workflow packaging path so Windows release assets and Docker release publication no longer fail during the release run.

## [2.0.10] - 2026-04-13

### Changed
- Token refresh management removes the running progress card and changes it to continuously display the task log in the pop-up window.
- Changed `folder=all` mailbox aggregation to fetch `inbox` and `junkemail` in parallel before merging and sorting the result list.

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed the aggregated mail path to pass group proxy failover settings consistently to both `inbox` and `junkemail` fetches.
- Fixed the external `/api/external/emails` compatibility check coverage so `folder=all` remains accepted without changing the live API request or response contract.

## [2.0.9] - 2026-04-13

### Added
- Added "All Mail" option at the top of the mail list and placed it in front of "Inbox".

### Change
- After selecting an email account, the "All Emails" list will be displayed by default.
- The loading and empty status text of the mailing list will display the corresponding name according to the current folder.

### Fix
- Fixed the issue in which emails in the "All Mail" list cannot be distinguished from the inbox or spam. The source label is now displayed.
- Fixed an issue where the `all` request was still used when opening email details from the "All Mail" list, resulting in the details being retrieved from the wrong folder. Now, the email is loaded according to its true source folder.

## [2.0.8] - 2026-04-12

### Added
- Added per-group proxy failover settings with `primary proxy -> fallback proxy 1 -> fallback proxy 2` order for Outlook Graph/token requests.

### Changed
- Token refresh management removes the running progress card and changes it to continuously display the task log in the pop-up window.
- Moved proxy failover configuration from system-wide settings into each mailbox group so different groups can use different fallback chains.

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed Outlook token refresh and Graph requests failing immediately when the primary group proxy was unreachable by retrying through configured fallback proxies in order.
- Fixed the group settings dialog copy to document that `fallback agent 1` and ` fallback agent 2` both support `direct` / `direct connection` as explicit direct-connect fallbacks.

## [2.0.7] - 2026-04-11

### Changed
- Token refresh management removes the running progress card and changes it to continuously display the task log in the pop-up window.
- Replaced the custom Windows tray implementation with a `pystray`-based tray menu and generated application icon.

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed the packaged Windows desktop app tray menu labels and icon rendering issues.
- Removed the brittle dependency on low-level Win32 `ctypes` tray bindings that caused repeated Windows-specific startup failures.

## [2.0.6] - 2026-04-11

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed additional Windows tray startup crashes by replacing more `ctypes.wintypes` handle annotations with compatibility-safe Win32 handle definitions.

## [2.0.5] - 2026-04-11

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed the Windows tray bootstrap using unavailable `ctypes.wintypes` symbols (`LRESULT`, `WNDPROC`) that caused the packaged app to crash during startup.

## [2.0.4] - 2026-04-11

### Added
- Added a Windows system tray controller for the packaged desktop app with `Open interface ` and ` exit` actions.

### Changed
- Token refresh management removes the running progress card and changes it to continuously display the task log in the pop-up window.
- Switched the packaged Windows desktop runtime to a controllable background server so the tray can exit the app cleanly.

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed the Windows packaged app having no visible way to quit after launching the browser UI.

## [2.0.3] - 2026-04-11

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed Windows `exe` packaging to include Python modules imported from dynamically executed segmented files, preventing startup crashes such as `ModuleNotFoundError: No module named 'imaplib'`.
- Made the PyInstaller hidden-import list derive automatically from the segmented source files so future segment imports are included in packaged builds.

## [2.0.2] - 2026-04-11

### Changed
- Token refresh management removes the running progress card and changes it to continuously display the task log in the pop-up window.
- Switched the packaged desktop build to GUI mode and auto-open the local web UI in the browser on startup.

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed packaged startup diagnostics so desktop launch failures are written to `startup-error.log` and surfaced to Windows users with a dialog instead of silently exiting.
- Fixed the packaged desktop default bind host to use `127.0.0.1`, avoiding local browser access issues on some Windows machines.

## [2.0.1] - 2026-04-11

### Added
- Added automated Windows `exe` packaging in the tag-based GitHub Release workflow.
- Added a PyInstaller spec and packaged-runtime resource handling for the desktop build.

### Changed
- Token refresh management removes the running progress card and changes it to continuously display the task log in the pop-up window.
- Documented the Windows desktop distribution flow in the README, deployment guide, and release guide.

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed packaged execution so templates, static assets, database storage, and `SECRET_KEY` persistence work correctly after bundling.

## [2.0.0] - 2026-04-09

### Changed
- Token refresh management removes the running progress card and changes it to continuously display the task log in the pop-up window.
- Formalized the repository into a release-managed project with `main` / `dev` branch roles, semantic versioning, and documented release flow.
- Added automated GitHub Release generation and clarified collaboration / branch-protection guidance for future contributors.
- Tightened Docker image publishing policy so documentation-only changes no longer trigger image builds.

### Added
- Added `VERSION`, `CHANGELOG.md`, `RELEASE.md`, and `BRANCH_PROTECTION.md` to make versioning, release, and collaboration rules explicit.
- Added release-tag driven image/version workflow for `latest`, `dev`, and semantic version tags.

### Fixed
- Fixed the problem of "retry failure" still taking synchronous requests, changed to streaming log output and reused refresh interval and stop task control.
- Fixed invalid Docker image tag generation caused by `docker/metadata-action` in tag-triggered builds.

## [1.0.0] - 2026-04-07

### Added
- Stable initial release baseline for the Outlook mail management tool.
- Web UI for mailbox group management, mailbox import, and mail browsing.
- Outlook access via Microsoft Graph API, new IMAP, and legacy IMAP fallback.
- Temporary mailbox integration for GPTMail, DuckMail, and Cloudflare Temp Email.
- External API access using API Key authentication.
- Docker and Docker Compose deployment support.
