# OutlookEmail browser extension instructions

This is a Chrome/Edge browser extension for OutlookEmail. The extension uses the web-side login password to establish a normal Web Session and does not use the external API Key; all management requests still go through the existing Session + CSRF protection of the server.

The extension runs in the browser sidebar by default and does not switch the current web page tab.

## Applicable browsers

- Google Chrome, it is recommended to use the newer stable version.
- Microsoft Edge, it is recommended to use the newer stable version.
- Requires browser support for Manifest V3 and Side Panel.

## Install extension

1. Open the browser extension management page:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
2. Turn on "Developer Mode".
3. Click "Load unzipped extension".
4. Select the `browser-extension` directory in this warehouse.
5. After the installation is completed, the `OutlookEmail` extension entry will appear on the toolbar.

## Update extension

After the code is updated, you need to manually reload it on the extension management page:

1. Open `chrome://extensions/` or `edge://extensions/`.
2. Found `OutlookEmail Console`.
3. Click the "Reload" button.
4. Reopen the sidebar.

If the sidebar still displays the old interface, you can close the sidebar and click the extension icon again.

## First time configuration

1. Click the OutlookEmail extension icon in the browser toolbar to open the sidebar.
2. Fill in the "Service Address", for example:
   - Local operation: `http://127.0.0.1:5000`
   - Server deployment: `https://your-domain.example`
3. Fill in the "Web login password", which is the password used to log in to the OutlookEmail web page.
4. Check "Remember password to local browser" if necessary.
5. Click "Save Configuration", or directly click the function entrance above to start using it.

Description:

- If "Remember password to local browser" is checked, the password will be saved in the local extension storage of the current browser.
- If unchecked, the password is only stored in the browser session level storage; it needs to be re-entered after the browser session ends.
- When the extension accesses the service address for the first time, the browser may pop up a site access permission confirmation, which requires permission.

## Daily use

After opening the sidebar, you can directly click on the top function entrance:

- `Mailbox`
- `Import`
- `Refresh`
- `Token`
- `Export`
- `label`
- `Settings`

The gear button in the upper right corner of the sidebar can expand or collapse the configuration area. The `Refresh` button will reload the current function page.

## Email

The mailbox page is used to view and manage regular mailboxes, temporary mailboxes, and all Cloudflare mails.

Main abilities:

- Select a mailbox group and the extension will remember the last selected group.
- Search ordinary mailboxes, supporting mailboxes, notes, labels or aliases.
- Ordinary mailbox lists support paging.
- Click "Mail" in the account line to directly view the mailing list.
- The mailing list is displayed above the account list, so there is no need to scroll down for a long time among a large number of accounts.
- Email details support viewing text, attachment entry, marking as read, and deleting ordinary emails.
- Other operations for ordinary accounts are included in "More Operations": edit, label, turn on/off forwarding, refresh Token, copy, delete.

Temporary email:

- After entering the "Temporary Mailbox" group, the temporary mailbox list of `/api/temp-emails` will be loaded.
- Support GPTMail, DuckMail, Cloudflare temporary mailbox.
- A single temporary mailbox message can be viewed.
- Temporary mailboxes can be refreshed, copied, and deleted.
- If the Cloudflare temporary mailbox service is configured, the `Cloudflare All Mail` entry will be displayed, and all emails in the current Worker can be viewed and filtered by recipient address.

## Import

The import page supports ordinary mailboxes and temporary mailboxes.

Ordinary email:

- Support Outlook/Hotmail.
- Supports Gmail, QQ, 163, 126, Yahoo, Alibaba Mail and other IMAP mailboxes.
- Support custom IMAP.
- You can select target grouping, import format, unified remarks, status, whether to enable forwarding and bind labels when importing.

Common formats:

```text
Email----Password----ClientID----RefreshToken
```

Custom IMAP format:

```text
Email----IMAP password----IMAP host----IMAP port
```

Temporary email:

- `gptmail`: One mailbox per line.
- `duckmail`: `Email----Password` per line.
- `cloudflare`: `Email----JWT` per line.

Generate temporary mailbox:

- Support GPTMail / DuckMail / Cloudflare.
- DuckMail requires domain name, username and password.
- Cloudflare can fill in the domain name and username; the username can be left blank and randomly generated.

## Refresh

The refresh page is used to manage the Refresh Token refresh of Outlook accounts.

Main abilities:

