        /* global accountsCache, currentAccountListSource, currentGroupId, excludedTagFilters, handleApiError, handleTagFilterChange, hideModal, invalidateAccountCaches, isTempEmailGroup, loadAccountTagExcludeFilterPreference, loadAccountTagFilterPreference, loadAccountsByGroup, loadTempEmails, normalizeTagFilterSelectionValue, refreshVisibleAccountList, renderFilteredAccountList, renderImportTagOptions, renderTempEmailList, saveAccountTagExcludeFilterPreference, saveAccountTagFilterPreference, selectedTagFilters, setAccountTagFilterSelection, showModal, showToast, updateBatchTagTagOptions, updateCurrentGroupHeader */

        // ==================== Tag Management ====================

        let allTags = [];

        // ==================== General label drop-down component function ====================
        // Shared by import modal box and edit modal box

        /**
         * Generate tag-filter-option checkbox list HTML
         * @param {Array} tags - tag list [{id, name, color}, ...]
         * @param {Array|Set} selectedIds - The selected tag ID set
         * @param {string} onchangeFn - the function name called by onchange (without brackets)
         */
        function buildTagFilterOptionsHtml(tags, selectedIds, onchangeFn) {
            const selectedSet = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
            const items = tags || [];
            if (!items.length) {
                return I18n.t("<div class=\"tag-filter-empty\" style=\"display: block;\">No tags yet</div>");
            }
            return items.map(tag => `
                <label class="tag-filter-option ${selectedSet.has(tag.id) ? 'is-checked' : ''}" data-tag-name="${escapeHtml(tag.name)}">
                    <input type="checkbox" class="tag-filter-checkbox" value="${tag.id}"
                        ${selectedSet.has(tag.id) ? 'checked' : ''}
                        ${onchangeFn ? `onchange="${onchangeFn}()"` : ''}>
                    <span class="tag-filter-dot" style="background-color: ${tag.color};"></span>
                    <span class="tag-filter-name">${escapeHtml(tag.name)}</span>
                </label>
            `).join('');
        }

        /**
         * Filter label options by keyword in the specified options container
         */
        function filterTagFilterOptions(keyword, optionsContainer) {
            if (!optionsContainer) return;
            const kw = (keyword || '').trim().toLowerCase();
            let visibleCount = 0;
            optionsContainer.querySelectorAll('.tag-filter-option').forEach(option => {
                const tagName = (option.dataset.tagName || '').toLowerCase();
                const isVisible = !kw || tagName.includes(kw);
                option.classList.toggle('hidden', !isVisible);
                if (isVisible) visibleCount += 1;
            });
            const emptyState = optionsContainer.querySelector('.tag-filter-empty');
            if (emptyState) {
                const hasOptions = optionsContainer.querySelectorAll('.tag-filter-option').length > 0;
                emptyState.style.display = (visibleCount === 0 && (kw || !hasOptions)) ? 'block' : 'none';
                if (kw && visibleCount === 0) {
                    emptyState.textContent = I18n.t("No matching tags");
                } else if (!hasOptions) {
                    emptyState.textContent = I18n.t("No tags yet");
                }
            }
        }

        /**
         * Get the selected tag ID array from the specified options container
         */
        function getTagFilterSelectedIds(optionsContainer) {
            if (!optionsContainer) return [];
            return Array.from(optionsContainer.querySelectorAll('.tag-filter-checkbox:checked'))
                .map(checkbox => parseInt(checkbox.value, 10))
                .filter(Number.isFinite);
        }

        /**
         * Update summary text and count badge for label dropdown trigger
         * @param {HTMLElement} triggerTextEl - summarize text elements
         * @param {HTMLElement} countEl - count badge elements
         * @param {Array} selectedItems - Array of selected label objects [{id, name, color}, ...]
         * @param {string} defaultText - the default text when no selection is made
         */
        function updateTagFilterSummaryText(triggerTextEl, countEl, selectedItems, defaultText) {
            if (!triggerTextEl || !countEl) return;
            const count = selectedItems.length;
            if (!count) {
                triggerTextEl.textContent = defaultText || I18n.t("No tag selected");
                countEl.style.display = 'none';
                countEl.textContent = '';
                return;
            }
            triggerTextEl.textContent = count <= 2
                ? selectedItems.map(t => t.name).join('、')
                : I18n.tpl`${count} tags selected`;
            countEl.style.display = 'inline-flex';
            countEl.textContent = String(count);
        }

        /**
         * Switch the label drop-down panel on and off, and focus the search box when it is opened.
         */
        function toggleTagFilterDropdownState(dropdownEl, searchInputEl, keyword) {
            if (!dropdownEl) return;
            const willOpen = !dropdownEl.classList.contains('open');
            dropdownEl.classList.toggle('open', willOpen);
            if (willOpen && searchInputEl) {
                searchInputEl.value = keyword || '';
                const optionsContainer = dropdownEl.querySelector('.tag-filter-options');
                filterTagFilterOptions(searchInputEl.value, optionsContainer);
                window.requestAnimationFrame(() => searchInputEl.focus());
            }
        }

        /**
         * Clear all selected states in the label drop-down (UI level only)
         */
        function clearTagFilterCheckboxes(dropdownEl) {
            if (!dropdownEl) return;
            dropdownEl.querySelectorAll('.tag-filter-checkbox').forEach(checkbox => {
                checkbox.checked = false;
            });
            dropdownEl.querySelectorAll('.tag-filter-option').forEach(option => {
                option.classList.remove('is-checked');
            });
        }

        // Display tag management modal box
        async function showTagManagementModal() {
            showModal('tagManagementModal');
            await loadTags();
        }

        // Hide tag management modal box
        function hideTagManagementModal() {
            hideModal('tagManagementModal');
        }

        function pruneAccountTagFilterSelections() {
            const availableTagIds = new Set(
                allTags
                    .map(tag => normalizeTagFilterSelectionValue(tag.id))
                    .filter(tagId => Number.isFinite(tagId) && tagId > 0)
            );
            const includedTagFilters = new Set(
                Array.from(selectedTagFilters)
                    .map(tagId => normalizeTagFilterSelectionValue(tagId))
                    .filter(tagId => availableTagIds.has(tagId))
            );
            const prunedExcludedTagFilters = new Set(
                Array.from(excludedTagFilters)
                    .map(tagId => normalizeTagFilterSelectionValue(tagId))
                    .filter(tagId => availableTagIds.has(tagId) && !includedTagFilters.has(tagId))
            );
            selectedTagFilters = includedTagFilters;
            excludedTagFilters = prunedExcludedTagFilters;
        }

        // Load tag list
        async function loadTags() {
            try {
                const response = await fetch('/api/tags');
                const data = await response.json();
                if (data.success) {
                    allTags = data.tags;
                    const selectedBeforePrune = Array.from(selectedTagFilters).join(',');
                    const excludedBeforePrune = Array.from(excludedTagFilters).join(',');
                    pruneAccountTagFilterSelections();
                    saveAccountTagFilterPreference();
                    saveAccountTagExcludeFilterPreference();
                    const selectedAfterPrune = Array.from(selectedTagFilters).join(',');
                    const excludedAfterPrune = Array.from(excludedTagFilters).join(',');
                    renderTagList();
                    updateTagFilter();
                    if (typeof renderImportTagOptions === 'function') {
                        renderImportTagOptions();
                    }
                    if ((selectedBeforePrune !== selectedAfterPrune
                        || excludedBeforePrune !== excludedAfterPrune) && currentGroupId) {
                        refreshVisibleAccountList(true);
                    }
                }
            } catch (error) {
                showToast(I18n.t("Failed to load tags"), 'error');
            }
        }

        function getTagFilterSummaryText() {
            const parts = [];
            if (selectedTagFilters.size) {
                parts.push(I18n.tpl`Yes ${selectedTagFilters.size}`);
            }
            if (excludedTagFilters.size) {
                parts.push(I18n.tpl`None ${excludedTagFilters.size}`);
            }
            return parts.length ? parts.join(' / ') : I18n.t("All tags");
        }

        function updateTagFilterSummary() {
            const triggerText = document.getElementById('tagFilterTriggerText');
            const countBadge = document.getElementById('tagFilterTriggerCount');
            if (!triggerText || !countBadge) return;

            const activeCount = selectedTagFilters.size + excludedTagFilters.size;
            triggerText.textContent = getTagFilterSummaryText();
            countBadge.style.display = activeCount ? 'inline-flex' : 'none';
            countBadge.textContent = activeCount ? String(activeCount) : '';
        }

        function filterTagOptions(keyword = '') {
            tagFilterKeyword = keyword.trim().toLowerCase();
            const dropdown = document.getElementById('tagFilterDropdown');
            const optionsContainer = dropdown?.querySelector('.tag-filter-options');
            filterTagFilterOptions(tagFilterKeyword, optionsContainer);
        }

        function toggleTagFilterDropdown(event) {
            event?.stopPropagation();
            const dropdown = document.getElementById('tagFilterDropdown');
            const searchInput = document.getElementById('tagFilterSearchInput');
            toggleTagFilterDropdownState(dropdown, searchInput, tagFilterKeyword);
        }

        function clearTagFilterSelection(event) {
            event?.stopPropagation();
            selectedTagFilters = new Set();
            excludedTagFilters = new Set();
            handleTagFilterChange();
        }

        function buildAccountTagFilterOptionsHtml() {
            return allTags.map(tag => {
                const tagId = normalizeTagFilterSelectionValue(tag.id);
                if (tagId === null) {
                    return '';
                }
                const included = selectedTagFilters.has(tagId);
                const excluded = excludedTagFilters.has(tagId);
                return I18n.tpl`
                    <div class="tag-filter-option account-tag-filter-option ${included || excluded ? 'is-checked' : ''}"
                         data-tag-id="${tagId}" data-tag-name="${escapeHtml(tag.name)}">
                        <span class="tag-filter-dot" style="background-color: ${tag.color};"></span>
                        <span class="tag-filter-name">${escapeHtml(tag.name)}</span>
                        <div class="tag-filter-state-actions">
                            <button class="tag-filter-state-btn ${included ? 'is-active' : ''}"
                                    type="button" data-tag-filter-state="include" aria-pressed="${included}"
                                    onclick="setAccountTagFilterSelection(${tagId}, 'include', event)">Yes</button>
                            <button class="tag-filter-state-btn ${excluded ? 'is-active' : ''}"
                                    type="button" data-tag-filter-state="exclude" aria-pressed="${excluded}"
                                    onclick="setAccountTagFilterSelection(${tagId}, 'exclude', event)">None</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function syncAccountTagFilterOptions() {
            const dropdown = document.getElementById('tagFilterDropdown');
            const optionsContainer = dropdown?.querySelector('.tag-filter-options');
            if (optionsContainer) {
                optionsContainer.querySelectorAll('.account-tag-filter-option').forEach(option => {
                    const tagId = normalizeTagFilterSelectionValue(option.dataset.tagId);
                    const included = selectedTagFilters.has(tagId);
                    const excluded = excludedTagFilters.has(tagId);
                    option.classList.toggle('is-checked', included || excluded);
                    option.querySelectorAll('[data-tag-filter-state]').forEach(button => {
                        const active = button.dataset.tagFilterState === 'include' ? included : excluded;
                        button.classList.toggle('is-active', active);
                        button.setAttribute('aria-pressed', active ? 'true' : 'false');
                    });
                });
            }
            updateTagFilterSummary();
        }

        // Update tag filter drop-down box
        function updateTagFilter() {
            const container = document.getElementById('tagFilterContainer');
            if (!container) return;

            container.style.display = 'flex';

            const optionsHtml = buildAccountTagFilterOptionsHtml();

            container.innerHTML = I18n.tpl`
                <span class="toolbar-label">Tags</span>
                <div class="tag-filter-dropdown" id="tagFilterDropdown">
                    <button class="tag-filter-trigger" type="button" onclick="toggleTagFilterDropdown(event)">
                        <span class="tag-filter-trigger-text" id="tagFilterTriggerText">${escapeHtml(getTagFilterSummaryText())}</span>
                        <span class="tag-filter-trigger-count" id="tagFilterTriggerCount" style="display: none;"></span>
                        <span class="tag-filter-trigger-caret">▾</span>
                    </button>
                    <div class="tag-filter-panel">
                        <div class="tag-filter-panel-header">
                            <input
                                type="text"
                                id="tagFilterSearchInput"
                                class="tag-filter-search-input"
                                placeholder="Search tags..."
                                oninput="filterTagOptions(this.value)"
                            >
                            <button class="tag-filter-clear-btn" type="button" onclick="clearTagFilterSelection(event)">Clear</button>
                        </div>
                        <p class="tag-filter-hint">Example:<br>Has: A, B → has either tag A or B<br>None: C, D → does not own C nor D at the same time<br>Yes: A, B + No: C, D → (A OR B) AND !C AND !D</p>
                        <div class="tag-filter-options" id="tagFilterOptions">
                            ${optionsHtml}
                            <div class="tag-filter-empty" id="tagFilterEmptyState" style="display: none;">No matching tags</div>
                        </div>
                    </div>
                </div>
            `;

            syncAccountTagFilterOptions();
            filterTagOptions(tagFilterKeyword);
        }

        // Render tag list
        function renderTagList() {
            const listEl = document.getElementById('tagList');
            if (!allTags.length) {
                listEl.innerHTML = I18n.t("<div style=\"text-align: center; color: #999; padding: 20px;\">No tags yet</div>");
                return;
            }

            let html = '';
            allTags.forEach(tag => {
                html += I18n.tpl`
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px; border-bottom: 1px solid #f0f0f0;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span class="tag-badge" style="background-color: ${tag.color};">${escapeHtml(tag.name)}</span>
                        </div>
                        <button class="btn btn-sm btn-danger" onclick="deleteTag(${tag.id})">Delete</button>
                    </div>
                `;
            });
            listEl.innerHTML = html;
        }

        // Create tags
        async function createTag() {
            const nameInput = document.getElementById('newTagName');
            const colorInput = document.getElementById('newTagColor');
            const name = nameInput.value.trim();
            const color = colorInput.value;

            if (!name) {
                showToast(I18n.t("Please enter the label name"), 'error');
                return;
            }

            try {
                const response = await fetch('/api/tags', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, color })
                });
                const data = await response.json();

                if (data.success) {
                    nameInput.value = '';
                    showToast(I18n.t("Label created successfully"), 'success');
                    await loadTags();
                    // Refresh the account list to reload tags (if you add tags while viewing the list, you may not need to refresh the list immediately, but you can refresh for consistency)
                    // But usually adding tags does not affect the current list display unless the account is marked.
                } else {
                    showToast(data.error || I18n.t("Creation failed"), 'error');
                }
            } catch (error) {
                showToast(I18n.t("Failed to create label"), 'error');
            }
        }

        // Delete tag
        async function deleteTag(id) {
            if (!(await showConfirmModal(I18n.t("Are you sure you want to delete this tag?"), { title: I18n.t("Delete tag"), confirmText: I18n.t("Confirm deletion") }))) return;

            try {
                const response = await fetch(`/api/tags/${id}`, { method: 'DELETE' });
                const data = await response.json();

                if (data.success) {
                    showToast(I18n.t("Tag deleted"), 'success');
                    await loadTags();
                    await refreshVisibleAccountList(true);
                } else {
                    showToast(data.error || I18n.t("Delete failed"), 'error');
                }
            } catch (error) {
                showToast(I18n.t("Failed to delete tag"), 'error');
            }
        }
