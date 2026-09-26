## 1. Database Schema and migration

- [x] 1.1 `01_bootstrap.py`: The groups table CREATE statement adds `parent_id INTEGER DEFAULT NULL` and `level INTEGER DEFAULT 1 CHECK(level IN (1,2,3))`, and adds `FOREIGN KEY(parent_id) REFERENCES groups(id)`
- [x] 1.2 `01_bootstrap.py`: New migration scripts `ALTER TABLE groups ADD COLUMN parent_id INTEGER DEFAULT NULL` and `ALTER TABLE groups ADD COLUMN level INTEGER DEFAULT 1`, for the existing row `UPDATE groups SET parent_id = NULL, level = 1 WHERE parent_id IS NULL`
- [x] 1.3 `01_bootstrap.py`: Add index `CREATE INDEX IF NOT EXISTS idx_groups_parent_id ON groups(parent_id)` to column `parent_id`

## 2. Back-end data layer—group-level operations

- [x] 2.1 `02_groups_accounts.py`: Added `get_descendant_group_ids(group_id)` function to return a list of all descendant group IDs including itself.
- [x] 2.2 `02_groups_accounts.py`: Added `get_child_groups(parent_id)` function to return the direct subgroup list of the specified parent group
- [x] 2.3 `02_groups_accounts.py`: Added `rebuild_group_levels(group_id)` function to cascade the level value of the subtree correction
- [x] 2.4 `02_groups_accounts.py`: Added `get_max_subtree_depth(group_id)` function to calculate the maximum depth of the group and its subtree
- [x] 2.5 `02_groups_accounts.py`: Added `validate_group_move(group_id, target_parent_id)` function to verify that the level depth after movement does not exceed 3
- [x] 2.6 `02_groups_accounts.py`: Transform `load_groups()` — return sorted by parent_id, level, sort_order, and accompanied by `descendant_account_count`
- [x] 2.7 `02_groups_accounts.py`: Transformation of `add_group()` - Add `parent_id` parameters, automatically calculate level, verify parent group legitimacy and hierarchy depth
- [x] 2.8 `02_groups_accounts.py`: Transform `update_group()` — Support `parent_id` changes, cascade correction subtree level when moving
- [x] 2.9 `02_groups_accounts.py`: Transform `delete_group()` — Recursively collect all descendant group IDs, move all associated accounts back to the default group (id=1), then delete all descendant groups and itself
- [x] 2.10 `02_groups_accounts.py`: Transform `reorder_groups()` - Add `parent_id` parameter, only rearrange the subgroups under the specified parent sort_order
- [x] 2.11 `02_groups_accounts.py`: Modify `get_group_account_count()` - Add `recursive` parameter, return the total number of descendant accounts when True
- [x] 2.12 `02_groups_accounts.py`: Modify `get_movable_group_ids()` — Add `parent_id` filter parameters

## 3. Backend data layer — proxy cascade fallback

- [x] 3.1 `02_groups_accounts.py`: Added `get_group_inherited_proxy_config(group_row)` function to search up the first ancestor group with proxy configuration along parent_id
- [x] 3.2 `02_groups_accounts.py`: Transform `get_account_proxy_config()` - the grouping agent part is changed to call `get_group_inherited_proxy_config()` step by step fallback

## 4. Backend data layer — recursive account query

- [x] 4.1 `02_groups_accounts.py`: Transform `load_accounts(group_id=X)` into a recursive query, matching the group itself and all descendant groups
- [x] 4.2 `02_groups_accounts.py`: Transform `count_accounts(group_id=X)` into recursive account statistics
- [x] 4.3 `02_groups_accounts.py`: Transform the group_id parameter of `search_account_records()` into recursive group filtering

## 5. Backend API routing

- [x] 5.1 `04_routes_groups_accounts.py`: `GET /api/groups` return adds `parent_id`, `level`, `descendant_account_count` fields
- [x] 5.2 `04_routes_groups_accounts.py`: `POST /api/groups` Add `parent_id` parameter, verify the level depth ≤ 3, and reject the temporary mailbox group as the parent group
- [x] 5.3 `04_routes_groups_accounts.py`: `PUT /api/groups/<id>` supports `parent_id` changes and verifies the legality of the move
- [x] 5.4 `04_routes_groups_accounts.py`: `DELETE /api/groups/<id>` uses cascade deletion logic instead, and the returned information includes the number of deleted subgroups
- [x] 5.5 `04_routes_groups_accounts.py`: `PUT /api/groups/reorder` Add `parent_id` parameter, only sort under the same parent
- [x] 5.6 `04_routes_groups_accounts.py`: `POST /api/accounts/batch-update-group` Verify the existence of the target group (supports any level of grouping)