- View refresh statistics.
- Filter by status: All, Success, Failure, Never Refreshed.
- Search for the account to be refreshed.
- Single account refresh.
- Single account retry.
- Full refresh.
- Streaming retry failed account.
- Quickly retry failed accounts.
- Stop full refresh.
- View refresh log and failure list.

Full refreshes and streaming retries show progress via SSE.

## Token

The Token page is used to assist in obtaining the Microsoft OAuth Refresh Token, and can be directly saved as an account.

Usage process:

1. Copy the authorization link.
2. Complete Microsoft licensing in your browser.
3. Copy the complete callback URL after authorization.
4. Return to the sidebar and fill in the email address, account password, and target group.
5. Paste the full callback URL.
6. Click "Redeem and Preview".
7. Click "Save Account" after confirming that it is correct.

When saving the account, the server account import interface will be called according to the Outlook import format.

## Export

The export page supports exporting accounts after two-step verification.

Usage process:

1. Enter the web login password as the two-step verification password.
2. Select to export all, or check the group and then export the selected group.
3. The exported content will be displayed in the text box.
4. You can click "Copy Results" to copy the exported content.

When exporting temporary mailbox groups, the corresponding temporary mailbox contents will be included according to the server-side export logic.

## tag

Tab support:

- Create tags.
- Delete tag.
- Add or remove tags in batches for ordinary accounts.
- Add or remove labels to temporary mailboxes in batches.

When binding in batches, you need to fill in the account ID or temporary email ID. The ID can be seen in the mailbox list.

## Settings

The settings page covers common web settings:

- Basic refresh settings.
- Cron and application time zones.
- Temporary mailbox service configuration.
- DuckMail configuration.
- Cloudflare Worker domain name, email domain name, and management password.
- Forwarding channel.
- SMTP / Telegram / Enterprise WeChat configuration.
- WebDAV backup configuration.
- View and modify external API Key.

Sensitive configurations in the settings page will be written directly to the server settings interface. When modifying sensitive settings such as WebDAV backup, you need to fill in the corresponding verification password.

## Login mechanism

The extended login process is as follows:

1. Extended call `POST /api/extension/login`.
2. The server verifies the web login password.
3. The server returns a one-time `launch_url` valid for 60 seconds.
4. Extended access to `launch_url`, the server writes normal Web Session under its own domain name.
5. Subsequent extension requests use this Session and obtain the CSRF Token through `GET /api/csrf-token`.

If the server version is too old and does not have `/api/extension/login`, the extension will try to fall back to the `/login` password login interface.

## FAQ

### After clicking the function, it always shows that you are logging in.

Check:

- Is the service address correct? Do not write more paths. For example, you should fill in `https://your-domain.example`, do not fill in `https://your-domain.example/#settings`.
- Is the web login password correct?
- Whether the browser allows the extension to access this service address.
- Whether the server can be opened normally.
- Deploy the reverse proxy to correctly forward cookies.

### Prompt that you need to allow access to the service address

This is a site permissions prompt for the browser extension. Allow the extension to request your OutlookEmail service.

### The temporary mailbox group shows that there is no account yet.

The temporary mailbox group does not read the ordinary account table, but reads `/api/temp-emails`. If there is a temporary mailbox on the web side but the extension is not displayed, first click "Refresh" in the extension and then confirm that the current service address is connected to the same server instance.

### All Cloudflare emails have no content

Check the Cloudflare configuration in the settings page:

- Cloudflare Worker domain name.
- Cloudflare email domain name.
- Cloudflare management password.

After configuration, enter the "Temporary Mailbox" group on the mailbox page and click `Cloudflare All Mail`.

### The interface has not changed after the extension update

You need to click "Reload" on the browser extension management page. Simply refreshing the page will not update the loaded extension code.

### Don’t want to save password

Uncheck "Remember password to local browser". In this way, the password is only saved in the browser session level storage and needs to be re-entered after closing the browser session.

## Document description

- `manifest.json`: Chrome Manifest V3 manifest.
- `background.js`: Open the sidebar when clicking the extension icon.
- `sidepanel.html` / `sidepanel.css` / `sidepanel.js`: Sidebar console.
- `popup.html` / `popup.css` / `popup.js`: Compatible with pop-up window entrance.
- `api-client.js`: Login, Session, CSRF, JSON/Text/SSE request encapsulation.
- `storage.js`: Local configuration and interface state storage.

