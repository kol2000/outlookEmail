## Context

The project currently treats Cloudflare Temp Email as a set of global configurations: `cloudflare_worker_domain`, `cloudflare_email_domains`, and `cloudflare_admin_password` exist in the `settings` table. This global configuration is read by all Cloudflare addresses created, addresses deleted, single-address emails read by JWT, and the `/api/cloudflare/messages` admin global mailing list.

Users now have multiple cfmail channels. Each channel has an independent Worker, administrator password, optional email domain name, and mail pool; the exact same email address will not appear in different channels; there is no need to aggregate all email views across channels.

## Goals / Non-Goals

**Goals:**
- Supports maintaining multiple sets of Cloudflare Temp Email channel configurations.
- Let Cloudflare temporary mailbox creation, reading, and deletion use the channel to which the mailbox belongs.
- Allows Cloudflare to view all messages by a single channel.
- Keep the `temp_emails.email` globally unique constraint to avoid changing all temporary mailbox routing to operate by ID.
- Migrate old global Cloudflare configuration and existing Cloudflare temporary mailboxes to the default channel.
- Compatible with old Cloudflare import format and let new export format carry channel information.

**Non-Goals:**
- Aggregated email view across all Cloudflare channels is not available.
- The exact same email address in different channels is not supported.
- Does not modify the administrative semantics of GPTMail, DuckMail, or regular mailboxes.
- No new Cloudflare global email persistence cache is added.
- No changes to the Cloudflare Worker upstream API protocol.

## Decisions

### Add `cloudflare_channels` table

Added a new table to save multiple sets of channel configurations:

```text
cloudflare_channels
  id INTEGER PRIMARY KEY
  name TEXT UNIQUE NOT NULL
  worker_domain TEXT NOT NULL
  email_domains TEXT DEFAULT ''
  admin_password TEXT NOT NULL
  enabled INTEGER DEFAULT 1
  is_default INTEGER DEFAULT 0
  created_at TIMESTAMP
  updated_at TIMESTAMP
```

`email_domains` is optional and may be empty when no domains are configured for creating mailboxes. A unique `LOWER(name)` index enforces case-insensitive channel names. `admin_password` is stored using the existing `encrypt_data` / `decrypt_data` encryption. The legacy `settings.cloudflare_admin_password` may remain for rollback and migration checks, but new requests should read the channel table first.

An alternative is to save the JSON array in `settings`. This will result in less migration, but will make settings updates, default channel constraints, query by channel, deletion protection, and testing worse.

### Add channel ownership field for `temp_emails`

Added `temp_emails.cloudflare_channel_id`. This field is written on Cloudflare mailbox creation, import, and legacy data migration; non-Cloudflare providers keep `NULL`.

Because the user confirmed that different channels will not have the same email address, continue to retain `email TEXT UNIQUE NOT NULL`. This can reuse existing routes for selecting, reading, and deleting by email address, reducing front-end and API changes.

An alternative is to change all temporary mailbox routing to operate as `temp_email_id`. It can support repeated addresses across channels, but this is not a requirement and will expand the scope of changes.

### Cloudflare request helper function receives channel context

Adjusted Cloudflare requests from "Read global settings internally" to "Assemble request after receiving channel object or channel ID". The caller is responsible for parsing the channel:

- Generate address: using user selected channel.
- Single address mail: read channel from `temp_emails.cloudflare_channel_id`.
- Delete address: Read the channel from the mailbox record to be deleted.
- All mailing lists: read channels from `channel_id` query parameters.

An alternative is to introduce a global "current channel" setting. This makes multiple user sessions, concurrent requests, and background operations unreliable.

### One Cloudflare all email portal per channel

The fixed entry in the temporary mailbox list is changed from one `Cloudflare All Mail` to generating multiple entries by channel, for example:

```text
Cloudflare all mail · cfmail-us
Cloudflare all mail · cfmail-hk
```

After clicking the entrance, the front end requests `/api/cloudflare/messages?channel_id=<id>` and does not request other channels.

An alternative is to use the drop-down box to switch channels after entering Cloudflare All Mail. The entry list is more direct and more consistent with the scope of "no aggregation".

### Import and export using channel segmentation format

Cloudflare’s new export format is segmented by channel:

```text
[cloudflare:cfmail-us]
user@example.com----jwt
```

Old formats continue to be supported:

```text
[cloudflare]
user@example.com----jwt
```

Old format writes to default Cloudflare channel when importing. When the import encounters a non-existent channel name, an understandable error is returned and the channel is not automatically created.

An alternative is to append `----channel_name` to each line. This format is less clear than segmented for batch export, but is supported as compatible input.

### Referenced channels cannot be deleted.

The system refuses to delete a channel if it is still referenced by a Cloudflare temporary mailbox. Users can disable channels. Once disabled, they cannot be used to create new mailboxes or view all mails. However, existing mailboxes will still retain ownership information for subsequent re-enabling or migration.

The alternative is to delete the local mailbox when deleting the channel or move the mailbox to the default channel. The former is too destructive, and the latter will cause the mailbox's upstream Worker to be wrongly assigned.

## Risks / Trade-offs

- [Old Cloudflare mailboxes missed in migration] → Write default channels for all `provider='cloudflare'` and `cloudflare_channel_id IS NULL` records during migration, and add regression testing.
- [After the user deletes or disables the channel, the existing mailbox cannot be read] → Disabling only blocks new creation and global views, and does not clear existing ownership; check references before deleting.
- [Administrator password encryption migration failed] → When the migration fails, the semi-finished channel will not be created, the old settings value will be retained, and the front end will continue to prompt for missing channel configuration.
- [Import format ambiguity] → Prioritize parsing the `[cloudflare:<channel>]` segment; the old `[cloudflare]` uses the default channel; the in-line channel is only for supplementary compatibility.
- [The old `/api/cloudflare/messages` call lacks channels] → Returns a clear error and prompts that `channel_id` is required, and all front-end entrances pass channels.

## Migration Plan

1. Create the `cloudflare_channels` table.
2. Add `cloudflare_channel_id` to `temp_emails`.
3. If the old global Cloudflare Worker domain name and administrator password exist and the channel table is empty, create a default channel. The name can be `default` or `Cloudflare Default`; the old email domain name configuration can be empty.
4. Bind the existing Cloudflare temporary mailbox to the default channel.
5. Update request path, front-end entry and import and export.
6. New tables and fields can be retained during rollback; the old global settings are not deleted, so the old version can still read the original global configuration, but the new channel data will not be understood by the old version.

## Open Questions

- Whether the default channel name is `default` or a Chinese display name needs to be confirmed with the existing UI copy during implementation.
