## 1. Backend authorization process

- [x] 1.1 Extract shared helpers for OAuth callback URL parsing and authorization code exchange tokens for reuse by existing OAuth assistants and account re-authorization interfaces
- [x] 1.2 Added account authorization update helper, only updates `client_id`, encrypted `refresh_token`, `refresh_token_updated_at` and necessary refresh status fields
- [x] 1.3 Added `POST /api/accounts/<account_id>/reauthorize` interface to verify login, account existence, account type is Outlook, and reject IMAP accounts
- [x] 1.4 Clear old refresh failure errors after saving new authorization information in the re-authorization interface, and call the existing single-account refresh logic to perform automatic verification
- [x] 1.5 Let the re-authorization interface return authorization update results and automatic refresh results. Failure responses use the existing error structure and sensitive information desensitization rules.

## 2. Front-end re-authorization entry

- [x] 2.1 Expand the existing OAuth pop-up window to support the "Update existing account" mode, pre-fill the account email address and hide the special field for saving new accounts
- [x] 2.2 Add a re-authorization entry in the Outlook account editing pop-up window. This entry is not displayed for IMAP accounts.
- [x] 2.3 Add a re-authorization entry in the refresh failure details to automatically bring in the failed account context
- [x] 2.4 Implement the front-end submission callback URL to the account re-authorization interface, and display three types of results: authorization update, automatic refresh success, and automatic refresh failure.
- [x] 2.5 After re-authorization is completed, refresh the account list, refresh the management list and the current account status cache to ensure that old failure prompts will not remain

## 3. Documentation and compatibility

- [x] 3.1 Update `docs/api.md`, record account re-authorization interface, request body, response fields and error behavior
- [x] 3.2 Confirm that the existing `/api/oauth/exchange-token`, account import, account editing, and single account refresh behaviors remain compatible
- [x] 3.3 Confirm that no database migration is required, reusing `refresh_token_updated_at` and existing refresh status fields

## 4. Test verification

- [x] 4.1 Added back-end test: only the authorization field will be updated if the re-authorization is successful, and the email, password, group, status, forwarding, proxy, remarks, alias and label will be retained.
- [x] 4.2 Added backend test: Reauthorization requests for IMAP accounts and non-existing accounts will not modify data
- [x] 4.3 Add backend test: the old failure status is cleared after re-authorization, and the final status is `success` when the automatic refresh is successful.
- [x] 4.4 Add backend test: when automatic refresh fails, the final status is `failed`, and new error information is saved
- [x] 4.5 Add front-end or static test: Outlook account displays the re-authorization entrance, IMAP account does not display, and the new mode does not go through the process of saving the new account.
- [x] 4.6 Run related tests: OAuth token preview, refresh status, account editing/sensitive field protection related tests, and record the results
