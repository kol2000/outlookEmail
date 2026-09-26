        /* global escapeHtml, handleApiError, hideModal, showAddAccountModal, showConfirmModal, showGetRefreshTokenModal, showModal, showToast */

        // ==================== Outlook upload account ====================

        const UPLOAD_ACCOUNTS_PAGE_SIZE_DEFAULT = 20;
        const UPLOAD_ACCOUNTS_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
        const UPLOAD_ACCOUNTS_PAGE_SIZE_STORAGE_KEY = 'outlook_upload_account_page_size';
        const UPLOAD_ACCOUNTS_AUTH_STATUS_OPTIONS = ['all', 'authorized', 'unauthorized'];

        const uploadAccountsState = {
            page: 1,
            pageSize: UPLOAD_ACCOUNTS_PAGE_SIZE_DEFAULT,
            keyword: '',
            authStatus: 'all',
            total: 0,
            totalPages: 1,
            loading: false,
            requestSequence: 0,
            editingRowId: null,
            currentData: [],
            selectedIds: new Set(),
            batchAuthQueue: [],
            batchAuthRunning: false,
        };

        let graphAuthState = {
            accountId: null,
            email: '',
            secretLength: 0,
            eventSource: null,
            running: false,
        };

        function normalizeUploadAccountsPageSize(value) {
            const parsed = parseInt(value, 10);
            if (UPLOAD_ACCOUNTS_PAGE_SIZE_OPTIONS.includes(parsed)) {
                return parsed;
            }
            return UPLOAD_ACCOUNTS_PAGE_SIZE_DEFAULT;
        }

        function syncUploadAccountsPageSizeSelect() {
            const select = document.getElementById('uploadAccountsPageSizeSelect');
            if (select) {
                select.value = String(normalizeUploadAccountsPageSize(uploadAccountsState.pageSize));
            }
        }

        function initializeUploadAccountsPageSize() {
            const storedValue = localStorage.getItem(UPLOAD_ACCOUNTS_PAGE_SIZE_STORAGE_KEY);
            const normalizedValue = normalizeUploadAccountsPageSize(
                storedValue === null ? UPLOAD_ACCOUNTS_PAGE_SIZE_DEFAULT : storedValue
            );
            uploadAccountsState.pageSize = normalizedValue;
            if (storedValue !== null && String(normalizedValue) !== storedValue) {
                localStorage.setItem(
                    UPLOAD_ACCOUNTS_PAGE_SIZE_STORAGE_KEY,
                    String(normalizedValue),
                );
            }
            syncUploadAccountsPageSizeSelect();
        }

        function normalizeUploadAccountsAuthStatus(value) {
            const normalized = String(value || '').trim().toLowerCase();
            return UPLOAD_ACCOUNTS_AUTH_STATUS_OPTIONS.includes(normalized)
                ? normalized
                : 'all';
        }

        function syncUploadAccountsAuthStatusFilter() {
            const select = document.getElementById('uploadAccountsAuthStatusFilter');
            if (select) {
                select.value = normalizeUploadAccountsAuthStatus(uploadAccountsState.authStatus);
            }
        }

        function normalizeUploadAccountId(value) {
            const id = Number(value);
            return Number.isFinite(id) && id > 0 ? id : null;
        }

        function getSelectedUploadAccountIds() {
            return Array.from(uploadAccountsState.selectedIds)
                .map(normalizeUploadAccountId)
                .filter(Boolean);
        }

        function syncUploadAccountSelectionUi() {
            const selectedIds = getSelectedUploadAccountIds();
            const bar = document.getElementById('uploadAccountsBatchBar');
            const summary = document.getElementById('uploadAccountsSelectedSummary');
            const selectAll = document.getElementById('uploadAccountsSelectAllVisible');
            const authorizeBtn = document.getElementById('batchAuthorizeUploadAccountsBtn');
            const deleteBtn = document.getElementById('batchDeleteUploadAccountsBtn');
            const visibleCheckboxes = Array.from(
                document.querySelectorAll('#uploadAccountsTableBody .upload-account-select-checkbox')
            );
            const visibleIds = visibleCheckboxes
                .map(cb => normalizeUploadAccountId(cb.value))
                .filter(Boolean);
            const visibleSelectedCount = visibleIds.filter(id => uploadAccountsState.selectedIds.has(id)).length;

            if (bar) {
                bar.style.display = selectedIds.length > 0 || visibleIds.length > 0 ? 'flex' : 'none';
            }
            if (summary) {
                summary.textContent = selectedIds.length
                    ? I18n.tpl`${selectedIds.length} item selected`
                    : I18n.t("No account selected");
            }
            if (selectAll) {
                selectAll.checked = visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;
                selectAll.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleIds.length;
            }
            if (authorizeBtn && authorizeBtn.dataset.loading !== 'true') {
                authorizeBtn.disabled = selectedIds.length === 0 || graphAuthState.running || uploadAccountsState.batchAuthRunning;
                authorizeBtn.textContent = selectedIds.length > 1
                    ? I18n.tpl`Volume licensing (${selectedIds.length})`
                    : I18n.t("Bulk authorization");
            }
            if (deleteBtn && deleteBtn.dataset.loading !== 'true') {
                deleteBtn.disabled = selectedIds.length === 0 || graphAuthState.running || uploadAccountsState.batchAuthRunning;
                deleteBtn.textContent = selectedIds.length > 1
                    ? I18n.tpl`Batch delete (${selectedIds.length})`
                    : I18n.t("Batch deletion");
            }

            visibleCheckboxes.forEach(cb => {
                const id = normalizeUploadAccountId(cb.value);
                cb.checked = id ? uploadAccountsState.selectedIds.has(id) : false;
                cb.disabled = uploadAccountsState.editingRowId !== null
                    || graphAuthState.running
                    || uploadAccountsState.batchAuthRunning;
            });
        }

        function setUploadAccountSelected(accountId, selected) {
            const id = normalizeUploadAccountId(accountId);
            if (!id) return;
            if (selected) {
                uploadAccountsState.selectedIds.add(id);
            } else {
                uploadAccountsState.selectedIds.delete(id);
            }
            syncUploadAccountSelectionUi();
        }

        function toggleSelectVisibleUploadAccounts(forceChecked) {
            const checkboxes = Array.from(
                document.querySelectorAll('#uploadAccountsTableBody .upload-account-select-checkbox')
            );
            if (!checkboxes.length) return;
            const shouldSelect = typeof forceChecked === 'boolean'
                ? forceChecked
                : !checkboxes.every(cb => cb.checked);
            checkboxes.forEach(cb => {
                const id = normalizeUploadAccountId(cb.value);
                if (!id) return;
                if (shouldSelect) {
                    uploadAccountsState.selectedIds.add(id);
                } else {
                    uploadAccountsState.selectedIds.delete(id);
                }
            });
            syncUploadAccountSelectionUi();
        }

        function clearUploadAccountSelection() {
            uploadAccountsState.selectedIds.clear();
            syncUploadAccountSelectionUi();
        }

        function renderAddUploadAccountTagOptions(selectedIds = []) {
            const container = document.getElementById('addUploadAccountTagOptions');
            if (!container || typeof buildTagFilterOptionsHtml !== 'function') return;
            const tags = typeof allTags !== 'undefined' && Array.isArray(allTags) ? allTags : [];
            container.innerHTML = buildTagFilterOptionsHtml(
                tags,
                selectedIds,
                'updateAddUploadAccountTagSummary'
            );
            updateAddUploadAccountTagSummary();
        }

        function updateAddUploadAccountTagSummary() {
            const summaryEl = document.getElementById('addUploadAccountTagTriggerText');
            const countEl = document.getElementById('addUploadAccountTagTriggerCount');
            if (!summaryEl || !countEl) return;
            const container = document.getElementById('addUploadAccountTagOptions');
            const selectedIds = typeof getTagFilterSelectedIds === 'function'
                ? getTagFilterSelectedIds(container)
                : [];
            const tags = typeof allTags !== 'undefined' && Array.isArray(allTags) ? allTags : [];
            const selectedItems = selectedIds.map(id => tags.find(t => t.id === id)).filter(Boolean);
            if (typeof updateTagFilterSummaryText === 'function') {
                updateTagFilterSummaryText(summaryEl, countEl, selectedItems, I18n.t("No tag selected"));
            }
        }

        function toggleAddUploadAccountTagDropdown(event) {
            event?.stopPropagation();
            const dropdown = document.getElementById('addUploadAccountTagDropdown');
            const searchInput = document.getElementById('addUploadAccountTagSearchInput');
            if (typeof toggleTagFilterDropdownState === 'function') {
                toggleTagFilterDropdownState(dropdown, searchInput, '');
            }
        }

        function filterAddUploadAccountTagOptions(keyword) {
            const container = document.getElementById('addUploadAccountTagOptions');
            if (typeof filterTagFilterOptions === 'function') {
                filterTagFilterOptions(keyword, container);
            }
        }

        function clearAddUploadAccountTagSelection(event) {
            event?.stopPropagation();
            const dropdown = document.getElementById('addUploadAccountTagDropdown');
            if (typeof clearTagFilterCheckboxes === 'function') {
                clearTagFilterCheckboxes(dropdown);
            }
            updateAddUploadAccountTagSummary();
        }

        function getAddUploadAccountSelectedTagIds() {
            const container = document.getElementById('addUploadAccountTagOptions');
            return typeof getTagFilterSelectedIds === 'function'
                ? getTagFilterSelectedIds(container)
                : [];
        }

        function prepareAddUploadAccountFormOptions() {
            if (typeof updateGroupSelects === 'function') {
                updateGroupSelects();
            }
            if (typeof loadTags === 'function' && (!Array.isArray(allTags) || !allTags.length)) {
                loadTags().then(() => renderAddUploadAccountTagOptions()).catch(() => {
                    renderAddUploadAccountTagOptions();
                });
            } else {
                renderAddUploadAccountTagOptions();
            }
        }

        function formatUploadAccountAuthorized(isAuthorized) {
            return isAuthorized
                ? I18n.t("<span class=\"upload-accounts-badge upload-accounts-badge--yes\">Authorized</span>")
                : I18n.t("<span class=\"upload-accounts-badge upload-accounts-badge--no\">Unauthorized</span>");
        }

        function formatUploadAccountTags(tags) {
            const safeTags = Array.isArray(tags) ? tags : [];
            if (!safeTags.length) {
                return '-';
            }

            const visibleTags = safeTags.slice(0, 2);
            const hiddenCount = Math.max(0, safeTags.length - visibleTags.length);
            const title = safeTags
                .map(tag => tag && tag.name ? String(tag.name) : '')
                .filter(Boolean)
                .join('、');
            const tagHtml = visibleTags.map(tag => {
                const tagName = tag && tag.name ? String(tag.name) : '';
                const tagColor = tag && tag.color ? String(tag.color) : '#64748b';
                return `
                    <span class="account-status-pill tag upload-accounts-tag-pill"
                        style="--pill-accent: ${escapeHtml(tagColor)}"
                        title="${escapeHtml(tagName)}">${escapeHtml(tagName)}</span>
                `;
            }).join('');
            const moreHtml = hiddenCount > 0
                ? `<span class="account-status-pill outline">+${hiddenCount}</span>`
                : '';

            return `<div class="upload-accounts-tags" title="${escapeHtml(title)}">${tagHtml}${moreHtml}</div>`;
        }

        function getUploadAccountPasswordMask(length) {
            return '*'.repeat(Math.max(6, Number(length) || 0));
        }

        function getUploadAccountEyeIcon(hidden) {
            if (!hidden) {
                return `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M3 3l18 18"></path>
                        <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"></path>
                        <path d="M9.5 5.5A10.5 10.5 0 0 1 12 5c6 0 9.5 7 9.5 7a17.6 17.6 0 0 1-2.1 3"></path>
                        <path d="M6.5 6.5C3.8 8.3 2.5 12 2.5 12s3.5 7 9.5 7a10 10 0 0 0 4.5-1.1"></path>
                    </svg>
                `;
            }
            return `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                </svg>
            `;
        }

        function formatUploadAccountPassword(item) {
            if (!item || !item.has_password) {
                return '-';
            }
            const plainPassword = typeof item.password === 'string' ? item.password : '';
            const maskedPassword = getUploadAccountPasswordMask(item.password_length || plainPassword.length);
            return I18n.tpl`
                <span class="upload-accounts-password" data-password-visible="false">
                    <span class="upload-accounts-password-text upload-accounts-password-mask">${escapeHtml(maskedPassword)}</span>
                    <button class="upload-accounts-password-toggle" type="button"
                        data-upload-account-password="${escapeHtml(plainPassword)}"
                        aria-label="Show password" title="Show password">
                        ${getUploadAccountEyeIcon(true)}
                    </button>
                </span>
            `;
        }

        function getUploadAccountProxyDisplay(proxyUrl) {
            const normalizedProxy = String(proxyUrl || '').trim();
            if (!normalizedProxy) return '';
            try {
                const parsedProxy = new URL(normalizedProxy);
                if (!parsedProxy.host) return I18n.t("Proxy configured");
                parsedProxy.username = '';
                parsedProxy.password = '';
                return `${parsedProxy.protocol}//${parsedProxy.host}`;
            } catch (error) {
                return I18n.t("Proxy configured");
            }
        }

        function formatUploadAccountProxy(proxyUrl) {
            const displayProxy = getUploadAccountProxyDisplay(proxyUrl);
            if (!displayProxy) return '-';
            const escapedProxy = escapeHtml(displayProxy);
            return `<span class="upload-accounts-proxy" title="${escapedProxy}">${escapedProxy}</span>`;
        }

        function renderUploadAccountsRows(items) {
            const tbody = document.getElementById('uploadAccountsTableBody');
            if (!tbody) return;

            if (!Array.isArray(items) || items.length === 0) {
                tbody.innerHTML = I18n.t("<tr><td colspan=\"9\" class=\"upload-accounts-empty\">No data yet</td></tr>");
                syncUploadAccountSelectionUi();
                return;
            }

            tbody.innerHTML = items.map(item => {
                const itemId = item.id ?? '';
                const itemEmail = item.email || '';
                const itemRemark = item.remark || '';
                const itemCreatedAt = item.created_at || '';
                const isEditing = uploadAccountsState.editingRowId === itemId;
                const selectDisabled = uploadAccountsState.editingRowId !== null
                    || graphAuthState.running
                    || uploadAccountsState.batchAuthRunning;
                const checkboxCell = I18n.tpl`
                    <td>
                        <input type="checkbox"
                            class="upload-account-select-checkbox"
                            value="${escapeHtml(String(itemId))}"
                            ${selectDisabled ? 'disabled' : ''}
                            onchange="setUploadAccountSelected(${escapeHtml(String(itemId))}, this.checked)"
                            aria-label="Select ${escapeHtml(itemEmail)}">
                    </td>
                `;

                if (isEditing) {
                    // Edit status
                    return I18n.tpl`
                        <tr class="upload-accounts-row--editing" data-editing-id="${escapeHtml(String(itemId))}">
                            ${checkboxCell}
                            <td class="upload-accounts-cell-mono upload-accounts-cell-right">
                                <input type="text" class="upload-accounts-edit-input"
                                    id="edit-email-${escapeHtml(String(itemId))}"
                                    value="${escapeHtml(itemEmail)}"
                                    placeholder="Mailboxes" autocomplete="off">
                            </td>
                            <td class="upload-accounts-cell-right">
                                <input type="password" class="upload-accounts-edit-input"
                                    id="edit-password-${escapeHtml(String(itemId))}"
                                    placeholder="Leave blank and do not change" autocomplete="off">
                            </td>
                            <td class="upload-accounts-edit-disabled">-</td>
                            <td class="upload-accounts-edit-disabled">-</td>
                            <td class="upload-accounts-cell-mono">${formatUploadAccountProxy(item.proxy_url)}</td>
                            <td>
                                <input type="text" class="upload-accounts-edit-input"
                                    id="edit-remark-${escapeHtml(String(itemId))}"
                                    value="${escapeHtml(itemRemark)}"
                                    placeholder="Notes" autocomplete="off">
                            </td>
                            <td class="upload-accounts-edit-disabled">-</td>
                            <td>
                                <button class="btn btn-sm btn-primary" type="button" onclick="saveRowEdit(${escapeHtml(String(itemId))})">Save changes</button>
                                <button class="btn btn-sm btn-secondary" type="button" onclick="cancelRowEdit()">Cancel</button>
                            </td>
                        </tr>
                    `;
                } else {
                    // Normal display status
                    const authBtnLabel = item.is_authorized ? I18n.t("Reauthorization") : I18n.t("Authorize");
                    const editDisabled = uploadAccountsState.editingRowId !== null
                        || graphAuthState.running
                        || uploadAccountsState.batchAuthRunning;
                    const authBtn = `<button class="btn btn-sm btn-primary" type="button" style="width: 80px;" ${editDisabled ? 'disabled' : ''} data-graph-auth-account-id="${escapeHtml(String(itemId))}" data-graph-auth-email="${escapeHtml(itemEmail)}" data-graph-auth-password-length="${escapeHtml(String(item.password_length || 0))}">${authBtnLabel}</button>`;
                    const editBtn = I18n.tpl`<button class="btn btn-sm btn-secondary" type="button" ${editDisabled ? 'disabled' : ''} onclick="enterRowEditMode(${escapeHtml(String(itemId))}, '${escapeHtml(itemEmail)}', '${escapeHtml(itemRemark)}')">Modification</button>`;
                    const deleteBtn = I18n.tpl`<button class="btn btn-sm btn-danger" type="button" ${editDisabled ? 'disabled' : ''} data-delete-account-id="${escapeHtml(String(itemId))}" data-delete-account-email="${escapeHtml(itemEmail)}">Delete</button>`;
                    return `
                        <tr>
                            ${checkboxCell}
                            <td class="upload-accounts-cell-mono upload-accounts-cell-right">${escapeHtml(itemEmail)}</td>
                            <td class="upload-accounts-cell-mono upload-accounts-cell-right">${formatUploadAccountPassword(item)}</td>
                            <td>${formatUploadAccountAuthorized(item.is_authorized)}</td>
                            <td>${formatUploadAccountTags(item.tags)}</td>
                            <td class="upload-accounts-cell-mono">${formatUploadAccountProxy(item.proxy_url)}</td>
                            <td>${escapeHtml(itemRemark)}</td>
                            <td>${escapeHtml(itemCreatedAt)}</td>
                            <td>${authBtn}${editBtn}${deleteBtn}</td>
                        </tr>
                    `;
                }
            }).join('');
            syncUploadAccountSelectionUi();
        }

        function syncUploadAccountsPagination() {
            const info = document.getElementById('uploadAccountsPageInfo');
            if (info) {
                info.textContent = I18n.tpl`Total ${uploadAccountsState.total} items`;
            }
            const pageText = document.getElementById('uploadAccountsPageText');
            if (pageText) {
                pageText.textContent = I18n.tpl`Page ${uploadAccountsState.page} / ${uploadAccountsState.totalPages}`;
            }
            const prevBtn = document.getElementById('uploadAccountsPrevBtn');
            const nextBtn = document.getElementById('uploadAccountsNextBtn');
            if (prevBtn) {
                prevBtn.disabled = uploadAccountsState.loading || uploadAccountsState.page <= 1;
            }
            if (nextBtn) {
                nextBtn.disabled = uploadAccountsState.loading
                    || uploadAccountsState.page >= uploadAccountsState.totalPages;
            }
            syncUploadAccountsPageSizeSelect();
        }

        function toggleUploadAccountPasswordVisibility(button) {
            const wrapper = button.closest('.upload-accounts-password');
            const textEl = wrapper ? wrapper.querySelector('.upload-accounts-password-text') : null;
            if (!wrapper || !textEl) return;

            const isVisible = wrapper.dataset.passwordVisible === 'true';
            const plainPassword = button.dataset.uploadAccountPassword || '';
            const maskedPassword = getUploadAccountPasswordMask(plainPassword.length);

            wrapper.dataset.passwordVisible = isVisible ? 'false' : 'true';
            textEl.textContent = isVisible ? maskedPassword : plainPassword;
            textEl.classList.toggle('upload-accounts-password-mask', isVisible);
            button.setAttribute('aria-label', isVisible ? I18n.t("Show password") : I18n.t("Hide password"));
            button.setAttribute('title', isVisible ? I18n.t("Show password") : I18n.t("Hide password"));
            button.innerHTML = getUploadAccountEyeIcon(isVisible);
        }

        document.addEventListener('click', (event) => {
            const button = event.target.closest('[data-upload-account-password]');
            if (!button) return;
            toggleUploadAccountPasswordVisibility(button);
        });

        async function loadUploadAccounts() {
            const requestSequence = ++uploadAccountsState.requestSequence;
            const tbody = document.getElementById('uploadAccountsTableBody');
            if (tbody) {
                tbody.innerHTML = I18n.t("<tr><td colspan=\"9\" class=\"upload-accounts-empty\">Loading...</td></tr>");
            }
            uploadAccountsState.loading = true;
            syncUploadAccountsPagination();

            try {
                const params = new URLSearchParams({
                    page: String(uploadAccountsState.page),
                    page_size: String(uploadAccountsState.pageSize),
                    auth_status: uploadAccountsState.authStatus,
                });
                if (uploadAccountsState.keyword) {
                    params.set('keyword', uploadAccountsState.keyword);
                }
                const response = await fetch(`/api/outlook-upload-accounts?${params.toString()}`);
                const data = await response.json();
                if (requestSequence !== uploadAccountsState.requestSequence) return;
                if (data.success) {
                    uploadAccountsState.total = Number(data.total) || 0;
                    uploadAccountsState.totalPages = Math.max(1, Number(data.total_pages) || 1);
                    uploadAccountsState.page = Math.max(1, Number(data.page) || 1);
                    uploadAccountsState.pageSize = normalizeUploadAccountsPageSize(
                        data.page_size || uploadAccountsState.pageSize
                    );
                    uploadAccountsState.currentData = data.items || [];
                    renderUploadAccountsRows(uploadAccountsState.currentData);
                } else {
                    uploadAccountsState.currentData = [];
                    renderUploadAccountsRows([]);
                    handleApiError(data, I18n.t("Failed to load Outlook and upload account"));
                }
            } catch (error) {
                if (requestSequence !== uploadAccountsState.requestSequence) return;
                uploadAccountsState.currentData = [];
                renderUploadAccountsRows([]);
                showToast(I18n.t("Failed to load Outlook upload account: ") + error.message, 'error');
            } finally {
                if (requestSequence === uploadAccountsState.requestSequence) {
                    uploadAccountsState.loading = false;
                    syncUploadAccountsPagination();
                }
            }
        }

        function changeUploadAccountsPage(delta) {
            if (uploadAccountsState.loading) return;
            const target = uploadAccountsState.page + delta;
            if (target < 1 || target > uploadAccountsState.totalPages) return;
            uploadAccountsState.page = target;
            loadUploadAccounts();
        }

        function handleUploadAccountsAuthStatusChange(value) {
            const nextStatus = normalizeUploadAccountsAuthStatus(value);
            if (nextStatus === uploadAccountsState.authStatus) {
                syncUploadAccountsAuthStatusFilter();
                return;
            }
            uploadAccountsState.authStatus = nextStatus;
            uploadAccountsState.page = 1;
            // Clear the selection after changing the filtering conditions to avoid batch operations on old filtering results.
            clearUploadAccountSelection();
            syncUploadAccountsAuthStatusFilter();
            loadUploadAccounts();
        }

        function handleUploadAccountsPageSizeChange(value) {
            const nextPageSize = normalizeUploadAccountsPageSize(value);
            if (nextPageSize === uploadAccountsState.pageSize) {
                syncUploadAccountsPageSizeSelect();
                return;
            }
            uploadAccountsState.pageSize = nextPageSize;
            uploadAccountsState.page = 1;
            // Changes in paging granularity will change the visible result set, clear the selection to avoid misoperations
            clearUploadAccountSelection();
            localStorage.setItem(
                UPLOAD_ACCOUNTS_PAGE_SIZE_STORAGE_KEY,
                String(nextPageSize),
            );
            syncUploadAccountsPageSizeSelect();
            loadUploadAccounts();
        }

        function searchUploadAccounts() {
            const input = document.getElementById('uploadAccountsSearch');
            const nextKeyword = input ? input.value.trim() : '';
            if (nextKeyword === uploadAccountsState.keyword) {
                uploadAccountsState.page = 1;
                loadUploadAccounts();
                return;
            }
            uploadAccountsState.keyword = nextKeyword;
            uploadAccountsState.page = 1;
            // Clear the selection after the search conditions change, and the batch operation is only for the current filtered results.
            clearUploadAccountSelection();
            loadUploadAccounts();
        }

        function reloadUploadAccounts() {
            loadUploadAccounts();
        }

        function showOutlookUploadAccountsModal() {
            uploadAccountsState.page = 1;
            uploadAccountsState.keyword = '';
            uploadAccountsState.authStatus = 'all';
            uploadAccountsState.selectedIds.clear();
            uploadAccountsState.batchAuthQueue = [];
            uploadAccountsState.batchAuthRunning = false;
            const input = document.getElementById('uploadAccountsSearch');
            if (input) input.value = '';
            initializeUploadAccountsPageSize();
            syncUploadAccountsAuthStatusFilter();
            resetGraphAuthPanel();
            clearAddAccountForm();
            prepareAddUploadAccountFormOptions();
            showModal('outlookUploadAccountsModal');
            loadUploadAccounts();
        }

        function hideOutlookUploadAccountsModal() {
            uploadAccountsState.requestSequence += 1;
            uploadAccountsState.loading = false;
            if (graphAuthState.eventSource) {
                graphAuthState.eventSource.close();
                graphAuthState.eventSource = null;
            }
            graphAuthState.running = false;
            uploadAccountsState.batchAuthQueue = [];
            uploadAccountsState.batchAuthRunning = false;
            hideModal('outlookUploadAccountsModal');
        }

        function openBatchImportFromUploadGuide() {
            hideOutlookUploadAccountsModal();
            if (typeof showAddAccountModal === 'function') {
                showAddAccountModal();
            }
        }

        function openOauthSaveFromUploadGuide() {
            hideOutlookUploadAccountsModal();
            if (typeof showGetRefreshTokenModal === 'function') {
                showGetRefreshTokenModal();
            }
        }

        // ==================== Add upload account ====================

        function toggleAddAccountPanel() {
            const container = document.getElementById('addAccountFormContainer');
            const icon = document.getElementById('toggleAddPanelIcon');
            if (!container || !icon) return;

            const isCollapsed = container.classList.toggle('is-collapsed');
            icon.textContent = isCollapsed ? '▶' : '▼';
        }

        function clearAddAccountForm() {
            const prefix = document.getElementById('addUploadAccountEmailPrefix');
            const domain = document.getElementById('addUploadAccountEmailDomain');
            const password = document.getElementById('addUploadAccountPassword');
            const remark = document.getElementById('addUploadAccountRemark');
            const proxy = document.getElementById('addUploadAccountProxyUrl');
            if (prefix) prefix.value = '';
            if (domain) domain.value = '@outlook.com';
            if (password) password.value = '';
            if (remark) remark.value = '';
            if (proxy) proxy.value = '';
            document.getElementById('addUploadAccountTagDropdown')?.classList.remove('open');
            renderAddUploadAccountTagOptions();
            if (typeof updateGroupSelects === 'function') {
                updateGroupSelects();
            }
        }

        async function submitAddUploadAccount() {
            const emailPrefix = document.getElementById('addUploadAccountEmailPrefix').value.trim();
            const emailDomain = document.getElementById('addUploadAccountEmailDomain').value;
            const password = document.getElementById('addUploadAccountPassword').value.trim();
            const remark = document.getElementById('addUploadAccountRemark').value.trim();
            const groupId = parseInt(document.getElementById('addUploadAccountGroupSelect')?.value || '0', 10) || 1;
            const proxyUrl = document.getElementById('addUploadAccountProxyUrl')?.value.trim() || '';
            const tagIds = getAddUploadAccountSelectedTagIds();

            if (!emailPrefix) {
                showToast(I18n.t("Please enter email prefix"), 'error');
                return;
            }
            if (!password) {
                showToast(I18n.t("Please enter password"), 'error');
                return;
            }

            const email = emailPrefix + emailDomain;

            const btn = document.getElementById('submitAddUploadAccountBtn');
            if (btn) btn.disabled = true;

            try {
                const response = await fetch('/api/outlook-upload-accounts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email,
                        password,
                        remark,
                        group_id: groupId,
                        proxy_url: proxyUrl,
                        tag_ids: tagIds,
                    })
                });
                const data = await response.json();
                if (data.success) {
                    showToast(I18n.t("Added successfully"), 'success');
                    clearAddAccountForm();
                    reloadUploadAccounts();
                } else {
                    handleApiError(data, I18n.t("Add failed"));
                }
            } catch (error) {
                showToast(I18n.t("Add failed: ") + error.message, 'error');
            } finally {
                if (btn) btn.disabled = false;
            }
        }

        // ==================== Modify upload account ====================

        function enterRowEditMode(accountId, email, remark) {
            if (uploadAccountsState.editingRowId !== null) {
                showToast(I18n.t("Please complete the current edit first"), 'warning');
                return;
            }
            uploadAccountsState.editingRowId = accountId;
            renderUploadAccountsRows(uploadAccountsState.currentData);

            // Focus on the note input box
            setTimeout(() => {
                const remarkInput = document.getElementById(`edit-remark-${accountId}`);
                if (remarkInput) remarkInput.focus();
            }, 50);
        }

        function cancelRowEdit() {
            uploadAccountsState.editingRowId = null;
            renderUploadAccountsRows(uploadAccountsState.currentData);
        }

        async function saveRowEdit(accountId) {
            const email = document.getElementById(`edit-email-${accountId}`)?.value.trim();
            const password = document.getElementById(`edit-password-${accountId}`)?.value.trim();
            const remark = document.getElementById(`edit-remark-${accountId}`)?.value.trim();

            if (!accountId) {
                showToast(I18n.t("The account is not selected and cannot be modified."), 'error');
                return;
            }
            if (!email) {
                showToast(I18n.t("Please enter your email address"), 'error');
                return;
            }

            const payload = { email, remark };
            // Leaving the password blank means keeping the original password and not issuing this field.
            if (password !== '') {
                payload.password = password;
            }

            // Disable save button
            const saveBtn = document.querySelector(`[onclick="saveRowEdit(${accountId})"]`);
            if (saveBtn) saveBtn.disabled = true;

            try {
                const response = await fetch(`/api/outlook-upload-accounts/${encodeURIComponent(accountId)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                const data = await response.json();
                if (data.success) {
                    showToast(I18n.t("Modification successful"), 'success');
                    uploadAccountsState.editingRowId = null;
                    reloadUploadAccounts();
                } else {
                    handleApiError(data, I18n.t("Modification failed"));
                }
            } catch (error) {
                showToast(I18n.t("Modification failed: ") + error.message, 'error');
            } finally {
                if (saveBtn) saveBtn.disabled = false;
            }
        }

        // ==================== Outlook automatic OAuth authorization (GraphAPI / IMAP) ====================

        const GRAPH_AUTH_LOG_PLACEHOLDER = I18n.t("After clicking \"Authorize/Reauthorize\" the account, the authorization log will be displayed here.");
        const GRAPH_AUTH_MODE_LABELS = {
            imap: I18n.t("IMAP authorization"),
            graph: 'GraphAPI',
        };

        function setGraphAuthStatus(state, text) {
            const statusEl = document.getElementById('graphAuthStatus');
            if (!statusEl) return;
            statusEl.dataset.state = state;
            statusEl.textContent = text;
        }

        function resetGraphAuthPanel() {
            if (graphAuthState.eventSource) {
                graphAuthState.eventSource.close();
                graphAuthState.eventSource = null;
            }
            graphAuthState.accountId = null;
            graphAuthState.email = '';
            graphAuthState.secretLength = 0;
            graphAuthState.running = false;
            const logEl = document.getElementById('graphAuthLog');
            if (logEl) logEl.textContent = GRAPH_AUTH_LOG_PLACEHOLDER;
            setGraphAuthStatus('idle', I18n.t("idle"));
        }

        function setUploadAuthButtonsDisabled(disabled) {
            document.querySelectorAll('#uploadAccountsTableBody [data-graph-auth-account-id]').forEach(btn => {
                btn.disabled = disabled;
            });
            syncUploadAccountSelectionUi();
        }

        function continueBatchAuthQueue() {
            if (!uploadAccountsState.batchAuthRunning) {
                return;
            }
            const next = uploadAccountsState.batchAuthQueue.shift();
            if (!next) {
                uploadAccountsState.batchAuthRunning = false;
                appendGraphAuthLog('');
                appendGraphAuthLog(I18n.t("Bulk authorization queue completed"));
                setGraphAuthStatus('success', I18n.t("Batch completion"));
                const authorizeBtn = document.getElementById('batchAuthorizeUploadAccountsBtn');
                if (authorizeBtn) {
                    authorizeBtn.dataset.loading = 'false';
                }
                setUploadAuthButtonsDisabled(false);
                loadUploadAccounts();
                return;
            }
            const remaining = uploadAccountsState.batchAuthQueue.length;
            appendGraphAuthLog('');
            appendGraphAuthLog(I18n.tpl`Bulk authorization: start processing ${next.email || next.accountId} (remaining ${remaining})`);
            startGraphAuthForAccount(next.accountId, next.email, next.passwordLength, { fromBatch: true });
        }

        function appendGraphAuthLog(message) {
            const logEl = document.getElementById('graphAuthLog');
            if (!logEl) return;

            const timestamp = new Date().toLocaleTimeString(I18n.language, { hour12: false });
            logEl.textContent += `\n[${timestamp}] ${message}`;
            logEl.scrollTop = logEl.scrollHeight;
        }

        function getGraphAuthMode() {
            const checked = document.querySelector('input[name="graphAuthMode"]:checked');
            // Default GraphAPI; only use IMAP when IMAP is explicitly selected
            return checked && checked.value === 'imap' ? 'imap' : 'graph';
        }

        function getGraphAuthModeLabel(mode) {
            return GRAPH_AUTH_MODE_LABELS[mode] || GRAPH_AUTH_MODE_LABELS.graph;
        }

        async function startGraphAuthForAccount(accountId, email, passwordLength, options = {}) {
            const fromBatch = !!options.fromBatch;
            if (graphAuthState.running) {
                showToast(I18n.t("Authorization in progress, please wait for the current task to be completed."), 'warning');
                return;
            }
            if (!accountId) {
                showToast(I18n.t("Please select the account to be authorized"), 'error');
                return;
            }

            if (graphAuthState.eventSource) {
                graphAuthState.eventSource.close();
                graphAuthState.eventSource = null;
            }

            graphAuthState.accountId = accountId;
            graphAuthState.email = email;
            graphAuthState.secretLength = Number(passwordLength) || 0;
            graphAuthState.running = true;
            const authMode = getGraphAuthMode();
            const authModeLabel = getGraphAuthModeLabel(authMode);

            setUploadAuthButtonsDisabled(true);
            setGraphAuthStatus('running', fromBatch ? I18n.t("Batch authorization in progress") : I18n.t("Authorizing"));

            const logEl = document.getElementById('graphAuthLog');
            if (logEl && !fromBatch) {
                logEl.textContent = I18n.tpl`Start ${authModeLabel} OAuth authorization process...`;
            } else if (logEl && fromBatch && !String(logEl.textContent || '').includes(I18n.t("Bulk authorization"))) {
                logEl.textContent = I18n.tpl`Start batch ${authModeLabel} OAuth authorization...`;
            }
            const startTime = Date.now();

            const finishAuth = (state, statusText) => {
                graphAuthState.running = false;
                if (fromBatch || uploadAccountsState.batchAuthRunning) {
                    setGraphAuthStatus(state, statusText);
                    // The batch queue continues; the button status is restored uniformly when the queue ends.
                    continueBatchAuthQueue();
                    return;
                }
                setUploadAuthButtonsDisabled(false);
                setGraphAuthStatus(state, statusText);
            };

            try {
                appendGraphAuthLog(I18n.t("Email: ") + email);
                appendGraphAuthLog(I18n.t("Password: ") + '*'.repeat(Math.max(6, graphAuthState.secretLength)));
                appendGraphAuthLog(I18n.t("Authorization mode: ") + authModeLabel);
                appendGraphAuthLog('');
                appendGraphAuthLog(I18n.t("Creating authorization task..."));
                appendGraphAuthLog('');

                const response = await fetch('/api/oauth/graph-extract-token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        account_id: accountId,
                        mode: authMode
                    })
                });

                const data = await response.json();
                if (!response.ok || !data.success || !data.stream_url) {
                    appendGraphAuthLog(I18n.t("Failed to create authorization task: ") + (data.error || I18n.t("Unknown error")));
                    showToast(authModeLabel + I18n.t(" Authorization failed: ") + (data.error || I18n.t("Unknown error")), 'error');
                    finishAuth('error', I18n.t("Failure"));
                    return;
                }

                appendGraphAuthLog(I18n.t("The authorization task has been created, waiting for the backend log..."));
                graphAuthState.eventSource = new EventSource(data.stream_url);
                graphAuthState.eventSource.onmessage = (event) => {
                    let payload;
                    try {
                        payload = JSON.parse(event.data);
                    } catch (parseError) {
                        appendGraphAuthLog(event.data);
                        return;
                    }

                    if (payload.type === 'start' && payload.message) {
                        appendGraphAuthLog(payload.message);
                    } else if (payload.type === 'log') {
                        appendGraphAuthLog(payload.message || '');
                    } else if (payload.type === 'success') {
                        appendGraphAuthLog('');
                        appendGraphAuthLog(I18n.t("Authorization successful, saved to official account"));
                        appendGraphAuthLog('Client ID: ' + (payload.client_id || '-'));
                        appendGraphAuthLog(payload.created ? I18n.t("Save method: Add official account") : I18n.t("Save method: Update existing official account"));
                        showToast(getGraphAuthModeLabel(payload.mode || authMode) + I18n.t(" Authorization successful, saved to official account"), 'success');
                    } else if (payload.type === 'error') {
                        appendGraphAuthLog('');
                        appendGraphAuthLog(I18n.t("Authorization failed: ") + (payload.message || I18n.t("Unknown error")));
                        if (payload.details) {
                            appendGraphAuthLog(payload.details);
                        }
                        showToast(getGraphAuthModeLabel(payload.mode || authMode) + I18n.t(" Authorization failed: ") + (payload.message || I18n.t("Unknown error")), 'error');
                    } else if (payload.type === 'complete') {
                        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                        appendGraphAuthLog('');
                        appendGraphAuthLog(I18n.t("Time consuming: ") + elapsed + I18n.t(" seconds"));
                        if (graphAuthState.eventSource) {
                            graphAuthState.eventSource.close();
                            graphAuthState.eventSource = null;
                        }
                        finishAuth(payload.success ? 'success' : 'error', payload.success ? I18n.t("Success") : I18n.t("Failure"));
                        if (payload.success && !fromBatch && !uploadAccountsState.batchAuthRunning) {
                            setTimeout(() => {
                                loadUploadAccounts();
                            }, 1000);
                        }
                    }
                };
                graphAuthState.eventSource.onerror = () => {
                    appendGraphAuthLog(I18n.t("Authorization log connection interrupted"));
                    if (graphAuthState.eventSource) {
                        graphAuthState.eventSource.close();
                        graphAuthState.eventSource = null;
                    }
                    finishAuth('error', I18n.t("Connection interrupted"));
                };
            } catch (error) {
                appendGraphAuthLog('');
                appendGraphAuthLog(I18n.t("Exception information: ") + error.message);

                showToast(I18n.t("Authorization request failed: ") + error.message, 'error');
                finishAuth('error', I18n.t("Failure"));
            }
        }

        document.addEventListener('click', (event) => {
            const button = event.target.closest('[data-graph-auth-account-id]');
            if (!button) return;
            if (uploadAccountsState.batchAuthRunning) {
                showToast(I18n.t("Batch authorization is in progress, please wait for completion"), 'warning');
                return;
            }
            startGraphAuthForAccount(
                Number(button.dataset.graphAuthAccountId),
                button.dataset.graphAuthEmail || '',
                Number(button.dataset.graphAuthPasswordLength) || 0
            );
        });

        async function authorizeSelectedUploadAccounts() {
            if (graphAuthState.running || uploadAccountsState.batchAuthRunning) {
                showToast(I18n.t("Authorization in progress, please wait for the current task to be completed."), 'warning');
                return;
            }
            const selectedIds = getSelectedUploadAccountIds();
            if (!selectedIds.length) {
                showToast(I18n.t("Please select the account to be authorized first"), 'error');
                return;
            }

            const queue = selectedIds.map(accountId => {
                const item = (uploadAccountsState.currentData || []).find(row => Number(row.id) === accountId) || {};
                return {
                    accountId,
                    email: item.email || '',
                    passwordLength: item.password_length || 0,
                };
            });

            if (!(await showConfirmModal(
                I18n.tpl`Are you sure you want to serially authorize the selected ${queue.length} accounts according to the current authorization mode?`,
                { title: I18n.t("Bulk authorization"), confirmText: I18n.t("Start authorization"), danger: false }
            ))) {
                return;
            }

            uploadAccountsState.batchAuthQueue = queue;
            uploadAccountsState.batchAuthRunning = true;
            const authorizeBtn = document.getElementById('batchAuthorizeUploadAccountsBtn');
            if (authorizeBtn) {
                authorizeBtn.dataset.loading = 'true';
                authorizeBtn.disabled = true;
                authorizeBtn.textContent = I18n.t("Batch authorization in progress...");
            }
            syncUploadAccountSelectionUi();
            const logEl = document.getElementById('graphAuthLog');
            if (logEl) {
                logEl.textContent = I18n.tpl`Start batch authorization, total ${queue.length} accounts (serial)`;
            }
            continueBatchAuthQueue();
        }

        async function deleteUploadAccount(accountId, email) {
            if (!(await showConfirmModal(I18n.tpl`Are you sure you want to delete account ${email || ''}? This operation is irreversible.`, { title: I18n.t("Delete upload account"), confirmText: I18n.t("Confirm deletion") }))) {
                return;
            }

            try {
                const response = await fetch(`/api/outlook-upload-accounts/${encodeURIComponent(accountId)}`, {
                    method: 'DELETE'
                });
                const data = await response.json();
                if (data.success) {
                    showToast(I18n.t("Deletion successful"), 'success');
                    uploadAccountsState.selectedIds.delete(normalizeUploadAccountId(accountId));
                    loadUploadAccounts();
                } else {
                    handleApiError(data, I18n.t("Delete failed"));
                }
            } catch (error) {
                showToast(I18n.t("Delete failed: ") + error.message, 'error');
            }
        }

        async function deleteSelectedUploadAccounts() {
            if (graphAuthState.running || uploadAccountsState.batchAuthRunning) {
                showToast(I18n.t("Authorization in progress, please delete later"), 'warning');
                return;
            }
            const accountIds = getSelectedUploadAccountIds();
            if (!accountIds.length) {
                showToast(I18n.t("Please select the account you want to delete first"), 'error');
                return;
            }
            if (!(await showConfirmModal(
                I18n.tpl`Are you sure you want to delete the selected ${accountIds.length} upload accounts? This operation is irreversible.`,
                { title: I18n.t("Delete upload accounts in batches"), confirmText: I18n.t("Confirm deletion") }
            ))) {
                return;
            }

            const deleteBtn = document.getElementById('batchDeleteUploadAccountsBtn');
            if (deleteBtn) {
                deleteBtn.dataset.loading = 'true';
                deleteBtn.disabled = true;
                deleteBtn.textContent = I18n.t("Deleting...");
            }

            try {
                const response = await fetch('/api/outlook-upload-accounts/batch-delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ account_ids: accountIds }),
                });
                const data = await response.json();
                if (data.success) {
                    showToast(data.message || I18n.tpl`${data.deleted || accountIds.length} accounts deleted`, 'success');
                    accountIds.forEach(id => uploadAccountsState.selectedIds.delete(id));
                    loadUploadAccounts();
                } else {
                    handleApiError(data, I18n.t("Batch deletion failed"));
                }
            } catch (error) {
                showToast(I18n.t("Batch deletion failed: ") + error.message, 'error');
            } finally {
                if (deleteBtn) {
                    deleteBtn.dataset.loading = 'false';
                }
                syncUploadAccountSelectionUi();
            }
        }

        function exportSelectedUploadAccounts() {
            const accountIds = getSelectedUploadAccountIds();
            if (!accountIds.length) {
                showToast(I18n.t("Please select the account to be exported first"), 'error');
                return;
            }
            startUploadAccountExport(accountIds);
        }

        document.addEventListener('click', (event) => {
            const button = event.target.closest('[data-delete-account-id]');
            if (!button) return;
            deleteUploadAccount(
                Number(button.dataset.deleteAccountId),
                button.dataset.deleteAccountEmail || ''
            );
        });

        // ==================== Join automatic authorization from the official account ====================

        async function queueAccountForOutlookAutoAuth(accountId, email) {
            if (!Number.isFinite(accountId) || accountId <= 0) {
                showToast(I18n.t("The account information is invalid and automatic authorization cannot be added."), 'error');
                return;
            }
            try {
                const response = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/outlook-auto-auth`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                });
                const data = await response.json();
                if (data.success) {
                    const msg = data.status === 'updated'
                        ? I18n.tpl`Automatic authorization has been added again: ${data.email || email || ''}`
                        : I18n.tpl`Automatic authorization has been added: ${data.email || email || ''}`;
                    showToast(msg, 'success');
                    const modal = document.getElementById('outlookUploadAccountsModal');
                    if (modal && modal.classList.contains('show')) {
                        loadUploadAccounts();
                    }
                } else {
                    handleApiError(data, I18n.t("Failed to join automatic authorization"));
                }
            } catch (error) {
                showToast(I18n.t("Failed to join automatic authorization: ") + error.message, 'error');
            }
        }

        window.queueAccountForOutlookAutoAuth = queueAccountForOutlookAutoAuth;
        window.setUploadAccountSelected = setUploadAccountSelected;
        window.toggleSelectVisibleUploadAccounts = toggleSelectVisibleUploadAccounts;
        window.clearUploadAccountSelection = clearUploadAccountSelection;
        window.authorizeSelectedUploadAccounts = authorizeSelectedUploadAccounts;
        window.deleteSelectedUploadAccounts = deleteSelectedUploadAccounts;
        window.exportSelectedUploadAccounts = exportSelectedUploadAccounts;
        window.toggleAddUploadAccountTagDropdown = toggleAddUploadAccountTagDropdown;
        window.filterAddUploadAccountTagOptions = filterAddUploadAccountTagOptions;
        window.clearAddUploadAccountTagSelection = clearAddUploadAccountTagSelection;
        window.updateAddUploadAccountTagSummary = updateAddUploadAccountTagSummary;

        document.addEventListener('click', (event) => {
            if (!event.target.closest('#addUploadAccountTagDropdown')) {
                document.getElementById('addUploadAccountTagDropdown')?.classList.remove('open');
            }
        });
