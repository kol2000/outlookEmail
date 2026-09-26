# English and Russian localization

The fork starts at upstream v3.0.9 (`d7a00986deb2e55f286e28b74e528c880cf98f42`). The application toolbar, sign-in page, shared-mail page and extension have an English/Russian selector. A language change reloads the page; save unfinished form changes first.

## Runtime behavior

- Jinja translates static labels before rendering, with normal HTML escaping.
- JavaScript uses `I18n.t(source)` and `I18n.tpl` tagged templates. Template values are inserted after translation and retain their original content and upstream escaping.
- Flask translates known application status fields at the JSON/SSE response boundary. Database values, mail bodies, subjects, account names, credentials, import/export formats and business decisions are not translated.
- Catalogs are bundled with the app. No translation network dependency is added.
- An explicit `X-Outlook-Language` header takes precedence over the language cookie, followed by the browser language and `OUTLOOK_LANGUAGE` (default `en`). The legacy `zh-CN` setting remains a pass-through mode without an extra UI option; newly authored server messages are English.
- The extension stores its own language preference and sends the language header to the server.
- Desktop tray/startup text follows `OUTLOOK_LANGUAGE`; the browser selection is per browser.

## Editing translations

Edit both `static/locales/en.json` and `static/locales/ru.json`. English source text is the message key. Escaped legacy aliases remain for previously stored statuses and older clients. Persisted system-group identifiers and localized provider folder names retain their exact runtime values using Unicode escapes; do not translate those identifiers. Preserve every `{__0__}`-style placeholder exactly; do not translate HTML attributes such as `class`, `id`, event handlers, URLs or API identifiers. Escape translated text inside HTML template attributes. Then run:

```sh
python scripts/sync_locales.py
python -m pytest tests/test_i18n.py -q
node tests/i18n.test.cjs
```

The regression suite checks English application messages and preserves Unicode mailbox fixtures. Run it with `OUTLOOK_LANGUAGE=en`. Localization tests request English and Russian explicitly. Several frontend tests were updated to assert the new translation calls. The pagination-limit test mocks persistence so it exercises all 100 pages without writing 10,000 rows; separate tests cover persistence.

Windows sandbox verification uses temporary test directories with inherited workspace ACLs because Python's private temporary-directory ACL excludes the restricted runner token. This test-harness workaround is outside the application and is not required in an ordinary checkout.

## Scope and review status

The catalogs, extension metadata, README, release/build instructions and current user/API guides have English and Russian versions. The initial full translation was machine-generated; common interface labels were edited and placeholders/markup were validated. Long descriptions may still need editorial refinement. Current documentation, source comments and historical changelog entries have been translated to English. Commit messages have also been translated by rewriting the history while preserving authors, dates, parent relationships and historical file trees. Original screenshot references point to upstream. External provider errors and user mailbox contents retain their original text. `README.zh-CN.md` links to the upstream manual.

Use a local build of this fork. Upstream executables and container images do not include the translations. Repository links and the default update-check owner point to `kol2000/outlookEmail`; `REPOSITORY_OWNER` remains configurable.
