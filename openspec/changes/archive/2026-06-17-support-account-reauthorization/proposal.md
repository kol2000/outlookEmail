## Why

After the Refresh Token of the current Outlook account expires, the user can only manually obtain a new Token, and then enter the edit account pop-up window to paste `Client ID` and `Refresh Token`. The process is easy to accidentally change other fields of the account, and the old "Refresh failed" status will continue to interfere with judgment.

It is necessary to provide a clear re-authorization entry for existing Outlook accounts: update the authorization information after successful authorization, clean up the old failure status, and immediately use a real single account refresh to verify whether the new authorization is available.

## What Changes

- Added "re-authorization" capability for existing Outlook OAuth accounts, which users can initiate from the account editing or failure prompt context.
- The ability for the re-authorization process to reuse existing Microsoft OAuth authorization links and authorization codes in exchange for Refresh Tokens.
- After successful re-authorization, only the `client_id`, `refresh_token`, `refresh_token_updated_at` and necessary refresh status fields of the target account will be updated. Business fields such as email, password, group, status, forwarding, agent, remarks, alias, etc. will not be modified.
- After successful re-authorization, the old refresh failure status and error message will be cleared, and then a single account refresh of the account will be automatically triggered.
- After the automatic refresh is completed, write back `last_refresh_status`, `last_refresh_at`, and `last_refresh_error` with the real refresh results; if the refresh fails, the interface must display the new failure results instead of hiding the failure.
- IMAP accounts do not support reauthorization entry.

## Capabilities

### New Capabilities

- `account-reauthorization`: Covers the re-authorization of existing Outlook OAuth accounts, authorization information update, old failure status cleanup and automatic refresh verification after re-authorization.

### Modified Capabilities

- None.

## Impact

- Backend Account API: Add or expand the existing account authorization update interface to handle target account verification, OAuth code exchange for tokens, encrypted saving of sensitive fields, refresh status updates and single account refresh triggers.
- Front-end account management: Provides re-authorization entry in the Outlook account editing pop-up window and refresh failure context, and displays the authorization, exchange, update, and automatic refresh process status.
- Database fields: reuse `accounts.refresh_token_updated_at`, `last_refresh_status`, `last_refresh_at`, `last_refresh_error` without adding new tables.
- Documentation and testing: Update the API documentation, supplement back-end interface testing and front-end process coverage, and focus on verifying that unauthorized account fields will not be accidentally changed.
