        /* global accountPaginationState, accountsCache, clearEmailSelection, closeModal, copyTextToClipboard, currentAccount, currentAccountListSource, currentEmailDetail, currentGroupId, deleteAccount, getSelectedForwardChannels, handleApiError, hideModal, invalidateAccountCaches, isTempEmailGroup, loadAccountsByGroup, loadGroups, loadTags, refreshVisibleAccountList, renderEmailList, selectedEmailIds, setModalVisible, showModal, showToast, startSelectedAccountExport, updateBatchActionBar */

        // ==================== Batch operation ====================

        let accountSelectionMode = false;
        let accountSelectionAnchorId = null;
        let accountSelectionDragState = null;
        let accountSelectionSuppressClickUntil = 0;

        function getAccountSelectionCheckboxes() {
            return Array.from(document.querySelectorAll('#accountList .account-select-checkbox'));
        }

        function getAccountSelectionCheckboxById(accountId) {
            return getAccountSelectionCheckboxes()
                .find(checkbox => String(checkbox.value) === String(accountId));
        }

        function setAccountSelectionMode(enabled) {
            accountSelectionMode = !!enabled;
            document.getElementById('accountPanel')?.classList.toggle('account-selection-mode', accountSelectionMode);
            document.querySelectorAll('.account-selection-mode-btn').forEach(button => {
                button.classList.toggle('active', accountSelectionMode);
                button.setAttribute('aria-pressed', accountSelectionMode ? 'true' : 'false');
                button.title = accountSelectionMode ? I18n.t("Exit batch selection") : I18n.t("Select multiple");
            });
            if (!accountSelectionMode) {
                accountSelectionDragState = null;
            }
        }

        function toggleAccountSelectionMode() {
            setAccountSelectionMode(!accountSelectionMode);
        }

        function setAccountSelectionAnchor(checkbox) {
            if (checkbox) {
                accountSelectionAnchorId = String(checkbox.value);
            }
        }

        function setAccountSelectionRange(fromCheckbox, toCheckbox, checked) {
            const checkboxes = getAccountSelectionCheckboxes();
            const fromIndex = checkboxes.indexOf(fromCheckbox);
            const toIndex = checkboxes.indexOf(toCheckbox);
            if (fromIndex === -1 || toIndex === -1) {
                return false;
            }

            const start = Math.min(fromIndex, toIndex);
            const end = Math.max(fromIndex, toIndex);
            for (let index = start; index <= end; index += 1) {
                checkboxes[index].checked = checked;
            }
            return true;
        }

        function applyAccountSelectionFromCheckbox(checkbox, event = null) {
            if (!checkbox) {
                return;
            }

            if (event?.shiftKey && accountSelectionAnchorId) {
                const anchor = getAccountSelectionCheckboxById(accountSelectionAnchorId);
                if (anchor && setAccountSelectionRange(anchor, checkbox, checkbox.checked)) {
                    event.preventDefault?.();
                }
            }
            setAccountSelectionAnchor(checkbox);
            updateBatchActionBar();
        }

        function handleAccountSelectionCheckboxClick(event) {
            event.stopPropagation();
            if (accountSelectionMode && Date.now() < accountSelectionSuppressClickUntil) {
                event.preventDefault();
                return;
            }
            applyAccountSelectionFromCheckbox(event.currentTarget, event);
        }

        function handleAccountRowSelectionClick(event) {
            if (Date.now() < accountSelectionSuppressClickUntil) {
                event?.preventDefault?.();
                return;
            }
            if (event?.target?.closest?.('.account-menu-wrap, .account-action-btn, .account-menu-trigger, .account-menu-panel, .account-error-btn, button, input, a')) {
                return;
            }

            const item = event.currentTarget;
            const checkbox = item?.querySelector?.('.account-select-checkbox');
            if (!checkbox) {
                return;
            }

            event?.preventDefault?.();
            if (event?.shiftKey && accountSelectionAnchorId) {
                checkbox.checked = true;
                applyAccountSelectionFromCheckbox(checkbox, event);
            } else {
                checkbox.checked = !checkbox.checked;
                applyAccountSelectionFromCheckbox(checkbox, event);
            }
        }

        function setAccountDragSelection(checkbox) {
            if (!accountSelectionDragState || !checkbox) {
                return;
            }
            const accountId = String(checkbox.value);
            if (accountSelectionDragState.visitedIds.has(accountId)) {
                return;
            }
            accountSelectionDragState.visitedIds.add(accountId);
            checkbox.checked = accountSelectionDragState.targetChecked;
            setAccountSelectionAnchor(checkbox);
            updateBatchActionBar();
        }

        function handleAccountSelectionPointerDown(event) {
            if (!accountSelectionMode || event.button !== 0) {
                return;
            }
            const startedOnCheckbox = !!event.target.closest('.account-select-checkbox');
            if (!startedOnCheckbox && event.target.closest('.account-menu-wrap, .account-action-btn, .account-menu-trigger, .account-menu-panel, .account-error-btn, button, input, a')) {
                return;
            }

            const item = event.target.closest('.account-item');
            const checkbox = item?.querySelector?.('.account-select-checkbox');
            if (!checkbox) {
                return;
            }

            event.preventDefault();
            accountSelectionSuppressClickUntil = Date.now() + 350;
            accountSelectionDragState = {
                pointerId: event.pointerId,
                targetChecked: !checkbox.checked,
                visitedIds: new Set()
            };
            document.getElementById('accountList')?.setPointerCapture?.(event.pointerId);
            setAccountDragSelection(checkbox);
        }

        function handleAccountSelectionPointerMove(event) {
            if (!accountSelectionDragState || event.pointerId !== accountSelectionDragState.pointerId) {
                return;
            }
            event.preventDefault();
            const element = document.elementFromPoint(event.clientX, event.clientY);
            const item = element?.closest?.('#accountList .account-item');
            const checkbox = item?.querySelector?.('.account-select-checkbox');
            setAccountDragSelection(checkbox);
        }

        function handleAccountSelectionPointerEnd(event) {
            if (!accountSelectionDragState || event.pointerId !== accountSelectionDragState.pointerId) {
                return;
            }
            document.getElementById('accountList')?.releasePointerCapture?.(event.pointerId);
            accountSelectionDragState = null;
        }

        function initAccountSelectionGestures() {
            const accountList = document.getElementById('accountList');
            if (!accountList || accountList.dataset.boundSelectionGestures) {
                return;
            }
            accountList.dataset.boundSelectionGestures = 'true';
            accountList.addEventListener('pointerdown', handleAccountSelectionPointerDown);
            accountList.addEventListener('pointermove', handleAccountSelectionPointerMove);
            accountList.addEventListener('pointerup', handleAccountSelectionPointerEnd);
            accountList.addEventListener('pointercancel', handleAccountSelectionPointerEnd);
            accountList.addEventListener('scroll', positionAccountBatchActionBar, { passive: true });
            window.addEventListener('resize', positionAccountBatchActionBar);
        }

        function resetAccountBatchActionBarPosition() {
            const bar = document.getElementById('batchActionBar');
            if (!bar) return;
            bar.style.removeProperty('--batch-action-top');
            bar.style.removeProperty('--batch-action-max-width');
        }

        function positionAccountBatchActionBar() {
            const bar = document.getElementById('batchActionBar');
            const panel = document.getElementById('accountPanel');
            const firstChecked = document.querySelector('#accountList .account-select-checkbox:checked');
            const firstSelectedItem = firstChecked?.closest('.account-item');

            if (!bar || !panel || !firstSelectedItem || !window.matchMedia('(min-width: 769px)').matches) {
                resetAccountBatchActionBarPosition();
                return;
            }

            const panelRect = panel.getBoundingClientRect();
            const itemRect = firstSelectedItem.getBoundingClientRect();
            const availableWidth = Math.max(260, window.innerWidth - panelRect.right - 16);
            bar.style.setProperty('--batch-action-max-width', `${Math.min(560, Math.round(availableWidth))}px`);

            const barHeight = bar.offsetHeight || 0;
            const minTop = 8;
            const maxTop = Math.max(minTop, panelRect.height - barHeight - 12);
            const selectedTop = itemRect.top - panelRect.top;
            const top = Math.min(Math.max(selectedTop, minTop), maxTop);

            bar.style.setProperty('--batch-action-top', `${Math.round(top)}px`);
        }

        // Update batch operation bar status
        function updateBatchActionBar() {
            const checked = Array.from(document.querySelectorAll('.account-select-checkbox:checked'));
            const allCheckboxes = document.querySelectorAll('#accountList .account-select-checkbox');
            const bar = document.getElementById('batchActionBar');
            const countSpan = document.getElementById('selectedCount');
            const selectAllBtn = document.getElementById('accountSelectAllBtn');
            const batchRefreshBtn = document.getElementById('batchRefreshTokensBtn');
            const batchOutlookAutoAuthBtn = document.getElementById('batchOutlookAutoAuthBtn');
            const batchCopyBtn = document.getElementById('batchCopyEmailsBtn');
            const batchExportBtn = document.getElementById('batchExportAccountsBtn');
            const batchEnableForwardingBtn = document.getElementById('batchEnableForwardingBtn');
            const batchDisableForwardingBtn = document.getElementById('batchDisableForwardingBtn');
            const batchProxyBtn = document.getElementById('batchProxyBtn');
            const batchAddTagBtn = document.getElementById('batchAddTagBtn');
            const batchRemoveTagBtn = document.getElementById('batchRemoveTagBtn');
            const batchMoveGroupBtn = document.getElementById('batchMoveGroupBtn');
            const batchDeleteBtn = document.getElementById('batchDeleteAccountsBtn');
            const panel = document.getElementById('accountPanel');
            const refreshableChecked = checked.filter(cb => cb.dataset.refreshable === 'true');
            const autoAuthChecked = checked.filter(cb => (cb.dataset.accountType || 'outlook') !== 'imap');
            const enableForwardingChecked = checked.filter(cb => cb.dataset.forwardEnabled !== 'true');
            const disableForwardingChecked = checked.filter(cb => cb.dataset.forwardEnabled === 'true');
            const isForwardingUpdating = batchEnableForwardingBtn?.dataset.loading === 'true'
                || batchDisableForwardingBtn?.dataset.loading === 'true';
            const isTempContext = !!isTempEmailGroup;
            const loadedAccountCount = allCheckboxes.length;
            const totalAccountCount = Number(accountPaginationState?.total) || loadedAccountCount;
            const isPartialPageLoaded = !isTempContext && totalAccountCount > loadedAccountCount;
            const loadedScopeSuffix = isPartialPageLoaded
                ? I18n.tpl`(${loadedAccountCount}/${totalAccountCount} loaded)`
                : '';

            if (batchRefreshBtn) batchRefreshBtn.style.display = isTempContext ? 'none' : 'inline-flex';
            if (batchOutlookAutoAuthBtn) batchOutlookAutoAuthBtn.style.display = isTempContext ? 'none' : 'inline-flex';
            if (batchExportBtn) batchExportBtn.style.display = isTempContext ? 'none' : 'inline-flex';
            if (batchEnableForwardingBtn) batchEnableForwardingBtn.style.display = isTempContext ? 'none' : 'inline-flex';
            if (batchDisableForwardingBtn) batchDisableForwardingBtn.style.display = isTempContext ? 'none' : 'inline-flex';
            if (batchProxyBtn) batchProxyBtn.style.display = isTempContext ? 'none' : 'inline-flex';
            if (batchMoveGroupBtn) batchMoveGroupBtn.style.display = isTempContext ? 'none' : 'inline-flex';
            if (batchAddTagBtn) batchAddTagBtn.style.display = 'inline-flex';
            if (batchRemoveTagBtn) batchRemoveTagBtn.style.display = 'inline-flex';
            if (batchDeleteBtn) batchDeleteBtn.style.display = 'inline-flex';
            if (selectAllBtn) {
                const allLoadedChecked = loadedAccountCount > 0 && checked.length === loadedAccountCount;
                const scopeLabel = isPartialPageLoaded ? I18n.t("Loaded") : '';
                selectAllBtn.textContent = allLoadedChecked
                    ? I18n.tpl`Unselect all ${scopeLabel}`
                    : I18n.tpl`Select all ${scopeLabel}`;
            }

            if (checked.length > 0) {
                bar.style.display = 'flex';
                panel?.classList.add('batch-toolbar-active');
                countSpan.textContent = isTempContext
                    ? I18n.tpl`${checked.length} item selected`
                    : (refreshableChecked.length > 0 && refreshableChecked.length !== checked.length
                    ? I18n.tpl`Item ${checked.length} has been selected, and item ${refreshableChecked.length} can be refreshed ${loadedScopeSuffix}`
                    : I18n.tpl`${checked.length} item ${loadedScopeSuffix} selected`);
                if (batchRefreshBtn) {
                    const isRefreshing = batchRefreshBtn.dataset.loading === 'true';
                    batchRefreshBtn.disabled = refreshableChecked.length === 0 || isRefreshing;
                    batchRefreshBtn.title = refreshableChecked.length === 0
                        ? I18n.t("There is no Outlook account that can be refreshed in the selected account.")
                        : '';
                    if (!isRefreshing) {
                        batchRefreshBtn.textContent = refreshableChecked.length > 0
                            ? I18n.tpl`Refresh Token${refreshableChecked.length !== checked.length ? ` (${refreshableChecked.length})` : ''}`
                            : I18n.t("Refresh Token");
                    }
                }
                if (batchOutlookAutoAuthBtn) {
                    const isQueueing = batchOutlookAutoAuthBtn.dataset.loading === 'true';
                    batchOutlookAutoAuthBtn.disabled = autoAuthChecked.length === 0 || isQueueing;
                    batchOutlookAutoAuthBtn.title = autoAuthChecked.length === 0
                        ? I18n.t("There is no Outlook account that can be added to the automatic authorization among the selected accounts.")
                        : I18n.t("Add the selected Outlook account to the automated authorization queue");
                    if (!isQueueing) {
                        batchOutlookAutoAuthBtn.textContent = autoAuthChecked.length > 0
                            ? I18n.tpl`Add automatic authorization ${autoAuthChecked.length !== checked.length ? ` (${autoAuthChecked.length})` : ''}`
                            : I18n.t("Add automatic authorization");
                    }
                }
                if (batchCopyBtn) {
                    const isCopying = batchCopyBtn.dataset.loading === 'true';
                    batchCopyBtn.disabled = checked.length === 0 || isCopying;
                    if (!isCopying) {
                        batchCopyBtn.textContent = isTempContext
                            ? (checked.length > 1 ? I18n.tpl`Copy mailbox (${checked.length})` : I18n.t("Copy mailbox"))
                            : (checked.length > 1 ? I18n.tpl`Copy email + alias (${checked.length})` : I18n.t("Copy email + alias"));
                    }
                }
                if (batchExportBtn) {
                    batchExportBtn.disabled = checked.length === 0;
                    batchExportBtn.textContent = checked.length > 1 ? I18n.tpl`Export (${checked.length})` : I18n.t("Export");
                }
                if (batchProxyBtn) {
                    const isUpdatingProxy = batchProxyBtn.dataset.loading === 'true';
                    batchProxyBtn.disabled = checked.length === 0 || isUpdatingProxy;
                    if (!isUpdatingProxy) {
                        batchProxyBtn.textContent = checked.length > 1 ? I18n.tpl`Agent (${checked.length})` : I18n.t("Agent");
                    }
                }
                if (batchEnableForwardingBtn) {
                    batchEnableForwardingBtn.disabled = enableForwardingChecked.length === 0 || isForwardingUpdating;
                    batchEnableForwardingBtn.title = enableForwardingChecked.length === 0
                        ? I18n.t("Forwarding has been enabled for all selected accounts")
                        : '';
                    if (batchEnableForwardingBtn.dataset.loading !== 'true') {
                        batchEnableForwardingBtn.textContent = enableForwardingChecked.length > 0
                            ? I18n.tpl`Enable forwarding ${enableForwardingChecked.length !== checked.length ? ` (${enableForwardingChecked.length})` : ''}`
                            : I18n.t("Enable forwarding");
                    }
                }
                if (batchDisableForwardingBtn) {
                    batchDisableForwardingBtn.disabled = disableForwardingChecked.length === 0 || isForwardingUpdating;
                    batchDisableForwardingBtn.title = disableForwardingChecked.length === 0
                        ? I18n.t("All selected accounts have been cancelled.")
                        : '';
                    if (batchDisableForwardingBtn.dataset.loading !== 'true') {
                        batchDisableForwardingBtn.textContent = disableForwardingChecked.length > 0
                            ? I18n.tpl`Cancel forwarding ${disableForwardingChecked.length !== checked.length ? ` (${disableForwardingChecked.length})` : ''}`
                            : I18n.t("Cancel forwarding");
                    }
                }
                if (batchDeleteBtn) {
                    const isDeleting = batchDeleteBtn.dataset.loading === 'true';
                    batchDeleteBtn.disabled = isDeleting;
                    if (!isDeleting) {
                        batchDeleteBtn.textContent = checked.length > 1 ? I18n.tpl`Delete (${checked.length})` : I18n.t("Delete");
                    }
                }
                positionAccountBatchActionBar();
            } else {
                bar.style.display = 'none';
                panel?.classList.remove('batch-toolbar-active');
                resetAccountBatchActionBarPosition();
                if (batchRefreshBtn) {
                    batchRefreshBtn.disabled = false;
                    batchRefreshBtn.dataset.loading = 'false';
                    batchRefreshBtn.textContent = I18n.t("Refresh Token");
                    batchRefreshBtn.title = '';
                }
                if (batchOutlookAutoAuthBtn) {
                    batchOutlookAutoAuthBtn.disabled = false;
                    batchOutlookAutoAuthBtn.dataset.loading = 'false';
                    batchOutlookAutoAuthBtn.textContent = I18n.t("Add automatic authorization");
                    batchOutlookAutoAuthBtn.title = '';
                }
                if (batchCopyBtn) {
                    batchCopyBtn.disabled = false;
                    batchCopyBtn.dataset.loading = 'false';
                    batchCopyBtn.textContent = isTempContext ? I18n.t("Copy mailbox") : I18n.t("Copy email + alias");
                    batchCopyBtn.title = '';
                }
                if (batchExportBtn) {
                    batchExportBtn.disabled = false;
                    batchExportBtn.textContent = I18n.t("Export");
                    batchExportBtn.title = '';
                }
                if (batchProxyBtn) {
                    batchProxyBtn.disabled = false;
                    batchProxyBtn.dataset.loading = 'false';
                    batchProxyBtn.textContent = I18n.t("Agent");
                    batchProxyBtn.title = '';
                }
                if (batchEnableForwardingBtn) {
                    batchEnableForwardingBtn.disabled = false;
                    batchEnableForwardingBtn.dataset.loading = 'false';
                    batchEnableForwardingBtn.textContent = I18n.t("Enable forwarding");
                    batchEnableForwardingBtn.title = '';
                }
                if (batchDisableForwardingBtn) {
                    batchDisableForwardingBtn.disabled = false;
                    batchDisableForwardingBtn.dataset.loading = 'false';
                    batchDisableForwardingBtn.textContent = I18n.t("Cancel forwarding");
                    batchDisableForwardingBtn.title = '';
                }
                if (batchDeleteBtn) {
                    batchDeleteBtn.disabled = false;
                    batchDeleteBtn.dataset.loading = 'false';
                    batchDeleteBtn.textContent = I18n.t("Delete");
                }
            }
        }

        let activeAccountBatchSelectionContext = null;
        let pendingAccountBatchModalContext = null;
        let batchActionType = ''; // 'add' or 'remove'

        function normalizeAccountBatchId(value) {
            const normalized = parseInt(value, 10);
            return Number.isFinite(normalized) ? normalized : null;
        }

        function getMainAccountBatchSelectionCheckboxes() {
            return Array.from(document.querySelectorAll('#accountList .account-select-checkbox:checked'));
        }

        function buildAccountBatchSelectionFromCheckboxes(checkboxes, sourceAccounts = currentAccountListSource) {
            const accountById = new Map();
            (Array.isArray(sourceAccounts) ? sourceAccounts : []).forEach(account => {
                const accountId = normalizeAccountBatchId(account?.id);
                if (accountId !== null) {
                    accountById.set(accountId, account);
                }
            });

            return checkboxes
                .map(checkbox => {
                    const accountId = normalizeAccountBatchId(checkbox.value);
                    if (accountId === null) {
                        return null;
                    }
                    const sourceAccount = accountById.get(accountId) || {};
                    return {
                        ...sourceAccount,
                        id: accountId,
                        email: sourceAccount.email || checkbox.dataset.accountEmail || '',
                        aliases: Array.isArray(sourceAccount.aliases) ? sourceAccount.aliases : [],
                        account_type: sourceAccount.account_type || checkbox.dataset.accountType || 'outlook',
                        provider: sourceAccount.provider || 'outlook',
                        forward_enabled: typeof sourceAccount.forward_enabled === 'boolean'
                            ? sourceAccount.forward_enabled
                            : checkbox.dataset.forwardEnabled === 'true',
                    };
                })
                .filter(Boolean);
        }

        function getMainAccountBatchSelectionContext() {
            const selectedCheckboxes = getMainAccountBatchSelectionCheckboxes();
            const selectedAccounts = buildAccountBatchSelectionFromCheckboxes(selectedCheckboxes);
            const selectedIds = selectedAccounts.map(account => normalizeAccountBatchId(account.id)).filter(Number.isFinite);
            const context = {
                source: 'main-account-list',
                isTempContext: !!isTempEmailGroup,
                selectedCheckboxes,
                selectedAccounts,
                selectedIds,
                selectedEmails: selectedAccounts.map(account => account.email).filter(Boolean),
                buttons: {
                    copy: document.getElementById('batchCopyEmailsBtn'),
                    export: document.getElementById('batchExportAccountsBtn'),
                    refresh: document.getElementById('batchRefreshTokensBtn'),
                    outlookAutoAuth: document.getElementById('batchOutlookAutoAuthBtn'),
                    enableForwarding: document.getElementById('batchEnableForwardingBtn'),
                    disableForwarding: document.getElementById('batchDisableForwardingBtn'),
                    proxy: document.getElementById('batchProxyBtn'),
                    delete: document.getElementById('batchDeleteAccountsBtn'),
                },
                clearSelection: clearAccountSelection,
                updateControls: updateBatchActionBar,
            };
            context.afterMutation = async function afterMainAccountMutation(options = {}) {
                if (context.isTempContext) {
                    delete accountsCache.temp;
                } else if (typeof invalidateAccountCaches === 'function') {
                    invalidateAccountCaches();
                }
                if (Array.isArray(options.deletedEmails) && options.deletedEmails.length && typeof resetSelectedAccountViewIfDeleted === 'function') {
                    resetSelectedAccountViewIfDeleted(options.deletedEmails);
                }
                if (typeof loadGroups === 'function') {
                    await loadGroups();
                }
                if (options.clearSelection !== false && typeof context.clearSelection === 'function') {
                    context.clearSelection();
                }
                if (typeof refreshVisibleAccountList === 'function') {
                    await refreshVisibleAccountList(true);
                }
            };
            return context;
        }

        function snapshotAccountBatchSelectionContext(context) {
            const safeContext = context || getMainAccountBatchSelectionContext();
            return {
                ...safeContext,
                selectedCheckboxes: Array.isArray(safeContext.selectedCheckboxes) ? [...safeContext.selectedCheckboxes] : [],
                selectedIds: Array.isArray(safeContext.selectedIds)
                    ? safeContext.selectedIds.map(normalizeAccountBatchId).filter(Number.isFinite)
                    : [],
                selectedEmails: Array.isArray(safeContext.selectedEmails) ? [...safeContext.selectedEmails] : [],
                selectedAccounts: Array.isArray(safeContext.selectedAccounts)
                    ? safeContext.selectedAccounts.map(account => ({
                        ...account,
                        aliases: Array.isArray(account.aliases) ? [...account.aliases] : [],
                        tags: Array.isArray(account.tags) ? [...account.tags] : [],
                    }))
                    : [],
                buttons: safeContext.buttons || {},
            };
        }

        function withAccountBatchSelectionContext(context, callback) {
            const previousContext = activeAccountBatchSelectionContext;
            activeAccountBatchSelectionContext = snapshotAccountBatchSelectionContext(context);
            try {
                const result = callback();
                if (result && typeof result.then === 'function') {
                    return result.finally(() => {
                        activeAccountBatchSelectionContext = previousContext;
                    });
                }
                activeAccountBatchSelectionContext = previousContext;
                return result;
            } catch (error) {
                activeAccountBatchSelectionContext = previousContext;
                throw error;
            }
        }

        function getCurrentAccountBatchSelectionContext() {
            return activeAccountBatchSelectionContext || getMainAccountBatchSelectionContext();
        }

        function getAccountBatchSelectedIds(context = getCurrentAccountBatchSelectionContext()) {
            return Array.from(new Set((context.selectedIds || [])
                .map(normalizeAccountBatchId)
                .filter(Number.isFinite)));
        }

        function getAccountBatchSelectedAccounts(context = getCurrentAccountBatchSelectionContext()) {
            return Array.isArray(context.selectedAccounts) ? context.selectedAccounts : [];
        }

        function getAccountBatchSelectedEmails(context = getCurrentAccountBatchSelectionContext()) {
            const emailSet = new Set();
            getAccountBatchSelectedAccounts(context)
                .map(account => String(account.email || '').trim())
                .filter(Boolean)
                .forEach(email => emailSet.add(email));
            (context.selectedEmails || [])
                .map(email => String(email || '').trim())
                .filter(Boolean)
                .forEach(email => emailSet.add(email));
            return Array.from(emailSet);
        }

        function getAccountBatchButton(context, name) {
            return context?.buttons?.[name] || null;
        }

        function updateAccountBatchControls(context = getCurrentAccountBatchSelectionContext()) {
            if (typeof context.updateControls === 'function') {
                context.updateControls();
            }
        }

        async function afterSuccessfulAccountBatchMutation(context, options = {}) {
            if (typeof context.afterMutation === 'function') {
                await context.afterMutation(options);
                return;
            }
            if (typeof invalidateAccountCaches === 'function') {
                invalidateAccountCaches();
            }
            if (typeof loadGroups === 'function') {
                await loadGroups();
            }
            if (options.clearSelection !== false && typeof context.clearSelection === 'function') {
                context.clearSelection();
            }
            if (typeof refreshVisibleAccountList === 'function') {
                await refreshVisibleAccountList(true);
            }
        }

        function setPendingAccountBatchModalContext(context = getCurrentAccountBatchSelectionContext()) {
            pendingAccountBatchModalContext = snapshotAccountBatchSelectionContext(context);
            return pendingAccountBatchModalContext;
        }

        function getPendingAccountBatchModalContext() {
            return pendingAccountBatchModalContext || getCurrentAccountBatchSelectionContext();
        }

        function clearPendingAccountBatchModalContext() {
            pendingAccountBatchModalContext = null;
        }

        function toggleSelectAllAccounts() {
            const checkboxes = Array.from(document.querySelectorAll('#accountList .account-select-checkbox'));
            if (!checkboxes.length) return;

            const shouldClear = checkboxes.every(cb => cb.checked);
            checkboxes.forEach(cb => {
                cb.checked = !shouldClear;
            });
            updateBatchActionBar();
        }

        function clearAccountSelection() {
            document.querySelectorAll('#accountList .account-select-checkbox').forEach(cb => {
                cb.checked = false;
            });
            accountSelectionAnchorId = null;
            updateBatchActionBar();
        }

        function getSelectedAccountIds() {
            return getAccountBatchSelectedIds();
        }

        function getSelectedAccounts() {
            return getAccountBatchSelectedAccounts();
        }

        async function copySelectedAccountsWithAliases() {
            const context = getCurrentAccountBatchSelectionContext();
            const btn = getAccountBatchButton(context, 'copy');
            if (!btn || btn.disabled) return;

            const selectedAccounts = getAccountBatchSelectedAccounts(context);
            if (!selectedAccounts.length) {
                showToast(I18n.t("Please select the mailbox to be copied first"), 'error');
                return;
            }

            const emailSet = new Set();
            selectedAccounts.forEach(account => {
                const candidates = [account.email].concat(Array.isArray(account.aliases) ? account.aliases : []);
                candidates
                    .map(value => String(value || '').trim())
                    .filter(Boolean)
                    .forEach(email => emailSet.add(email));
            });

            const emailList = Array.from(emailSet);
            if (!emailList.length) {
                showToast(I18n.t("The selected account does not have an email address that can be copied."), 'error');
                return;
            }

            btn.disabled = true;
            btn.dataset.loading = 'true';
            btn.textContent = I18n.t("Copying...");

            try {
                await copyTextToClipboard(emailList.join('\n'), I18n.tpl`${emailList.length} email addresses copied`);
            } finally {
                btn.dataset.loading = 'false';
                updateAccountBatchControls(context);
            }
        }

        function exportSelectedAccounts() {
            const context = getCurrentAccountBatchSelectionContext();
            if (context.isTempContext) {
                showToast(I18n.t("Temporary mailboxes do not currently support selected export."), 'error');
                return;
            }

            const accountIds = getAccountBatchSelectedIds(context);
            if (!accountIds.length) {
                showToast(I18n.t("Please select the email address to be exported first."), 'error');
                return;
            }

            startSelectedAccountExport(accountIds);
        }

        async function queueSelectedAccountsForOutlookAutoAuth() {
            const context = getCurrentAccountBatchSelectionContext();
            const btn = getAccountBatchButton(context, 'outlookAutoAuth');
            if (!btn || btn.disabled) return;
            if (context.isTempContext) {
                showToast(I18n.t("Temporary mailboxes do not support automatic authorization."), 'error');
                return;
            }

            const eligibleAccounts = getAccountBatchSelectedAccounts(context)
                .filter(account => String(account.account_type || 'outlook').toLowerCase() !== 'imap');
            const accountIds = eligibleAccounts
                .map(account => normalizeAccountBatchId(account.id))
                .filter(Number.isFinite);

            if (!accountIds.length) {
                showToast(I18n.t("There is no Outlook account that can be added to the automatic authorization among the selected accounts."), 'error');
                return;
            }
            if (!(await showConfirmModal(
                I18n.tpl`Are you sure to add the selected ${accountIds.length} Outlook accounts to the automatic authorization queue?`,
                { title: I18n.t("Add automatic authorization in batches"), confirmText: I18n.t("Confirm to join"), danger: false }
            ))) {
                return;
            }

            btn.disabled = true;
            btn.dataset.loading = 'true';
            btn.textContent = I18n.t("Joining the team...");

            try {
                const response = await fetch('/api/accounts/batch-outlook-auto-auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ account_ids: accountIds }),
                });
                const data = await response.json();
                if (!data.success) {
                    handleApiError(data, I18n.t("Failed to join automatic authorization in batches"));
                    return;
                }
                showToast(data.message || I18n.tpl`${accountIds.length} accounts processed`, 'success');
                const modal = document.getElementById('outlookUploadAccountsModal');
                if (modal && modal.classList.contains('show') && typeof loadUploadAccounts === 'function') {
                    loadUploadAccounts();
                }
            } catch (error) {
                showToast(I18n.t("Failed to join automatic authorization in batches: ") + error.message, 'error');
            } finally {
                btn.dataset.loading = 'false';
                updateAccountBatchControls(context);
            }
        }

        async function refreshSelectedAccounts() {
            const context = getCurrentAccountBatchSelectionContext();
            const btn = getAccountBatchButton(context, 'refresh');
            if (!btn || btn.disabled) return;

            const accountIds = getAccountBatchSelectedIds(context);
            const refreshableCount = getAccountBatchSelectedAccounts(context)
                .filter(account => String(account.account_type || 'outlook').toLowerCase() !== 'imap')
                .length;

            if (!accountIds.length) {
                showToast(I18n.t("Please select the email address you want to refresh first"), 'error');
                return;
            }
            if (!refreshableCount) {
                showToast(I18n.t("There is no Outlook account that can be refreshed in the selected account."), 'error');
                return;
            }
            if (!(await showConfirmModal(I18n.tpl`Are you sure you want to refresh the tokens of the selected ${accountIds.length} mailboxes?`, { title: I18n.t("Batch refresh Token"), confirmText: I18n.t("Confirm refresh"), danger: false }))) {
                return;
            }

            btn.disabled = true;
            btn.dataset.loading = 'true';
            btn.textContent = I18n.t("Refreshing...");

            try {
                const response = await fetch('/api/accounts/refresh-selected', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ account_ids: accountIds })
                });
                const data = await response.json();

                if (!data.success) {
                    handleApiError(data, I18n.t("Batch refresh failed"));
                    return;
                }

                const toastType = data.failed_count > 0 || data.skipped_count > 0 ? 'warning' : 'success';
                showToast(
                    I18n.tpl`Batch refresh completed: success ${data.success_count}, failure ${data.failed_count}, skip ${data.skipped_count}`,
                    toastType
                );

                if (data.failed_count > 0) {
                    await openRefreshModalWithStatus('failed');
                } else {
                    loadRefreshStats();
                }

                if (typeof context.clearSelection === 'function') {
                    context.clearSelection();
                }
                if (typeof refreshVisibleAccountList === 'function') {
                    await refreshVisibleAccountList(true);
                }
            } catch (error) {
                showToast(I18n.t("Batch refresh request failed"), 'error');
            } finally {
                btn.dataset.loading = 'false';
                updateAccountBatchControls(context);
            }
        }

        async function updateForwardingForSelectedAccounts(targetEnabled) {
            const context = getCurrentAccountBatchSelectionContext();
            const btn = getAccountBatchButton(context, targetEnabled ? 'enableForwarding' : 'disableForwarding');
            if (!btn || btn.disabled) return;

            const selectedAccounts = getAccountBatchSelectedAccounts(context);
            const accountIds = getAccountBatchSelectedIds(context);
            const eligibleCount = selectedAccounts.filter(account => !!account.forward_enabled !== targetEnabled).length;
            const actionLabel = targetEnabled ? I18n.t("Enable forwarding") : I18n.t("Cancel forwarding");
            const loadingLabel = targetEnabled ? I18n.t("Opening...") : I18n.t("Canceling...");
            const finishedLabel = targetEnabled ? I18n.t("All forwarding is enabled") : I18n.t("All forwarding has been canceled");
            const skippedLabel = targetEnabled ? I18n.t("Enabled") : I18n.t("Canceled");

            if (!accountIds.length) {
                showToast(I18n.tpl`Please select the email address of ${actionLabel} first`, 'error');
                return;
            }
            if (!eligibleCount) {
                showToast(I18n.tpl`Selected account ${finishedLabel}`, 'error');
                return;
            }

            const skippedCount = accountIds.length - eligibleCount;
            const confirmMessage = skippedCount > 0
                ? I18n.tpl`Are you sure you want to ${actionLabel} the selected ${accountIds.length} mailboxes? Among them, ${skippedCount} ${skippedLabel} accounts will be automatically skipped.`
                : I18n.tpl`Are you sure you want to ${actionLabel} the selected ${accountIds.length} mailboxes?`;
            if (!(await showConfirmModal(confirmMessage, { title: actionLabel, confirmText: I18n.t("Confirm"), danger: false }))) {
                return;
            }

            btn.disabled = true;
            btn.dataset.loading = 'true';
            btn.textContent = loadingLabel;

            try {
                const response = await fetch('/api/accounts/batch-update-forwarding', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        account_ids: accountIds,
                        forward_enabled: targetEnabled
                    })
                });
                const data = await response.json();

                if (!data.success) {
                    handleApiError(data, I18n.tpl`Batch ${actionLabel} failed`);
                    return;
                }

                showToast(data.message || I18n.tpl`Already ${actionLabel} for ${eligibleCount} accounts`, 'success');
                await afterSuccessfulAccountBatchMutation(context);
            } catch (error) {
                showToast(I18n.tpl`Batch ${actionLabel} failed`, 'error');
            } finally {
                btn.dataset.loading = 'false';
                updateAccountBatchControls(context);
            }
        }

        async function enableForwardingForSelectedAccounts() {
            await updateForwardingForSelectedAccounts(true);
        }

        async function disableForwardingForSelectedAccounts() {
            await updateForwardingForSelectedAccounts(false);
        }

        async function deleteSelectedAccounts() {
            const context = getCurrentAccountBatchSelectionContext();
            const btn = getAccountBatchButton(context, 'delete');
            if (!btn || btn.disabled) return;

            const accountIds = getAccountBatchSelectedIds(context);
            const accountEmails = getAccountBatchSelectedEmails(context);
            const isTempContext = !!context.isTempContext;

            if (!accountIds.length) {
                showToast(isTempContext ? I18n.t("Please select the temporary mailbox to be deleted first") : I18n.t("Please select the email address you want to delete first"), 'error');
                return;
            }

            const resourceLabel = isTempContext ? I18n.t("Temporary mailboxes") : I18n.t("Mailboxes");
            if (!(await showConfirmModal(I18n.tpl`Are you sure you want to delete the selected ${accountIds.length} ${resourceLabel}? This operation is irreversible.`, { title: I18n.tpl`Batch delete ${resourceLabel}`, confirmText: I18n.t("Confirm deletion") }))) {
                return;
            }

            btn.disabled = true;
            btn.dataset.loading = 'true';
            btn.textContent = I18n.t("Deleting...");

            try {
                const response = await fetch(isTempContext ? '/api/temp-emails/batch-delete' : '/api/accounts/batch-delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(isTempContext
                        ? { temp_email_ids: accountIds }
                        : { account_ids: accountIds })
                });
                const data = await response.json();

                if (!data.success) {
                    handleApiError(data, I18n.t("Batch deletion failed"));
                    return;
                }

                const deletedEmails = Array.isArray(isTempContext ? data.deleted_emails : data.deleted_accounts)
                    ? (isTempContext ? data.deleted_emails : data.deleted_accounts).map(item => item.email).filter(Boolean)
                    : accountEmails;

                showToast(data.message || I18n.tpl`${deletedEmails.length} ${resourceLabel} deleted`, 'success');
                await afterSuccessfulAccountBatchMutation(context, { deletedEmails });
            } catch (error) {
                showToast(I18n.t("Batch deletion failed"), 'error');
            } finally {
                btn.dataset.loading = 'false';
                updateAccountBatchControls(context);
            }
        }

        // Display batch marking modal box
        async function showBatchTagModal(type) {
            const context = setPendingAccountBatchModalContext();
            const accountIds = getAccountBatchSelectedIds(context);
            if (!accountIds.length) {
                showToast(I18n.t("Please select the account you want to operate first"), 'error');
                clearPendingAccountBatchModalContext();
                return;
            }
            batchActionType = type;
            const resourceLabel = context.isTempContext ? I18n.t("Temporary mailboxes") : I18n.t("Account");
            document.getElementById('batchTagTitle').textContent = type === 'add'
                ? I18n.tpl`Add tags to ${resourceLabel} in batches`
                : I18n.tpl`Remove ${resourceLabel} tags in batches`;
            showModal('batchTagModal');

            // Load label options
            await loadTagsForSelect();
        }

        function hideBatchTagModal() {
            clearPendingAccountBatchModalContext();
            hideModal('batchTagModal');
        }

        // Load tags into drop-down box
        async function loadTagsForSelect() {
            const select = document.getElementById('batchTagSelect');
            select.innerHTML = I18n.t("<option value=\"\">Loading…</option>");

            try {
                const response = await fetch('/api/tags');
                const data = await response.json();
                if (data.success) {
                    let html = I18n.t("<option value=\"\">Please select a label...</option>");
                    data.tags.forEach(tag => {
                        html += `<option value="${tag.id}">${escapeHtml(tag.name)}</option>`;
                    });
                    select.innerHTML = html;
                }
            } catch (error) {
                select.innerHTML = I18n.t("<option value=\"\">Loading failed</option>");
            }
        }

        // Confirm batch marking
        async function confirmBatchTag() {
            const context = getPendingAccountBatchModalContext();
            const tagId = document.getElementById('batchTagSelect').value;
            if (!tagId) {
                showToast(I18n.t("Please select a label"), 'error');
                return;
            }

            const accountIds = getAccountBatchSelectedIds(context);
            if (accountIds.length === 0) return;

            try {
                const isTempContext = !!context.isTempContext;
                const response = await fetch(isTempContext ? '/api/temp-emails/tags' : '/api/accounts/tags', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(isTempContext
                        ? {
                            temp_email_ids: accountIds,
                            tag_id: parseInt(tagId, 10),
                            action: batchActionType
                        }
                        : {
                            account_ids: accountIds,
                            tag_id: parseInt(tagId, 10),
                            action: batchActionType
                        })
                });

                const data = await response.json();
                if (data.success) {
                    showToast(data.message, 'success');
                    hideBatchTagModal();
                    await afterSuccessfulAccountBatchMutation(context);
                } else {
                    showToast(data.error || I18n.t("Operation failed"), 'error');
                }
            } catch (error) {
                showToast(I18n.t("Request failed"), 'error');
            } finally {
                updateAccountBatchControls(context);
            }
        }

        // ==================== Batch proxy settings ====================

        function showBatchProxyModal() {
            const context = setPendingAccountBatchModalContext();
            if (context.isTempContext) {
                showToast(I18n.t("Temporary email does not support account proxy settings"), 'error');
                clearPendingAccountBatchModalContext();
                return;
            }
            const accountIds = getAccountBatchSelectedIds(context);
            if (!accountIds.length) {
                showToast(I18n.t("Please first select the email address where you want to set up a proxy"), 'error');
                clearPendingAccountBatchModalContext();
                return;
            }
            document.getElementById('batchProxyUrl').value = '';
            document.getElementById('batchFallbackProxyUrl1').value = '';
            document.getElementById('batchFallbackProxyUrl2').value = '';
            showModal('batchProxyModal');
        }

        function hideBatchProxyModal() {
            clearPendingAccountBatchModalContext();
            hideModal('batchProxyModal');
        }

        async function confirmBatchProxy() {
            const context = getPendingAccountBatchModalContext();
            const btn = getAccountBatchButton(context, 'proxy');
            const accountIds = getAccountBatchSelectedIds(context);
            if (!accountIds.length) {
                showToast(I18n.t("Please first select the email address where you want to set up a proxy"), 'error');
                return;
            }

            const proxyUrl = document.getElementById('batchProxyUrl').value.trim();
            const fallbackProxyUrl1 = document.getElementById('batchFallbackProxyUrl1').value.trim();
            const fallbackProxyUrl2 = document.getElementById('batchFallbackProxyUrl2').value.trim();
            const isClearing = !proxyUrl && !fallbackProxyUrl1 && !fallbackProxyUrl2;
            const confirmMessage = isClearing
                ? I18n.tpl`Are you sure you want to clear the account proxies of the selected ${accountIds.length} mailboxes and inherit the group proxies instead?`
                : I18n.tpl`Are you sure you want to set up an account proxy for the selected ${accountIds.length} mailboxes?`;

            if (!(await showConfirmModal(confirmMessage, { title: I18n.t("Set up account proxy"), confirmText: I18n.t("Confirm"), danger: false }))) {
                return;
            }

            if (btn) {
                btn.disabled = true;
                btn.dataset.loading = 'true';
                btn.textContent = I18n.t("Setting up...");
            }

            try {
                const response = await fetch('/api/accounts/batch-update-proxy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        account_ids: accountIds,
                        proxy_url: proxyUrl,
                        fallback_proxy_url_1: fallbackProxyUrl1,
                        fallback_proxy_url_2: fallbackProxyUrl2
                    })
                });
                const data = await response.json();
                if (!data.success) {
                    handleApiError(data, I18n.t("Failed to set proxy in batches"));
                    return;
                }

                showToast(data.message || I18n.t("Account agent has been updated"), 'success');
                hideBatchProxyModal();
                await afterSuccessfulAccountBatchMutation(context);
            } catch (error) {
                showToast(I18n.t("Failed to set proxy in batches"), 'error');
            } finally {
                if (btn) {
                    btn.dataset.loading = 'false';
                }
                updateAccountBatchControls(context);
            }
        }

        // ==================== Batch move group ====================

        // Display batch move group modal box
        async function showBatchMoveGroupModal() {
            const context = setPendingAccountBatchModalContext();
            if (context.isTempContext) {
                showToast(I18n.t("Temporary mailbox does not support moving groups"), 'error');
                clearPendingAccountBatchModalContext();
                return;
            }
            const accountIds = getAccountBatchSelectedIds(context);
            if (!accountIds.length) {
                showToast(I18n.t("Please select the mailbox you want to move first"), 'error');
                clearPendingAccountBatchModalContext();
                return;
            }
            showModal('batchMoveGroupModal');
            await loadGroupsForBatchMove();
        }

        function hideBatchMoveGroupModal() {
            clearPendingAccountBatchModalContext();
            hideModal('batchMoveGroupModal');
        }

        // Load group into drop-down box
        async function loadGroupsForBatchMove() {
            const select = document.getElementById('batchMoveGroupSelect');
            select.innerHTML = I18n.t("<option value=\"\">Loading…</option>");

            try {
                const response = await fetch('/api/groups');
                const data = await response.json();
                if (data.success) {
                    let html = I18n.t("<option value=\"\">Please select a group...</option>");
                    const batchMoveTree = typeof buildGroupTree === 'function' ? buildGroupTree(data.groups) : [];
                    const optionGroups = typeof flattenGroupTree === 'function'
                        ? flattenGroupTree(batchMoveTree)
                        : data.groups;
                    optionGroups.filter(g => !g.is_system).forEach(group => {
                        const label = typeof getGroupOptionLabel === 'function'
                            ? getGroupOptionLabel(group)
                            : normalizeGroupName(group.name);
                        html += `<option value="${group.id}">${escapeHtml(label)}</option>`;
                    });
                    select.innerHTML = html;
                }
            } catch (error) {
                select.innerHTML = I18n.t("<option value=\"\">Loading failed</option>");
            }
        }

        // Confirm batch move grouping
        async function confirmBatchMoveGroup() {
            const context = getPendingAccountBatchModalContext();
            const groupId = document.getElementById('batchMoveGroupSelect').value;
            if (!groupId) {
                showToast(I18n.t("Please select the target group"), 'error');
                return;
            }

            const accountIds = getAccountBatchSelectedIds(context);
            if (accountIds.length === 0) return;

            try {
                const response = await fetch('/api/accounts/batch-update-group', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        account_ids: accountIds,
                        group_id: parseInt(groupId, 10)
                    })
                });

                const data = await response.json();
                if (data.success) {
                    showToast(data.message, 'success');
                    hideBatchMoveGroupModal();
                    await afterSuccessfulAccountBatchMutation(context);
                } else {
                    showToast(data.error || I18n.t("Operation failed"), 'error');
                }
            } catch (error) {
                showToast(I18n.t("Request failed"), 'error');
            } finally {
                updateAccountBatchControls(context);
            }
        }
