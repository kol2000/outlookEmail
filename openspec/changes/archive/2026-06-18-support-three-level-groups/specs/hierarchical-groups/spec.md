## ADDED Requirements

### Requirement: Three-level grouping data model
System SHALL supports the `groups` table to store up to 3 levels of tree hierarchical relationships. Each group MUST have `parent_id` (can be NULL) and `level` (1/2/3) fields. Grouping `parent_id` of `level=1` MUST be NULL.

#### Scenario: Create a first-level group
- **WHEN** User creates a group and does not specify a parent group
- **THEN** The system creates a group of `level=1, parent_id=NULL`

#### Scenario: Create secondary grouping
- **WHEN** The user creates a group and specifies the parent group as the first-level group
- **THEN** The system creates a group with `level=2, parent_id=parent group id`

#### Scenario: Create three-level grouping
- **WHEN** The user creates a group and specifies the parent group as a secondary group
- **THEN** The system creates a group with `level=3, parent_id=parent group id`

#### Scenario: It is forbidden to create more than three levels
- **WHEN** The user tried to create a subgroup under the third-level group
- **THEN** System SHALL rejects and prompts "Maximum level depth reached"

### Requirement: Recursive descendant group query
System SHALL provides function `get_descendant_group_ids(group_id)` to return a list of all descendant group IDs of the specified group (including itself).

#### Scenario: First-level grouping recursive query
- **WHEN** Query the descendants of the first-level group `A` (including the second-level sub-groups `B` and `C`, among which `B` contains the third-level sub-group `D`)
- **THEN** returns `[A.id, B.id, D.id, C.id]`

#### Scenario: Leaf grouping recursive query
- **WHEN** Query the descendants of third-level leaf grouping
- **THEN** only returns `[selfid]`

### Requirement: Recursive account display
When any group is selected, the system SHALL displays the accounts under this group and all descendant groups in the account panel.

#### Scenario: Select the first-level group to view the recursive account
- **WHEN** The user selects the first-level group `Customer A` (there are second-level sub-groups `Project 1` and `Project 2`, of which `Project 1` has a third-level sub-group `Subcategory 1`)
- **THEN** The account panel displays accounts under `Customer A`, `Project 1`, `Project 2`, and `Subcategory 1`

#### Scenario: Select the secondary group to view the recursive account
- **WHEN** The user selects a second-level group (with three-level sub-groups)
- **THEN** The account panel displays the accounts under the second-level group and its third-level sub-groups

### Requirement: Agent configuration cascade fallback
When a child group does not have a proxy set, the system SHALL falls back upwards to the proxy configuration of the parent group until it finds an ancestor group with a proxy or reaches the root node.

#### Scenario: Three-level grouping agent fallback
- **WHEN** The third-level group has no agent, and its parent second-level group has an agent `http://proxy:8080`
- **THEN** The proxy configuration of the account under this third-level group is `http://proxy:8080`

#### Scenario: Full chain rollback
- **WHEN** Neither the third-level group nor the parent second-level group has an agent, and the grandfather first-level group has an agent.
- **THEN** The account agent inherits the agent configuration of the grandparent first-level group

#### Scenario: No ancestor agent
- **WHEN** There is no proxy for the third-level group, parent level 2, and grandparent level 1
- **THEN** Account proxy configuration is empty

### Requirement: Cascade deletion of groups
When deleting a group containing subgroups, the system SHALL cascades to delete all subgroups, and moves all accounts under the deleted group (including subgroups) back to the default group (id=1).

#### Scenario: Delete groups containing subgroups
- **WHEN** The user deletes the first-level group `Customer A` (there are second-level groups `Project 1` and `Project 2`)
- **THEN** `Project 1` and `Project 2` are deleted, `group_id` of all accounts under them are set to `1` (default group), `Customer A` is deleted

#### Scenario: Deletion of default group is not allowed
- **WHEN** User attempted to delete default group (id=1)
- **THEN** System SHALL refuses to delete

#### Scenario: Do not allow deletion of temporary mailbox groups
- **WHEN** User attempts to delete temporary mailbox group
- **THEN** System SHALL refuses to delete

### Requirement: Temporary mailbox grouping restrictions
Temporary mailbox group (`is_system=1`) SHALL is always a first-level root group and is not allowed to create subgroups under it or move it as a subgroup of other groups.

#### Scenario: Prevent the creation of subgroups under temporary mailboxes
- **WHEN** User attempts to specify a temporary mailbox group to create a child group for the parent group
- **THEN** System SHALL refuses and prompts an error

#### Scenario: Prevent moving temporary mailbox groups
- **WHEN** The user tries to drag the temporary mailbox group to another group
- **THEN** System SHALL rejects the operation

### Requirement: Cross-level mobile grouping
System SHALL supports moving groups to different parents by dragging. When moving, it must be verified that the sum of the target depth and the subtree depth does not exceed 3.

#### Scenario: Move the second-level group under another first-level group
- **WHEN** The user drags the second-level group `Project 1` from the first-level group `Customer A` to the first-level group `Customer B`
- **THEN** `parent_id` of `project 1` is updated to `customerB.id`, `level` remains 2, and its subgroup level remains unchanged

#### Scenario: Move one level group to a subgroup of another group
- **WHEN** The user drags the first-level group `X` (no subgroup) into the first-level group `Y`
- **THEN** `parent_id` of `X` is set to `Y.id`, `level` is updated to 2

#### Scenario: Rejection when movement causes depth beyond three levels
- **WHEN** The user drags a first-level group containing second-level sub-groups into another second-level grouping
- **THEN** The system SHALL refuses and prompts "The depth of the level will exceed 3 levels after the move"

### Requirement: Sort under the same parent
System SHALL supports sorting subgroups by `sort_order` under the same `parent_id`.

#### Scenario: Sorting by peers
- **WHEN** The user drags and drops to adjust the order of two sub-groups under the same parent group.
- **THEN** The system updates their `sort_order` to make the order consistent with the drag result and does not affect the groups under other parents.

### Requirement: Group name is globally unique
The group name SHALL remains unique in the global scope and does not distinguish between the same parent or different parents.

#### Scenario: Creating a group with the same name was rejected
- **WHEN** User attempts to create a group with the same name as an existing group (even under a different parent)
- **THEN** System SHALL rejects and prompts "Group name already exists"

### Requirement: Statistics of descendant accounts
System SHALL provides statistics on the number of grouped descendant accounts (including direct and all recursive descendant accounts).

#### Scenario: The number of descendant accounts in the first-level group
- **WHEN** The first-level group `Customer A` has 3 accounts directly, the second-level sub-group `Project 1` has 5 accounts, and `Project 2` has 2 accounts
- **THEN** `Customer A`’s `descendant_account_count` is 10

#### Scenario: Number of descendant accounts of leaf groups
- **WHEN** The third-level leaf group has 5 direct accounts
- **THEN** whose `descendant_account_count` is 5

### Requirement: Database migration compatible
System SHALL provides a migration script to supplement the existing flat group data `parent_id=NULL, level=1`.

#### Scenario: Already have group migration
- **WHEN** Database upgrade from flat structure
- **THEN** `parent_id` of all existing groups is NULL and `level` is 1, and the function is not affected
