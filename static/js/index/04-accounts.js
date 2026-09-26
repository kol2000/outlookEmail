        /* global accountsCache, applyEmailListCache, closeMobilePanels, currentAccount, currentAccountListSource, currentAccountSummary, currentEmailDetail, currentEmailId, currentEmails, currentFolder, currentGroupId, currentMethod, currentSkip, emailListCache, getEmailListCacheEntry, getNextEmailSkipFromCache, handleApiError, hasMoreEmails, hideModal, isTempEmailGroup, loadAccountsByGroup, loadEmails, loadGroups, renderEmailList, scheduleEmailListLoadCheck, showEmailList, showToast, updateGraphSendMailAvailability, updateMobileContext */

        // ==================== Account related ====================

        function buildCurrentAccountSummary(email, accountId) {
            const targetId = Number(accountId) || 0;
            const normalizedEmail = String(email || '').trim();
            const source = (currentAccountListSource || []).find(account => (
                (targetId > 0 && Number(account?.id) === targetId)
                || (targetId <= 0 && String(account?.email || '').trim() === normalizedEmail)
            )) || {};
            return {
                id: Number(source.id || targetId) || 0,
                email: String(source.email || normalizedEmail).trim(),
                account_type: String(source.account_type || '').trim().toLowerCase(),
                provider: String(source.provider || '').trim().toLowerCase(),
                authorization_type: String(source.authorization_type || '').trim().toLowerCase(),
                status: String(source.status || '').trim().toLowerCase(),
            };
        }

        // Select account
        function selectAccount(email, accountId = 0) {
            currentAccount = email;
            currentAccountSummary = buildCurrentAccountSummary(email, accountId);
            isTempEmailGroup = false;
            if (typeof updateGraphSendMailAvailability === 'function') {
                updateGraphSendMailAvailability();
            }
            currentFolder = 'all'; // Reset to all mail
            currentEmailId = null;
            currentEmailDetail = null;

            document.getElementById('currentAccount').classList.add('show');
            document.getElementById('currentAccountEmail').textContent = email;
            showEmailList({ scheduleLoadCheck: false });
            closeMobilePanels();
            updateMobileContext();

            document.querySelectorAll('.account-item').forEach(item => {
                item.classList.remove('active');
                const emailEl = item.querySelector('.account-email');
                if (emailEl && emailEl.textContent.includes(email)) {
                    item.classList.add('active');
                }
            });

            // Show folder switching button
            const folderTabs = document.getElementById('folderTabs');
            if (folderTabs) {
                folderTabs.style.display = 'flex';
                // Reset to all mail
                document.querySelectorAll('.folder-tab').forEach(tab => {
                    tab.classList.toggle('active', tab.dataset.folder === 'all');
                });
            }

            const cache = getEmailListCacheEntry(email, 'all');

            // Check cache
            if (cache) {
                applyEmailListCache(cache, { scheduleLoadCheck: false });
            } else {
                document.getElementById('emailList').innerHTML = I18n.tpl`
                    <div class="empty-state">
                        <div class="empty-state-icon">📬</div>
                        <div class="empty-state-text">Automatically refreshing all emails...</div>
                    </div>
                `;
                document.getElementById('emailCount').textContent = '';
                document.getElementById('methodTag').style.display = 'none';
                currentEmails = [];
            }

            document.getElementById('emailDetail').innerHTML = I18n.tpl`
                <div class="empty-state">
                    <div class="empty-state-icon">📄</div>
                    <div class="empty-state-text">Select an email to view details</div>
                </div>
            `;
            document.getElementById('emailDetailToolbar').style.display = 'none';

            // Automatically loaded when entering miss cache for the first time
            if (!cache) {
                loadEmails(email);
            }
        }

        // Hide the add account modal box
        function hideAddAccountModal() {
            hideModal('addAccountModal');
        }

        // Hide the edit account modal box
        function hideEditAccountModal() {
            if (typeof clearEditAccountSecrets === 'function') {
                clearEditAccountSecrets();
            }
            document.getElementById('editTagFilterDropdown')?.classList.remove('open');
            hideModal('editAccountModal');
        }

        // Delete the currently edited account
        async function deleteCurrentAccount() {
            const accountId = document.getElementById('editAccountId').value;
            const email = document.getElementById('editEmail').value;
            const groupId = parseInt(document.getElementById('editGroupSelect').value);

            if (!(await showConfirmModal(I18n.tpl`Are you sure you want to delete account ${email}?`, { title: I18n.t("Delete account"), confirmText: I18n.t("Confirm deletion") }))) {
                return;
            }

            try {
                const response = await fetch(`/api/accounts/${accountId}`, { method: 'DELETE' });
                const data = await response.json();

                if (data.success) {
                    showToast(I18n.t("Deletion successful"), 'success');
                    hideEditAccountModal();

                    // Clear cache
                    delete accountsCache[groupId];

                    if (currentAccount === email) {
                        currentAccount = null;
                        currentAccountSummary = null;
                        if (typeof updateGraphSendMailAvailability === 'function') {
                            updateGraphSendMailAvailability();
                        }
                        document.getElementById('currentAccount').classList.remove('show');
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

                    // Refresh group list
                    loadGroups();

                    // Refresh the mailbox list of the current group
                    if (currentGroupId) {
                        loadAccountsByGroup(currentGroupId, true);
                    }
                }
            } catch (error) {
                showToast(I18n.t("Delete failed"), 'error');
            }
        }

        // Switch account status (enable/disable)
        async function toggleAccountStatus(accountId, currentStatus) {
            const newStatus = currentStatus === 'inactive' ? 'active' : 'inactive';
            const action = newStatus === 'inactive' ? I18n.t("Deactivate") : I18n.t("enable");

            try {
                const response = await fetch(`/api/accounts/${accountId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: newStatus })
                });

                const data = await response.json();

                if (data.success) {
                    showToast(I18n.tpl`${action} succeeded`, 'success');
                    if (Number(currentAccountSummary?.id) === Number(accountId)) {
                        currentAccountSummary = {
                            ...currentAccountSummary,
                            status: newStatus,
                        };
                        if (typeof updateGraphSendMailAvailability === 'function') {
                            updateGraphSendMailAvailability();
                        }
                    }

                    // Clear the cache of the current group
                    if (currentGroupId) {
                        delete accountsCache[currentGroupId];
                        loadAccountsByGroup(currentGroupId, true);
                    }
                } else {
                    handleApiError(data, I18n.tpl`${action} account failed`);
                }
            } catch (error) {
                showToast(I18n.tpl`${action} failed`, 'error');
            }
        }

        // Delete account (shortcut)
        async function deleteAccount(accountId, email) {
            if (!(await showConfirmModal(I18n.tpl`Are you sure you want to delete account ${email}?`, { title: I18n.t("Delete account"), confirmText: I18n.t("Confirm deletion") }))) {
                return;
            }

            try {
                const response = await fetch(`/api/accounts/${accountId}`, { method: 'DELETE' });
                const data = await response.json();

                if (data.success) {
                    showToast(I18n.t("Deletion successful"), 'success');
                    invalidateAccountCaches();
                    resetSelectedAccountViewIfDeleted([email]);
                    loadGroups();
                    await refreshVisibleAccountList(true);
                } else {
                    handleApiError(data, I18n.t("Failed to delete account"));
                }
            } catch (error) {
                showToast(I18n.t("Delete failed"), 'error');
            }
        }

        // Display the export mailbox modal box
        async function showExportModal() {
            showModal('exportModal');
            await loadExportGroupList();
        }

        // Hide export mailbox modal box
        function hideExportModal() {
            hideModal('exportModal');
        }

        // Load export group list
        async function loadExportGroupList() {
            const container = document.getElementById('exportGroupList');
            container.innerHTML = '<div class="loading loading-small"><div class="loading-spinner"></div></div>';

            try {
                // Using loaded grouped data
                if (groups.length === 0) {
                    container.innerHTML = I18n.t("<div style=\"padding: 20px; text-align: center; color: #999;\">No grouping yet</div>");
                } else {
                    const sortedGroups = typeof flattenGroupTree === 'function' && typeof buildGroupTree === 'function'
                        ? flattenGroupTree(buildGroupTree(groups))
                        : groups;

                    container.innerHTML = sortedGroups.map(group => {
                        const level = typeof normalizeGroupLevel === 'function' ? normalizeGroupLevel(group) : 1;
                        const paddingLeft = 12 + (level - 1) * 16;
                        const count = group.descendant_account_count ?? group.account_count ?? 0;
                        return `
                            <label style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; padding-left: ${paddingLeft}px; cursor: pointer; border-radius: 6px; transition: background-color 0.15s, opacity 0.15s;"
                                   onmouseover="this.style.backgroundColor='#f5f5f5'"
                                   onmouseout="this.style.backgroundColor='transparent'">
                                <input type="checkbox" class="export-group-checkbox" value="${group.id}" style="width: 16px; height: 16px;">
                                <span style="display: flex; align-items: center; gap: 8px; flex: 1;">
                                    <span style="width: 12px; height: 12px; border-radius: 3px; background-color: ${group.color || '#666'}"></span>
                                    <span style="display: inline-flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
                                        <span style="font-size: 14px; color: #1a1a1a; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(normalizeGroupName(group.name))}</span>
                                        ${formatGroupIdBadgeText(group.id) ? `<span class="group-id-badge">${escapeHtml(formatGroupIdBadgeText(group.id))}</span>` : ''}
                                    </span>
                                </span>
                                <span style="font-size: 12px; color: #999; background-color: #f0f0f0; padding: 2px 8px; border-radius: 10px;">${count || 0}</span>
                            </label>
                        `;
                    }).join('');

                    // Bind checkbox change event
                    document.querySelectorAll('.export-group-checkbox').forEach(cb => {
                        cb.addEventListener('change', handleExportCheckboxChange);
                    });
                    syncExportGroupCheckboxStates();
                }
            } catch (error) {
                container.innerHTML = I18n.t("<div style=\"padding: 20px; text-align: center; color: #dc3545;\">Loading failed</div>");
            }

            // Reset the Select All checkbox
            document.getElementById('selectAllGroups').checked = false;
        }

        // Get the ID list of subordinate groups
        function getDescendantGroupIds(groupId) {
            const descendants = [];
            const queue = [Number(groupId)];
            while (queue.length > 0) {
                const currentId = queue.shift();
                groups.forEach(g => {
                    if (g.parent_id && Number(g.parent_id) === currentId) {
                        descendants.push(g.id);
                        queue.push(g.id);
                    }
                });
            }
            return descendants;
        }

        function hasSelectedAncestorGroup(groupId, selectedGroupIds) {
            let current = groups.find(g => Number(g.id) === Number(groupId));
            while (current && current.parent_id) {
                const parentId = Number(current.parent_id);
                if (selectedGroupIds.has(parentId)) {
                    return true;
                }
                current = groups.find(g => Number(g.id) === parentId);
            }
            return false;
        }

        function syncExportGroupCheckboxStates() {
            const checkboxes = Array.from(document.querySelectorAll('.export-group-checkbox'));
            const selectedGroupIds = new Set(checkboxes
                .filter(cb => cb.checked)
                .map(cb => Number(cb.value)));

            checkboxes.forEach(cb => {
                const coveredByParent = hasSelectedAncestorGroup(Number(cb.value), selectedGroupIds);
                cb.disabled = coveredByParent;
                if (coveredByParent) {
                    cb.checked = true;
                }
                const row = cb.closest('label');
                if (row) {
                    row.style.opacity = coveredByParent ? '0.45' : '';
                    row.style.cursor = coveredByParent ? 'default' : 'pointer';
                }
            });
        }

        // Handle export checkbox changes
        function handleExportCheckboxChange(event) {
            const cb = event.target;
            if (!cb) return;
            const groupId = Number(cb.value);
            const isChecked = cb.checked;

            const descendants = getDescendantGroupIds(groupId);
            descendants.forEach(descId => {
                const descCb = document.querySelector(`.export-group-checkbox[value="${descId}"]`);
                if (descCb) {
                    descCb.checked = isChecked;
                }
            });
            syncExportGroupCheckboxStates();
        }

        // Select/unselect all groups
        function toggleSelectAllGroups() {
            const selectAll = document.getElementById('selectAllGroups').checked;
            document.querySelectorAll('.export-group-checkbox').forEach(cb => {
                cb.checked = selectAll;
            });
            syncExportGroupCheckboxStates();
        }

        // Store the group or account ID to be exported
        let pendingExportGroupIds = [];
        let pendingExportAccountIds = [];
        let pendingExportUploadAccountIds = [];

        // Export selected group
        async function exportSelectedGroups() {
            const checkboxes = Array.from(document.querySelectorAll('.export-group-checkbox:checked'));
            const selectedGroupIds = checkboxes.map(cb => parseInt(cb.value));

            // Filter out subgroups whose parent group is also selected to avoid repeated exports
            const groupIds = selectedGroupIds.filter(groupId => {
                let current = groups.find(g => Number(g.id) === Number(groupId));
                while (current && current.parent_id) {
                    if (selectedGroupIds.includes(Number(current.parent_id))) {
                        return false;
                    }
                    current = groups.find(g => Number(g.id) === Number(current.parent_id));
                }
                return true;
            });

            if (groupIds.length === 0) {
                showToast(I18n.t("Please select the group to export"), 'error');
                return;
            }

            pendingExportGroupIds = groupIds;
            pendingExportAccountIds = [];

            // Show password confirmation dialog
            hideExportModal();
            showExportVerifyModal();
        }

        function startSelectedAccountExport(accountIds) {
            const normalizedIds = Array.from(new Set((accountIds || [])
                .map(accountId => parseInt(accountId, 10))
                .filter(Number.isFinite)));

            if (!normalizedIds.length) {
                showToast(I18n.t("Please select the email address to be exported first."), 'error');
                return;
            }

            pendingExportGroupIds = [];
            pendingExportAccountIds = normalizedIds;
            pendingExportUploadAccountIds = [];
            showExportVerifyModal();
        }

        function startUploadAccountExport(accountIds) {
            const normalizedIds = Array.from(new Set((accountIds || [])
                .map(id => parseInt(id, 10))
                .filter(Number.isFinite)));

            if (!normalizedIds.length) {
                showToast(I18n.t("Please select the account to be exported first"), 'error');
                return;
            }

            pendingExportGroupIds = [];
            pendingExportAccountIds = [];
            pendingExportUploadAccountIds = normalizedIds;
            showExportVerifyModal();
        }

        // Display export password confirmation dialog box
        function showExportVerifyModal() {
            showModal('exportVerifyModal');
            const passwordInput = document.getElementById('exportVerifyPassword');
            if (passwordInput) {
                passwordInput.value = '';
                passwordInput.focus();
            }
        }

        // Hide export password confirmation dialog box
        function hideExportVerifyModal() {
            hideModal('exportVerifyModal');
            const passwordInput = document.getElementById('exportVerifyPassword');
            if (passwordInput) {
                passwordInput.value = '';
            }
        }

        // Confirm export verification
        async function confirmExportVerify() {
            const password = document.getElementById('exportVerifyPassword').value;

            if (!password) {
                showToast(I18n.t("Please enter password"), 'error');
                return;
            }

            try {
                // Get verification token
                const verifyResponse = await fetch('/api/export/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                });

                const verifyData = await verifyResponse.json();

                if (!verifyData.success) {
                    showToast(verifyData.error || I18n.t("Wrong password"), 'error');
                    return;
                }

                const verifyToken = verifyData.verify_token;

                const exportPayload = {
                    verify_token: verifyToken
                };
                let exportUrl = '/api/accounts/export-selected';
                if (pendingExportUploadAccountIds.length > 0) {
                    exportPayload.account_ids = pendingExportUploadAccountIds;
                    exportUrl = '/api/outlook-upload-accounts/export-selected';
                } else if (pendingExportAccountIds.length > 0) {
                    exportPayload.account_ids = pendingExportAccountIds;
                } else {
                    exportPayload.group_ids = pendingExportGroupIds;
                }

                // Execute export
                const response = await fetch(exportUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(exportPayload)
                });

                const contentType = response.headers.get('content-type') || '';
                if (response.ok && !contentType.includes('application/json')) {
                    // Get file name
                    const contentDisposition = response.headers.get('Content-Disposition');
                    let filename = 'accounts.txt';
                    if (contentDisposition) {
                        const match = contentDisposition.match(/filename\*?=(?:UTF-8'')?([^;\n]+)/i);
                        if (match) {
                            filename = decodeURIComponent(match[1]);
                        }
                    }

                    // Download file
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);

                    showToast(I18n.t("Export successful"), 'success');
                    hideExportVerifyModal();
                } else {
                    const data = await response.json();
                    handleApiError(data, I18n.t("Export failed"));
                }
            } catch (error) {
                showToast(I18n.t("Export failed"), 'error');
            }
        }
