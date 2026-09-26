## 1. Address fallback auxiliary function

- [x] 1.1 Added a new shared mailbox query candidate builder, the order remains as complete address first, existing plus-address fallback second, Gmail/Googlemail suffix fallback last.
- [x] 1.2 Updated account resolution logic to use shared candidate builder while retaining current alias and plus-address behavior.
- [x] 1.3 Return fallback metadata from account resolution results, allowing internal and external email APIs to expose request address and resolution address details.

## 2. Cloudflare administrator email backend

- [x] 2.1 Added Cloudflare administrator email request helper function, calling `GET /admin/mails` using the currently configured Worker domain name and administrator password.
- [x] 2.2 Added response normalization logic for Cloudflare administrator email records, including original RFC822 parsing, recipient metadata, stable ID, timestamp, and security processing of records lacking raw content.
- [x] 2.3 Added Cloudflare global email routing that requires session login, and supports restricted `limit`, `offset` and optional address filtering parameters.
- [x] 2.4 Apply Gmail/Googlemail fallback only if Cloudflare address filtering query succeeds the first time but returns 0 messages.
- [x] 2.5 Ensure Cloudflare global mail does not insert `temp_emails` or `temp_email_messages`.

## 3. API integration

- [x] 3.1 Updated `/api/emails/<email_addr>` to return fallback metadata when account resolution uses fallback candidates.
- [x] 3.2 Update `/api/external/emails` to return fallback metadata when account resolution uses fallback candidates.
- [x] 3.3 Keep the existing behavior of getting mail by temporary mailbox Cloudflare JWT unchanged.
- [x] 3.4 Return clear errors for missing Cloudflare Worker domain name, missing Cloudflare administrator password, and failure of the upstream Cloudflare administrator API.

## 4. Front end

- [x] 4.1 Added Cloudflare all mail portal in temporary mailbox UI.
- [x] 4.2 Added a new recipient address filtering control to the Cloudflare All Mail view.
- [x] 4.3 Renders a Cloudflare global message line containing recipient, sender, subject, timestamp, preview, and fallback metadata when applicable.
- [x] 4.4 Reuse existing email details rendering logic to display Cloudflare global emails as much as possible.

## 5. Documentation

- [x] 5.1 Document the Cloudflare global mail API separately from the existing `folder=all` general mailbox aggregation query.
- [x] 5.2 Document Gmail/Googlemail fallback behavior in internal APIs, external APIs, and Cloudflare address filtering queries.
- [x] 5.3 Updated user-facing instructions for the Cloudflare All Mail view in the README.

## 6. Test

- [x] 6.1 Added unit test for shared mailbox query candidate sequence, covering plus-address and Gmail/Googlemail combinations.
- [x] 6.2 Added account resolution test to prove that the existing plus-address fallback can still work, and that the Gmail/Googlemail fallback can resolve another suffix account.
- [x] 6.3 Added Cloudflare global list backend test without address filtering.
- [x] 6.4 Added Cloudflare address filtering fallback backend test, covering the scenario where the first suffix returns 0 emails and the other suffix returns emails.
- [x] 6.5 Added new backend test to prove that the Cloudflare global list does not write `temp_emails` or `temp_email_messages`.
- [x] 6.6 Runs a focused test suite covering the mail API, temporary mailboxes, and IMAP folder parsing behavior.
