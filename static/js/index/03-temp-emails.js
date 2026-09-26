        /* global accountsCache, allTags, closeMobilePanels, currentAccount, currentAccountListSource, currentAccountSummary, currentEmailDetail, currentEmailId, currentEmails, currentGroupId, currentMethod, currentSkip, escapeHtml, escapeJs, formatDate, groups, handleAccountSelectionCheckboxClick, handleApiError, hasActiveTagFilters, hasMoreEmails, isLoadingMore, loadGroups, loadTags, loadTempEmails, matchesSelectedTagFilters, refreshEmails, renderAccountTagSummary, renderEmailDetail, renderEmailList, renderEmptyStateMarkup, scheduleEmailListLoadCheck, setEmailListLoadingState, showEmailList, showMobileEmailDetail, showToast, updateBatchActionBar, updateGraphSendMailAvailability, updateMobileContext, updateCurrentGroupHeader */

        // ==================== Temporary mailbox related ====================

        const CLOUDFLARE_GLOBAL_ACCOUNT_KEY = '__cloudflare_global_messages__';
        const CLOUDFLARE_GLOBAL_ACCOUNT_PREFIX = `${CLOUDFLARE_GLOBAL_ACCOUNT_KEY}:`;
        const CLOUDFLARE_GLOBAL_PAGE_SIZE = 50;
        let currentCloudflareGlobalChannelId = null;
        let currentCloudflareGlobalChannelName = '';

        function setTempEmailListLoadingState(isLoading) {
            if (typeof setEmailListLoadingState === 'function') {
                setEmailListLoadingState(isLoading);
                return;
            }

            const refreshBtn = document.querySelector('.refresh-btn');
            if (refreshBtn) {
                refreshBtn.disabled = isLoading;
            }
        }

        // Load temporary mailbox list
        async function loadTempEmails(forceRefresh = false) {
            const container = document.getElementById('accountList');

            if (!forceRefresh && accountsCache['temp']) {
                renderTempEmailList(accountsCache['temp']);
                return;
            }

            container.innerHTML = '<div class="loading loading-small"><div class="loading-spinner"></div></div>';

            try {
                const response = await fetch('/api/temp-emails');
                const data = await response.json();

                if (data.success) {
                    await loadCloudflareChannelsForTempEmails(forceRefresh);
                    accountsCache['temp'] = data.emails;
                    renderTempEmailList(data.emails);

                    const group = groups.find(g => g.name === "\u4e34\u65f6\u90ae\u7bb1");
                    if (group) {
                        group.account_count = data.emails.length;
                        renderGroupList(groups);
                    }
                } else {
                    container.innerHTML = renderEmptyStateMarkup('⚠️', data.error || I18n.t("Loading failed"), {
                        onAction: 'loadTempEmails(true)',
                        actionTitle: I18n.t("Refresh temporary mailbox list")
                    });
                }
            } catch (error) {
                container.innerHTML = renderEmptyStateMarkup('⚠️', I18n.t("Loading failed"), {
                    onAction: 'loadTempEmails(true)',
                    actionTitle: I18n.t("Refresh temporary mailbox list")
                });
            }
        }

        async function loadCloudflareChannelsForTempEmails(forceRefresh = false) {
            if (!forceRefresh && Array.isArray(accountsCache.cloudflareChannels)) {
                return accountsCache.cloudflareChannels;
            }
            try {
                const response = await fetch('/api/cloudflare/channels');
                const data = await response.json();
                accountsCache.cloudflareChannels = data.success && Array.isArray(data.channels)
                    ? data.channels
                    : [];
            } catch (error) {
                accountsCache.cloudflareChannels = [];
            }
            return accountsCache.cloudflareChannels;
        }

        // Render temporary mailbox list
        function renderTempEmailList(emails) {
            const container = document.getElementById('accountList');
            currentAccountListSource = Array.isArray(emails) ? [...emails] : [];
            const cloudflareChannels = Array.isArray(accountsCache.cloudflareChannels)
                ? accountsCache.cloudflareChannels.filter(channel => channel.enabled)
                : [];

            // Channel screening
            const filter = localStorage.getItem('outlook_temp_email_filter') || 'all';
            const searchQuery = (document.getElementById('globalSearch')?.value || '').trim();
            const normalizedSearchQuery = searchQuery.toLowerCase();
            let filtered = filter === 'all'
                ? [...currentAccountListSource]
                : currentAccountListSource.filter(e => e.provider === filter);

            if (searchQuery) {
                filtered = filtered.filter(email => {
                    const tagText = Array.isArray(email.tags)
                        ? email.tags.map(tag => String(tag.name || '')).join('\n')
                        : '';
                    return matchesAccountSearchTerms([email.email, tagText], searchQuery);
                });
            }

            if (hasActiveTagFilters()) {
                filtered = filtered.filter(email => matchesSelectedTagFilters(email.tags));
            }

            const currentGroup = groups.find(group => group.id === currentGroupId);
            if (searchQuery) {
                updateCurrentGroupHeader(null);
            } else if (currentGroup) {
                updateCurrentGroupHeader(currentGroup);
            }

            const cloudflareGlobalEntries = (filter === 'all' || filter === 'cloudflare')
                ? cloudflareChannels.filter(channel => {
                    const label = I18n.tpl`Cloudflare all emails · ${channel.name || channel.id}`;
                    return !searchQuery || label.toLowerCase().includes(normalizedSearchQuery);
                })
                : [];

            if (filtered.length === 0 && cloudflareGlobalEntries.length === 0) {
                const providerName = filter === 'duckmail' ? 'DuckMail' : (filter === 'cloudflare' ? 'Cloudflare' : 'GPTMail');
                const hasAdvancedFilters = !!searchQuery || hasActiveTagFilters();
                const hint = hasAdvancedFilters
                    ? I18n.t("No matching temporary mailbox found")
                    : (filter === 'all' ? I18n.t("No temporary email address yet<br>Click the button below to generate") : I18n.tpl`There is no ${providerName} email address yet`);
                container.innerHTML = renderEmptyStateMarkup('⚡', hint, {
                    allowHtml: !hasAdvancedFilters,
                    onAction: 'loadTempEmails(true)',
                    actionTitle: I18n.t("Refresh temporary mailbox list")
                });
                updateBatchActionBar();
                return;
            }

            const cloudflareGlobalEntry = cloudflareGlobalEntries.map(channel => {
                const channelId = Number(channel.id);
                const channelName = channel.name || `#${channelId}`;
                const label = I18n.tpl`Cloudflare all emails · ${channelName}`;
                const active = currentMethod === 'cloudflare-admin' && Number(currentCloudflareGlobalChannelId) === channelId;
                return `
                <div class="account-item cloudflare-global-account-item ${active ? 'active' : ''}"
                     onclick="selectCloudflareGlobalMessages(event, ${channelId}, '${escapeJs(channelName)}')">
                    <div class="account-body">
                        <div class="account-title-row">
                            <div class="account-email-wrap">
                                <div class="account-email cloudflare-global-account-title" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
                            </div>
                        </div>
                        <div class="account-meta-row">
                            <span class="account-status-pill provider" style="--pill-accent: #f48120">Cloudflare</span>
                        </div>
                    </div>
                </div>
            `;
            }).join('');

            container.innerHTML = cloudflareGlobalEntry + filtered.map(email => I18n.tpl`
                <div class="account-item ${currentAccount === email.email ? 'active' : ''}"
                     data-account-id="${email.id}"
                     onclick="handleAccountItemClick(event, '${escapeJs(email.email)}', true)">
                    <input type="checkbox" class="account-select-checkbox" value="${email.id}"
                           data-account-email="${escapeHtml(email.email)}"
                           data-account-type="temp-email"
                           data-refreshable="false"
                           data-forward-enabled="false"
                           onclick="handleAccountSelectionCheckboxClick(event)">
                    <div class="account-body">
                        <div class="account-title-row">
                            <div class="account-email-wrap">
                                <div class="account-email" title="${escapeHtml(email.email)}">${escapeHtml(email.email)}</div>
                            </div>
                        </div>
                        <div class="account-meta-row">
                            <span class="account-status-pill provider"
                                style="--pill-accent: ${email.provider === 'duckmail' ? '#ff9800' : (email.provider === 'cloudflare' ? '#f48120' : '#00bcf2')}">
                                ${escapeHtml(email.provider === 'duckmail' ? 'DuckMail' : (email.provider === 'cloudflare' ? 'Cloudflare' : 'GPTMail'))}
                            </span>
                            <span class="account-status-pill muted">Temporary mailboxes</span>
                            ${email.provider === 'cloudflare' && email.cloudflare_channel_name ? `<span class="account-status-pill muted">${escapeHtml(email.cloudflare_channel_name)}</span>` : ''}
                        </div>
                        ${(email.tags || []).length ? `<div class="account-tags">${renderAccountTagSummary(email.tags)}</div>` : ''}
                    </div>
                    <div class="account-menu-wrap">
                        <button class="account-menu-trigger" type="button" data-account-menu-toggle="true" title="More actions">⋯</button>
                        <div class="account-menu-panel">
                            <button class="account-action-btn" type="button" onclick="event.stopPropagation(); closeAccountActionMenus(); copyEmail('${escapeJs(email.email)}')">Copy mailbox</button>
                            <button class="account-action-btn delete" type="button" onclick="event.stopPropagation(); closeAccountActionMenus(); deleteTempEmail('${escapeJs(email.email)}')">Delete mailbox</button>
                        </div>
                    </div>
                </div>
            `).join('');
            updateBatchActionBar();
        }

        // Generate temporary mailbox (display provider selection pop-up window)
        async function generateTempEmail() {
            // Show provider selection pop-up window
            showTempEmailProviderModal();
        }

        function hideTempEmailProviderModal() {
            hideModal('tempEmailProviderModal');
        }

        // Toggle Duckmail password visibility
        function toggleDuckmailPasswordVisibility() {
            const input = document.getElementById('duckmailPassword');
            const svg = document.getElementById('duckmailPasswordEyeIcon');
            if (!input || !svg) return;

            if (input.type === 'password') {
                input.type = 'text';
                svg.innerHTML = `
                    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>
                    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/>
                    <path d="M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/>
                    <line x1="2" y1="2" x2="22" y2="22"/>
                `;
            } else {
                input.type = 'password';
                svg.innerHTML = `
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                    <circle cx="12" cy="12" r="3"/>
                `;
            }
        }

        // Switch Cloudflare username generation method
        function toggleCloudflareUsernameMode(mode) {
            const btnRandom = document.getElementById('usernameModeRandom');
            const btnCustom = document.getElementById('usernameModeCustom');
            const groupUsername = document.getElementById('cloudflareUsernameGroup');
            const textarea = document.getElementById('cloudflareUsername');

            if (mode === 'random') {
                btnRandom?.classList.add('active');
                btnCustom?.classList.remove('active');
                if (groupUsername) groupUsername.style.display = 'none';
                if (textarea) textarea.value = '';
            } else {
                btnRandom?.classList.remove('active');
                btnCustom?.classList.add('active');
                if (groupUsername) groupUsername.style.display = 'block';
            }
        }

        // Show provider selection pop-up window
        function showTempEmailProviderModal() {
            closeAllModals();
            // Dynamically create pop-up windows
            let modal = document.getElementById('tempEmailProviderModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'tempEmailProviderModal';
                modal.className = 'modal';
                modal.onmousedown = function (e) { if (e.target === modal) hideTempEmailProviderModal(); };
                modal.innerHTML = I18n.tpl`
                    <div class="modal-content temp-email-provider-modal-content">
                        <div class="modal-header">
                            <h3>Generate temporary mailbox</h3>
                            <button class="modal-close" onclick="hideTempEmailProviderModal()">&times;</button>
                        </div>
                        <div class="modal-body temp-email-provider-modal-body">
                            <div class="form-group">
                                <label class="form-label">Select provider</label>
                                <div class="provider-tabs">
                                    <div class="provider-tab-item">
                                        <input type="radio" id="providerCloudflare" name="tempEmailProvider" value="cloudflare" checked onchange="toggleTempEmailProvider('cloudflare')">
                                        <label class="provider-tab-label" for="providerCloudflare" id="providerLabelCloudflare">
                                            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M17.5 19A3.5 3.5 0 0 0 21 15.5c0-2.79-2.54-4.5-5-4.5-.48 0-.96.06-1.41.17A5.98 5.98 0 0 0 9 8c-3.12 0-5.67 2.43-5.96 5.5A4.5 4.5 0 0 0 7.5 19h10z"/>
                                            </svg>
                                            <span>Cloudflare</span>
                                        </label>
                                    </div>
                                    <div class="provider-tab-item">
                                        <input type="radio" id="providerGptmail" name="tempEmailProvider" value="gptmail" onchange="toggleTempEmailProvider('gptmail')">
                                        <label class="provider-tab-label" for="providerGptmail" id="providerLabelGptmail">
                                            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z"/>
                                                <path d="m5 3 1 2.5L8.5 6 6 7 5 9.5 4 7 1.5 6 4 5.5Z"/>
                                                <path d="m19 17 1 2.5 2.5.5-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1Z"/>
                                            </svg>
                                            <span>GPTMail</span>
                                        </label>
                                    </div>
                                    <div class="provider-tab-item">
                                        <input type="radio" id="providerDuckmail" name="tempEmailProvider" value="duckmail" onchange="toggleTempEmailProvider('duckmail')">
                                        <label class="provider-tab-label" for="providerDuckmail" id="providerLabelDuckmail">
                                            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
                                                <path d="M7.5 10.5c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5z"/>
                                                <path d="M11.5 11.5c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5z"/>
                                                <path d="M16 14c0 1.657-2.686 3-6 3s-6-1.343-6-3"/>
                                            </svg>
                                            <span>DuckMail</span>
                                        </label>
                                    </div>
                                </div>
                            </div>
                            <div id="gptmailFields">
                                <div class="form-hint" style="margin-bottom: 12px; text-align: center; padding: 20px 0; color: #64748b;">
                                    Click the button below to generate a temporary GPTMail mailbox with one click
                                </div>
                            </div>
                            <div id="duckmailFields" style="display: none;">
                                <div class="form-group">
                                    <label class="form-label">Domain name</label>
                                    <select class="form-input" id="duckmailDomain" style="width: 100%;">
                                        <option value="">Loading…</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Username</label>
                                    <input type="text" class="form-input" id="duckmailUsername" placeholder="Please enter username (at least 3 characters)">
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Password</label>
                                    <div class="password-wrapper">
                                        <input type="password" class="form-input" id="duckmailPassword" placeholder="Please enter your login password (at least 6 characters)">
                                        <button type="button" class="password-toggle-btn" onclick="toggleDuckmailPasswordVisibility()" title="Show/hide password">
                                            <svg id="duckmailPasswordEyeIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                                                <circle cx="12" cy="12" r="3"/>
                                            </svg>
                                        </button>
                                    </div>
                                    <div class="form-hint">Used to log in to your email, please be sure to remember the password. Emails are saved for 3 days and the account will not be automatically deleted.</div>
                                </div>
                            </div>
                            <div id="cloudflareFields" style="display: none;">
                                <div class="form-grid-2">
                                    <div class="form-group">
                                        <label class="form-label">Channel</label>
                                        <select class="form-input" id="cloudflareChannel" style="width: 100%;" onchange="loadCloudflareDomains()">
                                            <option value="">Loading…</option>
                                        </select>
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label">Domain name</label>
                                        <select class="form-input" id="cloudflareDomain" style="width: 100%;">
                                            <option value="">Loading…</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="form-grid-2">
                                    <div class="form-group">
                                        <label class="form-label">Quantity</label>
                                        <input type="number" class="form-input" id="cloudflareGenerateCount" min="1" max="50" value="1" style="width: 100%;">
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label">Generation method</label>
                                        <div class="username-mode-selector">
                                            <button type="button" class="btn btn-secondary" id="usernameModeRandom" onclick="toggleCloudflareUsernameMode('random')">🎲 Random</button>
                                            <button type="button" class="btn btn-secondary active" id="usernameModeCustom" onclick="toggleCloudflareUsernameMode('custom')">✍️ Customization</button>
                                        </div>
                                    </div>
                                </div>
                                <div class="form-group" id="cloudflareUsernameGroup" style="display: block;">
                                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px;">
                                        <label class="form-label" style="margin-bottom: 0;">Username list</label>
                                        <button class="btn btn-secondary btn-ai-wand" type="button" id="cloudflareAiGenerateBtn" onclick="generateCloudflareAiUsernames()">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"/>
                                                <path d="m14 7 3 3"/>
                                                <path d="M5 6v4"/>
                                                <path d="M19 14v4"/>
                                                <path d="M10 2v2"/>
                                                <path d="M7 8H3"/>
                                                <path d="M21 16h-4"/>
                                                <path d="M11 3H9"/>
                                            </svg>
                                            AI intelligent generation
                                        </button>
                                    </div>
                                    <textarea class="form-input" id="cloudflareUsername" rows="2" placeholder="One username per line (leave blank to randomly generate based on number)" style="width: 100%; min-height: 48px; resize: vertical;"></textarea>
                                </div>
                                <div class="form-group" style="margin-bottom: 4px;">
                                    <label class="form-label">Binding tag</label>
                                    <div class="tag-cloud" id="cloudflareGenerateTagOptions">
                                        <div class="tag-cloud-empty">No tags yet</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button class="btn btn-secondary" onclick="hideTempEmailProviderModal()">Cancel</button>
                            <button class="btn btn-primary" id="createTempEmailBtn" onclick="doGenerateTempEmail()">Create mailbox</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            }
            // Reset the form to use the last saved channel
            const defaultProvider = localStorage.getItem('outlook_temp_email_generate') || 'cloudflare';
            const radio = modal.querySelector(`input[value="${defaultProvider}"]`);
            if (radio) radio.checked = true;
            toggleTempEmailProvider(defaultProvider);
            toggleCloudflareUsernameMode('custom');
            setModalVisible('tempEmailProviderModal', true);
        }

        // Switch provider display
        function toggleTempEmailProvider(provider) {
            // Record user selections
            localStorage.setItem('outlook_temp_email_generate', provider);

            const gptmailFields = document.getElementById('gptmailFields');
            const duckmailFields = document.getElementById('duckmailFields');
            const cloudflareFields = document.getElementById('cloudflareFields');
            const labelGpt = document.getElementById('providerLabelGptmail');
            const labelDuck = document.getElementById('providerLabelDuckmail');
            const labelCloudflare = document.getElementById('providerLabelCloudflare');

            labelGpt?.classList.toggle('active', provider === 'gptmail');
            labelDuck?.classList.toggle('active', provider === 'duckmail');
            labelCloudflare?.classList.toggle('active', provider === 'cloudflare');

            if (provider === 'duckmail') {
                gptmailFields.style.display = 'none';
                duckmailFields.style.display = 'block';
                cloudflareFields.style.display = 'none';
                loadDuckmailDomains();
            } else if (provider === 'cloudflare') {
                gptmailFields.style.display = 'none';
                duckmailFields.style.display = 'none';
                cloudflareFields.style.display = 'block';
                loadCloudflareChannelsForGenerate();
                ensureCloudflareGenerateTagsLoaded();
            } else {
                gptmailFields.style.display = 'block';
                duckmailFields.style.display = 'none';
                cloudflareFields.style.display = 'none';
            }
        }

        // Load DuckMail domain name list
        async function loadDuckmailDomains() {
            const select = document.getElementById('duckmailDomain');
            select.innerHTML = I18n.t("<option value=\"\">Loading…</option>");
            try {
                const response = await fetch('/api/duckmail/domains');
                const data = await response.json();
                if (data.success && data.domains && data.domains.length > 0) {
                    select.innerHTML = data.domains.map(d =>
                        `<option value="${escapeHtml(d.domain)}">${escapeHtml(d.domain)}</option>`
                    ).join('');
                } else if (data.error) {
                    select.innerHTML = I18n.tpl`<option value="">Loading failed: ${escapeHtml(data.error)}</option>`;
                } else {
                    select.innerHTML = I18n.t("<option value=\"\">No domain name available</option>");
                }
            } catch (error) {
                select.innerHTML = I18n.tpl`<option value="">Loading failed: ${escapeHtml(error.message)}</option>`;
            }
        }

        async function loadCloudflareDomains() {
            const channelSelect = document.getElementById('cloudflareChannel');
            const select = document.getElementById('cloudflareDomain');
            const channelId = channelSelect?.value || '';
            if (!channelId) {
                select.innerHTML = I18n.t("<option value=\"\">Please select a channel first</option>");
                return;
            }
            select.innerHTML = I18n.t("<option value=\"\">Loading…</option>");
            try {
                const response = await fetch(`/api/cloudflare/domains?channel_id=${encodeURIComponent(channelId)}`);
                const data = await response.json();
                if (data.success && data.domains && data.domains.length > 0) {
                    select.innerHTML = data.domains.map(d =>
                        `<option value="${escapeHtml(d.domain)}">${escapeHtml(d.domain)}</option>`
                    ).join('');
                } else if (data.error) {
                    select.innerHTML = I18n.tpl`<option value="">Loading failed: ${escapeHtml(data.error)}</option>`;
                } else {
                    select.innerHTML = I18n.t("<option value=\"\">No domain name available</option>");
                }
            } catch (error) {
                select.innerHTML = I18n.tpl`<option value="">Loading failed: ${escapeHtml(error.message)}</option>`;
            }
        }

        async function loadCloudflareChannelsForGenerate() {
            const channelSelect = document.getElementById('cloudflareChannel');
            const domainSelect = document.getElementById('cloudflareDomain');
            if (!channelSelect || !domainSelect) return;

            channelSelect.innerHTML = I18n.t("<option value=\"\">Loading…</option>");
            domainSelect.innerHTML = I18n.t("<option value=\"\">Please select a channel first</option>");
            const channels = await loadCloudflareChannelsForTempEmails(true);
            const enabledChannels = channels.filter(channel => channel.enabled);
            if (enabledChannels.length === 0) {
                channelSelect.innerHTML = I18n.t("<option value=\"\">No channel available</option>");
                return;
            }

            channelSelect.innerHTML = enabledChannels.map(channel =>
                `<option value="${escapeHtml(String(channel.id))}">${escapeHtml(channel.name || `#${channel.id}`)}</option>`
            ).join('');
            const defaultChannel = enabledChannels.find(channel => channel.is_default) || enabledChannels[0];
            channelSelect.value = String(defaultChannel.id);
            await loadCloudflareDomains();
        }

        async function ensureCloudflareGenerateTagsLoaded() {
            const tags = typeof allTags === 'undefined' || !Array.isArray(allTags) ? [] : allTags;
            if (typeof loadTags === 'function' && tags.length === 0) {
                await loadTags();
            }
            renderCloudflareGenerateTagOptions();
        }

        function renderCloudflareGenerateTagOptions() {
            const container = document.getElementById('cloudflareGenerateTagOptions');
            if (!container) return;

            const tags = typeof allTags === 'undefined' || !Array.isArray(allTags) ? [] : allTags;
            if (!tags.length) {
                container.innerHTML = I18n.t("<div class=\"tag-cloud-empty\">No tags yet</div>");
                return;
            }

            container.innerHTML = tags.map(tag => {
                const color = tag.color || '#9ca3af';
                let bgStyle = '';
                if (color.startsWith('#')) {
                    bgStyle = `--dot-color: ${color}; --tag-bg: ${color}15; --tag-color: ${color}; --tag-border: ${color}40;`;
                } else {
                    bgStyle = `--dot-color: ${color}; --tag-bg: rgba(156, 163, 175, 0.1); --tag-color: #374151; --tag-border: #e2e8f0;`;
                }
                return `
                    <label class="tag-badge-item" style="${bgStyle}">
                        <input type="checkbox" class="cloudflare-generate-tag-checkbox" value="${escapeHtml(String(tag.id))}">
                        <span class="tag-badge-label">
                            <span class="tag-badge-dot"></span>
                            <span>${escapeHtml(tag.name || '')}</span>
                        </span>
                    </label>
                `;
            }).join('');
        }

        function getCloudflareGenerateSelectedTagIds() {
            return Array.from(document.querySelectorAll('.cloudflare-generate-tag-checkbox:checked'))
                .map(checkbox => parseInt(checkbox.value, 10))
                .filter(Number.isFinite);
        }

        function getCloudflareUsernameLines() {
            const textarea = document.getElementById('cloudflareUsername');
            return (textarea?.value || '')
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(Boolean);
        }

        async function generateCloudflareAiUsernames() {
            const btn = document.getElementById('cloudflareAiGenerateBtn');
            const textarea = document.getElementById('cloudflareUsername');
            const count = parseInt(document.getElementById('cloudflareGenerateCount')?.value || '1', 10);
            if (Number.isNaN(count) || count < 1 || count > 50) {
                showToast(I18n.t("Quantity must be between 1-50"), 'error');
                return;
            }
            if (!btn || !textarea) return;

            const originalText = btn.textContent;
            btn.disabled = true;
            btn.textContent = I18n.t("Generating...");
            try {
                const response = await fetch('/api/cloudflare/ai-usernames/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ count })
                });
                const data = await response.json();
                if (data.success && Array.isArray(data.usernames)) {
                    textarea.value = data.usernames.join('\n');
                    showToast(I18n.tpl`${data.usernames.length} usernames generated`, 'success');
                } else {
                    handleApiError(data, I18n.t("AI failed to generate username"));
                }
            } catch (error) {
                showToast(I18n.t("AI failed to generate username"), 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        }

        function formatCloudflareBatchFailureSummary(failures) {
            const items = Array.isArray(failures) ? failures.slice(0, 3) : [];
            return items.map(failure => {
                const index = Number(failure.index);
                const target = Number.isFinite(index) ? I18n.tpl`No. ${index}` : (failure.email || failure.username || I18n.t("Mailboxes"));
                return `${target}: ${failure.error || I18n.t("Creation failed")}`;
            }).join('；');
        }

        // Perform creation of temporary mailbox
        async function doGenerateTempEmail() {
            const provider = document.querySelector('input[name="tempEmailProvider"]:checked').value;
            const btn = document.getElementById('createTempEmailBtn');
            const originalText = btn.textContent;
            btn.disabled = true;
            btn.textContent = I18n.t("⏳ Creating...");

            try {
                let body = { provider };

                if (provider === 'duckmail') {
                    body.domain = document.getElementById('duckmailDomain').value;
                    body.username = document.getElementById('duckmailUsername').value.trim();
                    body.password = document.getElementById('duckmailPassword').value;

                    if (!body.domain) {
                        showToast(I18n.t("Please select a domain name"), 'error');
                        return;
                    }
                    if (!body.username || body.username.length < 3) {
                        showToast(I18n.t("Username must be at least 3 characters"), 'error');
                        return;
                    }
                    if (!body.password || body.password.length < 6) {
                        showToast(I18n.t("Password must be at least 6 characters"), 'error');
                        return;
                    }
                } else if (provider === 'cloudflare') {
                    body.channel_id = document.getElementById('cloudflareChannel').value;
                    body.domain = document.getElementById('cloudflareDomain').value;
                    body.count = parseInt(document.getElementById('cloudflareGenerateCount')?.value || '1', 10);
                    body.tag_ids = getCloudflareGenerateSelectedTagIds();
                    const usernameLines = getCloudflareUsernameLines();
                    if (usernameLines.length > 0) {
                        body.usernames = usernameLines;
                    }

                    if (!body.channel_id) {
                        showToast(I18n.t("Please select channel"), 'error');
                        return;
                    }
                    if (!body.domain) {
                        showToast(I18n.t("Please select a domain name"), 'error');
                        return;
                    }
                    if (Number.isNaN(body.count) || body.count < 1 || body.count > 50) {
                        showToast(I18n.t("Quantity must be between 1-50"), 'error');
                        return;
                    }
                    if (usernameLines.length > 0 && usernameLines.length !== body.count) {
                        showToast(I18n.t("The number of usernames must be consistent with the number of creations"), 'error');
                        return;
                    }
                }

                const useCloudflareBatch = provider === 'cloudflare';
                const response = await fetch(useCloudflareBatch ? '/api/temp-emails/generate-batch' : '/api/temp-emails/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });

                const data = await response.json();

                if (data.success) {
                    if (useCloudflareBatch) {
                        const failedText = data.failed_count ? I18n.tpl`, failed ${data.failed_count}` : '';
                        const failureSummary = formatCloudflareBatchFailureSummary(data.failures);
                        const failureSummaryText = failureSummary ? `：${failureSummary}` : '';
                        showToast(
                            I18n.tpl`${data.created_count || 0} temporary mailboxes ${failedText}${failureSummaryText} have been generated`,
                            data.failed_count ? 'warning' : 'success'
                        );
                    } else {
                        showToast(I18n.tpl`Temporary mailbox has been generated: ${data.email}`, 'success');
                    }
                    hideModal('tempEmailProviderModal');
                    delete accountsCache['temp'];
                    loadTempEmails(true);
                    loadGroups();
                } else {
                    handleApiError(data, I18n.t("Failed to generate temporary mailbox"));
                }
            } catch (error) {
                showToast(I18n.t("Failed to generate temporary mailbox"), 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        }

        // Select temporary mailbox
        function selectTempEmail(email) {
            currentAccount = email;
            currentAccountSummary = null;
            if (typeof updateGraphSendMailAvailability === 'function') {
                updateGraphSendMailAvailability();
            }
            currentCloudflareGlobalChannelId = null;
            currentCloudflareGlobalChannelName = '';
            isTempEmailGroup = true;
            currentMethod = 'gptmail';
            currentEmailId = null;
            currentEmailDetail = null;
            currentSkip = 0;
            hasMoreEmails = false;

            document.getElementById('currentAccount').classList.add('show');
            document.getElementById('currentAccountEmail').textContent = email + I18n.t(" (temporary)");
            showEmailList();
            closeMobilePanels();
            updateMobileContext();

            document.querySelectorAll('.account-item').forEach(item => {
                item.classList.remove('active');
                const emailEl = item.querySelector('.account-email');
                if (emailEl && emailEl.textContent.includes(email)) {
                    item.classList.add('active');
                }
            });

            // Hide folder switching button (temporary mailbox does not support folders)
            const folderTabs = document.getElementById('folderTabs');
            if (folderTabs) {
                folderTabs.style.display = 'none';
            }

            document.getElementById('emailList').innerHTML = I18n.tpl`
                <div class="empty-state">
                    <div class="empty-state-icon">📬</div>
                    <div class="empty-state-text">Click the "Get Email" button to get the email</div>
                </div>
            `;

            document.getElementById('emailDetail').innerHTML = I18n.tpl`
                <div class="empty-state">
                    <div class="empty-state-icon">📄</div>
                    <div class="empty-state-text">Select an email to view details</div>
                </div>
            `;
            document.getElementById('emailDetailToolbar').style.display = 'none';
            document.getElementById('emailCount').textContent = '';
            document.getElementById('methodTag').style.display = 'none';
        }

        function getCloudflareGlobalAddressFilter() {
            return (localStorage.getItem(getCloudflareGlobalFilterStorageKey()) || '').trim();
        }

        function getCloudflareGlobalFilterStorageKey() {
            return `outlook_cloudflare_global_address_filter_${currentCloudflareGlobalChannelId || 'default'}`;
        }

        function renderCloudflareGlobalFilterBar() {
            const value = getCloudflareGlobalAddressFilter();
            return I18n.tpl`
                <div class="cloudflare-global-filter">
                    <input type="text" class="cloudflare-global-filter-input" id="cloudflareGlobalAddressFilter"
                           placeholder="Filter by recipient address, e.g. user@gmail.com"
                           value="${escapeHtml(value)}"
                           onkeydown="if(event.key === 'Enter') applyCloudflareGlobalFilter()">
                    <button class="cloudflare-global-filter-btn" type="button" onclick="applyCloudflareGlobalFilter()">Query</button>
                    <button class="cloudflare-global-filter-btn secondary" type="button" onclick="clearCloudflareGlobalFilter()">All</button>
                </div>
            `;
        }

        function selectCloudflareGlobalMessages(event, channelId, channelName) {
            if (event) event.stopPropagation();
            currentCloudflareGlobalChannelId = Number(channelId) || null;
            currentCloudflareGlobalChannelName = channelName || '';
            currentAccount = `${CLOUDFLARE_GLOBAL_ACCOUNT_PREFIX}${currentCloudflareGlobalChannelId}`;
            currentAccountSummary = null;
            if (typeof updateGraphSendMailAvailability === 'function') {
                updateGraphSendMailAvailability();
            }
            currentMethod = 'cloudflare-admin';
            currentEmailId = null;
            currentEmailDetail = null;
            currentEmails = [];
            isTempEmailGroup = true;
            currentSkip = 0;
            hasMoreEmails = true;

            document.getElementById('currentAccount').classList.add('show');
            document.getElementById('currentAccountEmail').textContent = I18n.tpl`Cloudflare all emails · ${currentCloudflareGlobalChannelName || currentCloudflareGlobalChannelId}`;
            showEmailList();
            closeMobilePanels();
            updateMobileContext();

            document.querySelectorAll('.account-item').forEach(item => item.classList.remove('active'));
            const targetItem = event?.currentTarget;
            if (targetItem) targetItem.classList.add('active');

            const folderTabs = document.getElementById('folderTabs');
            if (folderTabs) {
                folderTabs.style.display = 'none';
            }

            document.getElementById('emailList').innerHTML = I18n.tpl`
                ${renderCloudflareGlobalFilterBar()}
                    <div class="empty-state">
                        <div class="empty-state-icon">📬</div>
                        <div class="empty-state-text">Click the "Get Email" button to get the current channel email</div>
                    </div>
            `;
            document.getElementById('emailDetail').innerHTML = I18n.tpl`
                <div class="empty-state">
                    <div class="empty-state-icon">📄</div>
                    <div class="empty-state-text">Select an email to view details</div>
                </div>
            `;
            document.getElementById('emailDetailToolbar').style.display = 'none';
            document.getElementById('emailCount').textContent = '';
            const methodTag = document.getElementById('methodTag');
            methodTag.textContent = I18n.tpl`Cloudflare All · ${currentCloudflareGlobalChannelName || currentCloudflareGlobalChannelId}`;
            methodTag.style.display = 'inline';
            methodTag.style.backgroundColor = '#f48120';
            methodTag.style.color = 'white';
        }

        function applyCloudflareGlobalFilter() {
            const input = document.getElementById('cloudflareGlobalAddressFilter');
            localStorage.setItem(getCloudflareGlobalFilterStorageKey(), (input?.value || '').trim());
            loadCloudflareGlobalMessages();
        }

        function clearCloudflareGlobalFilter() {
            localStorage.removeItem(getCloudflareGlobalFilterStorageKey());
            const input = document.getElementById('cloudflareGlobalAddressFilter');
            if (input) input.value = '';
            loadCloudflareGlobalMessages();
        }

        function buildCloudflareGlobalMessagesParams(offset = 0) {
            const address = getCloudflareGlobalAddressFilter();
            const params = new URLSearchParams({
                channel_id: String(currentCloudflareGlobalChannelId || ''),
                limit: String(CLOUDFLARE_GLOBAL_PAGE_SIZE),
                offset: String(Math.max(0, Number(offset) || 0))
            });
            if (address) params.set('address', address);
            return params;
        }

        function updateCloudflareGlobalMethodTag(data) {
            const methodTag = document.getElementById('methodTag');
            const channelLabel = data?.channel_name || currentCloudflareGlobalChannelName || currentCloudflareGlobalChannelId || '';
            const fallbackLabel = data?.fallback_used && data?.queried_email
                ? I18n.tpl`Cloudflare All · ${channelLabel} · ${data.queried_email}`
                : I18n.tpl`Cloudflare All · ${channelLabel}`;
            methodTag.textContent = fallbackLabel;
            methodTag.style.display = 'inline';
            methodTag.style.backgroundColor = '#f48120';
            methodTag.style.color = 'white';
        }

        async function fetchCloudflareGlobalMessagesPage(offset = 0) {
            if (!currentCloudflareGlobalChannelId) {
                return { success: false, error: I18n.t("Please select the Cloudflare channel first") };
            }
            const params = buildCloudflareGlobalMessagesParams(offset);
            const response = await fetch(`/api/cloudflare/messages?${params.toString()}`);
            return response.json();
        }

        function getCloudflareGlobalNextOffset(data, fallbackOffset = 0) {
            const responseOffset = Number(data?.offset);
            const responseLimit = Number(data?.limit);
            if (Number.isFinite(responseOffset) && Number.isFinite(responseLimit) && responseLimit > 0) {
                return responseOffset + responseLimit;
            }
            return Math.max(0, Number(fallbackOffset) || 0) + CLOUDFLARE_GLOBAL_PAGE_SIZE;
        }

        async function loadCloudflareGlobalMessages() {
            const container = document.getElementById('emailList');
            container.innerHTML = `${renderCloudflareGlobalFilterBar()}<div class="loading"><div class="loading-spinner"></div></div>`;
            currentEmailId = null;
            currentEmailDetail = null;
            currentEmails = [];
            currentMethod = 'cloudflare-admin';
            currentSkip = 0;
            hasMoreEmails = true;

            setTempEmailListLoadingState(true);

            try {
                const data = await fetchCloudflareGlobalMessagesPage(0);

                if (data.success) {
                    currentEmails = data.emails || [];
                    hasMoreEmails = data.has_more === true;
                    currentSkip = hasMoreEmails ? getCloudflareGlobalNextOffset(data, 0) : currentEmails.length;
                    document.getElementById('emailCount').textContent = `(${currentEmails.length})`;
                    updateCloudflareGlobalMethodTag(data);

                    renderEmailList(currentEmails);
                    scheduleEmailListLoadCheck(80);
                } else {
                    hasMoreEmails = false;
                    handleApiError(data, I18n.t("Failed to load all Cloudflare emails"));
                    container.innerHTML = `${renderCloudflareGlobalFilterBar()}${renderEmptyStateMarkup('⚠️', data.error || I18n.t("Loading failed"), {
                        onAction: 'loadCloudflareGlobalMessages()',
                        actionTitle: I18n.t("Refresh mailing list")
                    })}`;
                }
            } catch (error) {
                hasMoreEmails = false;
                container.innerHTML = `${renderCloudflareGlobalFilterBar()}${renderEmptyStateMarkup('⚠️', I18n.t("Network error, please try again"), {
                    onAction: 'loadCloudflareGlobalMessages()',
                    actionTitle: I18n.t("Refresh mailing list")
                })}`;
            } finally {
                setTempEmailListLoadingState(false);
            }
        }

        async function loadMoreCloudflareGlobalMessages() {
            if (isLoadingMore || !hasMoreEmails) return;

            isLoadingMore = true;
            const nextOffset = Math.max(Number(currentSkip) || 0, Array.isArray(currentEmails) ? currentEmails.length : 0);
            currentSkip = nextOffset;

            const emailList = document.getElementById('emailList');
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'loading loading-small';
            loadingDiv.id = 'loadingMore';
            loadingDiv.innerHTML = '<div class="loading-spinner"></div>';
            emailList.appendChild(loadingDiv);

            const refreshBtn = document.querySelector('.refresh-btn');
            if (refreshBtn) {
                refreshBtn.disabled = true;
            }

            try {
                const data = await fetchCloudflareGlobalMessagesPage(nextOffset);

                if (!data.success) {
                    hasMoreEmails = false;
                    const loadingEl = document.getElementById('loadingMore');
                    if (loadingEl) loadingEl.remove();
                    handleApiError(data, I18n.t("Failed to load all Cloudflare emails"));
                    return;
                }

                if (Array.isArray(data.emails) && data.emails.length > 0) {
                    currentEmails = currentEmails.concat(data.emails);
                    hasMoreEmails = data.has_more === true;
                    currentSkip = hasMoreEmails ? getCloudflareGlobalNextOffset(data, nextOffset) : currentEmails.length;

                    const loadingEl = document.getElementById('loadingMore');
                    if (loadingEl) loadingEl.remove();

                    document.getElementById('emailCount').textContent = `(${currentEmails.length})`;
                    updateCloudflareGlobalMethodTag(data);
                    renderEmailList(currentEmails);
                    scheduleEmailListLoadCheck(80);
                } else {
                    hasMoreEmails = false;
                    currentSkip = getCloudflareGlobalNextOffset(data, nextOffset);
                    const loadingEl = document.getElementById('loadingMore');
                    if (loadingEl) {
                        loadingEl.innerHTML = I18n.t("<div style=\"text-align:center;padding:20px;color:#999;font-size:13px;\">No more messages</div>");
                    }
                }
            } catch (error) {
                const loadingEl = document.getElementById('loadingMore');
                if (loadingEl) loadingEl.remove();
                showToast(I18n.t("Failed to load all Cloudflare emails"), 'error');
            } finally {
                isLoadingMore = false;
                if (refreshBtn) {
                    refreshBtn.disabled = false;
                }
            }
        }

        function getCloudflareGlobalMessageDetail(messageId, index) {
            currentEmailId = messageId;
            document.querySelectorAll('.email-item').forEach((item, i) => {
                item.classList.toggle('active', i === index);
            });

            document.getElementById('emailDetailToolbar').style.display = 'flex';
            const deleteBtn = document.querySelector('#emailDetailToolbar .batch-btn.danger');
            if (deleteBtn) deleteBtn.style.display = 'none';
            showMobileEmailDetail();

            const email = currentEmails[index];
            if (!email) {
                document.getElementById('emailDetail').innerHTML = renderEmptyStateMarkup('⚠️', I18n.t("Mail does not exist"));
                return;
            }
            currentEmailDetail = email;
            renderEmailDetail(email);
        }

        // Clear all emails from the temporary mailbox
        async function clearTempEmailMessages(email) {
            if (!(await showConfirmModal(I18n.tpl`Are you sure you want to clear all emails from temporary mailbox ${email}?`, { title: I18n.t("Clear mail"), confirmText: I18n.t("Confirm clearing") }))) {
                return;
            }

            try {
                const response = await fetch(`/api/temp-emails/${encodeURIComponent(email)}/clear`, {
                    method: 'DELETE'
                });

                const data = await response.json();

                if (data.success) {
                    showToast(I18n.t("Mail has been cleared"), 'success');

                    // If this mailbox is currently selected, clear the mailing list
                    if (currentAccount === email) {
                        currentEmails = [];
                        document.getElementById('emailCount').textContent = '(0)';
                        document.getElementById('emailList').innerHTML = I18n.tpl`
                            <div class="empty-state">
                                <div class="empty-state-icon">📭</div>
                                <div class="empty-state-text">Inbox is empty</div>
                            </div>
                        `;
                        document.getElementById('emailDetail').innerHTML = I18n.tpl`
                            <div class="empty-state">
                                <div class="empty-state-icon">📄</div>
                                <div class="empty-state-text">Select an email to view details</div>
                            </div>
                        `;
                        document.getElementById('emailDetailToolbar').style.display = 'none';
                    }
                } else {
                    handleApiError(data, I18n.t("Failed to clear temporary mailbox"));
                }
            } catch (error) {
                showToast(I18n.t("Clearing failed"), 'error');
            }
        }

        // Delete temporary mailbox
        async function deleteTempEmail(email) {
            if (!(await showConfirmModal(I18n.tpl`Are you sure you want to delete the temporary mailbox ${email}? All emails in the 
 mailbox will also be deleted.`, { title: I18n.t("Delete temporary mailbox"), confirmText: I18n.t("Confirm deletion") }))) {
                return;
            }

            try {
                const response = await fetch(`/api/temp-emails/${encodeURIComponent(email)}`, {
                    method: 'DELETE'
                });

                const data = await response.json();

                if (data.success) {
                    showToast(I18n.t("The temporary mailbox has been deleted"), 'success');
                    delete accountsCache['temp'];

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

                    loadTempEmails(true);
                    loadGroups();
                } else {
                    handleApiError(data, I18n.t("Failed to delete temporary mailbox"));
                }
            } catch (error) {
                showToast(I18n.t("Delete failed"), 'error');
            }
        }

        // Load emails from temporary mailbox
        async function loadTempEmailMessages(email) {
            if (currentMethod === 'cloudflare-admin' || email === CLOUDFLARE_GLOBAL_ACCOUNT_KEY) {
                loadCloudflareGlobalMessages();
                return;
            }

            const container = document.getElementById('emailList');
            container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
            currentEmailId = null;
            currentEmailDetail = null;

            setTempEmailListLoadingState(true);

            try {
                const response = await fetch(`/api/temp-emails/${encodeURIComponent(email)}/messages`);
                const data = await response.json();

                if (data.success) {
                    currentEmails = data.emails;
                    currentMethod = data.method === 'DuckMail'
                        ? 'duckmail'
                        : (data.method === 'Cloudflare' ? 'cloudflare' : 'gptmail');

                    const methodTag = document.getElementById('methodTag');
                    methodTag.textContent = data.method || 'GPTMail';
                    methodTag.style.display = 'inline';
                    methodTag.style.backgroundColor = data.method === 'DuckMail'
                        ? '#ff9800'
                        : (data.method === 'Cloudflare' ? '#f48120' : '#00bcf2');
                    methodTag.style.color = 'white';

                    document.getElementById('emailCount').textContent = `(${data.count})`;

                    renderEmailList(data.emails);
                } else {
                    handleApiError(data, I18n.t("Failed to load temporary mail"));
                    container.innerHTML = renderEmptyStateMarkup('⚠️', data.error && data.error.message ? data.error.message : I18n.t("Loading failed"), {
                        onAction: 'refreshEmails()',
                        actionTitle: I18n.t("Refresh mailing list")
                    });
                }
            } catch (error) {
                container.innerHTML = renderEmptyStateMarkup('⚠️', I18n.t("Network error, please try again"), {
                    onAction: 'refreshEmails()',
                    actionTitle: I18n.t("Refresh mailing list")
                });
            } finally {
                setTempEmailListLoadingState(false);
            }
        }

        // Get temporary email details
        async function getTempEmailDetail(messageId, index) {
            if (currentMethod === 'cloudflare-admin') {
                getCloudflareGlobalMessageDetail(messageId, index);
                return;
            }

            currentEmailId = messageId;
            document.querySelectorAll('.email-item').forEach((item, i) => {
                item.classList.toggle('active', i === index);
            });

            document.getElementById('emailDetailToolbar').style.display = 'flex';
            const deleteBtn = document.querySelector('#emailDetailToolbar .batch-btn.danger');
            if (deleteBtn) deleteBtn.style.display = 'none';
            showMobileEmailDetail();

            const container = document.getElementById('emailDetail');
            container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

            try {
                const response = await fetch(`/api/temp-emails/${encodeURIComponent(currentAccount)}/messages/${encodeURIComponent(messageId)}`);
                const data = await response.json();

                if (data.success) {
                    renderEmailDetail(data.email);
                } else {
                    handleApiError(data, I18n.t("Failed to load email details"));
                    container.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-state-icon">⚠️</div>
                            <div class="empty-state-text">${data.error && data.error.message ? data.error.message : I18n.t("Loading failed")}</div>
                        </div>
                    `;
                }
            } catch (error) {
                container.innerHTML = I18n.tpl`
                    <div class="empty-state">
                        <div class="empty-state-icon">⚠️</div>
                        <div class="empty-state-text">Network error, please try again</div>
                    </div>
                `;
            }
        }
