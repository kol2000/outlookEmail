## Background and motivation

Cloudflare Temp Email already provides an administrator mail list interface, which can view the mail pool received by the entire Worker; however, this project can currently only view the mail of a single address through the JWT saved in the mailbox after selecting a local temporary mailbox. Users need to view all Cloudflare emails in this project, and be compatible with the situation where the same email address may appear as `@gmail.com` or `@googlemail.com` when querying the Gmail address.

## Change content

- Added Cloudflare global mailing list capabilities based on the currently configured set of Cloudflare Temp Email Workers and administrator passwords.
- Cloudflare global mailing lists support optional recipient address filtering while retaining an "all messages" view without filters.
- Parse raw RFC822 messages returned by Cloudflare into data shapes that can be reused by existing mailing lists and detail views.
- Added deterministic `@gmail.com` / `@googlemail.com` suffix fallback when the specified mailbox query misses.
- Keep the existing plus-address fallback behavior and make it work in combination with the Gmail suffix fallback.
- Metadata such as the request address, actual query or resolution address, and whether to use fallback are returned in the response.

## Capability scope

### New capabilities

- `cloudflare-all-mail-view`: View and filter all emails via the configured Cloudflare Temp Email admin email API.
- `email-address-fallback-resolution`: Parsing email queries with existing plus-address fallback and new Gmail/Googlemail suffix fallback.

### Modification ability

- None.

## Scope of influence

- Backend Cloudflare temporary mailbox route: `outlook_web/segments/06_routes_temp_email.py`.
- Existing account resolution auxiliary function: `outlook_web/segments/02_groups_accounts.py`.
- Internal and external mail API: `outlook_web/segments/08_forwarding_scheduler_errors.py`.
- Temporary mailbox frontend: `static/js/index/03-temp-emails.js`, along with necessary styles and templates.
- API documentation `docs/api.md` and README user instructions.
- Test coverage of Cloudflare admin mailing list, address filtering fallback, and existing plus-address fallback compatibility.
