## ADDED Requirements

### Requirement: Tree grouping panel rendering
Grouping panel SHALL renders the grouping list in a tree structure, with each level distinguished by indentation.

#### Scenario: Three-level grouping tree display
- **WHEN** The system loads group data including first-level, second-level and third-level groupings
- **THEN** The grouping panel is displayed in a tree-shaped indentation: no indentation for the first-level grouping, 20px for the second-level grouping, and 40px for the third-level grouping.

#### Scenario: Temporary mailbox group is fixed at the front
- **WHEN** Grouped list rendering
- **THEN** The temporary mailbox group is always at the top of the list, cannot be dragged, and has no folding arrow.

#### Scenario: Default group display
- **WHEN** Default group (id=1) exists
- **THEN** The default group is displayed in the group list, cannot be deleted, and is sorted by its hierarchical position.

### Requirement: Collapse/expand interaction
Non-leaf group SHALL displays the folding/expanding arrows (▶/▼). Click the arrow to switch the display/hide of sub-groups. Leaf grouping does not show arrows.

#### Scenario: Expand grouping
- **WHEN** The user clicks the ▶ arrow of the first-level group
- **THEN** The subgroups of this group are displayed and the arrow changes to ▼

#### Scenario: Collapse grouping
- **WHEN** The user clicks the ▼ arrow of the first-level group
- **THEN** The subgroups of this group are hidden and the arrow changes to ▶

#### Scenario: Folding state persistence
- **WHEN** User refreshes the page after folding/expanding the group
- **THEN** Collapse state is restored from localStorage

#### Scenario: Clicking on the group name does not change the folded state
- **WHEN** The user clicks on the group name (not the arrow) to select the group
- **THEN** The folding state does not change, only the group is selected

#### Scenario: Automatically expand ancestors when a collapsed subgroup is selected
- **WHEN** The user selected a collapsed subgroup via cache or URL
- **THEN** The system automatically expands all ancestors of the group to make them visible

### Requirement: Hierarchical indentation style
Each level of grouping SHALL distinguishes the depth of levels through different left padding.

#### Scenario: Indentation level
- **WHEN** renders first-level grouping
- **THEN** Left padding is 16px (current default)

- **WHEN** renders secondary grouping
- **THEN** Left padding is 36px (add 20px indent)

- **WHEN** Render three-level grouping
- **THEN** Left padding is 56px (plus 20px for indentation)

### Requirement: Account number display
SHALL for all groups displays the number of their descendant accounts, which is consistent with the mailbox list after the selected group.

#### Scenario: Non-leaf grouping displays the number of descendants
- **WHEN** The first-level group contains 3 accounts directly under it, and the sub-group has a total of 7 accounts
- **THEN** "10 mailboxes" is displayed next to this group

#### Scenario: Leaf grouping displays the number of descendants
- **WHEN** The third-level group has 5 direct accounts
- **THEN** "5 mailboxes" is displayed next to this group

### Requirement: Cross-level drag and drop interaction
Drag-and-drop grouping SHALL supports two goals: moving into another group (becoming a subgroup) and reordering within a sibling.

#### Scenario: Dragging into a group triggers move in
- **WHEN** The user drags a group to the upper area of another group
- **THEN** Highlight the border of the target group. After releasing, drag the group to become a subgroup of the target group.

#### Scenario: Drag into the gap to trigger sorting
- **WHEN** The user drags the group to the spacer line between sibling groups
- **THEN** displays the insertion indicator line and inserts at this position after releasing

#### Scenario: Prompt when dragging causes the depth to exceed three levels
- **WHEN** Dragging across levels will cause the level depth to exceed 3
- **THEN** The target area displays rejection highlighting (such as a red border), and the operation is canceled and Toast prompts after release.

### Requirement: Add/edit group modal box supports parent group selection
The group modal box SHALL contains the "parent group" drop-down selector, and the dynamic constraint level does not exceed 3 levels.

#### Scenario: Select the parent group when adding a group
- **WHEN** The user clicks to add a group
- **THEN** The modal box displays the "Parent Group" drop-down, optional "None (first-level group)" and all mountable groups

#### Scenario: Third-level grouping does not appear in the parent grouping drop-down
- **WHEN** User adds group
- **THEN** The third-level grouping is not included in the parent group drop-down (because no subgroups can be created under it)

#### Scenario: Change parent group when editing group
- **WHEN** User edits group and changes parent group
- **THEN** System SHALL verifies the level depth after the move. If it is legal, save it. If it is not legal, it will prompt rejection.

#### Scenario: Temporary mailbox group cannot be used as a parent group
- **WHEN** User adds/edits group
- **THEN** Temporary mailbox groups do not appear in the parent group drop-down

### Requirement: Group drop-down selector tree display
All group drop-down selectors (import, edit account, token save, batch move, etc.) SHALL display the group level in a tree-like indentation.

#### Scenario: Drop-down box level indentation
- **WHEN** The user opens the group selection drop-down of the imported mailbox
- **THEN** There is no indentation for the first-level grouping, 2 spaces for the second-level grouping, and 4 spaces for the third-level grouping.

#### Scenario: Collapse group does not appear in subgroup context
- **WHEN** group is collapsed
- **THEN** The drop-down selector still fully displays all groups (collapse only affects the left panel, not the drop-down)

### Requirement: Delete group confirmation prompt
When deleting a group containing sub-groups, the confirmation pop-up window SHALL prompts the number of sub-groups to be deleted in cascade.

#### Scenario: Confirmation prompt for deleting subgroups
- **WHEN** User deletes a first-level group with 2 subgroups
- **THEN** The confirmation pop-up window prompts "There are 2 sub-groups under this group. After deletion, the sub-groups will be deleted together, and all mailboxes will be moved to the default group."

#### Scenario: Delete confirmation prompt without subgroups
- **WHEN** User deletes leaf group
- **THEN** Confirmation pop-up window prompts "Are you sure you want to delete this group? The mailboxes under the group will be moved to the default group." (consistent with the current behavior)
