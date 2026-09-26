## Why

Currently Cloudflare Temp Email only supports a set of global Worker domain name, optional email domain name and administrator password configuration. The user has deployed multiple cfmail channels. Each channel corresponds to an independent Worker, administrator password, and mail pool. In this project, the temporary mailboxes of these channels need to be created, viewed, and managed respectively.

## What Changes

- Added Cloudflare channel management capabilities to support maintaining multiple sets of Cloudflare Temp Email Worker configurations.
- Cloudflare supports selecting a channel when creating a temporary email, and only displays the email domain name of the selected channel.
- Cloudflare temporarily saves the channel where the mailbox record belongs, and uses the Worker and administrator password of the channel when subsequently reading emails and deleting upstream addresses.
- Migrate existing global Cloudflare configuration to default channel, compatible with existing configuration and existing Cloudflare temporary mailbox records.
- Cloudflare's all email view is changed to view by channel. Each channel provides an independent entrance and does not provide cross-channel aggregate view.
- The Cloudflare Global Mail API now requires explicit channel context and only queries the mail pool for the specified channel.
- Cloudflare import/export format supports carrying channel information; the old format falls to the default channel when importing.

## Capabilities

### New Capabilities
- `cloudflare-channel-management`: Manage multiple sets of Cloudflare Temp Email channel configurations and bind Cloudflare temporary email operations to the corresponding channels.

### Modified Capabilities
- `cloudflare-all-mail-view`: Cloudflare changed all mailing lists from a single global configuration to querying by specified channels, and does not provide all channel aggregation.

## Impact

- Database: Added Cloudflare channel table, and added Cloudflare channel ownership field for `temp_emails`; migrated old global configuration and existing Cloudflare temporary mailbox.
- Backend: Adjustments to Cloudflare request helpers, channel CRUD API, domain list API, temporary mailbox creation/read/deletion, import/export, and global mailing list routing.
- Front-end: Added channel management to the settings page; added channel selection in a temporary mailbox generation pop-up window; the account list displays all Cloudflare email portals for each channel and the channel to which the mailbox belongs.
- Documentation and testing: Update the README/API documentation, and add channel migration, creation, reading, deletion, import and export, and global mail view testing by channel.
