## MODIFIED Requirements

### Requirement: Cloudflare admin global mail listing
System SHALL provides an API that requires a login session to read Worker emails of the channel through the administrator mailing list interface of the specified Cloudflare channel or the default Cloudflare channel.

#### Scenario: View all Cloudflare emails from the specified channel
- **WHEN** The logged in user requests the Cloudflare global mailing list and passes in a valid `channel_id`, and does not pass the address filter condition
- **THEN** System SHALL calls the administrator mailing list interface of the channel Worker without passing the address filtering conditions, and returns the parsed mailing list items.

#### Scenario: Use default channel when Cloudflare channel parameter is missing
- **WHEN** A logged in user requested the Cloudflare global mailing list, but `channel_id` was not passed in
- **THEN** System SHALL calls the admin mailing list interface using the default Cloudflare channel.

#### Scenario: Cloudflare channel does not exist
- **WHEN** The logged in user requested the Cloudflare global mailing list, but the incoming `channel_id` did not exist
- **THEN** System SHALL returns a failure response stating that the Cloudflare channel does not exist.

#### Scenario: Cloudflare channel disabled
- **WHEN** A logged in user requested the Cloudflare global mailing list, but the incoming `channel_id` corresponding channel was disabled
- **THEN** System SHALL returns a failure response stating that the Cloudflare channel is unavailable.

#### Scenario: Cloudflare channel configuration is missing
- **WHEN** A logged in user requested the Cloudflare global mailing list, but the specified channel lacked the Worker domain name or admin password
- **THEN** System SHALL returns a failure response and explains the missing Cloudflare channel configuration.

#### Scenario: Upstream Cloudflare returns error
- **WHEN** The Cloudflare admin mailing list interface for the specified channel returns an error
- **THEN** System SHALL returns a failure response, retaining useful upstream error details.

### Requirement: Cloudflare admin address filtering
System SHALL supports optional recipient address filtering for global mailing lists for specified Cloudflare channels.

#### Scenario: Filter specified channels by recipient address
- **WHEN** A logged in user requests a Cloudflare email and passes in a valid `channel_id` and address filter
- **THEN** System SHALL passes the normalized address to the Cloudflare administrator mailing list interface of the specified channel and returns the emails reported by upstream as belonging to this address.

#### Scenario: Address filtering response metadata
- **WHEN** Cloudflare global email query contains address filter and valid `channel_id`
- **THEN** response SHALL contains channel ID, request address, actual query address, and whether fallback was used.

#### Scenario: Address filtering does not fall back across channels
- **WHEN** Cloudflare global email query contains address filter and valid `channel_id`
- **THEN** The system SHALL applies address candidate fallbacks only within this channel, and SHALL NOT query other Cloudflare channels.

### Requirement: Cloudflare global mail pagination
System SHALL limits global mailing list requests to specified Cloudflare channels using explicit limit and offset parameters.

#### Scenario: Pagination request
- **WHEN** A logged in user requests a Cloudflare global email and passes in valid `channel_id`, limit and offset parameters
- **THEN** System SHALL forwards restricted pagination parameters to Cloudflare on the specified channel and includes pagination metadata in the response.

#### Scenario: limit beyond the limit
- **WHEN** A logged in user requested more than the maximum allowed number of Cloudflare global messages
- **THEN** System SHALL limits limit to the maximum value allowed by the configuration before calling Cloudflare for the specified channel.

## ADDED Requirements

### Requirement: Cloudflare channel global mail entries
System SHALL provides independent access to all mail views for each enabled Cloudflare channel.

#### Scenario: Show the entry for each enabled channel
- **WHEN** Temporary email list showing Cloudflare provider portal
- **THEN** System SHALL displays a separate Cloudflare all-mail portal for each enabled Cloudflare channel, displaying the channel name in the portal.

#### Scenario: Do not display disabled channel entrances
- **WHEN** A Cloudflare channel is disabled
- **THEN** The system SHALL NOT display this channel in the Cloudflare all mail portal list.

#### Scenario: Click the channel entrance to load only this channel
- **WHEN** Logged-in user clicks all email portals of a Cloudflare channel
- **THEN** The system SHALL only requests the Cloudflare global mailing list for this channel.

#### Scenario: Does not provide all channel aggregation entrances
- **WHEN** Temporary mailbox list displays all Cloudflare mail portals
- **THEN** The system SHALL NOT display or call a portal that aggregates mail across all Cloudflare channels.
