# cloudflare-channel-management Specification

## Purpose
TBD - created by archiving change add-cloudflare-channel-management. Update Purpose after archive.
## Requirements
### Requirement: Cloudflare channel records
System SHALL supports logged-in users to manage multiple sets of Cloudflare Temp Email channel configurations.

#### Scenario: Create a Cloudflare channel
- **WHEN** The logged in user submits the channel name, Worker domain name, optional email domain name list and administrator password
- **THEN** System SHALL creates an enabled Cloudflare channel and SHALL encrypts the administrator password.

#### Scenario: unique channel name
- **WHEN** A logged in user creates or renames a Cloudflare channel to an existing channel name, including names that differ only in case
- **THEN** System SHALL rejects the request and returns an error that the channel name already exists.

#### Scenario: Missing channel configuration
- **WHEN** A logged in user creates or updates a Cloudflare channel, but the channel name, worker domain name, or admin password on creation is missing
- **THEN** The system SHALL rejects the request, stating the missing fields.

#### Scenario: List Cloudflare channels
- **WHEN** Logged in user requests Cloudflare channel list
- **THEN** System SHALL returns the ID, name, Worker domain name, mailbox domain name list, enabled status, default status and whether the administrator password has been configured for each channel.

#### Scenario: Update Cloudflare channel
- **WHEN** Logged-in user updates Cloudflare channel name, Worker domain, email domain list, admin password, or enabled status
- **THEN** System SHALL saves the updated channel configuration, and SHALL retains the original administrator password if a new one is not submitted.

### Requirement: Default Cloudflare channel migration
System SHALL migrates old global Cloudflare configuration to default Cloudflare channel.

#### Scenario: Migrate the old configuration to the default channel
- **WHEN** The old Cloudflare Worker domain name and admin password configuration exists in the database and the Cloudflare channel does not yet exist
- **THEN** System SHALL creates a default Cloudflare channel and populates the channel with the old configuration.

#### Scenario: Cloudflare email is already bound to the default channel
- **WHEN** Migrate a temporary mailbox that is running and `provider='cloudflare'` exists but has no channel ownership
- **THEN** System SHALL binds these temporary mailboxes to the default Cloudflare channel.

#### Scenario: The default channel is only
- **WHEN** The system creates or sets the default Cloudflare channel
- **THEN** System SHALL ensures that at most one enabled Cloudflare channel is marked as the default channel.

#### Scenario: The old configuration does not exist
- **WHEN** The database does not have an old Cloudflare Worker domain or admin password configuration available
- **THEN** System SHALL NOT create empty default Cloudflare channels.

### Requirement: Cloudflare temp email channel binding
System SHALL binds each Cloudflare temporary mailbox to its own Cloudflare channel and uses that channel in subsequent operations.

#### Scenario: Create Cloudflare temporary mailboxes by channel
- **WHEN** The logged in user selects the Cloudflare channel and domain name to create a temporary mailbox
- **THEN** System SHALL uses the Worker domain name and administrator password of the selected channel to call the create address interface, and SHALL binds the created mailbox to the channel.

#### Scenario: Only use the selected channel domain name when creating
- **WHEN** The logged in user selects a Cloudflare channel to create a temporary mailbox
- **THEN** System SHALL only allows the creation of addresses using the email domain name configured for this channel.

#### Scenario: Disabled channels cannot be used for new creation
- **WHEN** A logged in user attempted to create a temporary mailbox using a disabled Cloudflare channel
- **THEN** The system SHALL rejects the request and states that this channel is not available for new mailboxes.

#### Scenario: Read Cloudflare temporary mailbox messages according to the channel they belong to.
- **WHEN** A logged-in user reads a Cloudflare temporary mailbox message
- **THEN** System SHALL uses the Worker domain name of the mailbox to bind the channel and the JWT saved in the mailbox to request the upstream mailing list.

#### Scenario: Delete Cloudflare upstream addresses by channel
- **WHEN** A logged-in user deletes a Cloudflare temporary mailbox
- **THEN** System SHALL uses the Worker domain name and administrator password of the email-bound channel to clean up the upstream address.

#### Scenario: Cloudflare mailbox lacks channel attribution
- **WHEN** The system needs to read or delete a Cloudflare temporary mailbox, but the mailbox does not have a channel attributed and no default channel exists
- **THEN** System SHALL returns a failure response with missing Cloudflare channel attribution.

### Requirement: Cloudflare channel deletion protection
System SHALL prevents deletion of channels that are still referenced by Cloudflare temporary mailboxes.

#### Scenario: Delete unreferenced channels
- **WHEN** A logged in user deletes a channel that does not have any Cloudflare temporary mailbox reference
- **THEN** System SHALL deletes the channel configuration.

#### Scenario: Refuse to delete the referenced channel
- **WHEN** A logged in user deletes a channel that is still referenced by one or more Cloudflare temporary mailboxes
- **THEN** System SHALL refuses deletion and returns a reference number or an understandable occupancy description.

#### Scenario: Disable referenced channels
- **WHEN** Signed-in user disables channels still referenced by Cloudflare temporary mailbox
- **THEN** System SHALL retains the channel and mailbox ownership, and SHALL blocks the channel from being used to create new mailboxes and view all messages in the channel.

### Requirement: Cloudflare channel domains
System SHALL returns available email domain names by Cloudflare channel.

#### Scenario: Query the domain name of the specified channel
- **WHEN** The logged in user requested a list of domains with Cloudflare channels enabled
- **THEN** System SHALL returns a list of email domain names configured for the channel; if the channel is not configured with an email domain name, system SHALL returns a successful response and an empty list.

#### Scenario: Query banned channel domain names
- **WHEN** List of domains where the logged in user requested to disable the Cloudflare channel
- **THEN** System SHALL returns a failure response stating that the channel is unavailable.

#### Scenario: Query that the channel domain name does not exist
- **WHEN** A logged in user requested a non-existent Cloudflare channel domain list
- **THEN** System SHALL returns a failure response and states that the channel does not exist.

### Requirement: Cloudflare channel import and export
System SHALL preserves channel information in Cloudflare temporary mailbox imports and exports.

#### Scenario: Export segmented by channel
- **WHEN** The logged in user exports the temporary mailbox group and a Cloudflare temporary mailbox exists
- **THEN** System SHALL outputs the `[cloudflare:<channel_name>]` segment by Cloudflare channel, and outputs the channel's email and JWT under the corresponding segment.

#### Scenario: Import by channels
- **WHEN** Logged-in user imports temporary mailbox data containing `[cloudflare:<channel_name>]` segments
- **THEN** System SHALL Binds the Cloudflare temporary mailbox under this segment to the Cloudflare channel with a matching name.

#### Scenario: Old Cloudflare format import
- **WHEN** Signed-in user imports old `[cloudflare]` segments or old `email----jwt` Cloudflare format
- **THEN** System SHALL Bind imported Cloudflare temporary mailbox to default Cloudflare channel.

#### Scenario: Import channel does not exist
- **WHEN** The logged in user imported `[cloudflare:<channel_name>]`, but the corresponding channel does not exist
- **THEN** System SHALL skips the segment or line and returns an understandable channel not present error.

#### Scenario: Cloudflare email addresses remain globally unique
- **WHEN** The Cloudflare email address imported by the logged in user already exists in the local temporary email list
- **THEN** The system SHALL updates the JWT and channel attribution for this mailbox, and SHALL NOT creates duplicate mailbox records.

