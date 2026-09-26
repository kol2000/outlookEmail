## Context

OutlookEmail currently has two related capabilities:

- OAuth Assistant: `/api/oauth/auth-url` generates a Microsoft authorization link, `/api/oauth/exchange-token` uses a callback URL in exchange for `refresh_token` and the system-configured `client_id`.
- Token refresh: Single account refresh will use the `client_id` / `refresh_token` saved in the account to exchange for the access token, and write the real refresh results to `last_refresh_status`, `last_refresh_at`, `last_refresh_error`; when Microsoft returns the rotated refresh token, `refresh_token_updated_at` will be updated.

The existing account editing interface can update `client_id` / `refresh_token`, but this is a complete account editing process, and it is easy to mix authorization updates with irrelevant fields such as email, group, agent, alias, etc. Reauthorization needs to be a narrow process with clear goals.

## Goals / Non-Goals

**Goals:**

- Provides re-authorization entry for existing Outlook OAuth accounts.
- Reauthorization only updates the authorization fields and necessary refresh status of the target account, without accidentally changing the account business configuration.
- Immediately clear the old refresh failure status after successful re-authorization, and automatically trigger a single account refresh to verify the new authorization.
- Automatically refresh to store the real results: success will be displayed, failure will be a new failure error.
- The front end can initiate this process in account editing and refresh failure scenarios, and display the processing results.

**Non-Goals:**

- IMAP account reauthorization is not supported.
- No bulk reauthorization.
- No new Microsoft OAuth application configuration management is added.
- Existing import accounts, normal editing accounts, and full refresh scheduling semantics will not be changed.

## Decisions

### Use account-level reauthorization narrow interface

Added account-level interface, such as `POST /api/accounts/<account_id>/reauthorize`. The request body only receives the authorized callback URL, and the backend is responsible for extracting code, exchanging tokens, updating account authorization fields, clearing old failure status, and triggering single account refresh.

Reason: Reusing the complete `PUT /api/accounts/<account_id>` will require the front end to submit a large number of irrelevant fields. The risk is that the password, group, status, agent, remarks or alias are mistakenly changed during re-authorization. Narrow interfaces limit authorization updates to those controllable by the backend.

Alternative: Let the front end call `/api/oauth/exchange-token` first, then stuff the result back into the edit form and call save. This implementation is smaller, but still relies on full edit commits and is not suitable as a failure recovery process.

### Backend reuses OAuth token replacement logic

Extract the logic of "extracting code from redirected_url and requesting Microsoft token endpoint" in the existing `/api/oauth/exchange-token` into a shared helper. Both the OAuth helper and the account reauthorization interface call this helper.

Reason: To avoid two sets of authorization code parsing and token request logic drift, and to facilitate testing of failure messages.

Alternative: Copy the token replacement logic inside the reauthorization interface. It works in the short term, but duplicating code will increase the cost of adjusting subsequent scopes, redirect URIs, or error handling.

### Authorization update and automatic refresh are processed in stages

After the re-authorization is successfully changed to the refresh token, first save the new `client_id` / `refresh_token` / `refresh_token_updated_at`, clean up the old `last_refresh_status` / `last_refresh_error`, and then call the existing single account refresh logic. The final response returns the authorization update results and automatic refresh results.

Reason: The user has clearly completed re-authorization, and the old failure status no longer represents the current authorization; subsequent automatic refresh gives a true verification conclusion. If the auto-refresh fails, the failed status is overwritten with the new error.

Alternative: Write a new token only if the automatic refresh is successful. This can avoid saving unavailable tokens, but will cause the new authorization that the user has completed to be lost; and the automatic refresh may fail due to proxy or temporary network, which does not necessarily mean that the token is invalid.

### No forgery refresh success

Reauthorizing the interface can clear the old failure status, but you cannot directly write `last_refresh_status` into `success`. `success` can only come from automatic single account refresh real success.

Reason: The refresh status is the result of "the latest refresh verification", not the result of "the latest authorization operation".

### The front-end reuses the authorization pop-up window structure but with account context

The front end can extend the existing OAuth pop-up window and add the "Update existing account" mode. This mode prefills the current account email address, hides or disables fields related to saving new accounts, and switches the main button behavior to "Update Authorization and Refresh".

Reason: The existing pop-up window already covers the mental model of authorization link, opening the authorization page, pasting the callback URL, and exchanging the token; adding a mode is more maintenance-free than creating a new completely independent pop-up window.

Alternative: embed the authorization steps directly in the edit account pop-up window. This makes the context more focused, but makes the edit popup more complex and duplicates more UI with the existing OAuth helper.

## Risks / Trade-offs

- Auto-refresh after reauthorization may fail due to temporary proxy or Microsoft failure → Overwrite status with real refresh results after saving new authorization and return new error in response, do not hide failure.
- Authorization is successful but the account email and Microsoft login email are inconsistent → The system is currently unable to reliably confirm the target email from the token; the status quo is retained and email consistency is not forced to be verified. If necessary, the UI copy prompts the user to authorize the current account.
- There is a short-term intermediate state between clearing old failure status and automatic refresh → The interface synchronizes to trigger a single account refresh, and the front end only refreshes the list after a complete response, reducing the exposure of intermediate states.
- Both token replacement and refresh involve network requests, and the interface may take a long time → Reuse existing request timeouts and error handling; maintain the synchronous process in the first version, and evaluate asynchronous tasks later.

## Migration Plan

- No database migration; reuse existing `accounts.refresh_token_updated_at` and refresh status fields.
- The old account does not need to be processed after publishing, and the authorization field is updated only when the user triggers re-authorization.
- If you need to roll back, just remove the front-end entrance and the new interface; the new saved refresh token can continue to be used by the existing refresh logic.

## Open Questions

- Whether it is necessary to display `refresh_token_updated_at` in the account list as the "latest authorization update" time. This first edition does not require display to avoid expanding the list and changing it.
