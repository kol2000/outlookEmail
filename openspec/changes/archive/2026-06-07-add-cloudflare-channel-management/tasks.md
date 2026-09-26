## 1. Data model and migration

- [x] 1.1 Write tests for Cloudflare channel migration, covering creating default channels, binding old Cloudflare temporary mailboxes, and not creating empty channels when the old configuration is missing.
- [x] 1.2 Added `cloudflare_channels` table, including channel name, Worker domain name, email domain name, encrypted administrator password, enabled status and default tag.
- [x] 1.3 Add the `cloudflare_channel_id` field to `temp_emails` and retain the existing email address global unique constraint.
- [x] 1.4 Implement idempotent migration of the old global Cloudflare configuration to the default channel, and rewrite the channel ownership for the old Cloudflare temporary mailbox.
- [x] 1.5 Added Cloudflare channel query, create, update, delete, default channel resolution and reference counting helper functions.

## 2. Backend channel API and Cloudflare request link

- [x] 2.1 Write backend tests for Cloudflare channel CRUD, enable/disable, deletion protection, and domain lookup.
- [x] 2.2 Added a new Cloudflare channel management API that requires session login, and supports listing, creating, updating, and deleting channels.
- [x] 2.3 Adjust `cloudflare_temp_request` to receive the channel context and initiate the request using the channel Worker domain name and the decrypted administrator password.
- [x] 2.4 Update the Cloudflare domain name list API so that it returns the corresponding channel domain name by `channel_id` and rejects non-existent or disabled channels.
- [x] 2.5 Updated Cloudflare temporary mailbox creation logic to require selection of a valid enabled channel and binding new mailboxes to that channel.
- [x] 2.6 Update Cloudflare's single mailbox reading and deletion upstream address logic to use the channel to which the mailbox belongs.

## 3. Cloudflare all mail view

- [x] 3.1 Write tests for `/api/cloudflare/messages`'s default channel fallback, channel does not exist, channel is disabled, address filtering does not fall back across channels.
- [x] 3.2 Update `/api/cloudflare/messages`, requiring incoming `channel_id` and querying only the administrator mailing list of the specified channel.
- [x] 3.3 Return channel metadata in Cloudflare global email responses, preserving request address, actual query address, pagination and fallback metadata.
- [x] 3.4 Confirmed that Cloudflare global mail still does not write `temp_email_messages` and retains original MIME normalization behavior.

## 4. Import and export compatible

- [x] 4.1 Write tests for `[cloudflare:<channel_name>]` staging import, old `[cloudflare]` import, old `email----jwt` import and no channel error.
- [x] 4.2 Updated the temporary mailbox import parsing to support segmented import by Cloudflare channel, and let the old format fall to the default channel.
- [x] 4.3 Update existing Cloudflare mailbox import update logic so that it updates JWT and channel attribution without creating duplicate mailbox records.
- [x] 4.4 Updated group export and all group export to make Cloudflare temporary mailbox output in `[cloudflare:<channel_name>]` segments.

## 5. Front-end interaction

- [x] 5.1 Added Cloudflare channel management interface to the settings page, which supports adding, editing, enabling/disabling and deleting channels, and displays errors when deleting referenced channels.
- [x] 5.2 Update to generate a temporary mailbox pop-up window. In Cloudflare mode, first select a channel and then load the channel domain name list.
- [x] 5.3 Update the temporary mailbox list to display the channel to which the Cloudflare mailbox belongs, and render a separate `Cloudflare All Mail · <channel>` entry for each enabled channel.
- [x] 5.4 Update all Cloudflare email front-end status and request parameters so that filtering, paging, and refreshing all carry the current `channel_id`.
- [x] 5.5 Remove or be compatible with the old single-entry Cloudflare all email front-end status to avoid sharing wrong address filtering status across different channels.

## 6. Documentation and Verification

- [x] 6.1 Updated README and API documentation to explain multi-Cloudflare channel configuration, creating mailboxes, all mail views, and import and export formats.
- [x] 6.2 Run relevant backend unit tests covering at least migrations, channel APIs, Cloudflare create/read/delete, global mail, and import/export.
- [x] 6.3 Run front-end static/build verification or the project's existing smoke test to confirm that there are no syntax errors in the settings page, generated pop-up window, and temporary mailbox list.
- [x] 6.4 Manually verify the upgrade path of the old single-channel configuration: the default channel will automatically appear after the old configuration is started, and the existing Cloudflare temporary mailbox can continue to be read and deleted.
