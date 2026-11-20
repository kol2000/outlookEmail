# OutlookEmail — English / Русский

Based on [upstream v3.0.32](https://github.com/assast/outlookEmail/releases/tag/v3.0.32), with an offline English/Russian language switcher.

[Download the Windows release](https://github.com/kol2000/outlookEmail/releases/latest) · [English manual](README.en.md) · [Руководство на русском](README.ru.md)

## Windows

Download `OutlookEmail-v3.0.32-en-ru-Windows.zip` from the release assets, extract it, and run `OutlookEmail/OutlookEmail.exe`. Keep the `_internal` directory next to the executable. Python is not required. Choose English or Русский on the sign-in page or in the toolbar.

Close the old application before starting the new one. Back up `%APPDATA%\OutlookEmail` first; this is where the packaged application stores its database and session secret. If you configured `OUTLOOK_EMAIL_HOME`, back up that directory instead. Extract the new release to a separate folder. Your accounts remain in the data directory.

The initial password for a new installation is `admin123`; change it in Settings. Existing installations keep their password.

## What's included

- Upstream v3.0.32, including iCloud management, forwarding improvements, account ordering and IMAP fixes.
- English/Russian UI, application status messages, browser extension and manuals.
- Update checks point to this fork. This portable folder is updated by extracting the complete release ZIP; replacing only its EXE is disabled.
- Original upstream ancestry is preserved for future merges. Syncing source does not itself translate new text or build a Windows release.

## Run from source

```powershell
git clone https://github.com/kol2000/outlookEmail.git
cd outlookEmail
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python web_outlook_app.py
```

Open http://127.0.0.1:5000. The browser remembers the language selection. `OUTLOOK_LANGUAGE=en` or `OUTLOOK_LANGUAGE=ru` selects the default language.

## Extension

The extension ZIP is an optional Chrome/Edge companion, not the Windows application. Extract it and load the `browser-extension` directory as an unpacked extension. It has its own language selector.

## Localization and maintenance

Translations are bundled; no translation service receives mailbox content at runtime. Email bodies, subjects, account names, passwords, tokens and API identifiers are preserved. Long-form documentation uses machine translation and may need editorial refinement. Original screenshots and historical upstream commits may contain Chinese.

See [localization maintenance](docs/localization.md) and the [upstream changelog](CHANGELOG.en.md). Upstream declares MIT in its README; retained third-party licenses are included in `third_party` and the vendor assets.
