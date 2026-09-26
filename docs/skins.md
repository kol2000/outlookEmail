# Appearance skin

Appearance skins are system-level settings. The skin switched after logging in will be saved to `active_skin_id` in the `settings` table on the server, and all devices and browsers will use the same set of current skins.

## Use the entrance

1. Log in to the web interface.
2. Open "Settings".
3. Enter "Appearance Skin".
4. Select an existing skin, or install a custom skin through zip upload or Git repository.

The built-in skin ID is `classic`. When the currently configured skin does not exist, has an invalid format, or fails to read CSS, the front end will automatically fall back to `classic` and record error information in the skin list.

## Skin pack format

The root directory of the skin package must contain `skin.json` and contain at least one CSS entry file.

```json
{
  "id": "midnight-sample",
  "name": "Midnight Sample",
  "version": "1.0.0",
  "entry": "theme.css",
  "description": "Sample dark skin using OutlookEmail CSS variables",
  "preview": "preview.png"
}
```

Field description:

| Field | Required | Description |
| --- | --- | --- |
| `id` | is the | skin ID. Only lowercase letters, numbers, underscores and dashes can be used, up to 64 characters; `classic` | cannot be used
| `name` | is | display name |
| `version` | is the | skin version |
| `entry` | is the | CSS entry file path, which must point to the `.css` file | in the package
| `description` | No | Skin description |
| `preview` | No | preview image path, supports `png`, `jpg`, `jpeg`, `gif`, `webp` |

A sample skin is available in the repository: [`docs/skin-example`](../skin-example).

## CSS variables

Custom skins mainly change the appearance of the interface by overriding CSS variables. Currently supported core variables include:

```css
:root {
    --skin-app-bg: #ffffff;
    --skin-surface: #ffffff;
    --skin-surface-muted: #fafafa;
    --skin-surface-soft: #f8fafc;
    --skin-surface-hover: #f0f0f0;
    --skin-border: #e5e5e5;
    --skin-border-strong: #d9dce3;
    --skin-text: #1a1a1a;
    --skin-text-muted: #666666;
    --skin-text-soft: #64748b;
    --skin-primary: #1a1a1a;
    --skin-primary-hover: #111827;
    --skin-primary-text: #ffffff;
    --skin-accent: #2563eb;
    --skin-accent-soft: #eff6ff;
    --skin-accent-border: #bfdbfe;
    --skin-danger: #dc3545;
    --skin-shadow: rgba(15, 23, 42, 0.08);
    --skin-overlay: rgba(0, 0, 0, 0.4);
}
```

The current version has only completed the first batch of core area variableization. Small detail colors may still be controlled by the base style, and darker skins will need to be checked for contrast and readability in the actual page.

## zip upload

The uploaded file must be a zip package, and the package root directory should directly contain `skin.json`. The server will perform the following verification:

- Maximum zip file size is 5 MB.
- CSS file size maximum 200 KB.
- Maximum preview image size is 1 MB.
- Reject absolute paths, path traversals, and symbolic links.
- Reject unallowed file types such as scripts, HTML, executables, etc.
- Only install skins that pass `skin.json` verification.

Uploading skins with the same ID and source will overwrite the old version; if the same ID has been installed by other sources, the installation will be refused.

## Git warehouse source

Git source is suitable for making skins into independent warehouses. The warehouse root directory needs to contain `skin.json` and CSS entry files.

Fill in the settings page:

- Git warehouse address, such as `https://github.com/user/outlook-skin.git`
- Optional ref, such as branch name, tag or commit resolvable ref

The server uses `git clone --depth 1` to pull the warehouse. Failure to install or update will not change the currently enabled skin, nor will it overwrite existing skin files.

Note:

- `git` must be installed in the operating environment.
- There is no dedicated management entry for private repository credentials; do not write credentials directly into the URL in an environment visible to many people.
- Git installation will allow the server to actively access the specified warehouse address. It is recommended that only trusted administrators open the setting entrance.

## File storage and backup

Skin files are saved in the `skins/` directory in the same directory as the database file. For example, when the default database is `data/outlook_accounts.db`, the skin directory is:

```txt
data/skins/
```

During Docker deployment, if `./data:/app/data` has been mounted as recommended, the database and skin files will be persisted together. When backing up or migrating, you should also keep:

- `outlook_accounts.db`
- `skins/`

Only backing up the database will retain the current skin ID, but not the custom skin files; it will fall back to `classic` after restoration.

## Security Boundary

The skin system is only responsible for loading CSS and does not execute scripts or installation commands in the skin package. The server will reject common scripts and HTML files.

Still need to pay attention to:

- CSS can change the visual appearance of the interface, hide elements, or load remote resources.
- Custom skins should be considered trusted administrator configurations and should not be allowed to be uploaded by ordinary users.
- If deployed in a multi-person shared environment, it is recommended to restrict the source of access to the settings page through network access control or reverse proxy.
