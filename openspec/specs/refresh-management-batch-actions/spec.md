# refresh-management-batch-actions Specification

## Purpose
Define the account batch selection and batch operation capabilities in Token refresh management to ensure that this view reuses the account batch actions of the main mailbox list, while retaining the streaming refresh task log and cross-view status synchronization.

## Requirements

### Requirement: Token refresh management supports account batch selection

Token refresh management account list SHALL supports the same batch selection experience as the main mailbox list, including selection mode, row click selection, check box selection, `Shift` continuous range selection, drag and drop selection, select all current list and clear selection.

#### Scenario: Enter selection mode and select rows

- **WHEN** The user enters the batch selection mode in the Token refresh management account list and clicks the account row
- **THEN** System SHALL switches the selected status of the account and updates the selected quantity

#### Scenario: Select a continuous range

- **WHEN** The user first selects an account, then holds down `Shift` and clicks another account or checkbox in the same Token list
- **THEN** System SHALL selects the continuous range between two accounts and updates the batch toolbar status

#### Scenario: Drag selection in selection mode

- **WHEN** User drags through multiple accounts starting from the account row or checkbox in batch selection mode
- **THEN** System SHALL Select or cancel accounts in batches by dragging the starting point state

#### Scenario: Select and clear current list

- **WHEN** The user clicks Token to refresh the current list of select all or clear the selection in the management batch toolbar.
- **THEN** System SHALL only updates the account selection status in the currently rendered Token list

### Requirement: Token refresh management exposes all normal account batch actions

Token refresh management account list SHALL provides all batch actions supported by ordinary accounts in the main mailbox list after selecting the account: refresh token, copy mailbox + alias, export, enable forwarding, cancel forwarding, account proxy, label +, label -, move group and delete.

#### Scenario: Show full batch action toolbar

- **WHEN** The user selects at least one account in the Token refresh management account list
- **THEN** System SHALL displays the batch toolbar and includes refresh token, copy mailbox + alias, export, enable forwarding, cancel forwarding, proxy, label +, label -, move and delete operations

#### Scenario: Hide batch action toolbar when nothing is selected

- **WHEN** Token refreshes the management account list and no account is selected.
- **THEN** System SHALL hides the selected batch toolbar or disables all selected batch actions

#### Scenario: Preserve account action eligibility

- **WHEN** The selected account does not meet the qualifications for a batch action
- **THEN** System SHALL disables this action according to the same rules as the main mailbox list or skips accounts that do not meet the conditions during execution and displays a clear prompt

### Requirement: Selected Token refresh uses streaming task logs

The refresh selected action in Token refresh management MUST use the existing selected account to stream the task link, and SHALL retain task logs, stop tasks, conflict prompts, and account-level refresh results for backfilling.

#### Scenario: Start selected refresh task

- **WHEN** The user selects the account in Token refresh management and clicks to refresh Token
- **THEN** System SHALL initializes the task with `POST /api/accounts/refresh-selected-stream` and uses the returned `stream_url` to subscribe to SSE progress

#### Scenario: Render selected refresh progress

- **WHEN** Select the account refresh task to return start, progress, account results, waiting, completion, stop, conflict or error events
- **THEN** System SHALL updates task logs, refresh statistics, current account refresh status and batch button available status

#### Scenario: Complete selected refresh task

- **WHEN** The selected account streaming refresh task is completed
- **THEN** System SHALL clears this refresh selection, refreshes the Token management list, and synchronously refreshes the main mailbox list cache

### Requirement: Account batch actions execute from Token refresh management

Token refresh management SHALL allows users to perform batch actions on existing accounts in the main mailbox list for selected accounts, and MUST reuse existing account batch interfaces and pop-up processes.

#### Scenario: Copy selected account emails and aliases

- **WHEN** The user selects the account in Token refresh management and clicks to copy the email address + alias
- **THEN** System SHALL copies the main email and alias email of the selected account, removes duplicates and writes them to the clipboard

#### Scenario: Export selected accounts

- **WHEN** The user selects the account in Token refresh management and clicks export
- **THEN** System SHALL reuses and exports the secondary verification process, and exports the corresponding account text by selecting the account ID

#### Scenario: Update forwarding for selected accounts

- **WHEN** The user selects the account in Token refresh management and clicks to enable forwarding or cancel forwarding
- **THEN** System SHALL calls the account batch forwarding interface, updates only the accounts that need to be changed, and prompts for the skip quantity or result.

#### Scenario: Update proxy for selected accounts

- **WHEN** The user selects the account in Token refresh management and clicks the agent
- **THEN** System SHALL reuses the account proxy settings pop-up window and applies the proxy configuration to the selected account

#### Scenario: Update tags for selected accounts

- **WHEN** The user selects the account in Token refresh management and clicks the label + or label -
- **THEN** System SHALL reuses the tag selection pop-up window and adds or removes target tags in batches for the selected account

#### Scenario: Move selected accounts

- **WHEN** The user selects the account in Token refresh management and clicks Move
- **THEN** System SHALL reuses the mobile group pop-up window and moves the selected account to the target normal group

#### Scenario: Delete selected accounts

- **WHEN** The user selects the account in Token refresh management and confirms the deletion
- **THEN** System SHALL calls the account batch deletion interface to delete the selected accounts and remove the deleted accounts from the Token refresh management list

### Requirement: Batch action results stay synchronized across account views

After the batch action in Token refresh management is completed, the system SHALL synchronizes the Token refresh management list, primary mailbox account list, group count, current account view and related front-end cache.

#### Scenario: Refresh related views after successful batch mutation

- **WHEN** The user completes account status change actions other than deletion, move, tag, proxy, forward or export in Token refresh management.
- **THEN** System SHALL caches invalid accounts, refreshes the group list, refreshes the Token management list, and refreshes the currently visible main email account list

#### Scenario: Reset selected account after deletion

- **WHEN** Token Refresh management of batch deleted accounts includes the email address currently being viewed
- **THEN** System SHALL clears the current account and email details view to avoid continuing to display the data of deleted accounts

#### Scenario: Preserve modal safety and feedback

- **WHEN** Users perform delete, move, proxy, forward, label, export or refresh Token batch actions from Token refresh management
- **THEN** The system MUST display confirmation, loading, success and failure feedback that matches the action risk, and avoid the confirmation pop-up window being blocked by the Token management pop-up window.