## 6. Front-end JS — tree rendering and interaction

- [x] 6.1 `02-groups.js`: Added `buildGroupTree(flatGroups)` function to build flat array into parent_id → children nested structure
- [x] 6.2 `02-groups.js`: Transform `renderGroupList()` → `renderGroupTree(nodes, level)` recursively render tree grouping list
- [x] 6.3 `02-groups.js`: Added folding/expanding toggle interaction logic, click the arrow to switch the sub-grouping to visible and hidden, and the status is stored in localStorage
- [x] 6.4 `02-groups.js`: Added `expandAncestors(groupId)` function to automatically expand its ancestors when a collapsed subgroup is selected
- [x] 6.5 `02-groups.js`: Modification of `selectGroup()` - pass group_id when calling the API, the account panel displays the current group and descendant group accounts
- [x] 6.6 `02-groups.js`: Transformation `loadGroups()` - Process the parent_id and level fields returned by the API, build the tree structure and then render

## 7. Front-end JS — drag-and-drop reconstruction

- [x] 7.1 `02-groups.js`: Modified drag logic to support two target modes - "Move into group" (upper area of the target group) and "Similar sorting" (spacer between groups)
- [x] 7.2 `02-groups.js`: Added visual feedback when dragging in - target group highlight border
- [x] 7.3 `02-groups.js`: Added API call for drag-and-drop operation - `PUT /api/groups/<id>` updates parent_id
- [x] 7.4 `02-groups.js`: New level depth verification - Verify that the target depth + subtree depth is ≤ 3 before moving into the operation. If it is illegal, a rejection highlight will be displayed and a prompt will be displayed.
- [x] 7.5 `02-groups.js`: Retrofit `persistGroupOrder()` — pass parent_id parameter

## 8. Front-end JS — Modal box and related functions

- [x] 8.1 `dialogs-primary.html`: Add/edit group modal box adds a "parent group" drop-down selector, optional "None (first-level group)" or existing group
- [x] 8.2 `02-groups.js`: Added new parent group drop-down dynamic logic - exclude third-level groups and temporary mailbox groups, the current group and its descendants are also not selectable when editing
- [x] 8.3 `02-groups.js`: Retrofit `saveGroup()` — Submit with `parent_id` parameter
- [x] 8.4 `02-groups.js`: Retrofit `editGroup()` — load and backfill parent_id into dropdown
- [x] 8.5 `02-groups.js`: Transformation `showAddGroupModal()` — Reset the parent group drop-down and pass in the currently selected group as the default parent group
- [x] 8.6 `02-groups.js`: Modification `deleteGroup()` — Confirmation pop-up window shows the number of subgroups
- [x] 8.7 `02-groups.js`: Transformation of `updateGroupSelects()` - Grouped drop-down display in tree-shaped indentation (no indentation at the first level, 2 spaces at the second level, 4 spaces at the third level)

## 9. CSS style

- [x] 9.1 `03-layout.css`: Added `.group-item.level-1/.level-2/.level-3` indent style (padding-left: 16/36/56px)
- [x] 9.2 `03-layout.css`: Added `.group-toggle` arrow style — 16px wide, centered, transition rotation animation
- [x] 9.3 `03-layout.css`: Added `.group-toggle.collapsed` rotation -90 degrees
- [x] 9.4 `03-layout.css`: Added drag-and-drop target highlighting style `.group-item.drop-target` (blue border + light blue background)
- [x] 9.5 `03-layout.css`: Added drag rejection highlight style `.group-item.drop-rejected` (red border)

## 10. Integrated verification

- [x] 10.1 Verify that existing flat data functions normally after migration (all groups parent_id=NULL, level=1, behavior is consistent with before upgrade)
- [x] 10.2 Verify the complete process of creating, editing, and deleting (including cascading) three-level groups
- [x] 10.3 Verify the correctness of agent cascade fallback (Level 3→Level 2→Level 1→Empty)
- [x] 10.4 Verify that self and descendant group accounts are displayed when non-leaf nodes are selected
- [x] 10.5 Verify cross-level drag and level depth verification
- [x] 10.6 Verify collapsed/expanded state persistence and auto-expand ancestors
- [x] 10.7 Verify tree indent display of grouped drop-down selectors
