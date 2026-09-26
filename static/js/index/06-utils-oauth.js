        /* global accountsCache, currentGroupId, escapeHtml, groups, handleApiError, hideModal, invalidateAccountCaches, invalidateRefreshTokenPreview, isTempEmailGroup, loadAccountsByGroup, loadGroups, loadRefreshStatusList, oauthPreviewAccount, refreshVisibleAccountList, renderRefreshTokenPreview, setModalVisible, showModal, showToast, updateGroupSelects */

        // ==================== Utility functions ====================

        // Format date
        function formatDate(dateStr) {
            if (!dateStr) return '';
            try {
                let normalizedDate = dateStr;
                if (typeof dateStr === 'number' || /^\d+$/.test(String(dateStr))) {
                    const timestamp = Number(dateStr);
                    normalizedDate = timestamp < 1000000000000 ? timestamp * 1000 : timestamp;
                }

                const date = new Date(normalizedDate);
                if (isNaN(date.getTime())) return dateStr;

                const now = new Date();
                const timeZone = getAppTimeZone();
                const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
                    timeZone,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                });
                const isToday = dateKeyFormatter.format(date) === dateKeyFormatter.format(now);

                if (isToday) {
                    return I18n.t("Today ") + date.toLocaleTimeString(I18n.language, {
                        timeZone,
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                } else {
                    return date.toLocaleDateString(I18n.language, {
                        timeZone,
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    }) + ' ' + date.toLocaleTimeString(I18n.language, {
                        timeZone,
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                }
            } catch (e) {
                return dateStr;
            }
        }

        // ==================== OAuth Refresh Token related ====================

        let oauthReauthorizeAccount = null;

        function isOAuthReauthorizeMode() {
            return !!(oauthReauthorizeAccount && oauthReauthorizeAccount.id);
        }

        function setOAuthElementDisplay(id, visible, displayValue = '') {
            const el = document.getElementById(id);
            if (el) {
                el.style.display = visible ? displayValue : 'none';
            }
        }

        function applyOAuthModalModeUI() {
            const reauthMode = isOAuthReauthorizeMode();
            const titleEl = document.getElementById('oauthModalTitle');
            const sectionTitleEl = document.getElementById('oauthAccountSectionTitle');
            const sectionHintEl = document.getElementById('oauthAccountSectionHint');
            const emailLabelEl = document.getElementById('oauthEmailLabel');
            const emailInput = document.getElementById('oauthEmailInput');
            const passwordLabelEl = document.getElementById('oauthPasswordLabel');
            const passwordInput = document.getElementById('oauthPasswordInput');
            const exchangeBtn = document.getElementById('exchangeTokenBtn');
            const saveBtn = document.getElementById('saveTokenAccountBtn');

            if (titleEl) titleEl.textContent = reauthMode ? I18n.t("🔑 Reauthorize Outlook account") : I18n.t("🔑 Authorize and save Outlook account");
            if (sectionTitleEl) sectionTitleEl.textContent = reauthMode ? I18n.t("Current account") : I18n.t("Account to be added to the database");
            if (sectionHintEl) {
                sectionHintEl.textContent = reauthMode
                    ? I18n.t("Please confirm the current account email and paste the authorized callback URL. The system will save the new authorization and automatically perform a Token refresh verification.")
                    : I18n.t("To exchange and preview, just paste the authorized callback URL. Email, password and target group are only used when saving the account and can be added later.");
            }
            if (emailLabelEl) emailLabelEl.textContent = reauthMode ? I18n.t("Current email account") : I18n.t("Email account (optional when saving)");
            if (emailInput) {
                emailInput.readOnly = reauthMode;
                emailInput.value = reauthMode ? (oauthReauthorizeAccount.email || '') : '';
                if (reauthMode) {
                    emailInput.style.cursor = 'pointer';
                    emailInput.title = I18n.t("Click to copy");
                    emailInput.onclick = function () { copyOauthField('oauthEmailInput', I18n.t("Email address copied")); };
                } else {
                    emailInput.style.cursor = '';
                    emailInput.title = '';
                    emailInput.onclick = null;
                }
            }

            // Password field: Use mask + small eye control in re-authorization mode, support click to copy
            if (passwordLabelEl) passwordLabelEl.textContent = reauthMode ? I18n.t("Password") : I18n.t("Password (optional when saving)");
            const revealOauthPasswordBtn = document.getElementById('revealOauthPasswordBtn');
            if (passwordInput) {
                passwordInput.type = 'text';
                passwordInput.readOnly = reauthMode;
                passwordInput.placeholder = reauthMode ? '' : I18n.t("Enter email password");
                if (reauthMode) {
                    const pw = oauthReauthorizeAccount.password || '';
                    const mask = '*'.repeat(Math.max(6, pw.length));
                    passwordInput.value = mask;
                    passwordInput.dataset.secretValue = pw;
                    passwordInput.dataset.secretRevealed = 'false';
                    passwordInput.style.cursor = 'pointer';
                    passwordInput.title = I18n.t("Click to copy");
                    passwordInput.onclick = function () { copyOauthField('oauthPasswordInput', I18n.t("Password copied")); };
                } else {
                    passwordInput.value = '';
                    passwordInput.type = 'password';
                    delete passwordInput.dataset.secretValue;
                    delete passwordInput.dataset.secretRevealed;
                    passwordInput.style.cursor = '';
                    passwordInput.title = '';
                    passwordInput.onclick = null;
                }
            }
            if (revealOauthPasswordBtn) {
                revealOauthPasswordBtn.style.display = reauthMode ? '' : 'none';
                revealOauthPasswordBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
                revealOauthPasswordBtn.title = I18n.t("Show password");
                revealOauthPasswordBtn.setAttribute('aria-label', I18n.t("Show password"));
            }
            setOAuthElementDisplay('copyOauthEmailBtn', reauthMode);

            setOAuthElementDisplay('oauthTargetGroup', !reauthMode);
            setOAuthElementDisplay('oauthForwardGroup', !reauthMode, 'flex');
            setOAuthElementDisplay('oauthPreviewPasswordGroup', !reauthMode);
            setOAuthElementDisplay('oauthPreviewGroupGroup', !reauthMode);

            if (exchangeBtn) {
                exchangeBtn.disabled = false;
                exchangeBtn.textContent = I18n.t("Exchange and preview");
                exchangeBtn.style.display = reauthMode ? 'none' : '';
            }
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = reauthMode ? I18n.t("Update authorization and refresh") : I18n.t("Save directly (automatic exchange)");
            }
        }

        function copyOauthField(inputId, successMessage) {
            const input = document.getElementById(inputId);
            if (!input) return;
            const text = input.dataset.secretValue || input.value || '';
            if (!text) {
                showToast(I18n.t("The content is empty and cannot be copied."), 'error');
                return;
            }
            if (typeof copyTextToClipboard === 'function') {
                copyTextToClipboard(text, successMessage);
            } else {
                input.select();
                document.execCommand('copy');
                showToast(successMessage, 'success');
            }
        }

        function toggleOauthPasswordVisibility() {
            const input = document.getElementById('oauthPasswordInput');
            const button = document.getElementById('revealOauthPasswordBtn');
            if (!input || !button) return;

            const isRevealed = input.dataset.secretRevealed === 'true';
            const secretValue = input.dataset.secretValue || '';
            const mask = '*'.repeat(Math.max(6, secretValue.length));

            if (isRevealed) {
                input.value = mask;
                input.dataset.secretRevealed = 'false';
                button.title = I18n.t("Show password");
                button.setAttribute('aria-label', I18n.t("Show password"));
                button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
            } else {
                input.value = secretValue;
                input.dataset.secretRevealed = 'true';
                button.title = I18n.t("Hide password");
                button.setAttribute('aria-label', I18n.t("Hide password"));
                button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"></path><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"></path><path d="M9.5 5.5A10.5 10.5 0 0 1 12 5c6 0 9.5 7 9.5 7a17.6 17.6 0 0 1-2.1 3"></path><path d="M6.5 6.5C3.8 8.3 2.5 12 2.5 12s3.5 7 9.5 7a10 10 0 0 0 4.5-1.1"></path></svg>';
            }
        }

        function invalidateRefreshTokenPreview() {
            oauthPreviewAccount = null;
            const resultEl = document.getElementById('refreshTokenResult');
            if (resultEl) {
                resultEl.style.display = 'none';
            }
        }

        function renderRefreshTokenPreview() {
            if (!oauthPreviewAccount) {
                invalidateRefreshTokenPreview();
                return;
            }
            const resultEl = document.getElementById('refreshTokenResult');
            const saveBtn = document.getElementById('saveTokenAccountBtn');
            if (isOAuthReauthorizeMode()) {
                if (resultEl) {
                    resultEl.style.display = 'none';
                }
                if (saveBtn) {
                    saveBtn.disabled = false;
                }
                return;
            }
            const group = groups.find(item => item.id === oauthPreviewAccount.group_id);
            const fallbackGroupId = Number.parseInt(String(oauthPreviewAccount.group_id ?? ''), 10);
            document.getElementById('oauthPreviewEmail').value = oauthPreviewAccount.email || '';
            document.getElementById('oauthPreviewPassword').value = oauthPreviewAccount.password || '';
            document.getElementById('oauthPreviewClientId').value = oauthPreviewAccount.client_id || '';
            document.getElementById('oauthPreviewGroup').value = group?.name || (Number.isFinite(fallbackGroupId) ? String(fallbackGroupId) : '');
            document.getElementById('oauthPreviewRefreshToken').value = oauthPreviewAccount.refresh_token || '';
            if (resultEl) {
                resultEl.style.display = 'block';
            }
        }

        // Display the modal box for obtaining Refresh Token
        async function showGetRefreshTokenModal(options = {}) {
            const reauthorizeAccount = options.reauthorizeAccount || null;
            oauthReauthorizeAccount = reauthorizeAccount && reauthorizeAccount.id
                ? {
                    id: Number(reauthorizeAccount.id),
                    email: String(reauthorizeAccount.email || ''),
                    password: String(reauthorizeAccount.password || '')
                }
                : null;

            showModal('getRefreshTokenModal');

            // Reset form
            document.getElementById('oauthEmailInput').value = oauthReauthorizeAccount?.email || '';
            document.getElementById('oauthPasswordInput').value = '';
            document.getElementById('redirectUrlInput').value = '';
            document.getElementById('oauthForwardEnabled').checked = false;
            invalidateRefreshTokenPreview();
            applyOAuthModalModeUI();

            // Reset button state
            const btn = document.getElementById('exchangeTokenBtn');
            btn.disabled = false;
            const saveBtn = document.getElementById('saveTokenAccountBtn');

            const groupSelect = document.getElementById('tokenSaveGroupSelect');
            if (groupSelect && !isOAuthReauthorizeMode()) {
                const nonTempGroups = groups.filter(group => group.name !== "\u4e34\u65f6\u90ae\u7bb1");
                const fallbackGroupId = (!isTempEmailGroup && currentGroupId && nonTempGroups.find(group => group.id === currentGroupId))
                    ? currentGroupId
                    : (nonTempGroups[0]?.id || '');
                if (fallbackGroupId) {
                    groupSelect.value = fallbackGroupId;
                }
            }

            // Get authorization URL
            try {
                const response = await fetch('/api/oauth/auth-url');
                const data = await response.json();

                if (data.success) {
                    document.getElementById('authUrlInput').value = data.auth_url;
                } else {
                    showToast(I18n.t("Failed to obtain authorization link"), 'error');
                }
            } catch (error) {
                showToast(I18n.t("Failed to obtain authorization link"), 'error');
            }
        }

        // Hide the Get Refresh Token modal box
        function hideGetRefreshTokenModal() {
            oauthReauthorizeAccount = null;
            hideModal('getRefreshTokenModal');
            applyOAuthModalModeUI();
        }

        async function showReauthorizeAccountModal(account) {
            const normalizedAccount = typeof account === 'object'
                ? account
                : { id: account, email: arguments.length > 1 ? arguments[1] : '' };
            const accountId = Number(normalizedAccount.id || 0);
            if (!Number.isFinite(accountId) || accountId <= 0) {
                showToast(I18n.t("The account information is invalid and cannot be reauthorized."), 'error');
                return;
            }

            let accountPassword = normalizedAccount.password || '';
            if (!accountPassword) {
                try {
                    const response = await fetch(`/api/accounts/${accountId}`);
                    const data = await response.json();
                    if (data.success && data.account) {
                        accountPassword = data.account.password || '';
                        if (!normalizedAccount.email) {
                            normalizedAccount.email = data.account.email || '';
                        }
                    }
                } catch (e) {
                    // Continue if getting password failed, password field will be empty
                }
            }

            await showGetRefreshTokenModal({
                reauthorizeAccount: {
                    id: accountId,
                    email: normalizedAccount.email || '',
                    password: accountPassword
                }
            });
        }

        function showReauthorizeAccountModalFromEdit() {
            const accountId = document.getElementById('editAccountId')?.value || '';
            const accountEmail = document.getElementById('editEmail')?.value || '';
            const passwordInput = document.getElementById('editPassword');
            const accountPassword = passwordInput?.dataset.secretValue || '';
            showReauthorizeAccountModal({ id: accountId, email: accountEmail, password: accountPassword });
        }

        // Copy the authorization URL
        function copyAuthUrl() {
            const input = document.getElementById('authUrlInput');
            input.select();
            document.execCommand('copy');
            showToast(I18n.t("Authorization link copied to clipboard"), 'success');
        }

        // Open the authorization URL
        function openAuthUrl() {
            const url = document.getElementById('authUrlInput').value;
            if (url) {
                window.open(url, '_blank');
                showToast(I18n.t("The authorization page has been opened in a new window"), 'info');
            }
        }

        // Exchange for Token
        async function exchangeToken(options = {}) {
            if (isOAuthReauthorizeMode()) {
                return reauthorizeExistingAccount();
            }

            const { silentSuccess = false, keepSavingState = false } = options;
            const email = document.getElementById('oauthEmailInput').value.trim();
            const password = document.getElementById('oauthPasswordInput').value;
            const redirectUrl = document.getElementById('redirectUrlInput').value.trim();
            const groupId = parseInt(document.getElementById('tokenSaveGroupSelect')?.value || '0', 10);
            const forwardEnabled = !!document.getElementById('oauthForwardEnabled')?.checked;

            if (!redirectUrl) {
                showToast(I18n.t("Please paste the complete authorized URL first"), 'error');
                return;
            }

            const btn = document.getElementById('exchangeTokenBtn');
            const saveBtn = document.getElementById('saveTokenAccountBtn');
            btn.disabled = true;
            if (!keepSavingState && saveBtn) {
                saveBtn.disabled = true;
            }
            btn.textContent = I18n.t("⏳ Previewing...");

            try {
                const response = await fetch('/api/oauth/exchange-token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        redirected_url: redirectUrl
                    })
                });

                const data = await response.json();

                if (data.success) {
                    oauthPreviewAccount = {
                        email,
                        password,
                        client_id: data.client_id,
                        refresh_token: data.refresh_token,
                        group_id: groupId,
                        forward_enabled: forwardEnabled
                    };
                    renderRefreshTokenPreview();

                    if (!silentSuccess) {
                        showToast(I18n.t("✅ Refresh Token obtained successfully!"), 'success');
                    }

                    // Reset button state (not hidden, allowed to be reused)
                    btn.disabled = false;
                    if (!keepSavingState && saveBtn) {
                        saveBtn.disabled = false;
                    }
                    btn.textContent = I18n.t("Exchange and preview");
                    return true;
                } else {
                    handleApiError(data, I18n.t("Failed to exchange for Token"));
                    btn.disabled = false;
                    if (!keepSavingState && saveBtn) {
                        saveBtn.disabled = false;
                    }
                    btn.textContent = I18n.t("Exchange and preview");
                    return false;
                }
            } catch (error) {
                showToast(I18n.t("Failed to exchange for Token: ") + error.message, 'error');
                btn.disabled = false;
                if (!keepSavingState && saveBtn) {
                    saveBtn.disabled = false;
                }
                btn.textContent = I18n.t("Exchange and preview");
                return false;
            }
        }

        async function reloadAuthorizationAffectedViews() {
            if (typeof invalidateAccountCaches === 'function') {
                invalidateAccountCaches();
            } else if (currentGroupId) {
                delete accountsCache[currentGroupId];
            }
            if (typeof loadGroups === 'function') {
                await loadGroups();
            }
            if (typeof refreshVisibleAccountList === 'function') {
                await refreshVisibleAccountList(true);
            } else if (currentGroupId && typeof loadAccountsByGroup === 'function') {
                await loadAccountsByGroup(currentGroupId, true);
            }
            if (typeof loadRefreshStatusList === 'function') {
                await loadRefreshStatusList();
            }
        }

        async function reauthorizeExistingAccount() {
            const accountId = Number(oauthReauthorizeAccount?.id || 0);
            const redirectUrl = document.getElementById('redirectUrlInput').value.trim();
            if (!Number.isFinite(accountId) || accountId <= 0) {
                showToast(I18n.t("The account information is invalid and cannot be reauthorized."), 'error');
                return false;
            }
            if (!redirectUrl) {
                showToast(I18n.t("Please paste the complete authorized URL first"), 'error');
                return false;
            }

            const saveBtn = document.getElementById('saveTokenAccountBtn');
            const exchangeBtn = document.getElementById('exchangeTokenBtn');
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.textContent = I18n.t("Updating and refreshing...");
            }
            if (exchangeBtn) {
                exchangeBtn.disabled = true;
            }

            try {
                const response = await fetch(`/api/accounts/${accountId}/reauthorize`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ redirected_url: redirectUrl })
                });
                const data = await response.json();
                if (!data.success) {
                    handleApiError(data, I18n.t("Reauthorization failed"));
                    return false;
                }

                await reloadAuthorizationAffectedViews();
                hideGetRefreshTokenModal();

                const validation = data.validation || {};
                if (validation.success) {
                    showToast(data.message || I18n.t("Re-authorization is successful, Token refresh verification passed"), 'success');
                } else {
                    showToast(data.message || I18n.t("Reauthorization saved, but auto-refresh verification failed"), 'error', validation.error);
                }
                return true;
            } catch (error) {
                showToast(I18n.t("Reauthorization failed: ") + error.message, 'error');
                return false;
            } finally {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = isOAuthReauthorizeMode() ? I18n.t("Update authorization and refresh") : I18n.t("Save directly (automatic exchange)");
                }
                if (exchangeBtn) {
                    exchangeBtn.disabled = false;
                }
            }
        }

        async function saveTokenAccount() {
            if (isOAuthReauthorizeMode()) {
                return reauthorizeExistingAccount();
            }

            if (!oauthPreviewAccount) {
                const exchanged = await exchangeToken({ silentSuccess: true, keepSavingState: true });
                if (!exchanged || !oauthPreviewAccount) {
                    return;
                }
            }

            if (!oauthPreviewAccount.email || !oauthPreviewAccount.password) {
                showToast(I18n.t("Please fill in your email account and password before saving your account"), 'error');
                return;
            }

            if (!oauthPreviewAccount.group_id) {
                showToast(I18n.t("Please select the target group before saving the account"), 'error');
                return;
            }

            const saveBtn = document.getElementById('saveTokenAccountBtn');
            const exchangeBtn = document.getElementById('exchangeTokenBtn');
            saveBtn.disabled = true;
            exchangeBtn.disabled = true;
            saveBtn.textContent = I18n.t("Saving...");

            try {
                const accountString = [
                    oauthPreviewAccount.email,
                    oauthPreviewAccount.password,
                    oauthPreviewAccount.client_id,
                    oauthPreviewAccount.refresh_token
                ].join('----');

                const response = await fetch('/api/accounts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        account_string: accountString,
                        group_id: oauthPreviewAccount.group_id,
                        provider: 'outlook',
                        forward_enabled: !!oauthPreviewAccount.forward_enabled
                    })
                });

                const data = await response.json();
                if (data.success) {
                    showToast(data.message || I18n.t("Account has been saved"), 'success');
                    currentGroupId = oauthPreviewAccount.group_id;
                    await reloadAuthorizationAffectedViews();
                    hideGetRefreshTokenModal();
                } else {
                    handleApiError(data, I18n.t("Failed to save account"));
                }
            } catch (error) {
                showToast(I18n.t("Failed to save account"), 'error');
            } finally {
                exchangeBtn.disabled = false;
                saveBtn.disabled = false;
                saveBtn.textContent = I18n.t("Save directly (automatic exchange)");
            }
        }
