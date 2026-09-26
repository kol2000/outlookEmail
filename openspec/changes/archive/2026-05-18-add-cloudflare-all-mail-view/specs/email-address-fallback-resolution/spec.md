## ADDED Requirements

### Requirement: Deterministic email query candidates
System SHALL generates a deterministic mailbox lookup candidate list based on the requesting email address.

#### Scenario: Complete address candidate
- **WHEN** The system builds a candidate list for valid requesting email addresses
- **THEN** The first candidate address SHALL is the fully normalized request address.

#### Scenario: Plus-address candidate
- **WHEN** The local part of the request mailbox contains the plus-address fragment
- **THEN** System SHALL removes the plus-address fragment from right to left and appends candidate addresses while retaining the original domain name.

#### Scenario: Non-Gmail address candidate
- **WHEN** The requested email domain name is neither `gmail.com` nor `googlemail.com`
- **THEN** System SHALL NOT add Gmail/Googlemail suffix fallback candidate addresses.

### Requirement: Gmail and Googlemail suffix fallback
System SHALL supports mutual fallback of `@gmail.com` and `@googlemail.com` in mailbox lookup and Cloudflare address filtering queries.

#### Scenario: Gmail fallback to Googlemail
- **WHEN** The request address ends with `@gmail.com` and no result was found for the request address
- **THEN** System SHALL retries with the same local part and `@googlemail.com` suffix.

#### Scenario: Googlemail fallback to Gmail
- **WHEN** The request address ends with `@googlemail.com` and no result was found for the request address
- **THEN** System SHALL retries with the same local part and `@gmail.com` suffix.

#### Scenario: Plus fallback and Gmail suffix fallback combination
- **WHEN** The requested Gmail or Googlemail address contains the plus-address fragment
- **THEN** System SHALL evaluates the plus-address candidate under the original suffix first, and then the equivalent candidate under the other suffix.

### Requirement: Account API fallback resolution
System SHALL uses shared mailbox query candidate ordering in account resolution for internal and external mail APIs.

#### Scenario: Internal mail API parsing another suffix for Gmail
- **WHEN** `/api/emails/<email_addr>` requested a Gmail or Googlemail address, and there was no direct account match
- **THEN** System SHALL retries account resolution using another suffix before returning that the account does not exist.

#### Scenario: External mail API parses another suffix of Gmail
- **WHEN** `/api/external/emails` requested a Gmail or Googlemail address, and there was no direct account match
- **THEN** System SHALL retries account resolution using another suffix before returning that the account does not exist.

#### Scenario: Return parsing metadata
- **WHEN** Account resolution for internal or external mail API uses fallback candidates
- **THEN** Successful response SHALL contains the original request email and the parsed account email, and indicates the alias or fallback metadata when applicable.

### Requirement: Cloudflare address-filter fallback
System SHALL only applies Gmail/Googlemail fallback when specific address filters are provided by the Cloudflare global mail query.

#### Scenario: Cloudflare address filtering retries with another suffix
- **WHEN** Cloudflare global email query includes Gmail or Googlemail address filter and the first query succeeds but returns 0 emails
- **THEN** System SHALL queries for another suffix candidate address before returning empty results.

#### Scenario: Cloudflare does not fall back when address filtering has results.
- **WHEN** Cloudflare global email query includes Gmail or Googlemail address filters and the first query returns one or more emails
- **THEN** The system SHALL NOT queries another suffix candidate address.

#### Scenario: Cloudflare unfiltered query does not fall back
- **WHEN** Cloudflare global email query does not include address filters
- **THEN** The system SHALL NOT generate or apply Gmail/Googlemail fallback candidate addresses.

#### Scenario: Return Cloudflare fallback metadata
- **WHEN** Cloudflare address filtering query returns emails from fallback candidate addresses
- **THEN** response SHALL contains the request address, the actual query address, and sets `fallback_used` to true.
