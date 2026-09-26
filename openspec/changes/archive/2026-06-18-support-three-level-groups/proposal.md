## Why

The current grouping system has a flat list structure and cannot express the hierarchical relationship between groups. As the number of email accounts and groups managed by users increases, the lack of hierarchical organization capabilities results in a cluttered group panel and difficulty in quickly locating target groups. Introducing a tree grouping structure of up to three levels, allowing users to organize email accounts according to logical levels (such as "Customer → Project → Category"), improving the efficiency and readability of large-scale account management.

## What Changes

- **Group data model upgrade**: `groups` table adds `parent_id` and `level` fields, supporting three-level nested tree structure
- **Proxy configuration cascade fallback**: When the subgroup does not have a proxy set, it will automatically fall back to the proxy configuration of the parent group.
- **Recursive account display**: When a group is selected, the accounts under this group and all sub-groups will be displayed.
- **Tree UI rendering**: The grouping panel is changed from a flat list to a tree structure with folding/expanding, and each level is distinguished by indentation.
- **Cross-level drag**: Drag-and-drop sorting supports same-level sorting and cross-level movement, and automatically verifies that the level depth does not exceed 3 levels when moving.
- **Cascade Delete**: When deleting a group with subgroups, all subgroups are deleted in cascade, and the accounts in the subgroups are moved back to the default group.
- **Add/edit group to add parent group selection**: Add a parent group drop-down in the modal box, and the dynamic constraint level does not exceed 3 levels
- **Group names remain globally unique**
- **The temporary mailbox group is fixed as the first-level root group**, and subgroups cannot be added.
- **Associated function adaptation**: Batch moving modal boxes, Project scope selection, import/edit/Token drop-down, etc. group selector adaptation tree display

## Capabilities

### New Capabilities
- `hierarchical-groups`: Group level management - data model, recursive query, cascade operation (delete/move)
- `group-tree-ui`: Group panel tree rendering, folding/expanding interaction, hierarchical indentation style, cross-level drag and drop

### Modified Capabilities
(No relevant specs need to be modified)

## Impact

- **Database**: `groups` table schema changes (2 new columns added), the migration script needs to be compatible with existing data
- **Backend data layer**: The grouping related functions in `02_groups_accounts.py` need to be significantly modified (load/add/update/delete/reorder/proxy)
- **Backend API**: `04_routes_groups_accounts.py` group routing parameters change, account query and export interface filtered by group subtree
- **Front-end JS**: `02-groups.js` The rendering logic is changed from flat to tree-shaped, and the drag-and-drop logic needs to support cross-level
- **HTML Template**: Adding/editing a group modal box requires adding a parent group selector
- **CSS**: `03-layout.css` group panel style needs to add hierarchical indentation, folding arrows, etc.
- **Associated module**: Batch operations, Project scope, and group drop-down selectors all need to be adapted
- **Backward Compatibility**: After the existing flat group data is migrated to `parent_id=NULL, level=1`, the API default behavior is compatible
