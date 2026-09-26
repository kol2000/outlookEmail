## Background

This project already supports GPTMail, DuckMail and Cloudflare Temp Email in the temporary mailbox area. The premise of current Cloudflare support is that the user selects a local `temp_emails` record, and then the system uses the JWT saved in the record to call `/api/mails` to read the email of a single address. The Worker domain name, email domain name, and administrator password are currently global settings.

Cloudflare Temp Email also provides the administrator mail list interface `/admin/mails`, which can list Worker mail pools and supports optional `address` filtering. This interface uses the admin password rather than a JWT for a single address, so it is better suited as a standalone "Cloudflare All Mail" view rather than reusing the existing "Mail for a temporary mailbox" interface.

Ordinary email API already has plus-address alias fallback logic. This logic is in the account resolution helper function and is reused by the internal and external email APIs.

## target / non-target

**Target:**

- Provides a Cloudflare Temp Email global mailing list for the currently configured set of Cloudflare channels.
- Allows users to filter the Cloudflare global mailing list by recipient address.
- When querying the specified address, if the first candidate address does not hit, support mutual fallback between `@gmail.com` and `@googlemail.com`.
- Preserve the existing plus-address fallback behavior and make the fallback order clear and testable.
- Returns metadata describing the request address, the actual query or resolution address, and whether fallback was used.
- To the extent feasible, make parsed email response fields compatible with existing email lists and detail rendering paths.

**Non-target:**

- Multiple Cloudflare channel configurations are not supported this time.
- Does not modify Cloudflare address creation, deletion, single-address JWT storage semantics.
- Do not write Cloudflare global mail pool persistence to `temp_email_messages`.
- Do not normalize email service providers other than `gmail.com` and `googlemail.com`.
- Cloudflare’s global email attachment download capability will not be added unless the content metadata already parsed can be directly reused.

## Design Decisions

### Use the standalone Cloudflare admin email API

Add a new backend route to carry the Cloudflare global view, such as `GET /api/cloudflare/messages`, and do not reuse or reload `GET /api/temp-emails/<email>/messages`.

Cause: An existing temporary mail route is scoped to a local temporary mailbox record. The administrator interface may return emails to addresses that do not exist locally. If it is used as a cache for a certain mailbox, the data ownership will become unclear.

Alternative: Put a special pseudo mailbox in the list of existing temporary mailboxes. This can reduce the number of UI entries, but it will introduce fake email identities, and the routing of email details requires additional special judgment.

### Do not write the administrator list email to `temp_email_messages`

Cloudflare global mailing lists should be fetched and parsed in real time for display, but not written to existing temporary mail cache tables.

Reason: `temp_email_messages.email_address` binds the local `temp_emails.email` foreign key. Administrator results may contain any recipient address in the Worker mail pool, including addresses not imported into this project.

Alternative: Automatically create missing temporary mailbox records. This will accidentally change the user's mailbox list and requires definition of cleanup semantics, which is not part of this requirement.

### Reuse raw MIME parsing via Cloudflare response adapter

Before parsing the original RFC822 content, first adapt the `id`, `message_id`, `source`, `address`, `raw`, `created_at` and other fields in each Cloudflare administrator email record into a data shape that can be used by the existing display logic.

Reason: The project has been able to parse Cloudflare raw emails returned by address JWT. Adding a small adaptation layer keeps parsing behavior consistent while obtaining recipient metadata from the administrator response.

Alternative: Rely on Cloudflare's parsed mail interface. However, it is not clear whether the administrator parsed interface covers the global view, and `/admin/mails` is a documented administrator list interface.

### Centrally generate address fallback candidates

Extend the auxiliary function that currently only serves plus-address into a unified candidate address builder to generate:

1. Completely normalized original address.
2. The plus-address fallback address under the same domain name.
3. When the domain name is `gmail.com` or `googlemail.com`, generate the corresponding address of another suffix for each plus-address candidate.

Reason: Both account resolution and Cloudflare address filtering queries require the same ordering rules. Centralized generation can avoid behavioral drift caused by different routes being implemented separately.

Alternative: Only do Gmail suffix fallback in the new Cloudflare route. This can only meet part of the requirements and will make `/api/emails/<email>` and `/api/external/emails` behave inconsistently.

### Cloudflare address fallback is triggered by "no result"

For `GET /api/cloudflare/messages?address=...`, first query the first candidate address. If the request succeeds but returns 0 messages, querying continues for the next candidate address until a result is found or candidates are exhausted.

Reason: Cloudflare administrator list does not parse local account records, and the observed "not found" status is an empty result set. This also keeps the global list simple: no address is passed and no fallback is triggered.

Alternative: Always query both Gmail suffixes and merge. This may cause duplication when equivalent addresses exist in the Worker, and may also violate the user's expectations for precise address queries.

## Risk/Trade-off

- The Cloudflare administrator list can expose all emails in the Worker mail pool -> Maintain session login authentication and will not expose it to the API Key external interface unless explicitly required later.
- Acquisition cost may be higher when global mail pool is large -> Limit paging size and preserve `limit` / `offset` semantics.
- When the offset is non-0, the empty first page does not necessarily mean that the filtered mailbox is empty as a whole -> The rollback is only triggered by the empty result under the current request offset, and `fallback_used` is exposed through the response metadata for the caller to judge.
- Cloudflare raw email responses may change with upstream versions -> Response normalization should be implemented defensively and preserve useful upstream error details.
- If both Gmail suffixes are configured with accounts, the fallback sequence may surprise users -> exposing `requested_email`, `queried_email` or `resolved_email`, `fallback_used` in the response.

## Migration plan

- Added auxiliary functions and routes without modifying the existing database schema.
- Keep existing behavior of getting Cloudflare mail by temporary mailbox JWT unchanged.
- Updated documentation to describe the new Cloudflare global list separately from the existing `folder=all` general mailbox aggregation query.
- When rolling back, just remove the new routing, UI entry and Gmail suffix rollback auxiliary logic, no data migration is required.

## Questions to be confirmed

- Does the Cloudflare global list need to be exposed to the external API Key interface in the future, or should it remain available only for login sessions?
- Will the first version of the UI include the recipient filtering input box directly, or will routing/API capabilities and a simple all-mail view be provided first?
