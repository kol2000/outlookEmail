        /* global ACCOUNT_LIST_DEFAULT_PAGE_SIZE, ACCOUNT_LIST_MAX_PAGE_SIZE, accountListPageSize, accountListRequestSeq, accountPaginationState, accountSelectionMode, accountsCache, closeAllModals, currentAccount, currentAccountListSource, currentAccountSummary, currentEmailDetail, currentEmailId, currentEmails, currentGroupId, currentSkip, currentSortBy, currentSortOrder, deleteAccount, editingGroupId, escapeHtml, excludedTagFilters, formatAbsoluteDateTime, generateTempEmail, groups, handleAccountRowSelectionClick, handleAccountSelectionCheckboxClick, handleApiError, hasActiveTagFilters, hasMoreEmails, hideModal, isMobileLayout, isTempEmailGroup, loadCloudflareChannelsForImport, loadTempEmails, localStorage, matchesSelectedTagFilters, normalizeTagFilterSelectionValue, openMobilePanel, renderEmptyStateMarkup, renderTempEmailList, resetSelectedAccountView, selectedColor, selectedTagFilters, setModalVisible, shouldShowAccountCreatedAt, shouldShowAccountSortOrder, showAddAccountModal, showGetRefreshTokenModal, showModal, showRefreshError, showTagManagementModal, showToast, suppressGroupClickUntil, syncAccountTagFilterOptions, tempEmailGroupId, toggleAccountSelectionMode, updateCurrentGroupHeader, updateGraphSendMailAvailability, updateMobileContext, updateTagFilterSummary */

        // ==================== Group related ====================

        const ACCOUNT_SEARCH_MAX_TERMS = 200;
        const ACCOUNT_SEARCH_QUERY_STORAGE_KEY = 'outlook_account_search_query';
        const ACCOUNT_SORT_STORAGE_KEY = 'outlook_account_sort';
        const ACCOUNT_TAG_FILTER_STORAGE_KEY = 'outlook_account_tag_filters';
        const ACCOUNT_TAG_EXCLUDE_FILTER_STORAGE_KEY = 'outlook_account_tag_exclude_filters';
        const GROUP_COLLAPSED_STORAGE_PREFIX = 'outlook_group_collapsed_';
        const GROUP_DESCRIPTION_VISIBILITY_STORAGE_KEY = 'outlook_group_descriptions_visible';
        let groupTree = [];

        function shouldShowGroupDescriptions() {
            return localStorage.getItem(GROUP_DESCRIPTION_VISIBILITY_STORAGE_KEY) === 'true';
        }

        function syncGroupDescriptionVisibilityButton() {
            const button = document.getElementById('groupDescriptionVisibilityBtn');
            if (!button) return;

            const visible = shouldShowGroupDescriptions();
            button.classList.toggle('active', visible);
            button.setAttribute('aria-pressed', visible ? 'true' : 'false');
            button.title = visible ? I18n.t("Hide group description") : I18n.t("Show group description");
        }

        function toggleGroupDescriptionVisibility() {
            const visible = !shouldShowGroupDescriptions();
            localStorage.setItem(GROUP_DESCRIPTION_VISIBILITY_STORAGE_KEY, String(visible));
            syncGroupDescriptionVisibilityButton();
            renderGroupList(groups);
        }

        function normalizeGroupLevel(group) {
            const level = Number(group?.level || 1);
            return Math.max(1, Math.min(3, Number.isFinite(level) ? level : 1));
        }

        function normalizeGroupParentId(value) {
            const parentId = Number(value);
            return Number.isFinite(parentId) && parentId > 0 ? parentId : null;
        }

        function isSystemGroup(group) {
            return !!(group && (group.is_system === 1 || group.name === "\u4e34\u65f6\u90ae\u7bb1"));
        }

        function getGroupById(groupId) {
            return groups.find(group => Number(group.id) === Number(groupId)) || null;
        }

        function sortGroupsForTree(left, right) {
            if (left.name === "\u4e34\u65f6\u90ae\u7bb1" && right.name !== "\u4e34\u65f6\u90ae\u7bb1") return -1;
            if (right.name === "\u4e34\u65f6\u90ae\u7bb1" && left.name !== "\u4e34\u65f6\u90ae\u7bb1") return 1;
            const leftOrder = Number(left.sort_order || 0);
            const rightOrder = Number(right.sort_order || 0);
            if (leftOrder !== rightOrder) return leftOrder - rightOrder;
            return Number(left.id) - Number(right.id);
        }

        function buildGroupTree(flatGroups) {
            const nodeMap = new Map();
            (flatGroups || []).forEach(group => {
                nodeMap.set(Number(group.id), { ...group, children: [] });
            });

            const roots = [];
            nodeMap.forEach(node => {
                const parentId = normalizeGroupParentId(node.parent_id);
                const parent = parentId ? nodeMap.get(parentId) : null;
                if (parent) {
                    parent.children.push(node);
                } else {
                    roots.push(node);
                }
            });

            function sortNodeChildren(nodes) {
                nodes.sort(sortGroupsForTree);
                nodes.forEach(node => sortNodeChildren(node.children));
            }

            sortNodeChildren(roots);
            return roots;
        }

        function flattenGroupTree(nodes = groupTree) {
            const result = [];
            function visit(nodeList) {
                nodeList.forEach(node => {
                    result.push(node);
                    if (node.children?.length) {
                        visit(node.children);
                    }
                });
            }
            visit(nodes || []);
            return result;
        }

        function getGroupChildren(groupId) {
            return groups
                .filter(group => normalizeGroupParentId(group.parent_id) === Number(groupId))
                .sort(sortGroupsForTree);
        }

        function getGroupDescendantIds(groupId) {
            const result = [];
            function visit(currentId) {
                getGroupChildren(currentId).forEach(child => {
                    result.push(Number(child.id));
                    visit(Number(child.id));
                });
            }
            visit(Number(groupId));
            return result;
        }

        function getGroupSubtreeDepth(groupId) {
            const children = getGroupChildren(groupId);
            if (!children.length) {
                return 1;
            }
            return 1 + Math.max(...children.map(child => getGroupSubtreeDepth(Number(child.id))));
        }

        function isGroupCollapsed(groupId) {
            return localStorage.getItem(`${GROUP_COLLAPSED_STORAGE_PREFIX}${groupId}`) === '1';
        }

        function setGroupCollapsed(groupId, collapsed) {
            const key = `${GROUP_COLLAPSED_STORAGE_PREFIX}${groupId}`;
            if (collapsed) {
                localStorage.setItem(key, '1');
            } else {
                localStorage.removeItem(key);
            }
        }

        function expandAncestors(groupId) {
            let changed = false;
            let current = getGroupById(groupId);
            const visited = new Set();
            while (current && normalizeGroupParentId(current.parent_id) && !visited.has(Number(current.id))) {
                visited.add(Number(current.id));
                const parentId = normalizeGroupParentId(current.parent_id);
                if (isGroupCollapsed(parentId)) {
                    setGroupCollapsed(parentId, false);
                    changed = true;
                }
                current = getGroupById(parentId);
            }
            return changed;
        }

        function toggleGroupCollapsed(event, groupId) {
            event.stopPropagation();
            setGroupCollapsed(groupId, !isGroupCollapsed(groupId));
            renderGroupList(groups);
        }

        function canMoveGroupToParent(groupId, targetParentId) {
            const source = getGroupById(groupId);
            if (!source || isSystemGroup(source) || Number(source.id) === 1) {
                return false;
            }
            const normalizedTargetParentId = normalizeGroupParentId(targetParentId);
            if (!normalizedTargetParentId) {
                return true;
            }
            if (Number(groupId) === normalizedTargetParentId) {
                return false;
            }
            const targetParent = getGroupById(normalizedTargetParentId);
            if (!targetParent || isSystemGroup(targetParent) || normalizeGroupLevel(targetParent) >= 3) {
                return false;
            }
            if (getGroupDescendantIds(groupId).includes(normalizedTargetParentId)) {
                return false;
            }
            return normalizeGroupLevel(targetParent) + getGroupSubtreeDepth(groupId) <= 3;
        }

        function getSiblingGroupIds(parentId, excludeGroupId = null) {
            const normalizedParentId = normalizeGroupParentId(parentId);
            return groups
                .filter(group => {
                    if (isSystemGroup(group)) return false;
                    if (Number(group.id) === 1) return false;
                    if (excludeGroupId !== null && Number(group.id) === Number(excludeGroupId)) return false;
                    return normalizeGroupParentId(group.parent_id) === normalizedParentId;
                })
                .sort(sortGroupsForTree)
                .map(group => Number(group.id));
        }

        function isLastChild(group) {
            const parentId = normalizeGroupParentId(group.parent_id);
            const siblings = groups
                .filter(g => !isSystemGroup(g) && Number(g.id) !== 1 && normalizeGroupParentId(g.parent_id) === parentId)
                .sort(sortGroupsForTree);
            if (siblings.length === 0) return true;
            return Number(siblings[siblings.length - 1].id) === Number(group.id);
        }

        function getGroupOptionLabel(group) {
            if (isSystemGroup(group) || Number(group.id) === 1) {
                return normalizeGroupName(I18n.groupName(group));
            }

            const level = normalizeGroupLevel(group);
            if (level === 1) {
                return normalizeGroupName(I18n.groupName(group));
            }

            let prefix = '';
            if (level === 3) {
                const parent = getGroupById(group.parent_id);
                if (parent) {
                    if (isLastChild(parent)) {
                        prefix += '\u00A0\u00A0\u00A0';
                    } else {
                        prefix += '│\u00A0\u00A0';
                    }
                }
            }

            if (isLastChild(group)) {
                prefix += '└─\u00A0';
            } else {
                prefix += '├─\u00A0';
            }

            return `${prefix}${normalizeGroupName(I18n.groupName(group))}`;
        }

        function renderGroupOptions({ includeTemp = true, placeholder = '' } = {}) {
            const optionGroups = flattenGroupTree(groupTree).filter(group => includeTemp || !isSystemGroup(group));
            const options = optionGroups.map(group =>
                `<option value="${group.id}">${escapeHtml(getGroupOptionLabel(group))}</option>`
            );
            if (placeholder) {
                options.unshift(`<option value="">${escapeHtml(placeholder)}</option>`);
            }
            return options.join('');
        }

        // Load group list
        async function loadGroups() {
            const container = document.getElementById('groupList');
            syncGroupDescriptionVisibilityButton();
            container.innerHTML = '<div class="loading loading-small"><div class="loading-spinner"></div></div>';

            try {
                const response = await fetch('/api/groups');
                const data = await response.json();

                if (data.success) {
                    groups = data.groups;
                    groupTree = buildGroupTree(groups);

                    // Find the temporary mailbox group
                    const tempGroup = groups.find(g => g.name === "\u4e34\u65f6\u90ae\u7bb1");
                    if (tempGroup) {
                        tempEmailGroupId = tempGroup.id;
                    }

                    // Get the locally cached group ID (if any)
                    if (!currentGroupId) {
                        const savedGroupId = localStorage.getItem('outlook_last_group_id');
                        if (savedGroupId) {
                            currentGroupId = parseInt(savedGroupId);
                        } else if (groups.length > 0) {
                            // If there is no cache, "temporary mailbox" or the first group will be selected by default.
                            const tempMatch = groups.find(g => g.name === "\u4e34\u65f6\u90ae\u7bb1");
                            currentGroupId = tempMatch ? tempMatch.id : groups[0].id;
                        }
                    }

                    if (currentGroupId) {
                        expandAncestors(currentGroupId);
                    }

                    renderGroupList(data.groups);
                    updateGroupSelects();
                    if (document.getElementById('addGroupModal').classList.contains('show')) {
                        const currentSortValue = parseInt(document.getElementById('groupSortPosition')?.value || '');
                        const parentId = normalizeGroupParentId(document.getElementById('groupParentSelect')?.value);
                        updateParentGroupSelect(parentId, editingGroupId);
                        updateGroupSortPositionOptions(editingGroupId, Number.isNaN(currentSortValue) ? null : currentSortValue, parentId);
                    }

                    // If there is a selected group, highlight the group and refresh the mailbox panel
                    if (currentGroupId) {
                        let group = groups.find(g => g.id === currentGroupId);
                        // Bottom line: If the cached group has been deleted, fall back to the first group
                        if (!group && groups.length > 0) {
                            currentGroupId = groups[0].id;
                            group = groups[0];
                        }

                        if (group) {
                            selectGroup(currentGroupId);
                        }
                    }

                    updateMobileContext();
                } else {
                    container.innerHTML = renderEmptyStateMarkup('⚠️', data.error || I18n.t("Loading failed"), {
                        onAction: 'loadGroups()',
                        actionTitle: I18n.t("Refresh group list")
                    });
                }
            } catch (error) {
                container.innerHTML = renderEmptyStateMarkup('⚠️', I18n.t("Loading failed"), {
                    onAction: 'loadGroups()',
                    actionTitle: I18n.t("Refresh group list")
                });
                showToast(I18n.t("Failed to load group"), 'error');
            }
        }

        // Render group list
        function renderGroupList(flatGroups) {
            const container = document.getElementById('groupList');
            const sourceGroups = Array.isArray(flatGroups) ? flatGroups : groups;

            groupTree = buildGroupTree(sourceGroups);
            if (!sourceGroups.length) {
                container.innerHTML = renderEmptyStateMarkup('📁', I18n.t("No grouping yet"), {
                    onAction: 'loadGroups()',
                    actionTitle: I18n.t("Refresh group list")
                });
                return;
            }

            const showGroupDescriptions = shouldShowGroupDescriptions();
            container.innerHTML = renderGroupTree(groupTree, showGroupDescriptions);
        }

        function renderGroupTree(nodes, showGroupDescriptions = shouldShowGroupDescriptions()) {
            return nodes.map(group => {
                const isSystem = isSystemGroup(group);
                const isTempGroup = group.name === "\u4e34\u65f6\u90ae\u7bb1";
                const isDefault = group.id === 1;
                const isMovable = !isSystem && !isDefault;
                const isDragging = groupDragState.isDragging && groupDragState.groupId === group.id;
                const level = normalizeGroupLevel(group);
                const hasChildren = Array.isArray(group.children) && group.children.length > 0;
                const collapsed = hasChildren && isGroupCollapsed(group.id);
                const groupName = normalizeGroupName(I18n.groupName(group));
                const groupIdBadgeText = formatGroupIdBadgeText(group.id);
                const count = group.descendant_account_count ?? group.account_count ?? 0;
                const groupDescription = String(group.description || '').trim();

                return `
                    <div class="group-item level-${level} ${currentGroupId === group.id ? 'active' : ''} ${isTempGroup ? 'temp-email-group' : ''} ${isMovable ? 'draggable' : ''} ${isDragging ? 'dragging' : ''}"
                          data-group-id="${group.id}"
                          data-parent-id="${normalizeGroupParentId(group.parent_id) || ''}"
                          data-level="${level}"
                          ${isMovable ? `onpointerdown="handleGroupPointerDown(event, ${group.id})"` : ''}
                          onclick="handleGroupClick(event, ${group.id})">
                        <div class="group-row-1">
                            ${hasChildren && !isTempGroup ? `<button type="button" class="group-toggle ${collapsed ? 'collapsed' : ''}" onclick="toggleGroupCollapsed(event, ${group.id})" title="${collapsed ? I18n.t("Expand") : I18n.t("fold")}">▾</button>` : '<span class="group-toggle-spacer"></span>'}
                            <div class="group-color" style="background-color: ${group.color || '#666'}"></div>
                            <span class="group-name">${escapeHtml(groupName)}${isTempGroup ? ' ⚡' : ''}</span>
                            <span class="group-count">${count || 0}</span>
                            <div class="group-actions">
                                ${!isSystem ? I18n.tpl`<button class="group-action-btn" onclick="event.stopPropagation(); editGroup(${group.id})" title="Edit">✏️</button>` : ''}
                                ${!isDefault && !isSystem ? I18n.tpl`<button class="group-action-btn" onclick="event.stopPropagation(); deleteGroup(${group.id})" title="Delete">🗑️</button>` : ''}
                            </div>
                        </div>
                        ${showGroupDescriptions && groupDescription ? `
                        <div class="group-row-2">
                            <span class="group-description" title="${escapeHtml(groupDescription)}">${escapeHtml(groupDescription)}</span>
                        </div>
                        ` : ''}
                    </div>
                    ${hasChildren && !collapsed ? renderGroupTree(group.children, showGroupDescriptions) : ''}
                `;
            }).join('');
        }

        function getMovableGroups() {
            return groups.filter(group => !isSystemGroup(group) && Number(group.id) !== 1);
        }

        function reorderGroupData(orderIds, parentId = null) {
            const orderMap = new Map(orderIds.map((id, index) => [Number(id), index + 1]));
            groups = groups.map(group => {
                if (normalizeGroupParentId(group.parent_id) !== normalizeGroupParentId(parentId) || !orderMap.has(Number(group.id))) {
                    return group;
                }
                return { ...group, sort_order: orderMap.get(Number(group.id)) };
            });
            groupTree = buildGroupTree(groups);
        }

        function getGroupSortPositionCount(editingId = null, parentId = null) {
            const normalizedParentId = normalizeGroupParentId(parentId);
            const movableGroups = groups.filter(group =>
                !isSystemGroup(group)
                && Number(group.id) !== 1
                && Number(group.id) !== Number(editingId)
                && normalizeGroupParentId(group.parent_id) === normalizedParentId
            );
            return movableGroups.length + 1;
        }

        function updateGroupSortPositionOptions(editingId = null, selectedPosition = null, parentId = null) {
            const select = document.getElementById('groupSortPosition');
            if (!select) {
                return;
            }

            const optionCount = getGroupSortPositionCount(editingId, parentId);
            let html = '';
            for (let position = 1; position <= optionCount; position += 1) {
                let label = I18n.tpl`No. ${position}`;
                if (position === 1) {
                    label += I18n.t("(front)");
                } else if (position === optionCount) {
                    label += I18n.t("(last)");
                }
                html += `<option value="${position}">${label}</option>`;
            }
            select.innerHTML = html;
            select.value = String(selectedPosition || optionCount);
        }

        function handleGroupClick(event, groupId) {
            if (Date.now() < suppressGroupClickUntil || groupDragState.isDragging) {
                event.preventDefault();
                return;
            }
            selectGroup(groupId);
        }

        function resetGroupDragState() {
            if (groupDragState.pressTimer) {
                clearTimeout(groupDragState.pressTimer);
            }

            if (groupDragState.placeholderEl && groupDragState.placeholderEl.parentNode) {
                groupDragState.placeholderEl.parentNode.removeChild(groupDragState.placeholderEl);
            }

            if (groupDragState.sourceEl) {
                groupDragState.sourceEl.classList.remove('dragging');
                groupDragState.sourceEl.style.position = '';
                groupDragState.sourceEl.style.left = '';
                groupDragState.sourceEl.style.top = '';
                groupDragState.sourceEl.style.width = '';
                groupDragState.sourceEl.style.zIndex = '';
                groupDragState.sourceEl.style.pointerEvents = '';
            }

            document.querySelectorAll('.group-item.drop-target, .group-item.drop-rejected').forEach(item => {
                item.classList.remove('drop-target', 'drop-rejected');
            });

            document.body.style.userSelect = '';
            groupDragState = createGroupDragState();
        }

        function getDragTargetItem(clientY) {
            const container = document.getElementById('groupList');
            const sourceEl = groupDragState.sourceEl;
            if (!container || !sourceEl) {
                return null;
            }
            return Array.from(container.querySelectorAll('.group-item.draggable'))
                .filter(item => item !== sourceEl);
        }

        function findClosestGroupItem(clientY) {
            const items = getDragTargetItem(clientY);
            if (!items?.length) {
                return null;
            }
            return items.find(item => {
                const rect = item.getBoundingClientRect();
                return clientY >= rect.top && clientY <= rect.bottom;
            }) || items.find(item => {
                const rect = item.getBoundingClientRect();
                return clientY < rect.top + (rect.height / 2);
            }) || items[items.length - 1];
        }

        function moveGroupPlaceholder(clientY) {
            const container = document.getElementById('groupList');
            const sourceEl = groupDragState.sourceEl;
            const placeholderEl = groupDragState.placeholderEl;
            if (!container || !sourceEl || !placeholderEl) {
                return;
            }

            document.querySelectorAll('.group-item.drop-target, .group-item.drop-rejected').forEach(item => {
                item.classList.remove('drop-target', 'drop-rejected');
            });

            const targetItem = findClosestGroupItem(clientY);
            if (!targetItem) {
                return;
            }

            const targetGroupId = Number(targetItem.dataset.groupId);
            const targetGroup = getGroupById(targetGroupId);
            const rect = targetItem.getBoundingClientRect();

            const relativeY = clientY - rect.top;
            const height = rect.height;
            const canNest = canMoveGroupToParent(groupDragState.groupId, targetGroupId);

            let isNestZone = false;
            let insertAfter = false;

            if (canNest) {
                if (relativeY >= height * 0.2 && relativeY <= height * 0.8) {
                    isNestZone = true;
                } else {
                    insertAfter = relativeY > height * 0.5;
                }
            } else {
                insertAfter = relativeY > height * 0.5;
            }

            if (isNestZone) {
                targetItem.classList.add('drop-target');
                placeholderEl.style.display = 'none';
                groupDragState.targetMode = 'move';
                groupDragState.targetGroupId = targetGroupId;
                groupDragState.targetParentId = targetGroupId;
                groupDragState.dropAllowed = true;
                return;
            }

            const targetParentId = normalizeGroupParentId(targetGroup?.parent_id);
            const sourceParentId = normalizeGroupParentId(getGroupById(groupDragState.groupId)?.parent_id);
            if (sourceParentId !== targetParentId) {
                targetItem.classList.add('drop-rejected');
                placeholderEl.style.display = 'none';
                groupDragState.targetMode = 'sort';
                groupDragState.targetGroupId = targetGroupId;
                groupDragState.targetParentId = targetParentId;
                groupDragState.dropAllowed = false;
                return;
            }

            placeholderEl.style.display = '';
            if (insertAfter) {
                targetItem.parentNode.insertBefore(placeholderEl, targetItem.nextSibling);
            } else {
                targetItem.parentNode.insertBefore(placeholderEl, targetItem);
            }

            groupDragState.targetMode = 'sort';
            groupDragState.targetGroupId = targetGroupId;
            groupDragState.targetParentId = targetParentId;
            groupDragState.insertAfter = insertAfter;
            groupDragState.dropAllowed = true;
        }

        function autoScrollGroupList(clientY) {
            const container = document.getElementById('groupList');
            if (!container) {
                return;
            }

            const rect = container.getBoundingClientRect();
            const edgeSize = 40;
            if (clientY < rect.top + edgeSize) {
                container.scrollTop -= 12;
            } else if (clientY > rect.bottom - edgeSize) {
                container.scrollTop += 12;
            }
        }

        function startGroupDrag(clientX, clientY) {
            const sourceEl = groupDragState.sourceEl;
            if (!sourceEl || groupDragState.isDragging) {
                return;
            }

            const rect = sourceEl.getBoundingClientRect();
            const placeholderEl = document.createElement('div');
            placeholderEl.className = 'group-placeholder';
            placeholderEl.style.height = `${rect.height}px`;

            sourceEl.parentNode.insertBefore(placeholderEl, sourceEl.nextSibling);
            sourceEl.classList.add('dragging');
            sourceEl.style.position = 'fixed';
            sourceEl.style.left = `${rect.left}px`;
            sourceEl.style.top = `${rect.top}px`;
            sourceEl.style.width = `${rect.width}px`;
            sourceEl.style.zIndex = '1200';
            sourceEl.style.pointerEvents = 'none';

            groupDragState.isDragging = true;
            groupDragState.placeholderEl = placeholderEl;
            groupDragState.offsetY = clientY - rect.top;
            groupDragState.fixedLeft = rect.left;
            suppressGroupClickUntil = Date.now() + 400;
            document.body.style.userSelect = 'none';

            moveGroupPlaceholder(clientY);
        }

        function handleGroupPointerDown(event, groupId) {
            if (event.button !== undefined && event.button !== 0) {
                return;
            }
            if (event.target.closest('.group-action-btn, .group-toggle')) {
                return;
            }

            const sourceEl = event.currentTarget;
            groupDragState = createGroupDragState();
            groupDragState.groupId = groupId;
            groupDragState.pointerId = event.pointerId;
            groupDragState.pointerType = event.pointerType || 'mouse';
            groupDragState.sourceEl = sourceEl;
            groupDragState.startX = event.clientX;
            groupDragState.startY = event.clientY;

            if (groupDragState.pointerType === 'touch') {
                groupDragState.pressTimer = window.setTimeout(() => {
                    startGroupDrag(groupDragState.startX, groupDragState.startY);
                }, 280);
            }
        }

        function handleGlobalGroupPointerMove(event) {
            if (!groupDragState.sourceEl || event.pointerId !== groupDragState.pointerId) {
                return;
            }

            const deltaX = event.clientX - groupDragState.startX;
            const deltaY = event.clientY - groupDragState.startY;
            const distance = Math.hypot(deltaX, deltaY);

            if (!groupDragState.isDragging) {
                if (groupDragState.pointerType === 'touch') {
                    if (distance > 8) {
                        resetGroupDragState();
                    }
                    return;
                }

                if (distance > 4) {
                    startGroupDrag(event.clientX, event.clientY);
                }
                return;
            }

            event.preventDefault();
            groupDragState.sourceEl.style.left = `${groupDragState.fixedLeft}px`;
            groupDragState.sourceEl.style.top = `${event.clientY - groupDragState.offsetY}px`;
            autoScrollGroupList(event.clientY);
            moveGroupPlaceholder(event.clientY);
        }

        async function finishGroupDrag() {
            if (!groupDragState.sourceEl) {
                resetGroupDragState();
                return;
            }

            const sourceGroupId = Number(groupDragState.groupId);
            const targetMode = groupDragState.targetMode;
            const targetGroupId = Number(groupDragState.targetGroupId);
            const targetParentId = normalizeGroupParentId(groupDragState.targetParentId);
            const insertAfter = !!groupDragState.insertAfter;
            const dropAllowed = groupDragState.dropAllowed !== false;

            resetGroupDragState();

            if (!dropAllowed) {
                showToast(targetMode === 'move' ? I18n.t("After the move, the level depth will exceed 3 levels") : I18n.t("Can only be sorted within the same parent level"), 'error');
                return;
            }

            if (targetMode === 'move') {
                await persistGroupMove(sourceGroupId, targetGroupId);
                return;
            }

            if (targetMode !== 'sort' || !targetGroupId) {
                return;
            }

            const newOrder = getSiblingGroupIds(targetParentId, sourceGroupId);
            const targetIndex = newOrder.indexOf(targetGroupId);
            if (targetIndex === -1) {
                return;
            }
            newOrder.splice(targetIndex + (insertAfter ? 1 : 0), 0, sourceGroupId);

            const previousOrder = getSiblingGroupIds(targetParentId);
            if (JSON.stringify(newOrder) === JSON.stringify(previousOrder)) {
                return;
            }

            reorderGroupData(newOrder, targetParentId);
            await persistGroupOrder(newOrder, targetParentId);
        }

        async function handleGlobalGroupPointerUp(event) {
            if (!groupDragState.sourceEl || event.pointerId !== groupDragState.pointerId) {
                return;
            }

            if (!groupDragState.isDragging) {
                resetGroupDragState();
                return;
            }

            suppressGroupClickUntil = Date.now() + 250;
            await finishGroupDrag();
        }

        async function persistGroupOrder(groupIds, parentId = null) {
            try {
                const response = await fetch('/api/groups/reorder', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        group_ids: groupIds,
                        parent_id: parentId
                    })
                });
                const data = await response.json();

                if (data.success) {
                    showToast(data.message, 'success');
                    await loadGroups();
                } else {
                    handleApiError(data, I18n.t("Failed to update group sorting"));
                    await loadGroups();
                }
            } catch (error) {
                showToast(I18n.t("Failed to update group sorting"), 'error');
                await loadGroups();
            }
        }

        async function persistGroupMove(groupId, parentId) {
            const group = getGroupById(groupId);
            if (!group) {
                return;
            }

            try {
                const response = await fetch(`/api/groups/${groupId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: group.name,
                        description: group.description || '',
                        color: group.color || '#1a1a1a',
                        proxy_url: group.proxy_url || '',
                        fallback_proxy_url_1: group.fallback_proxy_url_1 || '',
                        fallback_proxy_url_2: group.fallback_proxy_url_2 || '',
                        parent_id: parentId,
                        sort_position: null
                    })
                });
                const data = await response.json();
                if (data.success) {
                    showToast(data.message || I18n.t("Group moved"), 'success');
                } else {
                    handleApiError(data, I18n.t("Failed to move grouping"));
                }
                await loadGroups();
            } catch (error) {
                showToast(I18n.t("Failed to move grouping"), 'error');
                await loadGroups();
            }
        }

        // Select group
        async function selectGroup(groupId) {
            if (Date.now() < suppressGroupClickUntil) {
                return;
            }

            currentGroupId = groupId;
            localStorage.setItem('outlook_last_group_id', groupId);

            // Check whether it is a temporary mailbox group
            const group = groups.find(g => g.id === groupId);
            isTempEmailGroup = group && group.name === "\u4e34\u65f6\u90ae\u7bb1";

            const expandedAncestors = expandAncestors(groupId);

            // Update group list UI
            if (expandedAncestors) {
                renderGroupList(groups);
            } else {
                document.querySelectorAll('.group-item').forEach(item => {
                    item.classList.toggle('active', parseInt(item.dataset.groupId) === groupId);
                });
            }

            // Update mailbox panel title
            if (group) {
                updateCurrentGroupHeader(group);
                document.getElementById('currentGroupColor').style.backgroundColor = group.color || '#666';

                // Update the default grouping when importing mailboxes
                const importSelect = document.getElementById('importGroupSelect');
                if (importSelect) {
                    importSelect.value = groupId;
                }
            }
            // Temporary mailbox: first apply the last saved filter channel, and then update the panel (button style depends on the filter value)
            if (isTempEmailGroup) {
                // Read cache, if there is no or invalid (set to all), give the default value gptmail 
                let storedFilter = localStorage.getItem('outlook_temp_email_filter');
                if (!storedFilter || storedFilter === 'all') {
                    storedFilter = 'gptmail';
                }
                window.tempEmailProviderFilter = storedFilter;
                localStorage.setItem('outlook_temp_email_filter', storedFilter);
            }
            // Update account panel head movement
            updateAccountPanelActions();
            const shouldAdvanceToAccounts = isMobileLayout()
                && document.getElementById('groupPanel')?.classList.contains('show');

            // Load the mailbox of this group
            if (isTempEmailGroup) {
                await loadTempEmails();
            } else {
                const searchQuery = getAccountSearchQuery();
                if (searchQuery) {
                    await searchAccounts(searchQuery);
                } else {
                    await loadAccountsByGroup(groupId);
                }
            }

            if (shouldAdvanceToAccounts) {
                openMobilePanel('account');
            }
            updateMobileContext();
        }

        // Refresh button (reuse refreshCurrentAccountList function)
        function renderAccountRefreshButton() {
            return I18n.tpl`
                <button class="panel-action-btn" onclick="refreshCurrentAccountList()" title="Refresh mailboxes">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M1 8a7 7 0 0 1 13.22-3.22M15 8a7 7 0 0 1-13.22 3.22"/>
                        <path d="M14 1v3.5H10.5M2 15v-3.5h3.5"/>
                    </svg>
                </button>
            `;
        }

        // Update the account panel head action button
        function renderAccountSelectionModeButton() {
            const activeClass = accountSelectionMode ? ' active' : '';
            const title = accountSelectionMode ? I18n.t("Exit batch selection") : I18n.t("Select multiple");
            return `
                <button class="panel-action-btn account-selection-mode-btn${activeClass}" id="accountSelectionModeBtn"
                        onclick="toggleAccountSelectionMode()" title="${title}" aria-pressed="${accountSelectionMode ? 'true' : 'false'}">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="2" y="2" width="12" height="12" rx="2"></rect>
                        <path d="M5 8l2 2 4-4"></path>
                    </svg>
                </button>
            `;
        }

        function renderAccountMinimalModeButton() {
            const isMinimal = localStorage.getItem('outlook_account_list_minimal') === 'true';
            const activeClass = isMinimal ? ' active' : '';
            const title = isMinimal ? I18n.t("Switch to detailed display") : I18n.t("Toggle compact view");
            return `
                <button class="panel-action-btn${activeClass}" id="accountMinimalBtn" onclick="toggleAccountMinimalMode()" title="${title}" aria-pressed="${isMinimal ? 'true' : 'false'}">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="2" y="2.5" width="12" height="2.5" rx="0.5"></rect>
                        <rect x="2" y="6.75" width="12" height="2.5" rx="0.5"></rect>
                        <rect x="2" y="11" width="12" height="2.5" rx="0.5"></rect>
                    </svg>
                </button>
            `;
        }

        function updateAccountPanelActions() {
            const actions = document.querySelector('.account-panel-header-actions');
            const searchInput = document.getElementById('globalSearch');
            if (!actions) return;
            if (isTempEmailGroup) {
                actions.innerHTML = I18n.tpl`
                    ${renderAccountRefreshButton()}
                    ${renderAccountSelectionModeButton()}
                    <button class="panel-action-btn" onclick="showTagManagementModal()" title="Manage tags">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M7 1.5h6v6L6.5 14 2 9.5 7 1.5z"></path>
                            <circle cx="9.5" cy="5" r="1.2" fill="currentColor"></circle>
                        </svg>
                    </button>
                    ${renderAccountMinimalModeButton()}
                    <button class="panel-action-btn panel-action-btn-accent" onclick="generateTempEmail()" title="Generate temporary mailbox">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <polygon points="9 1 2 9 8 9 7 15 14 7 8 7 9 1"></polygon>
                        </svg>
                    </button>
                    <button class="panel-action-btn panel-action-btn-primary" onclick="showAddAccountModal()" title="Import email account">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path fill-rule="evenodd"
                                d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z" />
                        </svg>
                    </button>
                `;
                // Show channel filtering, hide sorting
                document.getElementById('tempEmailProviderFilter').style.display = 'flex';
                document.querySelector('.sort-control').style.display = 'none';
                document.getElementById('accountPageSizeContainer').style.display = 'none';
                syncAccountSearchScopeVisibility();
                updateTagFilter();
                // Synchronize filter button style
                const currentFilter = localStorage.getItem('outlook_temp_email_filter') || 'all';
                document.querySelectorAll('.provider-filter-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.provider === currentFilter);
                });
                if (searchInput) {
                    searchInput.placeholder = I18n.t("Search for a temporary email address or label...");
                }
            } else {
                actions.innerHTML = I18n.tpl`
                    ${renderAccountRefreshButton()}
                    ${renderAccountSelectionModeButton()}
                    <button class="panel-action-btn" onclick="showTagManagementModal()" title="Manage tags">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M7 1.5h6v6L6.5 14 2 9.5 7 1.5z"></path>
                            <circle cx="9.5" cy="5" r="1.2" fill="currentColor"></circle>
                        </svg>
                    </button>
                    ${renderAccountMinimalModeButton()}
                    <button class="panel-action-btn panel-action-btn-accent" onclick="showGetRefreshTokenModal()" title="Authorize and save Outlook account">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="5.5" cy="10.5" r="3.5"></circle>
                            <path d="M8 8l5-5M13 3h2v2M11 5h2v2"></path>
                        </svg>
                    </button>
                    <button class="panel-action-btn panel-action-btn-primary" onclick="showAddAccountModal()" title="Import email account">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path fill-rule="evenodd"
                                d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z" />
                        </svg>
                    </button>
                `;
                // Hidden channel filtering, display sorting, recovery label filtering
                document.getElementById('tempEmailProviderFilter').style.display = 'none';
                document.querySelector('.sort-control').style.display = 'flex';
                document.getElementById('accountPageSizeContainer').style.display = 'flex';
                syncAccountSearchScopeVisibility();
                syncAccountPageSizeSelect();
                syncAccountSortButtons();
                updateTagFilter();
                if (searchInput) {
                    searchInput.placeholder = I18n.t("Email|Alias|Remarks|Label");
                }
            }
        }

        // Filter temporary email channels (click the activated button to cancel filtering)
        function filterTempEmailByProvider(provider) {
            if (provider === 'all') {
                localStorage.setItem('outlook_temp_email_filter', 'all');
            } else if (localStorage.getItem('outlook_temp_email_filter') === provider) {
                // Click on the activated button to cancel filtering (show all)
                localStorage.setItem('outlook_temp_email_filter', 'all');
            } else {
                localStorage.setItem('outlook_temp_email_filter', provider);
            }

            // Update button style
            const currentFilter = localStorage.getItem('outlook_temp_email_filter') || 'all';
            document.querySelectorAll('.provider-filter-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.provider === currentFilter);
            });
            if (accountsCache['temp']) {
                renderTempEmailList(accountsCache['temp']);
            }
        }

        function getAccountTagFilterParams() {
            const tagIds = Array.from(selectedTagFilters || [])
                .map(value => normalizeTagFilterSelectionValue(value))
                .filter(value => value !== null);
            const excludeTagIds = Array.from(excludedTagFilters || [])
                .map(value => normalizeTagFilterSelectionValue(value))
                .filter(value => value !== null);
            return { tagIds, excludeTagIds };
        }

        function hasAccountServerSideFilters() {
            const filters = getAccountTagFilterParams();
            return filters.tagIds.length > 0 || filters.excludeTagIds.length > 0;
        }

        function loadStoredAccountTagFilterValues(storageKey) {
            try {
                const storedValue = localStorage.getItem(storageKey);
                const values = storedValue ? JSON.parse(storedValue) : [];
                if (!Array.isArray(values)) {
                    return new Set();
                }
                const normalizedValues = Array.from(new Set(
                    values
                        .map(value => normalizeTagFilterSelectionValue(value))
                        .filter(value => value !== null)
                ));
                if (JSON.stringify(values) !== JSON.stringify(normalizedValues)) {
                    try {
                        localStorage.setItem(storageKey, JSON.stringify(normalizedValues));
                    } catch (error) {
                        // The in-memory normalized state is still available for the current session.
                    }
                }
                return new Set(normalizedValues);
            } catch (error) {
                return new Set();
            }
        }

        function saveAccountTagFilterPreferenceValues(storageKey, values) {
            const normalizedValues = Array.from(values || [])
                .map(value => normalizeTagFilterSelectionValue(value))
                .filter(value => value !== null);
            localStorage.setItem(storageKey, JSON.stringify(Array.from(new Set(normalizedValues))));
        }

        function loadAccountTagFilterPreference() {
            return loadStoredAccountTagFilterValues(ACCOUNT_TAG_FILTER_STORAGE_KEY);
        }

        function saveAccountTagFilterPreference() {
            saveAccountTagFilterPreferenceValues(ACCOUNT_TAG_FILTER_STORAGE_KEY, selectedTagFilters);
        }

        function loadAccountTagExcludeFilterPreference() {
            return loadStoredAccountTagFilterValues(ACCOUNT_TAG_EXCLUDE_FILTER_STORAGE_KEY);
        }

        function saveAccountTagExcludeFilterPreference() {
            saveAccountTagFilterPreferenceValues(ACCOUNT_TAG_EXCLUDE_FILTER_STORAGE_KEY, excludedTagFilters);
        }

        selectedTagFilters = loadAccountTagFilterPreference();
        excludedTagFilters = loadAccountTagExcludeFilterPreference();

        function normalizeAccountPageSize(value) {
            const parsed = parseInt(value, 10);
            if (!Number.isFinite(parsed)) {
                return ACCOUNT_LIST_DEFAULT_PAGE_SIZE;
            }
            return Math.max(1, Math.min(parsed, ACCOUNT_LIST_MAX_PAGE_SIZE));
        }

        function getAccountPageSize() {
            accountListPageSize = normalizeAccountPageSize(accountListPageSize);
            return accountListPageSize;
        }

        function syncAccountPageSizeSelect() {
            const select = document.getElementById('accountPageSizeSelect');
            if (select) {
                const hasMatchingOption = Array.from(select.options)
                    .some(option => option.value === String(getAccountPageSize()));
                if (!hasMatchingOption) {
                    accountListPageSize = ACCOUNT_LIST_DEFAULT_PAGE_SIZE;
                    localStorage.setItem('outlook_account_page_size', String(accountListPageSize));
                }
                select.value = String(getAccountPageSize());
            }
        }

        function initAccountPageSizeSelect() {
            accountListPageSize = normalizeAccountPageSize(
                localStorage.getItem('outlook_account_page_size') || ACCOUNT_LIST_DEFAULT_PAGE_SIZE
            );
            syncAccountPageSizeSelect();
        }

        function getAccountSearchScope() {
            const select = document.getElementById('accountSearchScopeSelect');
            return select?.value === 'group' ? 'group' : 'all';
        }

        function getAccountSearchScopeKey() {
            return getAccountSearchScope() === 'group' && currentGroupId
                ? `group:${currentGroupId}`
                : 'all';
        }

        function getAccountSearchQuery() {
            return (document.getElementById('globalSearch')?.value || '').trim();
        }

        function saveAccountSearchQueryPreference(value) {
            const query = String(value || '');
            if (query.trim()) {
                localStorage.setItem(ACCOUNT_SEARCH_QUERY_STORAGE_KEY, query);
            } else {
                localStorage.removeItem(ACCOUNT_SEARCH_QUERY_STORAGE_KEY);
            }
        }

        function initAccountSearchInput() {
            const input = document.getElementById('globalSearch');
            if (!input) {
                return;
            }
            const savedQuery = localStorage.getItem(ACCOUNT_SEARCH_QUERY_STORAGE_KEY);
            if (savedQuery !== null) {
                input.value = savedQuery;
            }
        }

        function setAccountSearchScope(value, persist = true) {
            const normalizedScope = value === 'all' ? 'all' : 'group';
            const select = document.getElementById('accountSearchScopeSelect');
            if (select) {
                select.value = normalizedScope;
            }
            if (persist) {
                localStorage.setItem('outlook_account_search_scope', normalizedScope);
            }
            return normalizedScope;
        }

        function initAccountSearchScopeSelect() {
            const select = document.getElementById('accountSearchScopeSelect');
            if (!select) {
                return;
            }
            const savedScope = localStorage.getItem('outlook_account_search_scope');
            select.value = savedScope === 'all' ? 'all' : 'group';
        }

        function syncAccountSearchScopeVisibility() {
            const container = document.querySelector('.search-container');
            const wrap = document.getElementById('accountSearchScopeWrap');
            const select = document.getElementById('accountSearchScopeSelect');
            const hidden = !!isTempEmailGroup;

            if (container) {
                container.classList.toggle('search-container--single', hidden);
            }
            if (wrap) {
                wrap.hidden = hidden;
            }
            if (select) {
                select.disabled = hidden;
            }
        }

        function handleAccountSearchScopeChange(value) {
            setAccountSearchScope(value);
            const searchQuery = getAccountSearchQuery();
            if (searchQuery && !isTempEmailGroup) {
                searchAccounts(searchQuery, true);
            } else if (!isTempEmailGroup && hasAccountServerSideFilters()) {
                invalidateAccountCaches();
                refreshVisibleAccountList(true);
            }
        }

        function handleAccountPageSizeChange(value) {
            accountListPageSize = normalizeAccountPageSize(value);
            localStorage.setItem('outlook_account_page_size', String(accountListPageSize));
            syncAccountPageSizeSelect();
            invalidateAccountCaches();
            if (!isTempEmailGroup) {
                refreshVisibleAccountList(true);
            }
        }

        function appendAccountListParams(params) {
            params.set('limit', String(getAccountPageSize()));
            params.set('sort_by', currentSortBy || 'created_at');
            params.set('sort_order', currentSortOrder || 'desc');

            const filters = getAccountTagFilterParams();
            if (filters.tagIds.length) {
                params.set('tag_ids', filters.tagIds.join(','));
            }
            filters.excludeTagIds.forEach(tagId => {
                params.append('exclude_tag_ids', String(tagId));
            });
            return params;
        }

        function updateAccountPaginationState(mode, key, data, loadedCount, loading = false) {
            accountPaginationState = {
                mode,
                key,
                total: Number.isFinite(Number(data?.total)) ? Number(data.total) : loadedCount,
                loaded: loadedCount,
                hasMore: data?.has_more === true,
                loading
            };
        }

        function setAccountPaginationLoading(loading) {
            accountPaginationState.loading = loading;
            const footer = document.getElementById('accountPaginationFooter');
            if (footer) {
                footer.classList.toggle('is-loading', loading);
                const text = footer.querySelector('.account-pagination-text');
                if (text) {
                    if (loading) {
                        text.textContent = I18n.t("Loading…");
                    } else {
                        const total = Number(accountPaginationState.total) || 0;
                        const loaded = Math.min(Number(accountPaginationState.loaded) || 0, total || Number(accountPaginationState.loaded) || 0);
                        text.textContent = accountPaginationState.hasMore
                            ? I18n.tpl`${loaded} / ${total} mailboxes loaded`
                            : I18n.tpl`All ${total} mailboxes loaded`;
                    }
                }
            }
        }

        function renderAccountPaginationFooter(visibleCount) {
            if (!accountPaginationState.total && !accountPaginationState.hasMore) {
                return '';
            }

            const total = Math.max(Number(accountPaginationState.total) || 0, visibleCount);
            const loaded = Math.max(Number(accountPaginationState.loaded) || visibleCount, visibleCount);
            if (!accountPaginationState.hasMore && total <= getAccountPageSize()) {
                return '';
            }

            const text = accountPaginationState.hasMore
                ? I18n.tpl`${Math.min(loaded, total)} / ${total} mailboxes loaded`
                : I18n.tpl`All ${total} mailboxes loaded`;
            const action = accountPaginationState.hasMore
                ? I18n.t("<button class=\"account-pagination-btn\" type=\"button\" onclick=\"loadMoreAccounts()\">Load more</button>")
                : '';

            return `
                <div class="account-pagination-footer ${accountPaginationState.loading ? 'is-loading' : ''}" id="accountPaginationFooter">
                    <span class="account-pagination-text">${escapeHtml(accountPaginationState.loading ? I18n.t("Loading…") : text)}</span>
                    ${action}
                </div>
            `;
        }

        function maybeLoadMoreAccounts() {
            const container = document.getElementById('accountList');
            if (!container || accountPaginationState.loading || !accountPaginationState.hasMore) {
                return;
            }
            const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            if (distanceToBottom < 180) {
                loadMoreAccounts();
            }
        }

        function initAccountListScroll() {
            const accountList = document.getElementById('accountList');
            if (!accountList || accountList.dataset.boundPaging) return;
            accountList.dataset.boundPaging = 'true';
            accountList.addEventListener('scroll', maybeLoadMoreAccounts, { passive: true });
        }

        async function loadMoreAccounts() {
            if (accountPaginationState.loading || !accountPaginationState.hasMore) {
                return;
            }

            const searchQuery = (document.getElementById('globalSearch')?.value || '').trim();
            if (searchQuery) {
                await searchAccounts(searchQuery, false, true);
            } else if (currentGroupId && !isTempEmailGroup) {
                await loadAccountsByGroup(currentGroupId, false, true);
            }
        }

        // Load accounts under groups
        async function loadAccountsByGroup(groupId, forceRefresh = false, append = false) {
            const container = document.getElementById('accountList');
            const cacheAllowed = !hasAccountServerSideFilters();

            // If there is a cache and no forced refresh is required, use the cache directly.
            if (!append && !forceRefresh && cacheAllowed && accountsCache[groupId]) {
                updateAccountPaginationState('group', String(groupId), {
                    total: accountsCache[groupId].length,
                    has_more: false
                }, accountsCache[groupId].length);
                renderFilteredAccountList(accountsCache[groupId]);
                return;
            }

            const offset = append ? currentAccountListSource.length : 0;
            if (append) {
                setAccountPaginationLoading(true);
            } else {
                container.innerHTML = '<div class="loading loading-small"><div class="loading-spinner"></div></div>';
            }

            const params = new URLSearchParams({
                offset: String(offset)
            });
            if (getAccountSearchScope() === 'group' || !hasAccountServerSideFilters()) {
                params.set('group_id', String(groupId));
            }
            appendAccountListParams(params);
            const requestId = ++accountListRequestSeq;

            try {
                const response = await fetch(`/api/accounts?${params.toString()}`);
                const data = await response.json();
                if (requestId !== accountListRequestSeq) {
                    return;
                }

                if (data.success) {
                    const nextAccounts = append
                        ? currentAccountListSource.concat(data.accounts || [])
                        : (data.accounts || []);
                    if (cacheAllowed && !data.has_more && nextAccounts.length <= getAccountPageSize()) {
                        accountsCache[groupId] = nextAccounts;
                    } else if (!append) {
                        delete accountsCache[groupId];
                    } else if (nextAccounts.length > getAccountPageSize()) {
                        delete accountsCache[groupId];
                    }
                    updateAccountPaginationState('group', String(groupId), data, nextAccounts.length);
                    renderFilteredAccountList(nextAccounts);
                } else {
                    container.innerHTML = renderEmptyStateMarkup('⚠️', data.error || I18n.t("Loading failed"), {
                        onAction: `loadAccountsByGroup(${Number(groupId)}, true)`,
                        actionTitle: I18n.t("Refresh account list")
                    });
                }
            } catch (error) {
                if (append) {
                    showToast(I18n.t("Failed to load more accounts"), 'error');
                } else {
                    container.innerHTML = renderEmptyStateMarkup('⚠️', I18n.t("Loading failed"), {
                        onAction: `loadAccountsByGroup(${Number(groupId)}, true)`,
                        actionTitle: I18n.t("Refresh account list")
                    });
                }
            } finally {
                if (requestId === accountListRequestSeq) {
                    setAccountPaginationLoading(false);
                }
            }
        }

        function showForwardStatusLabel(enabled) {
            return enabled
                ? I18n.t("<span class=\"account-status-pill success\" title=\"Forwarding enabled\">turn</span>")
                : '';
        }

        function renderAccountTagSummary(tags, accountId) {
            const safeTags = Array.isArray(tags) ? tags : [];
            const visibleTags = safeTags.slice(0, 2);
            const hiddenCount = Math.max(0, safeTags.length - visibleTags.length);
            const canRemoveTags = Number.isFinite(Number(accountId)) && Number(accountId) > 0;

            let html = visibleTags.map(tag => `
                <span class="account-status-pill tag" style="--pill-accent: ${tag.color}">
                    ${escapeHtml(tag.name)}
                    ${canRemoveTags ? `<span class="tag-delete-btn" onclick="handleRemoveAccountTag(event, ${Number(accountId)}, ${Number(tag.id)}, '${escapeHtml(tag.name)}')">&times;</span>` : ''}
                </span>
            `).join('');

            if (hiddenCount > 0) {
                html += `<span class="account-status-pill outline">+${hiddenCount}</span>`;
            }

            return html;
        }

        async function handleRemoveAccountTag(event, accountId, tagId, tagName) {
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }
            if (!(await showConfirmModal(I18n.tpl`Are you sure you want to remove the label "${tagName}" from this mailbox?`, { title: I18n.t("Remove tag"), confirmText: I18n.t("Confirm removal"), danger: true }))) {
                return;
            }
            try {
                const response = await fetch('/api/accounts/tags', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        account_ids: [accountId],
                        tag_id: tagId,
                        action: 'remove'
                    })
                });
                const data = await response.json();
                if (data.success) {
                    showToast(I18n.t("Tag removed successfully"), 'success');
                    if (typeof invalidateAccountCaches === 'function') {
                        invalidateAccountCaches();
                    }
                    if (typeof refreshVisibleAccountList === 'function') {
                        refreshVisibleAccountList(true);
                    }
                } else {
                    handleApiError(data, I18n.t("Failed to remove tag"));
                }
            } catch (error) {
                showToast(I18n.t("Failed to remove tag: ") + error.message, 'error');
            }
        }

        function renderAccountAliasSummary(aliases) {
            const safeAliases = Array.isArray(aliases) ? aliases.filter(Boolean) : [];
            if (!safeAliases.length) return '';

            const visibleAliases = safeAliases.slice(0, 2);
            const hiddenCount = Math.max(0, safeAliases.length - visibleAliases.length);
            const aliasText = visibleAliases.join(' / ');
            const suffix = hiddenCount > 0 ? ` +${hiddenCount}` : '';
            return I18n.tpl`<div class="account-aliases" title="${escapeHtml(safeAliases.join('\n'))}">Alias: ${escapeHtml(aliasText)}${suffix}</div>`;
        }

        function renderAccountGroupSummary(account, showGroupInfo = false) {
            if (!showGroupInfo) return '';

            const groupColor = account.group_color || '#666666';
            const groupName = normalizeGroupName(I18n.groupName({ id: account.group_id, name: account.group_name }), I18n.t("Default group"));
            const groupIdBadgeText = formatGroupIdBadgeText(account.group_id);
            return I18n.tpl`
                <div class="account-group-summary" title="Group affiliation: ${escapeHtml(groupName)}">
                    <span class="account-group-dot" style="background-color: ${escapeHtml(groupColor)}"></span>
                    <span class="account-group-name">${escapeHtml(groupName)}</span>
                    ${groupIdBadgeText ? `<span class="group-id-badge account-group-id-badge">${escapeHtml(groupIdBadgeText)}</span>` : ''}
                </div>
            `;
        }

        function isAccountRowInteractiveTarget(target) {
            if (!target || typeof target.closest !== 'function') {
                return false;
            }
            return !!target.closest(
                '.account-menu-wrap, .account-action-btn, .account-menu-trigger, .account-menu-panel, .account-select-checkbox, .account-error-btn, button, input, a'
            );
        }

        function handleAccountItemClick(event, email, isTemp = false, accountId = 0) {
            if (isAccountRowInteractiveTarget(event?.target)) {
                return;
            }
            if (accountSelectionMode || event?.shiftKey) {
                handleAccountRowSelectionClick(event);
                return;
            }
            if (isTemp) {
                selectTempEmail(email);
            } else {
                selectAccount(email, accountId);
            }
        }

        // Render mailbox list
        function renderAccountList(accounts) {
            const container = document.getElementById('accountList');
            const isSearchMode = !!(document.getElementById('globalSearch')?.value || '').trim();
            const hasTagFilters = hasAccountServerSideFilters();
            const showSearchGroupInfo = (isSearchMode || hasTagFilters) && getAccountSearchScope() === 'all';
            const normalizedGroupId = Number(currentGroupId);
            const refreshAction = Number.isFinite(normalizedGroupId) && normalizedGroupId > 0
                ? `loadAccountsByGroup(${normalizedGroupId}, true)`
                : '';

            if (accounts.length === 0) {
                container.innerHTML = isSearchMode
                    ? renderEmptyStateMarkup('📭', I18n.t("No matching email found"))
                    : renderEmptyStateMarkup('📭', I18n.t("This group currently has no email address"), {
                        onAction: refreshAction,
                        actionTitle: I18n.t("Refresh account list")
                    });
                updateBatchActionBar();
                return;
            }

            const checkedAccountIds = new Set(
                Array.from(container.querySelectorAll('.account-select-checkbox:checked'))
                    .map(checkbox => String(checkbox.value))
            );
            container.innerHTML = accounts.map(acc => I18n.tpl`
                <div class="account-item ${currentAccount === acc.email ? 'active' : ''} ${acc.status === 'inactive' ? 'inactive' : ''}"
                     data-account-id="${acc.id}"
                     onclick="handleAccountItemClick(event, '${escapeJs(acc.email)}', false, ${Number(acc.id) || 0})">
                    <input type="checkbox" class="account-select-checkbox" value="${acc.id}" 
                           data-account-email="${escapeHtml(acc.email)}"
                           data-account-type="${escapeHtml(acc.account_type || 'outlook')}"
                           data-refreshable="${acc.account_type !== 'imap' ? 'true' : 'false'}"
                           data-forward-enabled="${acc.forward_enabled ? 'true' : 'false'}"
                           onclick="handleAccountSelectionCheckboxClick(event)">
                    <div class="account-body">
                        <div class="account-title-row">
                            <div class="account-email-wrap">
                                <div class="account-email" title="${escapeHtml(acc.email)}" style="${acc.last_refresh_status === 'failed' ? 'color: #b42318;' : ''}">
                                    ${escapeHtml(acc.email)}
                                </div>
                            </div>
                        </div>
                        <div class="account-meta-row">
                            <span class="account-status-pill provider"
                                style="--pill-accent: ${acc.account_type === 'imap' ? '#0ea5e9' : '#2563eb'}">
                                ${escapeHtml(getProviderLabel(acc.provider || (acc.account_type === 'imap' ? 'custom' : 'outlook')))}
                            </span>
                            ${showForwardStatusLabel(!!acc.forward_enabled)}
                            ${acc.status === 'inactive' ? I18n.t("<span class=\"account-status-pill muted\">Disabled</span>") : ''}
                            ${acc.last_refresh_status === 'failed' ? I18n.t("<span class=\"account-status-pill danger\">Refresh failed</span>") : ''}
                        </div>
                        ${renderAccountGroupSummary(acc, showSearchGroupInfo)}
                        ${renderAccountAliasSummary(acc.aliases)}
                        ${acc.remark && acc.remark.trim() ? `<div class="account-remark" title="${escapeHtml(acc.remark)}">${escapeHtml(acc.remark)}</div>` : ''}
                        ${(acc.tags || []).length ? `<div class="account-tags">${renderAccountTagSummary(acc.tags, acc.id)}</div>` : ''}
                        ${renderAccountFooter(acc)}
                    </div>
                    <div class="account-menu-wrap">
                        <button class="account-menu-trigger" type="button" data-account-menu-toggle="true" title="More actions">⋯</button>
                        <div class="account-menu-panel">
                            <button class="account-action-btn" type="button" data-account-action="copy" data-account-email="${escapeHtml(acc.email)}">Copy mailbox</button>
                            <button class="account-action-btn" type="button" data-account-action="share" data-account-id="${acc.id}" data-account-email="${escapeHtml(acc.email)}">Share email</button>
                            <button class="account-action-btn" type="button" data-account-action="forwardingLogs" data-account-id="${acc.id}" data-account-email="${escapeHtml(acc.email)}">Forward log</button>
                            <button class="account-action-btn" type="button" data-account-action="toggleStatus" data-account-id="${acc.id}" data-account-status="${escapeHtml(acc.status || 'active')}">${acc.status === 'inactive' ? I18n.t("Activate account") : I18n.t("Deactivate account")}</button>
                            ${(acc.account_type || 'outlook') !== 'imap' ? I18n.tpl`<button class="account-action-btn" type="button" data-account-action="outlookAutoAuth" data-account-id="${acc.id}" data-account-email="${escapeHtml(acc.email)}">Add automatic authorization</button>` : ''}
                            <button class="account-action-btn" type="button" data-account-action="edit" data-account-id="${acc.id}">Edit account</button>
                            <button class="account-action-btn delete" type="button" data-account-action="delete" data-account-id="${acc.id}" data-account-email="${escapeHtml(acc.email)}">Delete account</button>
                        </div>
                    </div>
                </div>
            `).join('') + renderAccountPaginationFooter(accounts.length);
            if (checkedAccountIds.size) {
                container.querySelectorAll('.account-select-checkbox').forEach(checkbox => {
                    checkbox.checked = checkedAccountIds.has(String(checkbox.value));
                });
            }
            updateBatchActionBar();
            maybeLoadMoreAccounts();
        }

        // Sorting related variables
        const ACCOUNT_SORT_DEFAULT_BY = 'sort_order';
        const ACCOUNT_SORT_DEFAULT_ORDERS = {
            sort_order: 'asc',
            created_at: 'desc',
            email: 'asc'
        };

        function normalizeAccountSortBy(value) {
            const candidate = String(value || '').trim();
            return Object.prototype.hasOwnProperty.call(ACCOUNT_SORT_DEFAULT_ORDERS, candidate)
                ? candidate
                : ACCOUNT_SORT_DEFAULT_BY;
        }

        function normalizeAccountSortOrder(value, sortBy = ACCOUNT_SORT_DEFAULT_BY) {
            if (value === 'asc' || value === 'desc') {
                return value;
            }
            return ACCOUNT_SORT_DEFAULT_ORDERS[normalizeAccountSortBy(sortBy)] || 'asc';
        }

        function loadAccountSortPreference() {
            try {
                const saved = JSON.parse(localStorage.getItem(ACCOUNT_SORT_STORAGE_KEY) || '{}');
                const by = normalizeAccountSortBy(saved?.by);
                return {
                    by,
                    order: normalizeAccountSortOrder(saved?.order, by)
                };
            } catch (error) {
                return {
                    by: ACCOUNT_SORT_DEFAULT_BY,
                    order: ACCOUNT_SORT_DEFAULT_ORDERS[ACCOUNT_SORT_DEFAULT_BY]
                };
            }
        }

        function saveAccountSortPreference() {
            currentSortBy = normalizeAccountSortBy(currentSortBy);
            currentSortOrder = normalizeAccountSortOrder(currentSortOrder, currentSortBy);
            localStorage.setItem(ACCOUNT_SORT_STORAGE_KEY, JSON.stringify({
                by: currentSortBy,
                order: currentSortOrder
            }));
        }

        function syncAccountSortButtons() {
            document.querySelectorAll('.sort-btn').forEach(btn => {
                btn.classList.remove('active');
                btn.style.backgroundColor = '#ffffff';
                btn.style.color = '#666';
                btn.style.borderColor = '#e5e5e5';
            });

            const activeBtn = document.querySelector(`[data-sort="${currentSortBy}"]`);
            if (activeBtn) {
                activeBtn.classList.add('active');
                activeBtn.style.backgroundColor = '#1a1a1a';
                activeBtn.style.color = '#ffffff';
                activeBtn.style.borderColor = '#1a1a1a';
            }
        }

        const savedAccountSort = loadAccountSortPreference();
        let currentSortBy = savedAccountSort.by;
        let currentSortOrder = savedAccountSort.order;
        let suppressGroupClickUntil = 0;
        function createGroupDragState() {
            return {
                groupId: null,
                pointerId: null,
                pointerType: 'mouse',
                sourceEl: null,
                placeholderEl: null,
                targetMode: null,
                targetGroupId: null,
                targetParentId: null,
                insertAfter: false,
                dropAllowed: true,
                pressTimer: null,
                isDragging: false,
                startX: 0,
                startY: 0,
                offsetY: 0,
                fixedLeft: 0
            };
        }
        let groupDragState = createGroupDragState();

        function renderAccountFooter(acc) {
            const footerParts = [];
            const sortOrder = getAccountSortOrderValue(acc);
            if (shouldShowAccountSortOrder() && sortOrder !== null) {
                footerParts.push(I18n.tpl`<span class="account-sort-order">Sort value ${escapeHtml(String(sortOrder))}</span>`);
            }
            if (shouldShowAccountCreatedAt() && acc.created_at) {
                footerParts.push(`<span class="account-created-at" title="${escapeHtml(acc.created_at || '')}">${escapeHtml(formatAbsoluteDateTime(acc.created_at))}</span>`);
            }
            if (acc.last_refresh_status === 'failed') {
                footerParts.push('<button class="account-error-btn" onclick="event.stopPropagation(); showRefreshError(' + acc.id + ', \'' + escapeJs(acc.last_refresh_error || I18n.t("Unknown error")) + '\', \'' + escapeJs(acc.email) + '\', \'' + escapeJs(acc.account_type || 'outlook') + I18n.t("')\"&gt;View errors</button>"));
            }
            if (!footerParts.length) {
                return '';
            }
            return `<div class="account-refresh-row">${footerParts.join('')}</div>`;
        }

        function getAccountSortOrderValue(account) {
            const value = parseInt(account?.sort_order, 10);
            return Number.isFinite(value) && value > 0 ? value : null;
        }

        function getAccountCreatedAtValue(account) {
            const value = Date.parse(account?.created_at || '');
            return Number.isNaN(value) ? 0 : value;
        }

        function compareAccountsByCreatedAt(a, b, order = 'desc') {
            const createdA = getAccountCreatedAtValue(a);
            const createdB = getAccountCreatedAtValue(b);
            return order === 'asc' ? createdA - createdB : createdB - createdA;
        }

        function compareAccountsByEmail(a, b, order = 'asc') {
            const emailA = String(a?.email || '').toLowerCase();
            const emailB = String(b?.email || '').toLowerCase();
            return order === 'asc'
                ? emailA.localeCompare(emailB)
                : emailB.localeCompare(emailA);
        }

        // Sort account list
        function sortAccounts(sortBy) {
            sortBy = normalizeAccountSortBy(sortBy);
            // If you click the same sort button, switch the sort order
            if (currentSortBy === sortBy) {
                currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortBy = sortBy;
                currentSortOrder = ACCOUNT_SORT_DEFAULT_ORDERS[sortBy] || 'asc';
            }

            saveAccountSortPreference();
            syncAccountSortButtons();

            invalidateAccountCaches();
            if (isTempEmailGroup) {
                if (currentAccountListSource.length) {
                    renderTempEmailList(currentAccountListSource);
                }
                return;
            }

            refreshVisibleAccountList(true);
        }

        function renderFilteredAccountList(accounts) {
            currentAccountListSource = Array.isArray(accounts) ? [...accounts] : [];
            const filteredAccounts = applyFiltersAndSort(currentAccountListSource);
            renderAccountList(filteredAccounts);

            const searchQuery = (document.getElementById('globalSearch')?.value || '').trim();
            if (searchQuery) {
                if (getAccountSearchScope() === 'group') {
                    const currentGroup = groups.find(group => group.id === currentGroupId);
                    updateCurrentGroupHeader(currentGroup || null);
                } else {
                    updateCurrentGroupHeader(null);
                }
            } else {
                if (hasAccountServerSideFilters() && getAccountSearchScope() === 'all') {
                    updateCurrentGroupHeader(null);
                } else {
                    const currentGroup = groups.find(group => group.id === currentGroupId);
                    if (currentGroup && Number(accountPaginationState.total) > 0) {
                        updateCurrentGroupHeader(currentGroup);
                    }
                }
            }
        }

        function refreshVisibleAccountList(forceRefresh = false) {
            if (currentGroupId && isTempEmailGroup) {
                return loadTempEmails(forceRefresh);
            }

            const searchQuery = (document.getElementById('globalSearch')?.value || '').trim();
            if (searchQuery) {
                return searchAccounts(searchQuery, forceRefresh);
            }
            if (currentGroupId) {
                return loadAccountsByGroup(currentGroupId, forceRefresh);
            }
            return Promise.resolve();
        }

        function invalidateAccountCaches() {
            Object.keys(accountsCache).forEach(key => {
                if (key !== 'temp') {
                    delete accountsCache[key];
                }
            });
        }

        function resetSelectedAccountView() {
            currentAccount = null;
            currentAccountSummary = null;
            if (typeof updateGraphSendMailAvailability === 'function') {
                updateGraphSendMailAvailability();
            }
            currentEmailId = null;
            currentEmailDetail = null;
            currentEmails = [];
            currentSkip = 0;
            hasMoreEmails = true;

            document.getElementById('currentAccount').classList.remove('show');
            document.getElementById('currentAccountEmail').textContent = '';
            document.getElementById('emailCount').textContent = '';
            document.getElementById('methodTag').style.display = 'none';
            document.getElementById('folderTabs').style.display = 'none';
            document.getElementById('emailDetailToolbar').style.display = 'none';
            document.getElementById('emailList').innerHTML = I18n.tpl`
                <div class="empty-state">
                    <div class="empty-state-icon">📬</div>
                    <div class="empty-state-text">Please select an email account from the left</div>
                </div>
            `;
            document.getElementById('emailDetail').innerHTML = I18n.tpl`
                <div class="empty-state">
                    <div class="empty-state-icon">📄</div>
                    <div class="empty-state-text">Select an email to view details</div>
                </div>
            `;
            showEmailList();
            updateMobileContext();
        }

        function resetSelectedAccountViewIfDeleted(deletedEmails) {
            const emailSet = new Set((deletedEmails || []).map(email => String(email || '').toLowerCase()));
            if (currentAccount && emailSet.has(String(currentAccount).toLowerCase())) {
                resetSelectedAccountView();
            }
        }

        function getAccountSearchTerms(query) {
            const normalizedQuery = String(query || '').trim().toLowerCase();
            if (!normalizedQuery) {
                return [];
            }

            const splitTerms = normalizedQuery.split(/\s+/).filter(Boolean);
            return Array.from(new Set(splitTerms));
        }

        function matchesAccountSearchTerms(fields, query) {
            const terms = getAccountSearchTerms(query);
            if (!terms.length) {
                return true;
            }

            const normalizedFields = fields.map(value => String(value || '').toLowerCase());
            return terms.some(term => normalizedFields.some(value => value.includes(term)));
        }

        // Apply filtering and sorting
        function applyFiltersAndSort(accounts) {
            let result = [...accounts];

            const searchQuery = (document.getElementById('globalSearch')?.value || '').trim();

            if (searchQuery) {
                result = result.filter(acc => {
                    const aliasText = Array.isArray(acc.aliases) ? acc.aliases.join('\n') : '';
                    const tagText = Array.isArray(acc.tags) ? acc.tags.map(tag => String(tag.name || '')).join('\n') : '';
                    return matchesAccountSearchTerms([
                        acc.email,
                        aliasText,
                        acc.remark,
                        tagText
                    ], searchQuery);
                });
            }

            // 1. Tag filtering
            if (hasActiveTagFilters()) {
                result = result.filter(acc => matchesSelectedTagFilters(acc.tags));
            }

            // 2. Sorting
            return result.sort((a, b) => {
                if (currentSortBy === 'sort_order') {
                    const sortA = getAccountSortOrderValue(a);
                    const sortB = getAccountSortOrderValue(b);
                    const hasSortA = sortA !== null;
                    const hasSortB = sortB !== null;

                    if (hasSortA !== hasSortB) {
                        return hasSortA ? -1 : 1;
                    }

                    if (hasSortA && hasSortB && sortA !== sortB) {
                        return currentSortOrder === 'asc' ? sortA - sortB : sortB - sortA;
                    }

                    const createdCompare = compareAccountsByCreatedAt(a, b, 'desc');
                    if (createdCompare !== 0) {
                        return createdCompare;
                    }
                    return compareAccountsByEmail(a, b, 'asc');
                }

                if (currentSortBy === 'created_at') {
                    const createdCompare = compareAccountsByCreatedAt(a, b, currentSortOrder);
                    if (createdCompare !== 0) {
                        return createdCompare;
                    }
                    return compareAccountsByEmail(a, b, 'asc');
                }

                const emailCompare = compareAccountsByEmail(a, b, currentSortOrder);
                if (emailCompare !== 0) {
                    return emailCompare;
                }
                return compareAccountsByCreatedAt(a, b, 'desc');
            });
        }

        function applyAccountTagFilterChange() {
            saveAccountTagFilterPreference();
            saveAccountTagExcludeFilterPreference();
            if (typeof syncAccountTagFilterOptions === 'function') {
                syncAccountTagFilterOptions();
            } else {
                updateTagFilterSummary();
            }
            invalidateAccountCaches();
            if (isTempEmailGroup) {
                if (currentAccountListSource.length) {
                    renderTempEmailList(currentAccountListSource);
                }
                return;
            }
            if (currentGroupId) {
                refreshVisibleAccountList(true);
                return;
            }

            if (currentAccountListSource.length) {
                renderFilteredAccountList(currentAccountListSource);
            }
        }

        function handleTagFilterChange() {
            applyAccountTagFilterChange();
        }

        function setAccountTagFilterSelection(value, state, event) {
            event?.stopPropagation();
            const tagId = normalizeTagFilterSelectionValue(value);
            if (tagId === null) {
                return;
            }

            if (state === 'include') {
                if (selectedTagFilters.has(tagId)) {
                    selectedTagFilters.delete(tagId);
                } else {
                    selectedTagFilters.add(tagId);
                    excludedTagFilters.delete(tagId);
                }
            } else if (state === 'exclude') {
                if (excludedTagFilters.has(tagId)) {
                    excludedTagFilters.delete(tagId);
                } else {
                    excludedTagFilters.add(tagId);
                    selectedTagFilters.delete(tagId);
                }
            }

            applyAccountTagFilterChange();
        }

        // Anti-shake function
        function debounce(func, wait) {
            let timeout;
            return function (...args) {
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(this, args), wait);
            };
        }

        // Global search function
        async function searchAccounts(query, forceRefresh = false, append = false) {
            const container = document.getElementById('accountList');
            if (!append) {
                saveAccountSearchQueryPreference(query);
            }

            if (!query.trim()) {
                const currentGroup = groups.find(group => group.id === currentGroupId);
                updateCurrentGroupHeader(currentGroup);
                currentAccountListSource = [];
                accountPaginationState = {
                    mode: '',
                    key: '',
                    total: 0,
                    loaded: 0,
                    hasMore: false,
                    loading: false
                };
                if (isTempEmailGroup) {
                    loadTempEmails();
                } else {
                    loadAccountsByGroup(currentGroupId, forceRefresh);
                }
                return;
            }

            if (getAccountSearchTerms(query).length > ACCOUNT_SEARCH_MAX_TERMS) {
                const message = I18n.t("Search keywords support up to 200");
                if (append) {
                    showToast(message, 'warning');
                } else {
                    container.innerHTML = `<div class="empty-state"><div class="empty-state-text">${escapeHtml(message)}</div></div>`;
                }
                return;
            }

            if (isTempEmailGroup) {
                if (accountsCache['temp']) {
                    renderTempEmailList(accountsCache['temp']);
                } else {
                    await loadTempEmails();
                }
                return;
            }

            const offset = append ? currentAccountListSource.length : 0;
            if (append) {
                setAccountPaginationLoading(true);
            } else {
                container.innerHTML = '<div class="loading loading-small"><div class="loading-spinner"></div></div>';
            }

            const params = appendAccountListParams(new URLSearchParams({
                q: query,
                offset: String(offset)
            }));
            if (getAccountSearchScope() === 'group' && currentGroupId) {
                params.set('group_id', String(currentGroupId));
            }
            const requestId = ++accountListRequestSeq;

            try {
                const response = await fetch(`/api/accounts/search?${params.toString()}`);
                const data = await response.json();
                if (requestId !== accountListRequestSeq) {
                    return;
                }

                if (data.success) {
                    const nextAccounts = append
                        ? currentAccountListSource.concat(data.accounts || [])
                        : (data.accounts || []);
                    updateAccountPaginationState('search', `${getAccountSearchScopeKey()}:${query}`, data, nextAccounts.length);
                    renderFilteredAccountList(nextAccounts);
                } else {
                    const message = data.error || I18n.t("Search failed");
                    container.innerHTML = `<div class="empty-state"><div class="empty-state-text">${escapeHtml(message)}</div></div>`;
                }
            } catch (error) {
                console.error(I18n.t("Search failed:"), error);
                if (append) {
                    showToast(I18n.t("Failed to load more search results"), 'error');
                } else {
                    container.innerHTML = I18n.t("<div class=\"empty-state\"><div class=\"empty-state-text\">Search failed, please try again</div></div>");
                }
            } finally {
                if (requestId === accountListRequestSeq) {
                    setAccountPaginationLoading(false);
                }
            }
        }

        // Update group drop-down selection box
        function updateGroupSelects() {
            const selects = ['importGroupSelect', 'editGroupSelect', 'tokenSaveGroupSelect', 'addUploadAccountGroupSelect'];
            selects.forEach(selectId => {
                const select = document.getElementById(selectId);
                if (select) {
                    const currentValue = select.value;
                    const includeTemp = !(selectId === 'editGroupSelect'
                        || selectId === 'tokenSaveGroupSelect'
                        || selectId === 'addUploadAccountGroupSelect');
                    const filteredGroups = includeTemp ? groups : groups.filter(g => !isSystemGroup(g));

                    select.innerHTML = renderGroupOptions({ includeTemp });
                    // Restore previous selections
                    if (currentValue && filteredGroups.find(g => g.id === parseInt(currentValue))) {
                        select.value = currentValue;
                    } else if (selectId === 'tokenSaveGroupSelect' || selectId === 'addUploadAccountGroupSelect') {
                        const preferredGroupId = (!isTempEmailGroup && currentGroupId && filteredGroups.find(g => g.id === currentGroupId))
                            ? currentGroupId
                            : (filteredGroups[0]?.id || '');
                        if (preferredGroupId) {
                            select.value = preferredGroupId;
                        }
                    } else if (currentGroupId && filteredGroups.find(g => g.id === currentGroupId)) {
                        select.value = currentGroupId;
                    }
                }
            });

            // Bind import group switching events and dynamically update prompts
            const importSelect = document.getElementById('importGroupSelect');
            if (importSelect) {
                importSelect.onchange = function () {
                    updateImportHint();
                };
            }
        }

        function getAvailableParentGroups(editingId = null) {
            const editingGroupIdValue = editingId === null ? null : Number(editingId);
            const excludedIds = editingGroupIdValue
                ? new Set([editingGroupIdValue, ...getGroupDescendantIds(editingGroupIdValue)])
                : new Set();
            return flattenGroupTree(groupTree).filter(group =>
                !isSystemGroup(group)
                && normalizeGroupLevel(group) < 3
                && !excludedIds.has(Number(group.id))
            );
        }

        function updateParentGroupSelect(selectedParentId = null, editingId = null) {
            const select = document.getElementById('groupParentSelect');
            if (!select) {
                return;
            }

            const normalizedSelectedParentId = normalizeGroupParentId(selectedParentId);
            const options = [I18n.t("<option value=\"\">None (first-level grouping)</option>")];
            getAvailableParentGroups(editingId).forEach(group => {
                options.push(`<option value="${group.id}">${escapeHtml(getGroupOptionLabel(group))}</option>`);
            });
            select.innerHTML = options.join('');
            select.value = normalizedSelectedParentId && getAvailableParentGroups(editingId).some(group => Number(group.id) === normalizedSelectedParentId)
                ? String(normalizedSelectedParentId)
                : '';
        }

        function handleGroupParentChange() {
            const parentId = normalizeGroupParentId(document.getElementById('groupParentSelect')?.value);
            updateGroupSortPositionOptions(editingGroupId, null, parentId);
        }

        // Display the add group modal box
        const MAIL_PROVIDER_LABELS = {
            outlook: 'Outlook',
            gmail: 'Gmail',
            qq: 'QQ',
            '163': '163',
            '126': '126',
            yahoo: 'Yahoo',
            aliyun: 'Aliyun',
            '2925': I18n.t("Email 2925"),
            custom: 'Custom IMAP'
        };

        function getProviderLabel(provider) {
            return MAIL_PROVIDER_LABELS[provider] || (provider || 'Outlook');
        }

        function isTempImportGroup() {
            const importSelect = document.getElementById('importGroupSelect');
            const selectedGroup = groups.find(g => g.id === parseInt(importSelect?.value || '0'));
            return !!(selectedGroup && selectedGroup.name === "\u4e34\u65f6\u90ae\u7bb1");
        }

        function normalizeForwardChannels(rawChannels) {
            const aliases = {
                email: 'smtp',
                smtp: 'smtp',
                tg: 'telegram',
                telegram: 'telegram',
                wecom: 'wecom',
                wechatwork: 'wecom',
                qywx: 'wecom'
            };
            const values = Array.isArray(rawChannels)
                ? rawChannels
                : String(rawChannels || '').split(',');

            return [...new Set(
                values
                    .map(channel => aliases[String(channel || '').trim().toLowerCase()])
                    .filter(Boolean)
            )];
        }

        function getSelectedForwardChannels() {
            const checkboxMap = {
                smtp: 'forwardChannelSmtp',
                telegram: 'forwardChannelTelegram',
                wecom: 'forwardChannelWecom',
            };
            return Object.keys(checkboxMap).filter(channel =>
                document.getElementById(checkboxMap[channel])?.checked
            );
        }

        function setSelectedForwardChannels(rawChannels) {
            const channels = normalizeForwardChannels(rawChannels);
            const smtpCheckbox = document.getElementById('forwardChannelSmtp');
            const telegramCheckbox = document.getElementById('forwardChannelTelegram');
            const wecomCheckbox = document.getElementById('forwardChannelWecom');
            if (smtpCheckbox) smtpCheckbox.checked = channels.includes('smtp');
            if (telegramCheckbox) telegramCheckbox.checked = channels.includes('telegram');
            if (wecomCheckbox) wecomCheckbox.checked = channels.includes('wecom');
            syncForwardChannelUI();
        }

        function syncForwardChannelUI() {
            const selectedChannels = new Set(getSelectedForwardChannels());

            document.querySelectorAll('#forwardChannelPicker .forward-channel-option').forEach(option => {
                const input = option.querySelector('input');
                option.classList.toggle('is-selected', !!input?.checked);
            });

            document.querySelectorAll('#forwardChannelPanels .forward-channel-panel').forEach(panel => {
                const channel = panel.dataset.channel;
                panel.hidden = !selectedChannels.has(channel);
            });

            const emptyState = document.getElementById('forwardChannelEmptyState');
            if (emptyState) {
                emptyState.hidden = selectedChannels.size > 0;
            }
        }

        const SMTP_FORWARD_PROVIDER_OPTIONS = ['outlook', 'qq', '163', '126', 'yahoo', 'aliyun', 'custom'];

        function normalizeSmtpForwardProvider(value) {
            const provider = String(value || '').trim().toLowerCase();
            return SMTP_FORWARD_PROVIDER_OPTIONS.includes(provider) ? provider : 'custom';
        }

        const SMTP_PROVIDER_PRESETS = {
            outlook: { host: 'smtp-mail.outlook.com', port: '587', useTls: true, useSsl: false, hint: I18n.t("Outlook recommends SMTP + STARTTLS (587).") },
            qq: { host: 'smtp.qq.com', port: '465', useTls: false, useSsl: true, hint: I18n.t("QQ mailbox usually uses SMTP authorization code, and the default is SSL 465.") },
            '163': { host: 'smtp.163.com', port: '465', useTls: false, useSsl: true, hint: I18n.t("163 mailboxes usually use SMTP authorization code, and the default is SSL 465.") },
            '126': { host: 'smtp.126.com', port: '465', useTls: false, useSsl: true, hint: I18n.t("126 mailboxes usually use SMTP authorization code, and the default is SSL 465.") },
            yahoo: { host: 'smtp.mail.yahoo.com', port: '465', useTls: false, useSsl: true, hint: I18n.t("Yahoo defaults to SSL 465.") },
            aliyun: { host: 'smtp.aliyun.com', port: '465', useTls: false, useSsl: true, hint: I18n.t("Alibaba Mailbox defaults to SSL 465.") },
            custom: { host: '', port: '465', useTls: false, useSsl: true, hint: I18n.t("In custom mode, please manually fill in the SMTP host, port and connection method.") }
        };

        function ensureForwardingSettingsUI() {
            if (!document.getElementById('forwardingSettingsSection')) return;
            syncForwardChannelUI();
            syncSmtpProviderUI(false);
        }

        function syncSmtpProviderUI(applyPreset = false) {
            const providerSelect = document.getElementById('settingsSmtpProvider');
            const hostInput = document.getElementById('settingsSmtpHost');
            const portInput = document.getElementById('settingsSmtpPort');
            const useTlsInput = document.getElementById('settingsSmtpUseTls');
            const useSslInput = document.getElementById('settingsSmtpUseSsl');
            const providerHint = document.getElementById('settingsSmtpProviderHint');
            const fromHint = document.getElementById('settingsSmtpFromEmailHint');
            if (!providerSelect || !hostInput || !portInput || !useTlsInput || !useSslInput || !providerHint || !fromHint) return;

            const provider = normalizeSmtpForwardProvider(providerSelect.value || 'custom');
            providerSelect.value = provider;
            const preset = SMTP_PROVIDER_PRESETS[provider] || SMTP_PROVIDER_PRESETS.custom;

            if (applyPreset) {
                hostInput.value = preset.host;
                portInput.value = preset.port;
                useTlsInput.checked = !!preset.useTls;
                useSslInput.checked = !!preset.useSsl;
            }

            providerHint.textContent = preset.hint;
            fromHint.textContent = I18n.t("Optional. When left blank, the SMTP username is used as the sender email by default.");
        }

        function updateEditAccountFields() {
            const provider = document.getElementById('editProviderSelect')?.value || 'outlook';
            const isOutlook = provider === 'outlook';
            const passwordGroup = document.getElementById('editPassword')?.closest('.form-group');
            const clientIdGroup = document.getElementById('editClientId')?.closest('.form-group');
            const refreshTokenGroup = document.getElementById('editRefreshToken')?.closest('.form-group');
            const authorizationTypeGroup = document.getElementById('editAuthorizationType')?.closest('.form-group');
            const authorizationTypeSelect = document.getElementById('editAuthorizationType');
            const imapFields = document.getElementById('editImapFields');
            const customImapFields = document.getElementById('editCustomImapFields');
            const reauthorizeGroup = document.getElementById('editReauthorizeGroup');

            if (passwordGroup) passwordGroup.style.display = isOutlook ? '' : 'none';
            if (clientIdGroup) clientIdGroup.style.display = isOutlook ? '' : 'none';
            if (refreshTokenGroup) refreshTokenGroup.style.display = isOutlook ? '' : 'none';
            if (authorizationTypeGroup) authorizationTypeGroup.style.display = isOutlook ? '' : 'none';
            if (authorizationTypeSelect) authorizationTypeSelect.disabled = !isOutlook;
            if (imapFields) imapFields.style.display = isOutlook ? 'none' : '';
            if (customImapFields) customImapFields.style.display = provider === 'custom' ? '' : 'none';
            if (reauthorizeGroup) reauthorizeGroup.style.display = isOutlook ? '' : 'none';
        }

        function updateImportHint() {
            const hintEl = document.getElementById('importFormatHint');
            const inputEl = document.getElementById('accountInput');
            const channelGroup = document.getElementById('importChannelGroup');
            const channelSelect = document.getElementById('importChannelSelect');
            const cloudflareChannelGroup = document.getElementById('importCloudflareChannelGroup');
            const cloudflareModeGroup = document.getElementById('importCloudflareModeGroup');
            const cloudflareModeSelect = document.getElementById('importCloudflareImportMode');
            const providerGroup = document.getElementById('importProviderGroup');
            const providerSelect = document.getElementById('importProviderSelect');
            const exampleEl = document.getElementById('importFormatExample');
            const importSource = document.querySelector('#addAccountModal .import-account-source');
            const customImapSettings = document.getElementById('customImapSettings');
            const customHost = document.getElementById('importImapHost');
            const customPort = document.getElementById('importImapPort');
            const accountDefaultFields = document.querySelectorAll('#addAccountModal .import-account-default-field');
            if (!hintEl || !inputEl) return;

            const isTempGroup = isTempImportGroup();
            if (channelGroup) channelGroup.style.display = isTempGroup ? '' : 'none';
            if (providerGroup) providerGroup.style.display = isTempGroup ? 'none' : '';
            if (!isTempGroup) {
                if (cloudflareChannelGroup) cloudflareChannelGroup.style.display = 'none';
                if (cloudflareModeGroup) cloudflareModeGroup.style.display = 'none';
                if (importSource) importSource.style.display = '';
            }
            accountDefaultFields.forEach(field => {
                const isTagField = !!field.querySelector('#importTagFilterDropdown');
                field.style.display = isTempGroup ? (isTagField ? '' : 'none') : '';
            });

            if (isTempGroup) {
                if (customImapSettings) customImapSettings.style.display = 'none';
                const channel = channelSelect ? channelSelect.value : 'gptmail';
                const isCloudflare = channel === 'cloudflare';
                const cloudflareMode = cloudflareModeSelect ? cloudflareModeSelect.value : 'auto';
                if (cloudflareChannelGroup) cloudflareChannelGroup.style.display = isCloudflare ? '' : 'none';
                if (cloudflareModeGroup) cloudflareModeGroup.style.display = isCloudflare ? '' : 'none';
                if (importSource) importSource.style.display = isCloudflare && cloudflareMode === 'auto' ? 'none' : '';
                if (isCloudflare && typeof loadCloudflareChannelsForImport === 'function') {
                    loadCloudflareChannelsForImport();
                }
                if (channel === 'duckmail') {
                    hintEl.textContent = I18n.t("Format: Email ---- Password, one per line.");
                    inputEl.placeholder = I18n.t("Email----Password");
                    if (exampleEl) {
                        exampleEl.style.display = '';
                        exampleEl.textContent = I18n.t("Example: \nuser@duck.com----mypassword\nuser2@duck.com----password2");
                    }
                    return;
                }
                if (channel === 'cloudflare') {
                    if (cloudflareMode === 'auto') {
                        hintEl.textContent = I18n.t("Automatically pull email addresses from the selected Cloudflare channel and import them, without pulling JWT.");
                        inputEl.placeholder = '';
                        if (exampleEl) {
                            exampleEl.style.display = 'none';
                            exampleEl.textContent = '';
                        }
                        return;
                    }
                    hintEl.textContent = I18n.t("Format: One email address per line. Manual import no longer supports email----JWT.");
                    inputEl.placeholder = 'user@example.com\nuser2@example.com';
                    if (exampleEl) {
                        exampleEl.style.display = '';
                        exampleEl.textContent = I18n.t("Example: \nuser@example.com\nuser2@example.com");
                    }
                    return;
                }
                hintEl.textContent = I18n.t("Format: One email address per line.");
                inputEl.placeholder = I18n.t("One email address per line");
                if (exampleEl) {
                    exampleEl.style.display = '';
                    exampleEl.textContent = I18n.t("Example: \nuser1@gptmail.com\nuser2@gptmail.com");
                }
                return;
            }

            const provider = providerSelect ? providerSelect.value : 'outlook';
            const isOutlook = provider === 'outlook';
            if (customImapSettings) customImapSettings.style.display = provider === 'custom' ? '' : 'none';
            if (exampleEl) exampleEl.style.display = '';

            if (isOutlook) {
                hintEl.textContent = I18n.t("Outlook supports two formats and automatically recognizes them: Email----Password----client_id----refresh_token or Email----Password----refresh_token----client_id.");
                inputEl.placeholder = I18n.t("Email----Password----client_id----refresh_token");
                if (exampleEl) {
                    exampleEl.textContent = I18n.t("Example: \nuser@outlook.com----password123----24d9a0ed-8787-4584-883c-2fd79308940a----0.AXEA. ..\nuser@outlook.com----password123----0.AXEA...----24d9a0ed-8787-4584-883c-2fd79308940a");
                }
                return;
            }

            if (provider === 'custom') {
                hintEl.textContent = I18n.t("Format: Email----IMAP password. Compatible formats are also supported: email----IMAP password----imap_host----imap_port.");
                inputEl.placeholder = I18n.t("Email----IMAP password");
                if (exampleEl) {
                    const host = customHost?.value?.trim() || 'imap.example.com';
                    const port = customPort?.value?.trim() || '993';
                    exampleEl.textContent = I18n.tpl`Example: 
user@example.com----app-password
user@example.com----app-password----${host}----${port}`;
                }
                return;
            }

            hintEl.textContent = I18n.tpl`Format: Email----IMAP authorization code/application password, one per line. Current type: ${getProviderLabel(provider)}.`;
            inputEl.placeholder = I18n.t("Email----IMAP authorization code/application password");
            if (exampleEl) {
                exampleEl.textContent = I18n.t("Example: \nuser@gmail.com----app-password\nuser2@qq.com----imap-auth-code");
            }
        }

        function showAddGroupModal() {
            closeAllModals();
            editingGroupId = null;
            document.getElementById('groupModalTitle').textContent = I18n.t("Add group");
            document.getElementById('groupName').value = '';
            document.getElementById('groupDescription').value = '';
            const currentGroup = getGroupById(currentGroupId);
            const defaultParentId = currentGroup && !isSystemGroup(currentGroup) && normalizeGroupLevel(currentGroup) < 3
                ? currentGroup.id
                : null;
            updateParentGroupSelect(defaultParentId, null);
            updateGroupSortPositionOptions(null, null, defaultParentId);
            selectedColor = '#1a1a1a';
            document.querySelectorAll('.color-option').forEach(o => {
                o.classList.toggle('selected', o.dataset.color === selectedColor);
            });
            document.getElementById('customColorInput').value = selectedColor;
            document.getElementById('customColorHex').value = selectedColor;
            document.getElementById('groupProxyUrl').value = '';
            document.getElementById('groupFallbackProxyUrl1').value = '';
            document.getElementById('groupFallbackProxyUrl2').value = '';
            setModalVisible('addGroupModal', true);
        }

        // Hide the add group modal box
        function hideAddGroupModal() {
            hideModal('addGroupModal');
        }

        // Edit group
        async function editGroup(groupId) {
            try {
                const response = await fetch(`/api/groups/${groupId}`);
                const data = await response.json();

                if (data.success) {
                    editingGroupId = groupId;
                    document.getElementById('groupModalTitle').textContent = I18n.t("Edit group");
                    document.getElementById('groupName').value = data.group.name;
                    document.getElementById('groupDescription').value = data.group.description || '';
                    updateParentGroupSelect(data.group.parent_id, groupId);
                    updateGroupSortPositionOptions(groupId, data.group.sort_position, data.group.parent_id);
                    selectedColor = data.group.color || '#1a1a1a';

                    // Check if it is the default color
                    let isPresetColor = false;
                    document.querySelectorAll('.color-option').forEach(o => {
                        if (o.dataset.color === selectedColor) {
                            o.classList.add('selected');
                            isPresetColor = true;
                        } else {
                            o.classList.remove('selected');
                        }
                    });

                    // Update custom color input box
                    document.getElementById('customColorInput').value = selectedColor;
                    document.getElementById('customColorHex').value = selectedColor;

                    // Populate proxy settings
                    document.getElementById('groupProxyUrl').value = data.group.proxy_url || '';
                    document.getElementById('groupFallbackProxyUrl1').value = data.group.fallback_proxy_url_1 || '';
                    document.getElementById('groupFallbackProxyUrl2').value = data.group.fallback_proxy_url_2 || '';

                    showModal('addGroupModal');
                }
            } catch (error) {
                showToast(I18n.t("Failed to load group information"), 'error');
            }
        }

        // Save group
        async function saveGroup() {
            const name = document.getElementById('groupName').value.trim();
            const description = document.getElementById('groupDescription').value.trim();
            const sortPositionRaw = document.getElementById('groupSortPosition').value;
            const sortPosition = sortPositionRaw ? parseInt(sortPositionRaw, 10) : null;
            const parentId = normalizeGroupParentId(document.getElementById('groupParentSelect')?.value);

            if (!name) {
                showToast(I18n.t("Please enter the group name"), 'error');
                return;
            }

            try {
                const url = editingGroupId ? `/api/groups/${editingGroupId}` : '/api/groups';
                const method = editingGroupId ? 'PUT' : 'POST';

                const response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name,
                        description,
                        color: selectedColor,
                        proxy_url: document.getElementById('groupProxyUrl').value.trim(),
                        fallback_proxy_url_1: document.getElementById('groupFallbackProxyUrl1').value.trim(),
                        fallback_proxy_url_2: document.getElementById('groupFallbackProxyUrl2').value.trim(),
                        sort_position: sortPosition,
                        parent_id: parentId
                    })
                });

                const data = await response.json();

                if (data.success) {
                    showToast(data.message, 'success');
                    hideAddGroupModal();
                    loadGroups();
                } else {
                    handleApiError(data, I18n.t("Failed to save group"));
                }
            } catch (error) {
                showToast(I18n.t("Save failed"), 'error');
            }
        }

        // Delete group
        async function deleteGroup(groupId) {
            const childCount = getGroupDescendantIds(groupId).length;
            const message = childCount > 0
                ? I18n.tpl`There are ${childCount} subgroups under this group. After deletion, the subgroups will be deleted together and all mailboxes will be moved to the default group.`
                : I18n.t("Are you sure you want to delete this group? Mailboxes under the group will be moved to the default group.");
            if (!(await showConfirmModal(message, { title: I18n.t("Delete group"), confirmText: I18n.t("Confirm deletion") }))) {
                return;
            }

            try {
                const response = await fetch(`/api/groups/${groupId}`, { method: 'DELETE' });
                const data = await response.json();

                if (data.success) {
                    showToast(data.message, 'success');
                    // Clear cache
                    delete accountsCache[groupId];
                    // If the currently selected group is deleted, switch to the default group
                    if (currentGroupId === groupId) {
                        currentGroupId = 1;
                        localStorage.setItem('outlook_last_group_id', 1);
                    }
                    loadGroups();
                } else {
                    handleApiError(data, I18n.t("Failed to delete group"));
                }
            } catch (error) {
                showToast(I18n.t("Delete failed"), 'error');
            }
        }
