## Context

The current system grouping model is a flat list structure, and the `groups` table only has `id, name, description, color, sort_order, is_system, proxy_url, fallback_proxy_url_1, fallback_proxy_url_2, created_at` fields without any hierarchical relationship. All groups are arranged at the same level and sorted by `sort_order`. The `accounts.group_id` foreign key points to a single grouping.

The front-end grouping panel `#groupList` is rendered as a simple list and supports drag-and-drop sorting. Grouping operations (CRUD, sorting, proxy inheritance) all assume a flat structure.

Constraints:
- Technology stack: Flask + SQLite3 + native JS (no framework)
- SQLite ≥ 3.8.3 supports `WITH RECURSIVE` CTE
- Maximum level 3 depth
- Existing production data needs to be migrated smoothly

## Goals / Non-Goals

**Goals:**
- Supports tree grouping structure up to 3 levels
- When a group is selected, the group and all descendant group accounts are displayed
- Agent configuration supports hierarchical upward fallback inheritance
- Front-end tree rendering with collapse/expand interaction
- Support cross-level drag and drop to move groups
- When deleting a group, the sub-groups will be deleted cascaded, and the account will fall back to the default group.
- All related functions (drop-down selectors, batch operations, etc.) are adapted to tree display

**Non-Goals:**
- Deeper nesting beyond 3 levels is not supported
- Dynamic classifications such as "Virtual Grouping" or "Smart Grouping" are not supported
- Does not change the flat structure of the tags system
- Does not change the concept of IMAP folders

## Decisions

### D1: Hierarchical data model — Adjacency List (parent_id)

**Select**: Add `parent_id INTEGER DEFAULT NULL` and `level INTEGER DEFAULT 1 CHECK(level IN (1,2,3))` to the `groups` table

**Alternatives**:
- Path Enumeration (`level_path TEXT` such as `"3/7/12"`): Querying subtrees is efficient (`LIKE '3/7/%'`), but moving subtrees requires batch rewriting of paths, and SQLite string operations are not intuitive enough.
- Nested Set (`lft/rgt`): The query is fast but the insertion/move cost is high, and it is over-designed for low-frequency writing and high-frequency reading scenarios.
- Closure Table: An extra table to hold all ancestor-descendant pairs, 3 levels of depth is not worth it.

**Reason**: The level is the shallowest (only 3 levels), the recursive CTE performance is sufficient, and the code is the simplest and most intuitive. SQLite `WITH RECURSIVE` can query the entire tree at one time, and only need to change `parent_id` for move/deletion operations.

**Constraints**:
- `level=1` → `parent_id IS NULL`
- `level=2` → `parent_id` points to the group of `level=1`
- `level=3` → `parent_id` points to the group of `level=2`
- `name` maintains global UNIQUE (unique under different parents)

### D2: Proxy inheritance — fallback upwards step by step

**Selection**: `get_account_proxy_config()` The logic is changed to: account itself coverage → mount group → mount group parent → mount group grandparent → global null value.

**Reason**: The most intuitive inheritance method - the child group "inherits" the parent group without a proxy. When users edit subgroups, they can see the prompt "Currently inherited from: XX group".

**Implementation**: Add `get_group_inherited_proxy_config(group_row)` function, traverse `parent_id` upwards until a group with agent configuration is found or the root node is reached.

### D3: Recursive account display — group_id expands into group subtree

**Select**: `load_accounts(group_id=X)`, `count_accounts(group_id=X)` and `search_account_records(group_id=X)` Expand `X` into its own and all descendant group IDs and query the entire group subtree.

**Reason**: The parent group represents the scope of its subtree. When the user selects the parent group in the mailbox list or export, it is expected to include the subgroup account. The back-end export selects account deduplication for overlapping parent-child groups to avoid repeated output.

**API Impact**: `GET /api/accounts?group_id=X`, `GET /api/accounts/search?group_id=X` and group export semantics are "subtree accounts of X".

### D4: Folded state — front-end localStorage

**Selection**: In the folded state, only the front end `localStorage` and key format `outlook_group_collapsed_<groupId>` remain, without going to the database.

**Reason**: Collapse is a pure UI state and should not be shared across multiple users/devices.

### D5: Cross-level dragging - move + sort dual mode

**Select**:
1. Drag to the area above another group → "Move into this group" (set `parent_id` as the target group, and `level` adjust accordingly)
2. Drag to the separation line between groups → "Insert at this position at this level" (same as `sort_order` sorting under `parent_id`)

**Constraint**: Verify target depth when moving in + dragging subtree depth ≤ 3.

**Rejected plan**: Only supports sibling sorting + pop-up window moving parent - the interaction is fragmented and not as intuitive as drag and drop.

### D6: Deletion strategy — cascade deletion + account rollback

**Select**: When deleting a group, delete all subgroups recursively. All accounts `group_id` under the deleted group (including sub-groups) are moved back to the default group (id=1).

**Rejected Plan**:
- Moving subgroups up one level: This may lead to name conflicts under the same parent (need to be renamed), and the semantics may not meet user expectations.
- Refuse to delete groups with sub-groups: users need to manually clean up layer by layer, resulting in poor experience.

### D7: Temporary mailbox grouping — restricted to root nodes with no leaves

**SELECT**: The temporary mailbox group (`is_system=1`) remains a one-level root group and does not allow subgroups to be created under it or moved as subgroups of other groups.

**Reason**: Temporary mailboxes are special system groupings, and their behavior (channel filtering, dynamic generation) has nothing to do with hierarchical organization.

### D8: Sorting range — Sort under the same parent

**Selection**: `sort_order` is only meaningful if it is the same as `parent_id`. `reorder_groups()` is changed to `reorder_groups(parent_id, group_ids)`, which only rearranges the subgroups under the specified parent.

**Reason**: The grouping sorting of different parents does not interfere with each other, and the logic is clearer.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------|
| Data migration: There are existing flat groups that need to be supplemented `parent_id=NULL, level=1` | `ALTER TABLE` + `UPDATE`. The existing data is naturally satisfied |
| Globally unique names may cause user confusion: different parents cannot have the same name | Keep existing constraints unchanged to avoid complications; they can be relaxed to be unique under the same parent as needed in the future |
| Cross-level drag and drop verification is complex | Only 3 levels of depth, the verification logic is simple: `target_level + max_child_depth ≤ 3` |
| It is easy to confuse the descendant scope and the direct scope | The account list/search/export/sidebar number uniformly uses the group subtree; the API retains two fields: the number of direct descendants and the number of descendants |
| The front-end tree rendering rewrite workload is heavy | The number of groups is usually limited (tens to hundreds), and there is no performance bottleneck in DOM operations |
| Deleting a cascade may accidentally delete a large number of subgroups | The front-end secondary confirmation pop-up window prompts the number of subgroups to be deleted |
