# OutlookEmail — English / Русский

This fork of [assast/outlookEmail](https://github.com/assast/outlookEmail) is based on **v3.0.9** and adds an English/Russian interface switcher, offline translation catalogs, localized status messages and browser-extension labels.

[English manual](README.en.md) · [Руководство на русском](README.ru.md) · [Original upstream README](https://github.com/assast/outlookEmail/blob/main/README.md)

## Download for Windows

Get the Windows ZIP from [Releases](https://github.com/kol2000/outlookEmail/releases). Extract the entire archive and keep `_internal` beside `OutlookEmail.exe`.

## Run this translated version

```sh
git clone https://github.com/kol2000/outlookEmail.git
cd outlookEmail
git checkout localization/en-ru-v3.0.9
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
python -m pip install -r requirements.txt
```

On Windows PowerShell, generate a local session secret and start the app:

```powershell
$env:SECRET_KEY = python -c "import secrets; print(secrets.token_hex(32))"
$env:HOST = "127.0.0.1"
python web_outlook_app.py
```

On macOS/Linux:

```sh
export SECRET_KEY="$(python -c 'import secrets; print(secrets.token_hex(32))')"
HOST=127.0.0.1 python web_outlook_app.py
```

Open http://127.0.0.1:5000. The upstream initial password is `admin123`; change it in Settings after signing in. Select **English** or **Русский** on the sign-in page or in the application toolbar. The browser remembers the selection. `OUTLOOK_LANGUAGE=en` or `OUTLOOK_LANGUAGE=ru` selects the server/desktop default.

For Docker, build this checkout using `docker compose -f docker-compose.build.yml up -d --build` after configuring `.env.local` from `.env.example`. The original author's prebuilt images and release downloads do **not** contain this fork's translation.

Load `browser-extension/` as an unpacked extension in Chrome or Edge. Its language selector is independent of the web application. [English extension manual](browser-extension/README.en.md) · [Русская инструкция](browser-extension/README.ru.md).

## Repository history

This fork's commit messages were translated to English. Commit IDs have changed; authors, dates, parent relationships and historical file trees are preserved. Existing clones should be backed up before moving to the rewritten branches.

## Localization details

Catalogs are stored in `static/locales/en.json` and `ru.json`. No translation service is contacted while the application is running. Account names, mailbox contents, credentials, persisted identifiers, import/export formats and API field names are preserved. Server status messages are localized at the response boundary; protocol values and persisted identifiers remain compatible with upstream. API clients may send `X-Outlook-Language: en`, `ru`, or `zh-CN` (legacy pass-through; newly authored statuses are English).

The full manuals were machine translated; common UI terminology has been edited and placeholder/markup integrity is tested. Long help text may still benefit from editorial review. Source comments, current documentation, changelog entries and commit messages use English. Original screenshots are linked in the upstream project rather than embedded here. External provider error messages are preserved when they do not match an application message.

See [localization maintenance and verification](docs/localization.md). Upstream declares MIT in its README, but the v3.0.9 snapshot does not include the referenced LICENSE file; no new license grant is added by this fork.
