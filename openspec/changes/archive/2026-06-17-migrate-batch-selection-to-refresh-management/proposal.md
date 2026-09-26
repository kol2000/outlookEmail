## Why

The account list in Token refresh management is already responsible for filtering, viewing refresh status, and batch refresh/deletion, but the batch interaction capability is significantly weaker than the main mailbox list. After users filter out target accounts in token refresh management, they still need to return to the main mailbox list to perform batch actions such as copying, exporting, labeling, moving, proxying, and forwarding. The process is fragmented and the current filtering context is easily lost.

## What Changes

- Token refreshes the management account list and completely migrates the batch selection experience of the mailbox list: selection mode, row click selection, check box selection, `Shift` continuous range selection, drag and drop selection, select all current list and clear selection.
- Token refresh management account list to completely migrate the batch actions of ordinary mailbox list: refresh token, copy mailbox + alias, export, enable forwarding, cancel forwarding, account proxy, label +, label -, move group and delete.
- Token refresh management continues to use the existing streaming refresh link to perform "refresh selected", retaining task logs, stopped tasks, conflict prompts, and refresh result backfilling.
- After the batch action is completed, the Token is refreshed synchronously to refresh the management list, main email account list, group count and related front-end cache to avoid inconsistency in the status of the two lists.
- Batch actions in Token refresh management comply with the same qualification judgment, secondary confirmation, error prompts and execution result feedback as the main mailbox list.
- No breaking changes are introduced.

## Capabilities

### New Capabilities

- `refresh-management-batch-actions`: Token refreshes the batch selection, batch toolbar and account batch operation capabilities in the management account list.

### Modified Capabilities

None.

## Impact

- Front-end template: `templates/partials/index/dialogs-management.html`
- Front-end script: `static/js/index/08-refresh.js`, reuse or extract the general selection/action logic of `static/js/index/10-batch-actions.js` when necessary
- Front-end style: `static/css/index/06-modals-toast.css`, reuse the mailbox list batch toolbar style if necessary
- Backend interface: Prioritize reuse of existing account batch interfaces, including `/api/accounts/refresh-selected-stream`, `/api/accounts/export-selected`, `/api/accounts/batch-update-forwarding`, `/api/accounts/batch-update-proxy`, `/api/accounts/tags`, `/api/accounts/batch-update-group`, `/api/accounts/batch-delete`
- Testing and documentation: Supplement front-end structure regression, batch action entry regression, README/API or change log description
