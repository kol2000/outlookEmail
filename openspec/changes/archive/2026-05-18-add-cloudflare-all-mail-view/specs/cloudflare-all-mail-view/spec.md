## ADDED Requirements

### Requirement: Cloudflare admin global mail listing
System SHALL provides an API that requires a login session to read the currently configured Cloudflare Temp Email Worker emails through the Cloudflare administrator mailing list interface.

#### Scenario: View all Cloudflare emails
- **WHEN** A logged in user requests the Cloudflare global mailing list without passing address filters
- **THEN** System SHALL calls the administrator mailing list interface of the currently configured Worker without passing the address filtering conditions, and returns the parsed mailing list items.

#### Scenario: Cloudflare configuration is missing
- **WHEN** A logged in user requested the Cloudflare global mailing list, but the Worker domain name or admin password was not configured
- **THEN** System SHALL returns a failure response and explains the missing Cloudflare configuration.

#### Scenario: Upstream Cloudflare returns error
- **WHEN** Cloudflare admin mailing list interface returned error
- **THEN** System SHALL returns a failure response, retaining useful upstream error details.

### Requirement: Cloudflare admin address filtering
System SHALL supports optional recipient address filtering for Cloudflare global mailing lists.

#### Scenario: Filter by recipient address
- **WHEN** A logged in user requests a Cloudflare email and passes in address filters
- **THEN** System SHALL passes the normalized address to the Cloudflare administrator mailing list interface and returns the upstream reports of emails belonging to that address.

#### Scenario: Address filtering response metadata
- **WHEN** Cloudflare global email query includes address filters
- **THEN** The response SHALL contains the request address, the actual query address, and whether fallback was used.

### Requirement: Cloudflare global mail pagination
System SHALL limits Cloudflare global mailing list requests using explicit limit and offset parameters.

#### Scenario: Pagination request
- **WHEN** The logged in user requests Cloudflare global mail and passes in the limit and offset parameters
- **THEN** System SHALL forwards restricted pagination parameters to Cloudflare and includes pagination metadata in the response.

#### Scenario: limit beyond the limit
- **WHEN** A logged in user requested more than the maximum allowed number of Cloudflare global messages
- **THEN** System SHALL limits limit to the maximum value allowed by the configuration before calling Cloudflare.

### Requirement: Cloudflare raw mail normalization
System SHALL normalizes Cloudflare admin email records to the email list and details fields expected by the existing UI rendering process.

#### Scenario: Parse original email items
- **WHEN** Cloudflare returns email records containing original RFC822 content
- **THEN** System SHALL parses sender, recipients, subject, preview text, whether it contains HTML, timestamp and stable message ID for presentation.

#### Scenario: Mail item is missing original content
- **WHEN** Cloudflare email records are missing original RFC822 content
- **THEN** The system SHALL skips this record or safely represents it without affecting the overall response.

### Requirement: Cloudflare global view isolation
System SHALL keeps Cloudflare global mailing lists isolated from the local temporary mailbox cache.

#### Scenario: Global email address is not imported locally
- **WHEN** Cloudflare global mailing list returns mail for an address not in `temp_emails`
- **THEN** The system SHALL still displays the message, and SHALL NOT create a local temporary mailbox record.

#### Scenario: Global mail is not cached as temporary mailbox mail
- **WHEN** System lists Cloudflare global mail
- **THEN** The system SHALL NOT write these messages to `temp_email_messages`.
