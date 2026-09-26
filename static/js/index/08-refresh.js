        /* global closeAccountActionMenus, closeFullscreenEmail, closeMobilePanels, closeNavbarActionsMenu, closeTagFilterDropdown, currentGroupId, escapeHtml, formatDate, handleApiError, hideModal, invalidateAccountCaches, loadGroups, loadAccountsByGroup, markCurrentReleaseNoticeSeen, refreshVisibleAccountList, resetSelectedAccountViewIfDeleted, showEditAccountModal, showModal, showToast, updateModalBodyState */

        // ==================== Token refresh management ====================

        const refreshModalState = {
            query: '',
            status: 'all',
            page: 1,
            pageSize: 200,
            total: 0,
            items: [],
            stats: null,
            currentRefreshingAccountId: null,
            searchTimer: 0,
            eventSource: null,
            isRunning: false,
            stopRequested: false,
            runtimeLogs: [],
            selectedAccountIds: new Set(),
            selectionMode: false,
            selectionAnchorId: null,
            selectionDragState: null,
            selectionSuppressClickUntil: 0,
        };
        const REFRESH_PAGE_SIZE_STORAGE_KEY = 'outlook_refresh_page_size';
        const REFRESH_PAGE_SIZE_DEFAULT = 200;
        const REFRESH_PAGE_SIZE_MAX = 10000;

        function getRefreshStatusMeta(status) {
            switch (String(status || '').toLowerCase()) {
                case 'running':
                    return { label: I18n.t("Refreshing"), className: 'running' };
                case 'success':
                    return { label: I18n.t("Success"), className: 'success' };
                case 'failed':
                    return { label: I18n.t("Failure"), className: 'failed' };
                case 'partial_failed':
                    return { label: I18n.t("Partial failure"), className: 'partial-failed' };
                case 'never':
                    return { label: I18n.t("Never refreshed"), className: 'never' };
                default:
                    return { label: I18n.t("Not executed"), className: 'never' };
            }
        }

        function renderRefreshStatusBadge(status, isRunning = false) {
            const meta = isRunning ? getRefreshStatusMeta('running') : getRefreshStatusMeta(status);
            return `<span class="refresh-status-pill ${meta.className}">${meta.label}</span>`;
        }

        function closeRefreshEventSource(source = refreshModalState.eventSource) {
            if (!source) {
                return;
            }
            try {
                source.close();
            } catch (error) {
                console.warn(I18n.t("Failed to close Token and refresh EventSource:"), error);
            }
            if (refreshModalState.eventSource === source) {
                refreshModalState.eventSource = null;
            }
        }

        function setRefreshSnapshotCounts(total = 0, success = 0, failed = 0) {
            const totalEl = document.getElementById('totalRefreshCount');
            const successEl = document.getElementById('successRefreshCount');
            const failedEl = document.getElementById('failedRefreshCount');

            if (totalEl) {
                totalEl.textContent = String(Math.max(0, Number(total || 0)));
            }
            if (successEl) {
                successEl.textContent = String(Math.max(0, Number(success || 0)));
            }
            if (failedEl) {
                failedEl.textContent = String(Math.max(0, Number(failed || 0)));
            }
        }

        function syncRefreshActionButtons() {
            const refreshAllBtn = document.getElementById('refreshAllBtn');
            if (refreshAllBtn) {
                refreshAllBtn.disabled = refreshModalState.isRunning;
                refreshAllBtn.textContent = refreshModalState.isRunning
                    ? (refreshModalState.stopRequested ? I18n.t("Stopping...") : I18n.t("Refreshing..."))
                    : I18n.t("Full refresh");
            }

            const stopRefreshBtn = document.getElementById('stopRefreshBtn');
            if (stopRefreshBtn) {
                stopRefreshBtn.hidden = !refreshModalState.isRunning;
                stopRefreshBtn.disabled = !refreshModalState.isRunning || refreshModalState.stopRequested;
                stopRefreshBtn.textContent = refreshModalState.stopRequested ? I18n.t("Stopping...") : I18n.t("Stop task");
            }

            const retryFailedBtn = document.getElementById('retryFailedBtn');
            if (retryFailedBtn) {
                retryFailedBtn.disabled = refreshModalState.isRunning;
                retryFailedBtn.textContent = I18n.t("Retry failed");
            }

            syncRefreshBatchControls();
            syncRefreshPaginationControls();
        }

        function updateRefreshLogSummary(text = I18n.t("No task log yet")) {
            const summaryEl = document.getElementById('refreshLogsSummary');
            if (summaryEl) {
                summaryEl.textContent = text;
            }
        }

        function renderRefreshRuntimeLogs() {
            const container = document.getElementById('refreshLogsList');
            if (!container) {
                return;
            }
            if (!refreshModalState.runtimeLogs.length) {
                container.innerHTML = I18n.t("<div class=\"refresh-log-empty\">No task log yet</div>");
                return;
            }

            container.innerHTML = refreshModalState.runtimeLogs.map(log => `
                <article class="refresh-log-item refresh-log-item--${escapeHtml(log.level || 'info')}">
                    <div class="refresh-log-item__head">
                        <strong class="refresh-log-item__title">${escapeHtml(log.title || '-')}</strong>
                        <span class="refresh-log-item__time">${escapeHtml(log.time || '-')}</span>
                    </div>
                    ${log.detail ? `<div class="refresh-log-item__detail">${escapeHtml(log.detail)}</div>` : ''}
                </article>
            `).join('');
        }

        function appendRefreshRuntimeLog(level, title, detail = '') {
            refreshModalState.runtimeLogs.unshift({
                level: String(level || 'info').toLowerCase(),
                title: String(title || '').trim() || I18n.t("Mission update"),
                detail: String(detail || '').trim(),
                time: new Date().toLocaleTimeString(I18n.language, {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                }),
            });
            if (refreshModalState.runtimeLogs.length > 300) {
                refreshModalState.runtimeLogs.length = 300;
            }
            renderRefreshRuntimeLogs();
        }

        function resetRefreshModalRuntime(force = false) {
            if (refreshModalState.searchTimer) {
                window.clearTimeout(refreshModalState.searchTimer);
                refreshModalState.searchTimer = 0;
            }
            if (refreshModalState.isRunning && !force) {
                syncRefreshActionButtons();
                renderRefreshRuntimeLogs();
                return;
            }
            closeRefreshEventSource();
            refreshModalState.currentRefreshingAccountId = null;
            refreshModalState.isRunning = false;
            refreshModalState.stopRequested = false;
            syncRefreshActionButtons();
        }

        function updateRefreshStatusFilterButtons() {
            document.querySelectorAll('#refreshModal .refresh-filter-chip').forEach(btn => {
                btn.classList.toggle('is-active', btn.dataset.status === refreshModalState.status);
            });
        }

        function normalizeRefreshPageSize(value) {
            const parsed = parseInt(value, 10);
            if (!Number.isFinite(parsed)) {
                return REFRESH_PAGE_SIZE_DEFAULT;
            }
            return Math.max(1, Math.min(parsed, REFRESH_PAGE_SIZE_MAX));
        }

        function getRefreshTotalPages() {
            const pageSize = normalizeRefreshPageSize(refreshModalState.pageSize);
            const total = Math.max(0, Number(refreshModalState.total || 0));
            return Math.max(1, Math.ceil(total / pageSize));
        }

        function getRefreshPaginationMarkup() {
            return I18n.tpl`
                <div class="refresh-pagination" aria-label="Token refresh management page">
                    <select id="refreshPageSizeSelect" class="refresh-pagination__select"
                        onchange="handleRefreshPageSizeChange(this.value)">
                        <option value="100">100 per page</option>
                        <option value="200" selected>200 per page</option>
                        <option value="500">500 per page</option>
                        <option value="1000">1000 per page</option>
                        <option value="2000">2000 per page</option>
                        <option value="5000">5000 per page</option>
                        <option value="10000">10000 per page</option>
                    </select>
                    <div class="refresh-pagination__controls">
                        <button class="refresh-pagination__btn" type="button" id="refreshPrevPageBtn"
                            onclick="changeRefreshPage(-1)">Previous page</button>
                        <label class="refresh-pagination__page" for="refreshPageInput">
                            <span>No.</span>
                            <input type="number" id="refreshPageInput" min="1" value="1"
                                onchange="goToRefreshPage(this.value)"
                                onkeydown="handleRefreshPageInputKeydown(event)">
                            <span id="refreshTotalPagesText">/ 1 page</span>
                        </label>
                        <button class="refresh-pagination__btn" type="button" id="refreshNextPageBtn"
                            onclick="changeRefreshPage(1)">Next page</button>
                    </div>
                </div>
            `;
        }

        function ensureRefreshPaginationControls() {
            if (document.getElementById('refreshPageSizeSelect')) {
                return;
            }

            const listActions = document.querySelector('#refreshModal .refresh-list-panel__actions');
            const mount = document.getElementById('refreshPaginationMount');
            if (mount && listActions?.contains(mount)) {
                mount.innerHTML = getRefreshPaginationMarkup();
                return;
            }
            if (listActions) {
                listActions.insertAdjacentHTML('afterbegin', getRefreshPaginationMarkup());
                return;
            }

            if (mount) {
                mount.innerHTML = getRefreshPaginationMarkup();
                return;
            }

            const toolbarActions = document.querySelector('#refreshModal .refresh-toolbar__actions');
            if (toolbarActions) {
                toolbarActions.insertAdjacentHTML('beforebegin', getRefreshPaginationMarkup());
            }
        }

        function syncRefreshPageSizeSelect() {
            const select = document.getElementById('refreshPageSizeSelect');
            if (!select) {
                return;
            }
            const pageSize = normalizeRefreshPageSize(refreshModalState.pageSize);
            const hasMatchingOption = Array.from(select.options)
                .some(option => option.value === String(pageSize));
            if (!hasMatchingOption) {
                refreshModalState.pageSize = REFRESH_PAGE_SIZE_DEFAULT;
            }
            select.value = String(normalizeRefreshPageSize(refreshModalState.pageSize));
        }

        function syncRefreshPaginationControls() {
            refreshModalState.page = Math.max(1, parseInt(refreshModalState.page, 10) || 1);
            refreshModalState.pageSize = normalizeRefreshPageSize(refreshModalState.pageSize);
            syncRefreshPageSizeSelect();

            const totalPages = getRefreshTotalPages();
            const visiblePage = Math.min(refreshModalState.page, totalPages);
            const pageInput = document.getElementById('refreshPageInput');
            if (pageInput) {
                pageInput.value = String(visiblePage);
                pageInput.max = String(totalPages);
                pageInput.disabled = refreshModalState.isRunning;
            }

            const totalPagesText = document.getElementById('refreshTotalPagesText');
            if (totalPagesText) {
                totalPagesText.textContent = I18n.tpl`/${totalPages} page`;
            }

            const prevBtn = document.getElementById('refreshPrevPageBtn');
            const nextBtn = document.getElementById('refreshNextPageBtn');
            if (prevBtn) {
                prevBtn.disabled = refreshModalState.isRunning || refreshModalState.page <= 1;
            }
            if (nextBtn) {
                nextBtn.disabled = refreshModalState.isRunning || refreshModalState.page >= totalPages || refreshModalState.total <= 0;
            }

            const pageSizeSelect = document.getElementById('refreshPageSizeSelect');
            if (pageSizeSelect) {
                pageSizeSelect.disabled = refreshModalState.isRunning;
            }
        }

        function initRefreshPaginationSettings() {
            ensureRefreshPaginationControls();
            refreshModalState.pageSize = normalizeRefreshPageSize(
                localStorage.getItem(REFRESH_PAGE_SIZE_STORAGE_KEY) || refreshModalState.pageSize
            );
            syncRefreshPaginationControls();
        }

        function renderRefreshStats(stats) {
            refreshModalState.stats = stats || null;
            setRefreshSnapshotCounts(stats?.total ?? 0, stats?.success_count ?? 0, stats?.failed_count ?? 0);
            document.getElementById('refreshFilterCountAll').textContent = String(stats?.total ?? 0);
            document.getElementById('refreshFilterCountSuccess').textContent = String(stats?.success_count ?? 0);
            document.getElementById('refreshFilterCountFailed').textContent = String(stats?.failed_count ?? 0);
            document.getElementById('refreshFilterCountNever').textContent = String(stats?.never_count ?? 0);
        }

        function getVisibleRefreshAccountIds() {
            return refreshModalState.items
                .map(item => Number(item.id))
                .filter(Number.isFinite);
        }

        function getSelectedRefreshAccountIds() {
            return Array.from(refreshModalState.selectedAccountIds)
                .map(accountId => Number(accountId))
                .filter(Number.isFinite);
        }

        function getSelectedRefreshAccounts() {
            const selectedIds = new Set(getSelectedRefreshAccountIds());
            if (!selectedIds.size) {
                return [];
            }
            return refreshModalState.items.filter(item => selectedIds.has(Number(item.id)));
        }

        function getRefreshAccountBatchContext() {
            const selectedAccounts = getSelectedRefreshAccounts();
            return {
                source: 'refresh-management',
                isTempContext: false,
                selectedAccounts,
                selectedIds: getSelectedRefreshAccountIds(),
                selectedEmails: selectedAccounts.map(account => account.email).filter(Boolean),
                selectedCheckboxes: Array.from(document.querySelectorAll('#refreshAccountList .refresh-account-select-checkbox:checked')),
                buttons: {
                    copy: document.getElementById('refreshCopySelectedBtn'),
                    export: document.getElementById('refreshExportSelectedBtn'),
                    refresh: document.getElementById('refreshSelectedBtn'),
                    enableForwarding: document.getElementById('refreshEnableForwardingBtn'),
                    disableForwarding: document.getElementById('refreshDisableForwardingBtn'),
                    proxy: document.getElementById('refreshProxyBtn'),
                    delete: document.getElementById('refreshDeleteSelectedBtn'),
                },
                clearSelection: clearRefreshSelection,
                updateControls: syncRefreshBatchControls,
                afterMutation: async function afterRefreshBatchMutation(options = {}) {
                    if (typeof invalidateAccountCaches === 'function') {
                        invalidateAccountCaches();
                    }
                    if (Array.isArray(options.deletedEmails) && options.deletedEmails.length && typeof resetSelectedAccountViewIfDeleted === 'function') {
                        resetSelectedAccountViewIfDeleted(options.deletedEmails);
                    }
                    if (typeof loadGroups === 'function') {
                        await loadGroups();
                    }
                    clearRefreshSelection();
                    await reloadRefreshWorkbenchData();
                }
            };
        }

        function withRefreshAccountBatchContext(callback) {
            if (typeof withAccountBatchSelectionContext !== 'function') {
                showToast(I18n.t("The batch operation module has not been loaded, please refresh the page and try again"), 'error');
                return undefined;
            }
            return withAccountBatchSelectionContext(getRefreshAccountBatchContext(), callback);
        }

        function setRefreshSelectionMode(enabled) {
            refreshModalState.selectionMode = !!enabled;
            document.getElementById('refreshModal')?.classList.toggle('refresh-selection-mode', refreshModalState.selectionMode);
            document.querySelectorAll('.refresh-selection-mode-btn').forEach(button => {
                button.classList.toggle('active', refreshModalState.selectionMode);
                button.setAttribute('aria-pressed', refreshModalState.selectionMode ? 'true' : 'false');
                button.title = refreshModalState.selectionMode ? I18n.t("Exit batch selection") : I18n.t("Select multiple");
            });
            if (!refreshModalState.selectionMode) {
                refreshModalState.selectionDragState = null;
            }
        }

        function toggleRefreshSelectionMode() {
            setRefreshSelectionMode(!refreshModalState.selectionMode);
        }

        function getRefreshSelectionCheckboxes() {
            return Array.from(document.querySelectorAll('#refreshAccountList .refresh-account-select-checkbox'));
        }

        function getRefreshSelectionCheckboxById(accountId) {
            return getRefreshSelectionCheckboxes()
                .find(checkbox => String(checkbox.value) === String(accountId));
        }

        function setRefreshSelectionAnchor(accountId) {
            const normalizedId = Number(accountId);
            refreshModalState.selectionAnchorId = Number.isFinite(normalizedId) ? normalizedId : null;
        }

        function setRefreshSelectionRange(fromId, toId, selected) {
            const checkboxes = getRefreshSelectionCheckboxes();
            const fromIndex = checkboxes.findIndex(checkbox => String(checkbox.value) === String(fromId));
            const toIndex = checkboxes.findIndex(checkbox => String(checkbox.value) === String(toId));
            if (fromIndex === -1 || toIndex === -1) {
                return false;
            }
            const start = Math.min(fromIndex, toIndex);
            const end = Math.max(fromIndex, toIndex);
            for (let index = start; index <= end; index += 1) {
                setRefreshAccountSelected(checkboxes[index].value, selected, { sync: false });
            }
            return true;
        }

        function applyRefreshSelectionFromCheckbox(checkbox, event = null) {
            if (!checkbox || refreshModalState.isRunning) {
                syncRefreshBatchControls();
                return;
            }
            const accountId = Number(checkbox.value);
            if (!Number.isFinite(accountId)) {
                syncRefreshBatchControls();
                return;
            }
            const selected = !!checkbox.checked;
            if (event?.shiftKey && refreshModalState.selectionAnchorId !== null) {
                if (setRefreshSelectionRange(refreshModalState.selectionAnchorId, accountId, selected)) {
                    event.preventDefault?.();
                } else {
                    setRefreshAccountSelected(accountId, selected, { sync: false });
                }
            } else {
                setRefreshAccountSelected(accountId, selected, { sync: false });
            }
            setRefreshSelectionAnchor(accountId);
            syncRefreshBatchControls();
        }

        function handleRefreshSelectionCheckboxClick(event) {
            event.stopPropagation();
            if (refreshModalState.selectionMode && Date.now() < refreshModalState.selectionSuppressClickUntil) {
                event.preventDefault();
                return;
            }
            applyRefreshSelectionFromCheckbox(event.currentTarget, event);
        }

        function isRefreshRowInteractiveTarget(target) {
            return !!target?.closest?.('button, input, a, .refresh-account-action');
        }

        function handleRefreshAccountRowClick(event) {
            if (Date.now() < refreshModalState.selectionSuppressClickUntil) {
                event?.preventDefault?.();
                return;
            }
            if (refreshModalState.isRunning || isRefreshRowInteractiveTarget(event?.target)) {
                return;
            }
            if (!refreshModalState.selectionMode && !event?.shiftKey) {
                return;
            }

            const checkbox = event.currentTarget?.querySelector?.('.refresh-account-select-checkbox');
            if (!checkbox) {
                return;
            }

            event?.preventDefault?.();
            if (event?.shiftKey && refreshModalState.selectionAnchorId !== null) {
                checkbox.checked = true;
                applyRefreshSelectionFromCheckbox(checkbox, event);
            } else {
                checkbox.checked = !checkbox.checked;
                applyRefreshSelectionFromCheckbox(checkbox, event);
            }
        }

        function setRefreshDragSelection(checkbox) {
            if (!refreshModalState.selectionDragState || !checkbox) {
                return;
            }
            const accountId = String(checkbox.value);
            if (refreshModalState.selectionDragState.visitedIds.has(accountId)) {
                return;
            }
            refreshModalState.selectionDragState.visitedIds.add(accountId);
            checkbox.checked = refreshModalState.selectionDragState.targetChecked;
            setRefreshAccountSelected(checkbox.value, refreshModalState.selectionDragState.targetChecked, { sync: false });
            setRefreshSelectionAnchor(checkbox.value);
            syncRefreshBatchControls();
        }

        function handleRefreshSelectionPointerDown(event) {
            if (!refreshModalState.selectionMode || refreshModalState.isRunning || event.button !== 0) {
                return;
            }
            const startedOnCheckbox = !!event.target.closest('.refresh-account-select-checkbox');
            if (!startedOnCheckbox && isRefreshRowInteractiveTarget(event.target)) {
                return;
            }

            const row = event.target.closest('.refresh-account-row');
            const checkbox = row?.querySelector?.('.refresh-account-select-checkbox');
            if (!checkbox) {
                return;
            }

            event.preventDefault();
            refreshModalState.selectionSuppressClickUntil = Date.now() + 350;
            refreshModalState.selectionDragState = {
                pointerId: event.pointerId,
                targetChecked: !checkbox.checked,
                visitedIds: new Set()
            };
            document.getElementById('refreshAccountList')?.setPointerCapture?.(event.pointerId);
            setRefreshDragSelection(checkbox);
        }

        function handleRefreshSelectionPointerMove(event) {
            const dragState = refreshModalState.selectionDragState;
            if (!dragState || event.pointerId !== dragState.pointerId) {
                return;
            }
            event.preventDefault();
            const element = document.elementFromPoint(event.clientX, event.clientY);
            const row = element?.closest?.('#refreshAccountList .refresh-account-row');
            const checkbox = row?.querySelector?.('.refresh-account-select-checkbox');
            setRefreshDragSelection(checkbox);
        }

        function handleRefreshSelectionPointerEnd(event) {
            const dragState = refreshModalState.selectionDragState;
            if (!dragState || event.pointerId !== dragState.pointerId) {
                return;
            }
            document.getElementById('refreshAccountList')?.releasePointerCapture?.(event.pointerId);
            refreshModalState.selectionDragState = null;
        }

        function initRefreshSelectionGestures() {
            const refreshAccountList = document.getElementById('refreshAccountList');
            if (!refreshAccountList || refreshAccountList.dataset.boundSelectionGestures) {
                return;
            }
            refreshAccountList.dataset.boundSelectionGestures = 'true';
            refreshAccountList.addEventListener('pointerdown', handleRefreshSelectionPointerDown);
            refreshAccountList.addEventListener('pointermove', handleRefreshSelectionPointerMove);
            refreshAccountList.addEventListener('pointerup', handleRefreshSelectionPointerEnd);
            refreshAccountList.addEventListener('pointercancel', handleRefreshSelectionPointerEnd);
        }

        function syncRefreshBatchControls() {
            const selectedIds = getSelectedRefreshAccountIds();
            const visibleIds = getVisibleRefreshAccountIds();
            const visibleSelectedCount = visibleIds.filter(accountId => refreshModalState.selectedAccountIds.has(accountId)).length;
            const hiddenSelectedCount = Math.max(0, selectedIds.length - visibleSelectedCount);
            const hasVisibleItems = visibleIds.length > 0;
            const hasSelection = selectedIds.length > 0;
            const allVisibleSelected = hasVisibleItems && visibleSelectedCount === visibleIds.length;
            const selectedAccounts = getSelectedRefreshAccounts();
            const enableForwardingCount = selectedAccounts.filter(account => !account.forward_enabled).length;
            const disableForwardingCount = selectedAccounts.filter(account => !!account.forward_enabled).length;

            const modalEl = document.getElementById('refreshModal');
            modalEl?.classList.toggle('refresh-selection-mode', refreshModalState.selectionMode);

            const batchActions = document.getElementById('refreshBatchActions');
            if (batchActions) {
                batchActions.classList.toggle('is-active', hasSelection);
            }

            document.querySelectorAll('.refresh-selection-mode-btn').forEach(button => {
                button.classList.toggle('active', refreshModalState.selectionMode);
                button.setAttribute('aria-pressed', refreshModalState.selectionMode ? 'true' : 'false');
                button.title = refreshModalState.selectionMode ? I18n.t("Exit batch selection") : I18n.t("Select multiple");
            });

            const summaryEl = document.getElementById('refreshSelectedSummary');
            if (summaryEl) {
                summaryEl.textContent = hasSelection
                    ? (hiddenSelectedCount > 0 ? I18n.tpl`The ${selectedIds.length} item is selected, and the ${hiddenSelectedCount} item is outside the current filter.` : I18n.tpl`${selectedIds.length} item selected`)
                    : I18n.t("No account selected");
            }

            const selectVisibleBtn = document.getElementById('refreshSelectVisibleBtn');
            if (selectVisibleBtn) {
                selectVisibleBtn.disabled = !hasVisibleItems || refreshModalState.isRunning;
                selectVisibleBtn.textContent = allVisibleSelected ? I18n.t("Cancel current list") : I18n.t("Select all current list");
            }

            const clearSelectionBtn = document.getElementById('refreshClearSelectionBtn');
            if (clearSelectionBtn) {
                clearSelectionBtn.disabled = !hasSelection || refreshModalState.isRunning;
            }

            const refreshSelectedBtn = document.getElementById('refreshSelectedBtn');
            if (refreshSelectedBtn) {
                refreshSelectedBtn.disabled = !hasSelection || refreshModalState.isRunning;
                refreshSelectedBtn.textContent = hasSelection ? I18n.tpl`Refresh selected (${selectedIds.length})` : I18n.t("Refresh selected");
            }

            const copySelectedBtn = document.getElementById('refreshCopySelectedBtn');
            if (copySelectedBtn) {
                const isCopying = copySelectedBtn.dataset.loading === 'true';
                copySelectedBtn.disabled = !hasSelection || refreshModalState.isRunning || isCopying;
                if (!isCopying) {
                    copySelectedBtn.textContent = hasSelection ? I18n.tpl`Copy email + alias (${selectedIds.length})` : I18n.t("Copy email + alias");
                }
            }

            const exportSelectedBtn = document.getElementById('refreshExportSelectedBtn');
            if (exportSelectedBtn) {
                exportSelectedBtn.disabled = !hasSelection || refreshModalState.isRunning;
                exportSelectedBtn.textContent = hasSelection ? I18n.tpl`Export (${selectedIds.length})` : I18n.t("Export");
            }

            const enableForwardingBtn = document.getElementById('refreshEnableForwardingBtn');
            const disableForwardingBtn = document.getElementById('refreshDisableForwardingBtn');
            const isForwardingUpdating = enableForwardingBtn?.dataset.loading === 'true'
                || disableForwardingBtn?.dataset.loading === 'true';
            if (enableForwardingBtn) {
                enableForwardingBtn.disabled = !hasSelection || enableForwardingCount === 0 || refreshModalState.isRunning || isForwardingUpdating;
                enableForwardingBtn.title = hasSelection && enableForwardingCount === 0 ? I18n.t("Forwarding has been enabled for all selected accounts") : '';
                if (enableForwardingBtn.dataset.loading !== 'true') {
                    enableForwardingBtn.textContent = enableForwardingCount > 0 && enableForwardingCount !== selectedIds.length
                        ? I18n.tpl`Enable forwarding (${enableForwardingCount})`
                        : I18n.t("Enable forwarding");
                }
            }
            if (disableForwardingBtn) {
                disableForwardingBtn.disabled = !hasSelection || disableForwardingCount === 0 || refreshModalState.isRunning || isForwardingUpdating;
                disableForwardingBtn.title = hasSelection && disableForwardingCount === 0 ? I18n.t("All selected accounts have been cancelled.") : '';
                if (disableForwardingBtn.dataset.loading !== 'true') {
                    disableForwardingBtn.textContent = disableForwardingCount > 0 && disableForwardingCount !== selectedIds.length
                        ? I18n.tpl`Cancel forwarding (${disableForwardingCount})`
                        : I18n.t("Cancel forwarding");
                }
            }

            const proxyBtn = document.getElementById('refreshProxyBtn');
            if (proxyBtn) {
                const isUpdatingProxy = proxyBtn.dataset.loading === 'true';
                proxyBtn.disabled = !hasSelection || refreshModalState.isRunning || isUpdatingProxy;
                if (!isUpdatingProxy) {
                    proxyBtn.textContent = hasSelection ? I18n.tpl`Agent (${selectedIds.length})` : I18n.t("Agent");
                }
            }

            const addTagBtn = document.getElementById('refreshAddTagBtn');
            if (addTagBtn) {
                addTagBtn.disabled = !hasSelection || refreshModalState.isRunning;
            }

            const removeTagBtn = document.getElementById('refreshRemoveTagBtn');
            if (removeTagBtn) {
                removeTagBtn.disabled = !hasSelection || refreshModalState.isRunning;
            }

            const moveGroupBtn = document.getElementById('refreshMoveGroupBtn');
            if (moveGroupBtn) {
                moveGroupBtn.disabled = !hasSelection || refreshModalState.isRunning;
            }

            const deleteSelectedBtn = document.getElementById('refreshDeleteSelectedBtn');
            if (deleteSelectedBtn) {
                const isDeleting = deleteSelectedBtn.dataset.loading === 'true';
                deleteSelectedBtn.disabled = !hasSelection || refreshModalState.isRunning || isDeleting;
                if (!isDeleting) {
                    deleteSelectedBtn.textContent = hasSelection ? I18n.tpl`Delete (${selectedIds.length})` : I18n.t("Delete");
                }
            }

            const selectVisibleCheckbox = document.getElementById('refreshSelectVisibleCheckbox');
            if (selectVisibleCheckbox) {
                selectVisibleCheckbox.disabled = !hasVisibleItems || refreshModalState.isRunning;
                selectVisibleCheckbox.checked = allVisibleSelected;
                selectVisibleCheckbox.indeterminate = hasVisibleItems && visibleSelectedCount > 0 && !allVisibleSelected;
            }

            document.querySelectorAll('#refreshAccountList .refresh-account-select-checkbox').forEach(checkbox => {
                const accountId = Number(checkbox.value);
                checkbox.checked = refreshModalState.selectedAccountIds.has(accountId);
                checkbox.disabled = refreshModalState.isRunning;
            });
        }

        function setRefreshAccountSelected(accountId, selected, options = {}) {
            const normalizedId = Number(accountId);
            if (!Number.isFinite(normalizedId) || refreshModalState.isRunning) {
                syncRefreshBatchControls();
                return;
            }
            if (selected) {
                refreshModalState.selectedAccountIds.add(normalizedId);
            } else {
                refreshModalState.selectedAccountIds.delete(normalizedId);
            }
            if (options.sync !== false) {
                syncRefreshBatchControls();
            }
        }

        function toggleRefreshVisibleSelection() {
            if (refreshModalState.isRunning) {
                return;
            }
            const visibleIds = getVisibleRefreshAccountIds();
            if (!visibleIds.length) {
                return;
            }
            const shouldClear = visibleIds.every(accountId => refreshModalState.selectedAccountIds.has(accountId));
            visibleIds.forEach(accountId => {
                if (shouldClear) {
                    refreshModalState.selectedAccountIds.delete(accountId);
                } else {
                    refreshModalState.selectedAccountIds.add(accountId);
                }
            });
            syncRefreshBatchControls();
        }

        function clearRefreshSelection() {
            if (refreshModalState.isRunning) {
                return;
            }
            refreshModalState.selectedAccountIds.clear();
            refreshModalState.selectionAnchorId = null;
            syncRefreshBatchControls();
        }

        function clearRefreshSelectionForScopeChange() {
            refreshModalState.selectionAnchorId = null;
            if (!refreshModalState.selectedAccountIds.size) {
                return;
            }
            refreshModalState.selectedAccountIds.clear();
            syncRefreshBatchControls();
        }

        function renderRefreshAccountList(items, total) {
            const container = document.getElementById('refreshAccountList');
            const summaryEl = document.getElementById('refreshListSummary');
            if (!container || !summaryEl) {
                return;
            }

            refreshModalState.items = Array.isArray(items) ? items : [];
            refreshModalState.total = Number(total || 0);
            const pageSize = normalizeRefreshPageSize(refreshModalState.pageSize);
            const page = Math.max(1, parseInt(refreshModalState.page, 10) || 1);
            const startItem = refreshModalState.items.length
                ? ((page - 1) * pageSize) + 1
                : 0;
            const endItem = refreshModalState.items.length
                ? Math.min(refreshModalState.total, startItem + refreshModalState.items.length - 1)
                : 0;
            summaryEl.textContent = refreshModalState.total > 0
                ? I18n.tpl`Item ${startItem}-${endItem} / Total item ${refreshModalState.total}`
                : I18n.t("0 items in total");
            syncRefreshPaginationControls();

            if (!refreshModalState.items.length) {
                container.innerHTML = I18n.t("<div class=\"refresh-account-empty\">There is no email under the current filter conditions.</div>");
                syncRefreshBatchControls();
                return;
            }

            const rowsHtml = refreshModalState.items.map(item => {
                const accountId = Number(item.id);
                const isRunning = refreshModalState.currentRefreshingAccountId === item.id;
                const isSelected = refreshModalState.selectedAccountIds.has(accountId);
                const canRetry = item.last_refresh_status === 'failed' && !isRunning;
                const groupText = item.group_name || "\u9ed8\u8ba4\u5206\u7ec4";
                const refreshTime = item.last_refresh_at ? formatDateTime(item.last_refresh_at) : '-';
                const remarkHtml = item.remark
                    ? `<div class="refresh-account-remark">${escapeHtml(item.remark)}</div>`
                    : '';
                const errorHtml = item.last_refresh_status === 'failed' && item.last_refresh_error
                    ? `<div class="refresh-account-error">${escapeHtml(item.last_refresh_error)}</div>`
                    : '';
                const rowClassNames = [
                    isRunning ? 'is-refreshing' : '',
                    isSelected ? 'is-selected' : '',
                    refreshModalState.isRunning ? 'is-disabled' : '',
                ].filter(Boolean);

                return `
                    <tr class="refresh-account-row ${rowClassNames.join(' ')}" data-refresh-account-id="${accountId}" onclick="handleRefreshAccountRowClick(event)">
                        <td class="refresh-account-select-cell">
                            <input type="checkbox" class="refresh-account-select-checkbox" value="${item.id}"
                                ${isSelected ? 'checked' : ''}
                                onclick="handleRefreshSelectionCheckboxClick(event)">
                        </td>
                        <td class="refresh-account-main">
                            <div class="refresh-account-email" title="${escapeHtml(item.email)}">${escapeHtml(item.email)}</div>
                            ${remarkHtml}
                            ${errorHtml}
                        </td>
                        <td class="refresh-account-group" title="${escapeHtml(groupText)}">${escapeHtml(groupText)}</td>
                        <td class="refresh-account-time">${escapeHtml(refreshTime)}</td>
                        <td class="refresh-account-status-cell">${renderRefreshStatusBadge(item.last_refresh_status, isRunning)}</td>
                        <td class="refresh-account-action">
                            ${canRetry
                                ? I18n.tpl`<button class="btn btn-sm btn-primary" type="button" onclick="retrySingleAccount(${item.id}, '${escapeJs(item.email)}')">Try again</button>`
                                : '<span class="refresh-account-time">-</span>'}
                        </td>
                    </tr>
                `;
            }).join('');

            container.innerHTML = I18n.tpl`
                <table class="refresh-account-table">
                    <thead>
                        <tr>
                            <th class="refresh-account-select-head">
                                <input type="checkbox" id="refreshSelectVisibleCheckbox" onclick="toggleRefreshVisibleSelection()">
                            </th>
                            <th>Mailboxes</th>
                            <th>Groups</th>
                            <th>Recently refreshed</th>
                            <th>Status</th>
                            <th>Operation</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            `;
            syncRefreshBatchControls();
        }

        async function loadRefreshStats() {
            try {
                const response = await fetch('/api/accounts/refresh-stats');
                const data = await response.json();
                if (data.success) {
                    renderRefreshStats(data.stats || {});
                }
            } catch (error) {
                console.error(I18n.t("Failed to load refresh statistics:"), error);
            }
        }

        async function loadRefreshStatusList() {
            const params = new URLSearchParams({
                q: refreshModalState.query,
                status: refreshModalState.status,
                page: String(refreshModalState.page),
                page_size: String(refreshModalState.pageSize),
            });

            try {
                const response = await fetch(`/api/accounts/refresh-status-list?${params.toString()}`);
                const data = await response.json();
                if (!data.success) {
                    handleApiError(data, I18n.t("Failed to load Token and refresh status"));
                    return;
                }
                refreshModalState.page = Math.max(1, parseInt(data.page, 10) || refreshModalState.page);
                refreshModalState.pageSize = normalizeRefreshPageSize(data.page_size || refreshModalState.pageSize);
                refreshModalState.total = Math.max(0, Number(data.total || 0));
                const totalPages = getRefreshTotalPages();
                if (refreshModalState.total > 0 && refreshModalState.page > totalPages) {
                    refreshModalState.page = totalPages;
                    await loadRefreshStatusList();
                    return;
                }
                renderRefreshStats(data.stats || {});
                renderRefreshAccountList(data.items || [], data.total || 0);
                updateRefreshStatusFilterButtons();
            } catch (error) {
                showToast(I18n.t("Failed to load Token and refresh status"), 'error');
            }
        }

        function handleRefreshPageSizeChange(value) {
            if (refreshModalState.isRunning) {
                syncRefreshPaginationControls();
                return;
            }
            const nextPageSize = normalizeRefreshPageSize(value);
            if (nextPageSize === refreshModalState.pageSize) {
                syncRefreshPaginationControls();
                return;
            }
            clearRefreshSelectionForScopeChange();
            refreshModalState.pageSize = nextPageSize;
            refreshModalState.page = 1;
            localStorage.setItem(REFRESH_PAGE_SIZE_STORAGE_KEY, String(nextPageSize));
            syncRefreshPaginationControls();
            loadRefreshStatusList();
        }

        function goToRefreshPage(value) {
            if (refreshModalState.isRunning) {
                syncRefreshPaginationControls();
                return;
            }
            const totalPages = getRefreshTotalPages();
            const nextPage = Math.min(
                totalPages,
                Math.max(1, parseInt(value, 10) || 1)
            );
            if (nextPage === refreshModalState.page) {
                syncRefreshPaginationControls();
                return;
            }
            clearRefreshSelectionForScopeChange();
            refreshModalState.page = nextPage;
            syncRefreshPaginationControls();
            loadRefreshStatusList();
        }

        function changeRefreshPage(delta) {
            goToRefreshPage(refreshModalState.page + (parseInt(delta, 10) || 0));
        }

        function handleRefreshPageInputKeydown(event) {
            if (event.key !== 'Enter') {
                return;
            }
            event.preventDefault();
            goToRefreshPage(event.currentTarget.value);
            event.currentTarget.blur();
        }

        async function showRefreshModal(resetFilters = false) {
            if (resetFilters) {
                refreshModalState.query = '';
                refreshModalState.status = 'all';
                refreshModalState.page = 1;
                refreshModalState.selectedAccountIds.clear();
                refreshModalState.selectionAnchorId = null;
                setRefreshSelectionMode(false);
            }

            showModal('refreshModal');
            initRefreshSelectionGestures();
            initRefreshPaginationSettings();
            updateRefreshStatusFilterButtons();
            syncRefreshActionButtons();
            renderRefreshRuntimeLogs();
            if (!refreshModalState.runtimeLogs.length) {
                updateRefreshLogSummary(refreshModalState.isRunning ? I18n.t("Executing full refresh task") : I18n.t("No task log yet"));
            }

            const searchInput = document.getElementById('refreshSearchInput');
            if (searchInput) {
                searchInput.value = refreshModalState.query;
            }

            await loadRefreshStatusList();
        }

        async function openRefreshModalWithStatus(status = 'all') {
            refreshModalState.query = '';
            refreshModalState.status = String(status || 'all').toLowerCase();
            refreshModalState.page = 1;
            refreshModalState.selectedAccountIds.clear();
            refreshModalState.selectionAnchorId = null;
            setRefreshSelectionMode(false);
            await showRefreshModal();
        }

        function hideRefreshModal() {
            hideModal('refreshModal');
            if (!refreshModalState.isRunning) {
                setRefreshSelectionMode(false);
                resetRefreshModalRuntime();
            }
        }

        function handleRefreshSearchInput(value) {
            const nextQuery = String(value || '').trim();
            if (nextQuery !== refreshModalState.query) {
                clearRefreshSelectionForScopeChange();
            }
            refreshModalState.query = nextQuery;
            refreshModalState.page = 1;
            if (refreshModalState.searchTimer) {
                window.clearTimeout(refreshModalState.searchTimer);
            }
            refreshModalState.searchTimer = window.setTimeout(() => {
                refreshModalState.searchTimer = 0;
                loadRefreshStatusList();
            }, 180);
        }

        function setRefreshStatusFilter(status, triggerEl = null) {
            const nextStatus = String(status || 'all').toLowerCase();
            if (nextStatus !== refreshModalState.status) {
                clearRefreshSelectionForScopeChange();
            }
            refreshModalState.status = nextStatus;
            refreshModalState.page = 1;
            if (triggerEl?.dataset?.status) {
                document.querySelectorAll('#refreshModal .refresh-filter-chip').forEach(btn => {
                    btn.classList.toggle('is-active', btn === triggerEl);
                });
            } else {
                updateRefreshStatusFilterButtons();
            }
            loadRefreshStatusList();
        }

        function applyRefreshResultToListItem(data) {
            const targetItem = refreshModalState.items.find(item => item.id === data.account_id);
            if (!targetItem) {
                return;
            }
            targetItem.last_refresh_status = data.status;
            targetItem.last_refresh_error = data.error_message || null;
            targetItem.last_refresh_at = new Date().toISOString();
        }

        function beginRefreshTaskRuntime(summary, title, detail) {
            closeRefreshEventSource();
            refreshModalState.runtimeLogs = [];
            refreshModalState.isRunning = true;
            refreshModalState.stopRequested = false;
            refreshModalState.currentRefreshingAccountId = null;
            updateRefreshLogSummary(summary);
            appendRefreshRuntimeLog('info', title, detail);
            syncRefreshActionButtons();
            renderRefreshAccountList(refreshModalState.items, refreshModalState.total);
        }

        function finishRefreshTaskRuntime(source = refreshModalState.eventSource) {
            closeRefreshEventSource(source);
            refreshModalState.isRunning = false;
            refreshModalState.stopRequested = false;
            refreshModalState.currentRefreshingAccountId = null;
            syncRefreshActionButtons();
            renderRefreshAccountList(refreshModalState.items, refreshModalState.total);
        }

        async function reloadRefreshWorkbenchData() {
            await loadRefreshStatusList();
            if (typeof refreshVisibleAccountList === 'function') {
                await refreshVisibleAccountList(true);
            } else if (currentGroupId && typeof loadAccountsByGroup === 'function') {
                await loadAccountsByGroup(currentGroupId, true);
            }
        }

        async function startRefreshEventStream(url, options = {}) {
            if (refreshModalState.isRunning) {
                return;
            }

            const taskLabel = options.taskLabel || I18n.t("Refresh");
            const startSummary = options.startSummary || I18n.tpl`Preparing for ${taskLabel} mission`;
            const startLogTitle = options.startLogTitle || I18n.tpl`${taskLabel} task has been submitted`;
            const startLogDetail = options.startLogDetail || I18n.t("Establishing refresh connection");
            const requestErrorToast = options.requestErrorToast || I18n.tpl`${taskLabel} request failed`;
            const emptyToast = options.emptyToast || I18n.t("No account needs to be processed");
            const clearSelectionOnComplete = options.clearSelectionOnComplete === true;

            beginRefreshTaskRuntime(startSummary, startLogTitle, startLogDetail);

            try {
                const eventSource = new EventSource(url);
                refreshModalState.eventSource = eventSource;

                let totalCount = 0;
                let successCount = 0;
                let failedCount = 0;
                let finished = false;

                async function finalizeRefreshTask(callback) {
                    if (finished || refreshModalState.eventSource !== eventSource) {
                        return;
                    }
                    finished = true;
                    await callback();
                }

                eventSource.onmessage = async function (event) {
                    if (refreshModalState.eventSource !== eventSource || finished) {
                        return;
                    }

                    let data = null;
                    try {
                        data = JSON.parse(event.data);
                    } catch (error) {
                        console.error(I18n.t("Failed to parse refresh log:"), error);
                        return;
                    }

                    if (data.type === 'start') {
                        totalCount = Math.max(0, Number(data.total || 0));
                        successCount = Math.max(0, Number(data.success_count || 0));
                        failedCount = Math.max(0, Number(data.failed_count || 0));
                        setRefreshSnapshotCounts(totalCount, successCount, failedCount);

                        const delayText = Number(data.delay_seconds || 0) > 0 ? I18n.tpl`, refresh interval ${data.delay_seconds} seconds` : '';
                        updateRefreshLogSummary(totalCount > 0 ? I18n.tpl`Task running: 0/${totalCount}` : I18n.t("There are no accounts that need to be processed this time"));
                        appendRefreshRuntimeLog('info', I18n.t("Mission starts"), I18n.tpl`A total of ${totalCount} accounts ${delayText} need to be processed this time`);
                        return;
                    }

                    if (data.type === 'progress') {
                        totalCount = Math.max(totalCount, Number(data.total || 0));
                        successCount = Math.max(0, Number(data.success_count || successCount));
                        failedCount = Math.max(0, Number(data.failed_count || failedCount));
                        refreshModalState.currentRefreshingAccountId = data.account_id || null;
                        setRefreshSnapshotCounts(totalCount, successCount, failedCount);
                        updateRefreshLogSummary(I18n.tpl`Task running: ${Math.max(0, Number(data.current || 0) - 1)} / ${Math.max(totalCount, Number(data.total || 0))}`);
                        appendRefreshRuntimeLog('info', I18n.tpl`Start refreshing ${data.email || '-'}`, I18n.tpl`Progress ${data.current || 0}/${data.total || totalCount}`);
                        renderRefreshAccountList(refreshModalState.items, refreshModalState.total);
                        return;
                    }

                    if (data.type === 'account_result') {
                        totalCount = Math.max(totalCount, Number(data.total || 0));
                        successCount = Math.max(0, Number(data.success_count || successCount));
                        failedCount = Math.max(0, Number(data.failed_count || failedCount));
                        refreshModalState.currentRefreshingAccountId = null;
                        setRefreshSnapshotCounts(totalCount, successCount, failedCount);
                        updateRefreshLogSummary(I18n.tpl`Task running: ${successCount + failedCount} / ${Math.max(totalCount, Number(data.total || 0))}`);
                        applyRefreshResultToListItem(data);
                        appendRefreshRuntimeLog(
                            data.status === 'failed' ? 'error' : 'success',
                            `${data.email || '-'} ${data.status === 'failed' ? I18n.t("Refresh failed") : I18n.t("Refresh successful")}`,
                            data.error_message || I18n.tpl`Cumulative success ${successCount}, failure ${failedCount}`
                        );
                        renderRefreshAccountList(refreshModalState.items, refreshModalState.total);
                        return;
                    }

                    if (data.type === 'delay') {
                        const waitSeconds = Math.max(0, Number(data.seconds || 0));
                        const processedCount = successCount + failedCount;
                        updateRefreshLogSummary(I18n.tpl`Task running: ${processedCount} / ${totalCount}, waiting for ${waitSeconds} seconds`);
                        appendRefreshRuntimeLog('warn', I18n.t("Waiting for the next round of refresh"), I18n.tpl`Wait ${waitSeconds} seconds before continuing`);
                        return;
                    }

                    if (data.type === 'stopped') {
                        await finalizeRefreshTask(async () => {
                            totalCount = Math.max(totalCount, Number(data.total || 0));
                            successCount = Math.max(0, Number(data.success_count || successCount));
                            failedCount = Math.max(0, Number(data.failed_count || failedCount));
                            setRefreshSnapshotCounts(totalCount, successCount, failedCount);
                            finishRefreshTaskRuntime(eventSource);
                            updateRefreshLogSummary(I18n.tpl`Task stopped: ${data.processed_count || (successCount + failedCount)} / ${totalCount} processed`);
                            appendRefreshRuntimeLog('warn', I18n.t("Task stopped"), data.message || I18n.tpl`${taskLabel} task stopped`);
                            showToast(data.message || I18n.tpl`${taskLabel} task stopped`, 'warning');
                            await reloadRefreshWorkbenchData();
                        });
                        return;
                    }

                    if (data.type === 'complete') {
                        await finalizeRefreshTask(async () => {
                            totalCount = Math.max(totalCount, Number(data.total || 0));
                            successCount = Math.max(0, Number(data.success_count || successCount));
                            failedCount = Math.max(0, Number(data.failed_count || failedCount));
                            setRefreshSnapshotCounts(totalCount, successCount, failedCount);
                            finishRefreshTaskRuntime(eventSource);
                            if (clearSelectionOnComplete) {
                                refreshModalState.selectedAccountIds.clear();
                                refreshModalState.selectionAnchorId = null;
                                syncRefreshBatchControls();
                            }

                            if (totalCount <= 0) {
                                updateRefreshLogSummary(I18n.t("There are no accounts that need to be processed this time"));
                                appendRefreshRuntimeLog('info', I18n.t("Task completed"), I18n.t("There are no accounts that need to be processed this time"));
                                showToast(emptyToast, 'info');
                            } else {
                                updateRefreshLogSummary(I18n.tpl`Mission completed: ${successCount + failedCount} / ${totalCount}`);
                                appendRefreshRuntimeLog(
                                    failedCount > 0 ? 'warn' : 'success',
                                    I18n.t("Task completed"),
                                    I18n.tpl`Success ${successCount}, failure ${failedCount}`
                                );
                                showToast(
                                    I18n.tpl`${taskLabel} completion: success ${successCount}, failure ${failedCount}`,
                                    failedCount > 0 ? 'warning' : 'success'
                                );
                            }

                            await reloadRefreshWorkbenchData();
                        });
                        return;
                    }

                    if (data.type === 'conflict') {
                        await finalizeRefreshTask(async () => {
                            finishRefreshTaskRuntime(eventSource);
                            updateRefreshLogSummary(I18n.t("There is already a task being executed"));
                            appendRefreshRuntimeLog('warn', I18n.t("Task not started"), data.message || I18n.t("A refresh task is already being executed"));
                            showToast(data.message || I18n.t("A refresh task is already being executed"), 'warning');
                            await reloadRefreshWorkbenchData();
                        });
                        return;
                    }

                    if (data.type === 'error') {
                        await finalizeRefreshTask(async () => {
                            totalCount = Math.max(totalCount, Number(data.total || 0));
                            successCount = Math.max(0, Number(data.success_count || successCount));
                            failedCount = Math.max(0, Number(data.failed_count || failedCount));
                            if (totalCount > 0 || successCount > 0 || failedCount > 0) {
                                setRefreshSnapshotCounts(totalCount, successCount, failedCount);
                            }
                            finishRefreshTaskRuntime(eventSource);
                            updateRefreshLogSummary(I18n.t("Task execution failed"));
                            appendRefreshRuntimeLog('error', I18n.t("Task execution failed"), data.message || I18n.tpl`An error occurred during ${taskLabel}`);
                            showToast(data.message || I18n.tpl`An error occurred during ${taskLabel}`, 'error');
                            await reloadRefreshWorkbenchData();
                        });
                    }
                };

                eventSource.onerror = function (error) {
                    console.error(I18n.t("Token refresh EventSource error:"), error);
                    if (refreshModalState.eventSource !== eventSource || finished) {
                        return;
                    }

                    finished = true;
                    const wasStopping = refreshModalState.stopRequested;
                    finishRefreshTaskRuntime(eventSource);

                    if (!wasStopping) {
                        updateRefreshLogSummary(I18n.t("Connection interrupted"));
                        appendRefreshRuntimeLog('error', I18n.t("Connection interrupted"), I18n.tpl`${taskLabel} log connection abnormally disconnected`);
                        showToast(I18n.tpl`An error occurred during ${taskLabel}`, 'error');
                    }

                    reloadRefreshWorkbenchData();
                };
            } catch (error) {
                finishRefreshTaskRuntime();
                updateRefreshLogSummary(I18n.t("Task startup failed"));
                appendRefreshRuntimeLog('error', I18n.t("Task startup failed"), error.message || requestErrorToast);
                showToast(requestErrorToast, 'error');
            }
        }

        // Fully refresh all accounts
        async function refreshAllAccounts() {
            const btn = document.getElementById('refreshAllBtn');
            if (btn?.disabled) {
                return;
            }

            if (!(await showConfirmModal(I18n.t("Are you sure you want to refresh the tokens of all accounts?"), { title: I18n.t("Refresh Token"), confirmText: I18n.t("Confirm refresh"), danger: false }))) {
                return;
            }

            await startRefreshEventStream('/api/accounts/trigger-scheduled-refresh?force=true', {
                taskLabel: I18n.t("Full refresh"),
                startSummary: I18n.t("Preparing for full refresh task"),
                startLogTitle: I18n.t("A full refresh task has been submitted"),
                startLogDetail: I18n.t("Establishing refresh connection"),
                requestErrorToast: I18n.t("Refresh request failed"),
                emptyToast: I18n.t("There is no account to refresh"),
            });
        }

        async function stopFullRefresh() {
            if (!refreshModalState.isRunning || refreshModalState.stopRequested) {
                return;
            }

            const stopBtn = document.getElementById('stopRefreshBtn');
            refreshModalState.stopRequested = true;
            syncRefreshActionButtons();
            updateRefreshLogSummary(I18n.t("Requesting to stop task"));
            appendRefreshRuntimeLog('warn', I18n.t("Stop request sent"), I18n.t("The task will end after the current account is processed."));

            try {
                const response = await fetch('/api/accounts/stop-full-refresh', {
                    method: 'POST',
                });
                const data = await response.json();
                if (!response.ok || !data.success) {
                    refreshModalState.stopRequested = false;
                    syncRefreshActionButtons();
                    updateRefreshLogSummary(I18n.t("Stop request failed"));
                    appendRefreshRuntimeLog('error', I18n.t("Stop request failed"), data.message || I18n.t("Stop task failed"));
                    showToast(data.message || I18n.t("Stop task failed"), 'error');
                    return;
                }
                if (stopBtn) {
                    stopBtn.blur();
                }
                showToast(data.message || I18n.t("Requested to stop refresh task"), 'warning');
            } catch (error) {
                refreshModalState.stopRequested = false;
                syncRefreshActionButtons();
                updateRefreshLogSummary(I18n.t("Stop request failed"));
                appendRefreshRuntimeLog('error', I18n.t("Stop request failed"), error.message || I18n.t("Stop request exception"));
                showToast(I18n.t("Stop task failed"), 'error');
            }
        }

        async function retryFailedAccounts() {
            const btn = document.getElementById('retryFailedBtn');
            if (btn?.disabled) {
                return;
            }

            await startRefreshEventStream('/api/accounts/refresh-failed-stream', {
                taskLabel: I18n.t("Retry on failure"),
                startSummary: I18n.t("Preparing for failed retry task"),
                startLogTitle: I18n.t("Failed retry task has been submitted"),
                startLogDetail: I18n.t("Establishing refresh connection"),
                requestErrorToast: I18n.t("Retry request failed"),
                emptyToast: I18n.t("There are no failed accounts that need to be retried."),
            });
        }

        async function copySelectedRefreshAccountsWithAliases() {
            return withRefreshAccountBatchContext(() => copySelectedAccountsWithAliases());
        }

        function exportSelectedRefreshAccounts() {
            return withRefreshAccountBatchContext(() => exportSelectedAccounts());
        }

        async function enableForwardingForSelectedRefreshAccounts() {
            return withRefreshAccountBatchContext(() => updateForwardingForSelectedAccounts(true));
        }

        async function disableForwardingForSelectedRefreshAccounts() {
            return withRefreshAccountBatchContext(() => updateForwardingForSelectedAccounts(false));
        }

        function showRefreshBatchProxyModal() {
            return withRefreshAccountBatchContext(() => showBatchProxyModal());
        }

        function showRefreshBatchTagModal(type) {
            return withRefreshAccountBatchContext(() => showBatchTagModal(type));
        }

        function showRefreshBatchMoveGroupModal() {
            return withRefreshAccountBatchContext(() => showBatchMoveGroupModal());
        }

        async function refreshSelectedRefreshAccounts() {
            const btn = document.getElementById('refreshSelectedBtn');
            if (btn?.disabled || refreshModalState.isRunning) {
                return;
            }

            const accountIds = getSelectedRefreshAccountIds();
            if (!accountIds.length) {
                showToast(I18n.t("Please select the account you want to refresh first"), 'error');
                return;
            }
            if (!(await showConfirmModal(I18n.tpl`Are you sure you want to refresh the selected ${accountIds.length} account Tokens?`, { title: I18n.t("Refresh selected Token"), confirmText: I18n.t("Confirm refresh"), danger: false }))) {
                return;
            }

            let data = null;
            try {
                const response = await fetch('/api/accounts/refresh-selected-stream', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ account_ids: accountIds })
                });
                data = await response.json();

                if (!response.ok || !data.success || !data.stream_url) {
                    handleApiError(data, I18n.t("Batch refresh task initialization failed"));
                    return;
                }
            } catch (error) {
                handleApiError({
                    success: false,
                    error: {
                        message: I18n.t("Batch refresh task initialization failed"),
                        details: error.message,
                        code: 'NETWORK_ERROR',
                        type: 'Frontend'
                    }
                });
                return;
            }

            await startRefreshEventStream(data.stream_url, {
                taskLabel: I18n.t("Batch refresh"),
                startSummary: I18n.t("Preparing batch refresh tasks"),
                startLogTitle: I18n.t("Batch refresh task has been submitted"),
                startLogDetail: I18n.tpl`${accountIds.length} accounts selected`,
                requestErrorToast: I18n.t("Batch refresh request failed"),
                emptyToast: I18n.t("There is no selected account to refresh"),
                clearSelectionOnComplete: true,
            });
        }

        async function deleteSelectedRefreshAccounts() {
            const btn = document.getElementById('refreshDeleteSelectedBtn');
            if (btn?.disabled || refreshModalState.isRunning) {
                return;
            }

            const accountIds = getSelectedRefreshAccountIds();
            if (!accountIds.length) {
                showToast(I18n.t("Please select the account you want to delete first"), 'error');
                return;
            }
            if (!(await showConfirmModal(I18n.tpl`Are you sure you want to delete the selected ${accountIds.length} accounts? This operation is irreversible.`, { title: I18n.t("Delete selected account"), confirmText: I18n.t("Confirm deletion") }))) {
                return;
            }

            btn.disabled = true;
            btn.dataset.loading = 'true';
            btn.textContent = I18n.t("Deleting...");

            try {
                const response = await fetch('/api/accounts/batch-delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ account_ids: accountIds })
                });
                const data = await response.json();

                if (!data.success) {
                    handleApiError(data, I18n.t("Batch deletion failed"));
                    return;
                }

                const deletedAccounts = Array.isArray(data.deleted_accounts) ? data.deleted_accounts : [];
                const deletedEmails = deletedAccounts.map(account => account.email).filter(Boolean);
                accountIds.forEach(accountId => refreshModalState.selectedAccountIds.delete(accountId));
                if (!refreshModalState.selectedAccountIds.size) {
                    refreshModalState.selectionAnchorId = null;
                }
                updateRefreshLogSummary(data.message || I18n.tpl`${deletedAccounts.length} accounts deleted`);
                appendRefreshRuntimeLog('warn', I18n.t("Delete accounts in batches"), data.message || I18n.tpl`${deletedAccounts.length} accounts deleted`);
                showToast(data.message || I18n.tpl`${deletedAccounts.length} accounts deleted`, 'success');

                if (typeof invalidateAccountCaches === 'function') {
                    invalidateAccountCaches();
                }
                if (typeof resetSelectedAccountViewIfDeleted === 'function') {
                    resetSelectedAccountViewIfDeleted(deletedEmails);
                }
                if (typeof loadGroups === 'function') {
                    await loadGroups();
                }
                await reloadRefreshWorkbenchData();
            } catch (error) {
                showToast(I18n.t("Batch deletion failed"), 'error');
            } finally {
                btn.dataset.loading = 'false';
                syncRefreshBatchControls();
            }
        }

        // Single account retry
        async function retrySingleAccount(accountId, accountEmail) {
            try {
                refreshModalState.currentRefreshingAccountId = accountId;
                updateRefreshLogSummary(I18n.tpl`Retrying ${accountEmail}`);
                appendRefreshRuntimeLog('info', I18n.tpl`Start retrying ${accountEmail}`, I18n.t("Single account retry task"));
                renderRefreshAccountList(refreshModalState.items, refreshModalState.total);

                const response = await fetch(`/api/accounts/${accountId}/retry-refresh`, {
                    method: 'POST'
                });
                const data = await response.json();

                if (data.success) {
                    appendRefreshRuntimeLog('success', I18n.tpl`${accountEmail} refreshed successfully`, I18n.t("Single account retry completed"));
                    updateRefreshLogSummary(I18n.tpl`${accountEmail} Retry completed`);
                    showToast(I18n.tpl`${accountEmail} refreshed successfully`, 'success');
                    await reloadRefreshWorkbenchData();
                } else {
                    const errorMessage = data?.error?.message || data?.error || data?.message || I18n.t("Refresh failed");
                    appendRefreshRuntimeLog('error', I18n.tpl`${accountEmail} refresh failed`, errorMessage);
                    updateRefreshLogSummary(I18n.tpl`${accountEmail} retry failed`);
                    handleApiError(data, I18n.tpl`${accountEmail} refresh failed`);
                }
            } catch (error) {
                appendRefreshRuntimeLog('error', I18n.tpl`${accountEmail} refresh failed`, error.message || I18n.t("Refresh request failed"));
                updateRefreshLogSummary(I18n.tpl`${accountEmail} retry failed`);
                handleApiError({ success: false, error: { message: I18n.t("Refresh request failed"), details: error.message, code: 'NETWORK_ERROR', type: 'Frontend' } });
            } finally {
                refreshModalState.currentRefreshingAccountId = null;
                renderRefreshAccountList(refreshModalState.items, refreshModalState.total);
            }
        }

        async function loadForwardingLogs() {
            const drawer = document.getElementById('forwardingLogsDrawer');
            const container = document.getElementById('forwardingLogsContainer');
            const listEl = document.getElementById('forwardingLogsList');
            hideFailedForwardingLogs();

            try {
                const response = await fetch('/api/accounts/forwarding-logs?limit=100');
                const data = await response.json();

                if (data.success) {
                    if (data.logs.length === 0) {
                        listEl.innerHTML = I18n.t("<div style=\"padding: 20px; text-align: center; color: #666;\">No forwarding history yet</div>");
                    } else {
                        let html = '';
                        data.logs.forEach(log => {
                            const statusColor = log.status === 'success' ? '#28a745' : '#dc3545';
                            const statusText = log.status === 'success' ? I18n.t("Success") : I18n.t("Failure");
                            html += I18n.tpl`
                                <div style="padding: 12px; border-bottom: 1px solid #e5e5e5;">
                                    <div style="display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
                                        <div style="font-weight: 600;">${escapeHtml(log.account_email)}</div>
                                        <div style="font-size: 12px; color: ${statusColor}; font-weight: 600;">${statusText}</div>
                                    </div>
                                    <div style="font-size: 12px; color: #666; line-height: 1.7;">
                                        <div>Channel: ${escapeHtml(log.channel || '-')}</div>
                                        <div>Email ID: ${escapeHtml(log.message_id || '-')}</div>
                                        <div>Time: ${formatDateTime(log.created_at)}</div>
                                    </div>
                                    ${log.error_message ? `<div style="font-size: 12px; color: #dc3545; margin-top: 6px; padding: 6px; background-color: #fff5f5; border-radius: 4px;">${escapeHtml(log.error_message)}</div>` : ''}
                                </div>
                            `;
                        });
                        listEl.innerHTML = html;
                    }
                    if (container) {
                        container.hidden = false;
                    }
                    if (drawer) {
                        drawer.classList.add('is-open');
                    }
                    const toggleBtn = document.getElementById('forwardingLogsToggleBtn');
                    if (toggleBtn) {
                        toggleBtn.textContent = I18n.t("Close history");
                    }
                }
            } catch (error) {
                showToast(I18n.t("Failed to load forwarding history"), 'error');
            }
        }

        async function loadFailedForwardingLogs() {
            const drawer = document.getElementById('failedForwardingLogsDrawer');
            const container = document.getElementById('failedForwardingLogsContainer');
            const listEl = document.getElementById('failedForwardingLogsList');
            hideForwardingLogs();

            try {
                const response = await fetch('/api/accounts/forwarding-logs/failed?limit=100');
                const data = await response.json();

                if (data.success) {
                    if (data.logs.length === 0) {
                        listEl.innerHTML = I18n.t("<div style=\"padding: 20px; text-align: center; color: #666;\">No forwarding failure record yet</div>");
                    } else {
                        let html = '';
                        data.logs.forEach(log => {
                            html += I18n.tpl`
                                <div style="padding: 12px; border-bottom: 1px solid #f3d6d6;">
                                    <div style="display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
                                        <div style="font-weight: 600;">${escapeHtml(log.account_email)}</div>
                                        <div style="font-size: 12px; color: #dc3545; font-weight: 600;">Failure</div>
                                    </div>
                                    <div style="font-size: 12px; color: #666; line-height: 1.7;">
                                        <div>Channel: ${escapeHtml(log.channel || '-')}</div>
                                        <div>Email ID: ${escapeHtml(log.message_id || '-')}</div>
                                        <div>Time: ${formatDateTime(log.created_at)}</div>
                                    </div>
                                    <div style="font-size: 12px; color: #dc3545; margin-top: 6px; padding: 6px; background-color: #fff5f5; border-radius: 4px;">${escapeHtml(log.error_message || I18n.t("Unknown error"))}</div>
                                </div>
                            `;
                        });
                        listEl.innerHTML = html;
                    }
                    if (container) {
                        container.hidden = false;
                    }
                    if (drawer) {
                        drawer.classList.add('is-open');
                    }
                    const toggleBtn = document.getElementById('failedForwardingLogsToggleBtn');
                    if (toggleBtn) {
                        toggleBtn.textContent = I18n.t("Failed to collapse");
                    }
                }
            } catch (error) {
                showToast(I18n.t("Failed to load forwarding failure record"), 'error');
            }
        }

        function toggleForwardingLogsDrawer() {
            const container = document.getElementById('forwardingLogsContainer');
            if (container?.hidden) {
                loadForwardingLogs();
                return;
            }
            hideForwardingLogs();
        }

        function toggleFailedForwardingLogsDrawer() {
            const container = document.getElementById('failedForwardingLogsContainer');
            if (container?.hidden) {
                loadFailedForwardingLogs();
                return;
            }
            hideFailedForwardingLogs();
        }

        function hideForwardingLogs() {
            const drawer = document.getElementById('forwardingLogsDrawer');
            const container = document.getElementById('forwardingLogsContainer');
            if (container) {
                container.hidden = true;
            }
            if (drawer) {
                drawer.classList.remove('is-open');
            }
            const toggleBtn = document.getElementById('forwardingLogsToggleBtn');
            if (toggleBtn) {
                toggleBtn.textContent = I18n.t("View history");
            }
        }

        function hideFailedForwardingLogs() {
            const drawer = document.getElementById('failedForwardingLogsDrawer');
            const container = document.getElementById('failedForwardingLogsContainer');
            if (container) {
                container.hidden = true;
            }
            if (drawer) {
                drawer.classList.remove('is-open');
            }
            const toggleBtn = document.getElementById('failedForwardingLogsToggleBtn');
            if (toggleBtn) {
                toggleBtn.textContent = I18n.t("View failed");
            }
        }

        // Format date and time
        function formatDateTime(dateStr) {
            if (!dateStr) return '-';

            let date;
            if (dateStr instanceof Date) {
                date = dateStr;
            } else if (typeof dateStr === 'number' || /^\d+$/.test(String(dateStr))) {
                const timestamp = Number(dateStr);
                date = new Date(timestamp < 1000000000000 ? timestamp * 1000 : timestamp);
            } else {
                // If the string does not contain time zone information, UTC time is assumed
                if (!dateStr.includes('Z') && !dateStr.includes('+') && !dateStr.includes('-', 10)) {
                    dateStr = dateStr + 'Z';
                }
                date = new Date(dateStr);
            }

            const now = new Date();
            const diff = now - date;
            const minutes = Math.floor(diff / 60000);
            const hours = Math.floor(diff / 3600000);
            const days = Math.floor(diff / 86400000);

            if (minutes < 1) return I18n.t("Just now");
            if (minutes < 60) return I18n.tpl`${minutes} minutes ago`;
            if (hours < 24) return I18n.tpl`${hours} hours ago`;
            if (days < 7) return I18n.tpl`${days} days ago`;

            return date.toLocaleString(I18n.language, {
                timeZone: getAppTimeZone(),
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        }

        // Function to close all modal boxes uniformly (bug fix: prevent modal boxes from accidentally remaining)
        function closeAllModals() {
            const releaseNoticeModal = document.getElementById('releaseNoticeModal');
            if (releaseNoticeModal?.classList.contains('show') && typeof markCurrentReleaseNoticeSeen === 'function') {
                markCurrentReleaseNoticeSeen();
            }

            document.querySelectorAll('.modal').forEach(modal => {
                modal.classList.remove('show');
                modal.style.display = 'none';
                modal.setAttribute('aria-hidden', 'true');
            });

            const settingsPassword = document.getElementById('settingsPassword');
            if (settingsPassword) {
                settingsPassword.value = '';
            }
            const settingsCurrentPassword = document.getElementById('settingsCurrentPassword');
            if (settingsCurrentPassword) {
                settingsCurrentPassword.value = '';
            }

            const exportVerifyPassword = document.getElementById('exportVerifyPassword');
            if (exportVerifyPassword) {
                exportVerifyPassword.value = '';
            }

            if (typeof clearEditAccountSecrets === 'function') {
                clearEditAccountSecrets();
            }

            setRefreshSelectionMode(false);
            resetRefreshModalRuntime();
            hideForwardingLogs();
            hideFailedForwardingLogs();

            closeFullscreenEmail();
            updateModalBodyState();
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                closeNavbarActionsMenu();
                closeMobilePanels();
                closeAccountActionMenus();
                closeTagFilterDropdown();
                closeAllModals();
            }
        });
