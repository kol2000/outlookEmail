## Context

The main mailbox list already has a mature batch selection and batch operation system, including selection mode, row click, `Shift` range selection, drag and drop selection, floating batch toolbar, as well as account actions such as refreshing Token, copying mailbox + alias, export, forward, proxy, label, move and delete.

Token refresh management is currently an independent pop-up workbench. The list only provides table check boxes, current list all selection, clear, refresh selected and delete selected. After users filter out accounts through status or search in Token refresh management, if they want to perform batch actions on other accounts, they need to return to the main mailbox list to re-filter and select.

## Goals / Non-Goals

**Goals:**

- Provide a batch selection experience consistent with the main email list in the Token refresh management account list.
- Provides batch actions for all existing accounts in the general mailbox list in Token refresh management.
- Reuse the existing account batch API to avoid adding new back-end data models.
- Retain Token refresh management of existing streaming refresh tasks, task logs and the ability to stop tasks.
- After the batch action is completed, the Token management list, main account list, group count and local cache are refreshed synchronously.

**Non-Goals:**

- Do not move temporary mailbox batch actions into Token refresh management.
- The account data range managed by Token refresh will not be changed; the active Outlook account will still be the main one.
- No new batch reauthorization capability is added.
- Does not change the authentication, CSRF or export two-step verification rules of the existing account batch API.

## Decisions

### Decision: The Token page reuses the account batch API and does not add a dedicated backend interface.

The account summary returned by Token refresh management list already contains information such as `email`, `aliases`, `account_type`, `provider`, `forward_enabled`, `tags`, grouping and refresh status, which is enough to drive front-end qualification judgment and button copywriting. Batch actions can reuse existing interfaces:

- Refresh Token: `POST /api/accounts/refresh-selected-stream`
- Export: `POST /api/accounts/export-selected`
- Forward: `POST /api/accounts/batch-update-forwarding`
- Agent: `POST /api/accounts/batch-update-proxy`
- Tag: `POST /api/accounts/tags`
- Move: `POST /api/accounts/batch-update-group`
- Deleted: `POST /api/accounts/batch-delete`

The alternative is to add a new set of `/api/refresh-management/*` interfaces. This solution will duplicate the backend behavior and increase the risk of rule drift between the two entrances, so it is not adopted.

### Decision: Refresh selected continue to use SSE task link

Batch refresh in the main mailbox list currently uses sync `POST /api/accounts/refresh-selected`. Token refresh management has used `POST /api/accounts/refresh-selected-stream` to initialize the task, and then subscribe to the SSE log. When migrating actions, only the action entrance and selection experience are migrated, and there is no fallback to synchronous refresh.

An alternative is to replicate the master mailbox list synchronous refresh logic for action consistency. This solution will lose the task logs, stop tasks, conflict prompts and account-level real-time results of Token refresh management, so it is not used.

### Decision: Extract or adapt shared batch action logic to avoid copying complete functions

The batch action function of the main mailbox list currently strongly relies on `#accountList` DOM and `.account-select-checkbox`. When implementing, priority should be given to extracting reusable data-driven functions, such as "Get selected account summary", "Copy email + alias", "Start export", "Update forwarding", "Update agent", "Update label", "Move grouping", "Refresh cache after deleting account". The main email list and Token list provide the source of the selected account respectively.

An alternative is to duplicate all bulk action functions in `08-refresh.js`. This solution is faster to implement, but subsequent maintenance will result in two sets of confirmation copywriting, error handling and cache refresh logic, so the thin wrapper will only be partially copied when the extraction cost is obviously too high.

### Decision: Token list selection range is limited to the current rendering list

Token refresh management includes search, status filtering and paging size. "Select all current list" in batch selection only works on the currently rendered list items; clear the selection when searching or status filtering changes to avoid misoperations on invisible accounts. The abstract copy must clearly indicate the currently selected quantity.

An alternative is to keep the selection hidden across filters. This solution is suitable for advanced batch construction, but the risk of destructive or semi-destructive actions such as deletion, movement, and proxy is higher, so it is not used.

## Risks / Trade-offs

- [Risk] Too many batch action buttons cause the top of the Token management list to be crowded -> Use the selected toolbar consistent with the main mailbox list, and do not display the complete action group when it is not selected.
- [Risk] Improper extraction of the main mailbox list and Token list sharing logic will affect existing batch operations -> Supplement regression testing of the main mailbox list first, and then perform small-scale extraction to retain the original DOM entry.
- [Risk] The status of the two lists is inconsistent after actions such as deletion, movement, and labeling are completed -> Cache invalidation, group refresh, Token list refresh, and current account view reset are all called after the action is successful.
- [Risk] The export action requires secondary verification. Triggering export verification in the Token pop-up window may cause pop-up layer order problems -> Reuse the existing export verification pop-up window and verify that it can cover the Token management pop-up window.
- [Risk] The Token list only contains active Outlook accounts. Batch forwarding/agent/label/move will modify the account management properties -> the copy is clearly account batch action, and the main mailbox list confirmation prompt will be used.

## Migration Plan

1. Add the selection mode entry and post-selection batch toolbar to the Token refresh management template.
2. Bind the row click, check box, `Shift` and drag and drop selection behaviors to the Token list rows that are consistent with the main mailbox list.
3. Extract or adapt the account batch action function so that the Token list can use the account summary array as action input.
4. Keep the existing streaming refresh implementation of the Token page and add a new "Refresh Token" batch button.
5. Access existing interfaces and pop-ups for copy, export, forward, proxy, label, move, delete.
6. Supplement regression testing and update README, CHANGELOG or API documentation.

Rollback can remove the new toolbar entry in the Token management template and return `08-refresh.js` to the existing table checkbox and four basic buttons; the backend interface does not require rollback.

## Open Questions

None.
