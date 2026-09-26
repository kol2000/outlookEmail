        /* global applyPendingNewMailSync, closeAllModals, debounce, ensureForwardingSettingsUI, handleGlobalGroupPointerMove, handleGlobalGroupPointerUp, hasPendingNewMailSync, initAccountListScroll, initAccountPageSizeSelect, initAccountSearchInput, initAccountSearchScopeSelect, initAccountSelectionGestures, initColorPicker, initEmailListScroll, loadGroups, loadMoreCloudflareGlobalMessages, loadTags, renderEmailList, saveAccountSearchQueryPreference, scheduleEmailListLoadCheck, searchAccounts */

        // Global status
        let csrfToken = null;
        let currentAccount = null;
        let currentAccountSummary = null;
        let currentGroupId = null;
        let currentEmails = [];
        let currentMethod = 'graph';
        let currentFolder = 'all'; // Current folder: all/inbox/junemail/deleteditems
        let isListVisible = true;
        let groups = [];
        let accountsCache = {}; // Cache the mailbox list of each group
        let currentAccountListSource = []; // The original data source of the current account list (grouping or search results)
        const ACCOUNT_LIST_DEFAULT_PAGE_SIZE = 200;
        const ACCOUNT_LIST_MAX_PAGE_SIZE = 10000;
        let accountListPageSize = ACCOUNT_LIST_DEFAULT_PAGE_SIZE;
        let accountPaginationState = {
            mode: '',
            key: '',
            total: 0,
            loaded: 0,
            hasMore: false,
            loading: false
        };
        let accountListRequestSeq = 0;
        let currentForwardingLogAccountId = null;
        let currentForwardingLogAccountEmail = '';
        let editingGroupId = null;
        let selectedColor = '#1a1a1a';
        let isTempEmailGroup = false; // Whether it is a temporary mailbox group
        let tempEmailGroupId = null; // Temporary mailbox group ID
        let isLoadingMore = false; // Is more mail loading?
        let hasMoreEmails = true; // Are there any more emails?
        let currentSkip = 0; // Current paging offset

        // Caching and trust model
        let emailListCache = {}; // Structure: { "account_folder": { emails: [], hasMore: bool, skip: int, method: str, count: int } }
        let currentEmailId = null; // Currently selected email ID
        let currentEmailDetail = null; // Details of the currently viewed email
        let isTrustedMode = false; // Whether in trust mode (does not filter HTML)
        let oauthPreviewAccount = null;
        let selectedTagFilters = new Set();
        let excludedTagFilters = new Set();
        let tagFilterKeyword = '';
        let responsiveUiResizeTimer = null;
        const DEFAULT_MAIL_FETCH_TIMEOUT_SECONDS = 120;
        const MAIL_FETCH_TIMEOUT_MIN_SECONDS = 30;
        const MAIL_FETCH_TIMEOUT_MAX_SECONDS = 300;
        const EMAIL_LIST_REQUEST_TIMEOUT_BUFFER_MS = 10000;
        function normalizeMailFetchTimeoutSeconds(value) {
            const seconds = Number.parseInt(String(value ?? '').trim(), 10);
            if (!Number.isFinite(seconds)) return DEFAULT_MAIL_FETCH_TIMEOUT_SECONDS;
            return Math.max(MAIL_FETCH_TIMEOUT_MIN_SECONDS, Math.min(MAIL_FETCH_TIMEOUT_MAX_SECONDS, seconds));
        }
        function buildEmailListRequestTimeoutMs(value) {
            return normalizeMailFetchTimeoutSeconds(value) * 1000 + EMAIL_LIST_REQUEST_TIMEOUT_BUFFER_MS;
        }
        let mailFetchTimeoutSeconds = normalizeMailFetchTimeoutSeconds(window.OUTLOOK_EMAIL_CONFIG?.mailFetchTimeoutSeconds);
        let EMAIL_LIST_REQUEST_TIMEOUT_MS = buildEmailListRequestTimeoutMs(mailFetchTimeoutSeconds);
        function setMailFetchTimeoutSeconds(value) {
            mailFetchTimeoutSeconds = normalizeMailFetchTimeoutSeconds(value);
            EMAIL_LIST_REQUEST_TIMEOUT_MS = buildEmailListRequestTimeoutMs(mailFetchTimeoutSeconds);
        }
        function getMailFetchTimeoutSeconds() {
            return mailFetchTimeoutSeconds;
        }
        const EMAIL_DETAIL_REQUEST_TIMEOUT_MS = 45000;
        const EMAIL_LIST_LOAD_MORE_THRESHOLD_PX = 96;
        const TOKEN_REFRESH_REQUEST_TIMEOUT_MS = 70000;
        const BULK_REFRESH_BASE_TIMEOUT_MS = 30000;
        const BULK_REFRESH_PER_ACCOUNT_TIMEOUT_MS = 35000;
        const BULK_REFRESH_MAX_TIMEOUT_MS = 180000;
        const REFRESH_STREAM_STALL_TIMEOUT_MS = 70000;
        const VERSION_STATUS_REQUEST_TIMEOUT_MS = 12000;
        const DOCKER_UPDATE_REQUEST_TIMEOUT_MS = 20000;
        const UPDATE_NOTICE_SEEN_VERSION_KEY = 'outlook_update_notice_seen_latest_version';
        const DEFAULT_APP_TIME_ZONE = 'Asia/Shanghai';
        const FALLBACK_APP_TIME_ZONES = [
            'Asia/Shanghai',
            'UTC',
            'Asia/Tokyo',
            'Asia/Singapore',
            'Europe/London',
            'America/Los_Angeles',
            'America/New_York',
        ];
        let versionStatusRequest = null;
        let dockerUpdateStatusRequest = null;
        let currentVersionStatusState = 'unknown';
        let dockerUpdateStatus = null;
        let emailListLoadCheckTimer = null;
        let appTimeZone = DEFAULT_APP_TIME_ZONE;
        let showAccountCreatedAt = true;
        let showAccountSortOrder = false;
        let showGroupId = true;
        let normalMailLocalRetentionEnabled = false;

        function normalizeTagFilterSelectionValue(value) {
            const normalized = Number.parseInt(String(value ?? '').trim(), 10);
            return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
        }

        function hasActiveTagFilters() {
            return selectedTagFilters.size > 0 || excludedTagFilters.size > 0;
        }

        function matchesSelectedTagFilters(tags) {
            const safeTags = Array.isArray(tags) ? tags : [];
            const selectedTagIds = Array.from(selectedTagFilters)
                .map(value => normalizeTagFilterSelectionValue(value))
                .filter(value => value !== null);
            const excludedTagIds = Array.from(excludedTagFilters)
                .map(value => normalizeTagFilterSelectionValue(value))
                .filter(value => value !== null);
            const matchesIncludedTags = !selectedTagIds.length || safeTags.some(tag => (
                selectedTagIds.includes(normalizeTagFilterSelectionValue(tag?.id))
            ));
            const matchesExcludedTags = !safeTags.some(tag => (
                excludedTagIds.includes(normalizeTagFilterSelectionValue(tag?.id))
            ));

            return matchesIncludedTags && matchesExcludedTags;
        }

        function isMobileLayout() {
            return window.matchMedia('(max-width: 768px)').matches;
        }

        function isValidAppTimeZone(timeZone) {
            const candidate = String(timeZone || '').trim();
            if (!candidate) {
                return false;
            }

            try {
                Intl.DateTimeFormat('zh-CN', { timeZone: candidate }).format(new Date());
                return true;
            } catch (error) {
                return false;
            }
        }

        function normalizeAppTimeZone(timeZone) {
            const candidate = String(timeZone || '').trim();
            if (isValidAppTimeZone(candidate)) {
                return candidate;
            }
            if (isValidAppTimeZone(DEFAULT_APP_TIME_ZONE)) {
                return DEFAULT_APP_TIME_ZONE;
            }
            return 'UTC';
        }

        function setAppTimeZone(timeZone) {
            appTimeZone = normalizeAppTimeZone(timeZone);
            return appTimeZone;
        }

        function getAppTimeZone() {
            return normalizeAppTimeZone(appTimeZone);
        }

        function setShowAccountCreatedAt(enabled) {
            showAccountCreatedAt = enabled !== false;
            return showAccountCreatedAt;
        }

        function shouldShowAccountCreatedAt() {
            return showAccountCreatedAt !== false;
        }

        function setShowAccountSortOrder(enabled) {
            showAccountSortOrder = enabled !== false;
            return showAccountSortOrder;
        }

        function shouldShowAccountSortOrder() {
            return showAccountSortOrder !== false;
        }

        function setShowGroupId(enabled) {
            showGroupId = enabled !== false;
            return showGroupId;
        }

        function shouldShowGroupId() {
            return showGroupId !== false;
        }

        function setNormalMailLocalRetentionEnabled(enabled) {
            normalMailLocalRetentionEnabled = enabled === true;
            return normalMailLocalRetentionEnabled;
        }

        function isNormalMailLocalRetentionEnabled() {
            return normalMailLocalRetentionEnabled === true;
        }

        function parseDateInput(dateInput) {
            if (!dateInput) {
                return null;
            }

            if (dateInput instanceof Date) {
                return Number.isNaN(dateInput.getTime()) ? null : dateInput;
            }

            if (typeof dateInput === 'number' || /^\d+$/.test(String(dateInput))) {
                const timestamp = Number(dateInput);
                const parsed = new Date(timestamp < 1000000000000 ? timestamp * 1000 : timestamp);
                return Number.isNaN(parsed.getTime()) ? null : parsed;
            }

            let normalizedInput = String(dateInput).trim();
            if (!normalizedInput) {
                return null;
            }

            if (!normalizedInput.includes('Z') && !normalizedInput.includes('+') && !normalizedInput.includes('-', 10)) {
                normalizedInput += 'Z';
            }

            const parsed = new Date(normalizedInput);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }

        function formatAbsoluteDateTime(dateInput) {
            const date = parseDateInput(dateInput);
            if (!date) {
                return '-';
            }

            return date.toLocaleString(I18n.language, {
                timeZone: getAppTimeZone(),
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
            });
        }

        function getAvailableAppTimeZones() {
            const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const supportedTimeZones = typeof Intl.supportedValuesOf === 'function'
                ? Intl.supportedValuesOf('timeZone')
                : [];
            const merged = [...FALLBACK_APP_TIME_ZONES, browserTimeZone, ...supportedTimeZones];
            const unique = [];
            const seen = new Set();

            merged.forEach(timeZone => {
                const candidate = String(timeZone || '').trim();
                if (!candidate || seen.has(candidate) || !isValidAppTimeZone(candidate)) {
                    return;
                }
                seen.add(candidate);
                unique.push(candidate);
            });

            return unique;
        }

        function isTimeoutAbortError(error) {
            return error?.name === 'AbortError';
        }

        function getNextEmailSkipFromCache(cache) {
            const cachedEmailCount = Array.isArray(cache?.emails) ? cache.emails.length : 0;
            const cachedSkip = Number(cache?.skip);

            if (!Number.isFinite(cachedSkip) || cachedSkip < 0) {
                return cachedEmailCount;
            }

            return Math.max(cachedSkip, cachedEmailCount);
        }

        function normalizeFolderSummaries(rawSummaries) {
            const normalizedSummaries = {};
            Object.entries(rawSummaries || {}).forEach(([folder, summary]) => {
                const normalizedFolder = String(folder || '').trim().toLowerCase();
                if (!normalizedFolder || !summary || typeof summary !== 'object') {
                    return;
                }

                const fetchedCount = Number(summary.fetched_count);
                const requestMethod = String(summary.request_method || '').trim().toLowerCase();
                const methodLabel = String(summary.method || '').trim();
                normalizedSummaries[normalizedFolder] = {
                    success: summary.success === true,
                    fetched_count: Number.isFinite(fetchedCount) && fetchedCount >= 0 ? fetchedCount : 0,
                    has_more: summary.has_more === true,
                    request_method: requestMethod === 'graph' || requestMethod === 'imap' ? requestMethod : '',
                    method: methodLabel,
                };
                if (Object.prototype.hasOwnProperty.call(summary, 'error')) {
                    normalizedSummaries[normalizedFolder].error = summary.error;
                }
            });
            return normalizedSummaries;
        }

        function mergeFolderSummaries(currentSummaries, incomingSummaries, { appendFetchedCount = false } = {}) {
            const mergedSummaries = normalizeFolderSummaries(currentSummaries);
            const normalizedIncoming = normalizeFolderSummaries(incomingSummaries);

            Object.entries(normalizedIncoming).forEach(([folder, summary]) => {
                const existingSummary = mergedSummaries[folder];
                if (!existingSummary) {
                    mergedSummaries[folder] = summary;
                    return;
                }

                if (appendFetchedCount && existingSummary.success === true && summary.success === true) {
                    mergedSummaries[folder] = {
                        ...existingSummary,
                        ...summary,
                        fetched_count: existingSummary.fetched_count + summary.fetched_count,
                    };
                    return;
                }

                if (summary.success === false) {
                    mergedSummaries[folder] = {
                        ...existingSummary,
                        ...summary,
                        fetched_count: existingSummary.fetched_count,
                    };
                    return;
                }

                mergedSummaries[folder] = {
                    ...existingSummary,
                    ...summary,
                };
            });

            return mergedSummaries;
        }

        function buildDerivedEmailListCache(account, folder) {
            const normalizedAccount = String(account || '').trim();
            const normalizedFolder = String(folder || '').trim().toLowerCase();

            if (!normalizedAccount || !['inbox', 'junkemail'].includes(normalizedFolder)) {
                return null;
            }

            const allCache = emailListCache[`${normalizedAccount}_all`];
            if (!allCache || !Array.isArray(allCache.emails)) {
                return null;
            }

            const folderSummaries = normalizeFolderSummaries(allCache.folder_summaries);
            const folderSummary = folderSummaries[normalizedFolder];
            if (!folderSummary || folderSummary.success !== true) {
                return null;
            }

            const filteredEmails = allCache.emails.filter(email => String(email?.folder || '').trim().toLowerCase() === normalizedFolder);
            const fetchedCount = Number(folderSummary.fetched_count);
            return {
                emails: filteredEmails,
                has_more: folderSummary.has_more === true,
                skip: Number.isFinite(fetchedCount) && fetchedCount >= 0
                    ? Math.max(fetchedCount, filteredEmails.length)
                    : filteredEmails.length,
                method: folderSummary.request_method || allCache.method || 'graph',
                method_label: folderSummary.method || allCache.method_label || allCache.method || 'graph',
                derived_from: 'all',
                folder_summaries: {
                    [normalizedFolder]: folderSummary,
                }
            };
        }

        function getEmailListCacheEntry(account, folder = 'all') {
            const normalizedAccount = String(account || '').trim();
            const normalizedFolder = String(folder || 'all').trim().toLowerCase() || 'all';

            if (!normalizedAccount) {
                return null;
            }

            const cacheKey = `${normalizedAccount}_${normalizedFolder}`;
            const directCache = emailListCache[cacheKey];
            if (directCache && directCache.derived_from !== 'all') {
                return directCache;
            }

            const derivedCache = buildDerivedEmailListCache(normalizedAccount, normalizedFolder);
            if (derivedCache) {
                emailListCache[cacheKey] = derivedCache;
                return derivedCache;
            }

            if (directCache) {
                delete emailListCache[cacheKey];
            }

            return null;
        }

        function applyEmailListCache(cache, { scheduleLoadCheck = true } = {}) {
            currentEmails = Array.isArray(cache?.emails) ? cache.emails : [];
            hasMoreEmails = cache?.has_more === true;
            currentSkip = getNextEmailSkipFromCache(cache);
            currentMethod = cache?.method || 'graph';

            const methodTag = document.getElementById('methodTag');
            if (methodTag) {
                methodTag.textContent = cache?.method_label || currentMethod;
                methodTag.style.display = 'inline';
            }

            const emailCount = document.getElementById('emailCount');
            if (emailCount) {
                emailCount.textContent = `(${currentEmails.length})`;
            }

            renderEmailList(currentEmails);
            if (scheduleLoadCheck) {
                scheduleEmailListLoadCheck(0);
            }
        }

        function invalidateEmailListCache(account, folder = 'all') {
            const normalizedAccount = String(account || '').trim();
            const normalizedFolder = String(folder || 'all').trim().toLowerCase() || 'all';

            if (!normalizedAccount) {
                return;
            }

            const cacheKeys = new Set([`${normalizedAccount}_${normalizedFolder}`]);
            if (normalizedFolder === 'all') {
                cacheKeys.add(`${normalizedAccount}_inbox`);
                cacheKeys.add(`${normalizedAccount}_junkemail`);
            } else if (['inbox', 'junkemail'].includes(normalizedFolder)) {
                cacheKeys.add(`${normalizedAccount}_all`);
            }

            cacheKeys.forEach(cacheKey => {
                delete emailListCache[cacheKey];
            });
        }

        function isNormalMailRetentionCache(cache) {
            const method = String(cache?.method || '').trim().toLowerCase();
            const methodLabel = String(cache?.method_label || '').trim().toLowerCase();
            return cache?.local_retention === true
                || method === 'local'
                || methodLabel === 'local retention';
        }

        function invalidateNormalMailRetentionCaches(options = {}) {
            Object.entries(emailListCache).forEach(([cacheKey, cacheValue]) => {
                if (isNormalMailRetentionCache(cacheValue)) {
                    delete emailListCache[cacheKey];
                }
            });

            if (options.resetCurrentView === true && isNormalMailRetentionCache({
                method: currentMethod,
                local_retention: currentMethod === 'local'
            })) {
                currentEmails = [];
                currentSkip = 0;
                hasMoreEmails = false;
                renderEmailList(currentEmails);
                const methodTag = document.getElementById('methodTag');
                if (methodTag) {
                    methodTag.style.display = 'none';
                }
                const emailCount = document.getElementById('emailCount');
                if (emailCount) {
                    emailCount.textContent = '';
                }
            }
        }

        function canLoadMoreEmails() {
            const isCloudflareGlobalList = currentMethod === 'cloudflare-admin';
            if (isLoadingMore || !hasMoreEmails || !currentAccount || (isTempEmailGroup && !isCloudflareGlobalList)) {
                return false;
            }

            const listPanel = document.getElementById('emailListPanel');
            return !listPanel || !listPanel.classList.contains('hidden');
        }

        function isEmailListNearBottom(emailList) {
            if (!emailList) {
                return false;
            }

            const remainingScroll = emailList.scrollHeight - emailList.scrollTop - emailList.clientHeight;
            return remainingScroll <= EMAIL_LIST_LOAD_MORE_THRESHOLD_PX;
        }

        function maybeLoadMoreEmails() {
            if (!canLoadMoreEmails()) {
                return;
            }

            const emailList = document.getElementById('emailList');
            if (isEmailListNearBottom(emailList)) {
                loadMoreEmails();
            }
        }

        function scheduleEmailListLoadCheck(delayMs = 0) {
            if (emailListLoadCheckTimer) {
                window.clearTimeout(emailListLoadCheckTimer);
                emailListLoadCheckTimer = null;
            }

            const runCheck = () => {
                emailListLoadCheckTimer = null;
                window.requestAnimationFrame(() => {
                    maybeLoadMoreEmails();
                });
            };

            if (delayMs > 0) {
                emailListLoadCheckTimer = window.setTimeout(runCheck, delayMs);
                return;
            }

            runCheck();
        }

        function fetchWithTimeout(url, options = {}) {
            const fetchOptions = { ...(options || {}) };
            const timeoutMs = Number(fetchOptions.timeoutMs || 0);
            const timeoutMessage = fetchOptions.timeoutMessage || I18n.t("Request timed out, please try again later.");
            delete fetchOptions.timeoutMs;
            delete fetchOptions.timeoutMessage;

            if (!timeoutMs || timeoutMs <= 0) {
                return window.fetch(url, fetchOptions);
            }

            const controller = new AbortController();
            const originalSignal = fetchOptions.signal;
            const timer = window.setTimeout(() => {
                controller.abort(new DOMException(timeoutMessage, 'AbortError'));
            }, timeoutMs);

            if (originalSignal) {
                if (originalSignal.aborted) {
                    controller.abort(originalSignal.reason);
                } else {
                    originalSignal.addEventListener('abort', () => controller.abort(originalSignal.reason), { once: true });
                }
            }

            fetchOptions.signal = controller.signal;
            return window.fetch(url, fetchOptions).finally(() => {
                window.clearTimeout(timer);
            });
        }

        function createEventSourceWatchdog(eventSource, timeoutMs, onTimeout) {
            let timer = null;

            function stop() {
                if (timer) {
                    window.clearTimeout(timer);
                    timer = null;
                }
            }

            function reset() {
                stop();
                timer = window.setTimeout(() => {
                    try {
                        eventSource.close();
                    } catch (error) {
                        console.warn(I18n.t("Failed to close timeout EventSource:"), error);
                    }
                    if (typeof onTimeout === 'function') {
                        onTimeout();
                    }
                }, timeoutMs);
            }

            reset();
            return { reset, stop };
        }

        function getFolderDisplayName(folder) {
            const names = {
                all: I18n.t("All emails"),
                inbox: I18n.t("Inbox"),
                junkemail: I18n.t("Junk mail"),
                deleteditems: I18n.t("Deleted mail")
            };
            return names[String(folder || '').trim().toLowerCase()] || I18n.t("Messages");
        }

        function normalizeGroupName(groupName, fallbackName = I18n.t("Unnamed group")) {
            const normalizedName = String(groupName || '').trim();
            return normalizedName || fallbackName;
        }

        function formatGroupIdBadgeText(groupId) {
            if (!shouldShowGroupId()) {
                return '';
            }
            const normalizedId = Number.parseInt(String(groupId ?? ''), 10);
            return Number.isFinite(normalizedId) ? String(normalizedId) : '';
        }

        function updateMobileQuickbarState() {
            const groupBtn = document.getElementById('mobileGroupBtn');
            const accountBtn = document.getElementById('mobileAccountBtn');
            const listBtn = document.getElementById('mobileListBtn');
            const groupOpen = document.getElementById('groupPanel')?.classList.contains('show');
            const accountOpen = document.getElementById('accountPanel')?.classList.contains('show');
            const listHidden = document.getElementById('emailListPanel')?.classList.contains('hidden');

            groupBtn?.classList.toggle('is-active', !!groupOpen);
            accountBtn?.classList.toggle('is-active', !!accountOpen);
            listBtn?.classList.toggle('is-active', !groupOpen && !accountOpen && !listHidden);
        }

        function updateMobileContext() {
            const groupText = document.getElementById('mobileCurrentGroup');
            const accountText = document.getElementById('mobileCurrentAccount');
            const listText = document.getElementById('mobileListButtonHint');
            const listHidden = document.getElementById('emailListPanel')?.classList.contains('hidden');
            const currentGroup = Array.isArray(groups) ? groups.find(group => group.id === currentGroupId) : null;
            const mobileActive = isMobileLayout();

            if (groupText) {
                groupText.textContent = currentGroup
                    ? normalizeGroupName(currentGroup.name)
                    : I18n.t("Not selected");
            }

            if (accountText) {
                accountText.textContent = currentAccount
                    ? `${currentAccount}${isTempEmailGroup ? I18n.t(" (temporary)") : ''}`
                    : I18n.t("Not selected");
            }

            if (listText) {
                listText.textContent = listHidden ? I18n.t("Return to list") : I18n.t("Current list");
            }

            document.body.classList.toggle('mobile-email-detail-open', !!mobileActive && !!listHidden);
            document.body.classList.toggle('mobile-has-current-account', !!mobileActive && !!currentAccount);
            updateMobileQuickbarState();
        }

        function syncMobilePanels() {
            const scrim = document.getElementById('mobilePanelScrim');
            const hasOpenPanel = isMobileLayout()
                && !!document.querySelector('#groupPanel.show, #accountPanel.show');

            scrim?.classList.toggle('show', hasOpenPanel);
            document.body.classList.toggle('mobile-panels-open', hasOpenPanel);
            updateMobileQuickbarState();
        }

        function closeMobilePanels() {
            document.getElementById('groupPanel')?.classList.remove('show');
            document.getElementById('accountPanel')?.classList.remove('show');
            syncMobilePanels();
        }

        function openMobilePanel(panelName) {
            if (!isMobileLayout()) return;

            const targetPanel = document.getElementById(panelName === 'account' ? 'accountPanel' : 'groupPanel');
            const otherPanel = document.getElementById(panelName === 'account' ? 'groupPanel' : 'accountPanel');
            if (!targetPanel) return;

            closeNavbarActionsMenu();
            otherPanel?.classList.remove('show');
            targetPanel.classList.add('show');
            syncMobilePanels();
        }

        function toggleMobilePanel(panelName) {
            if (!isMobileLayout()) return;

            const targetPanel = document.getElementById(panelName === 'account' ? 'accountPanel' : 'groupPanel');
            if (!targetPanel) return;

            if (targetPanel.classList.contains('show')) {
                closeMobilePanels();
                return;
            }

            openMobilePanel(panelName);
        }

        function closeNavbarActionsMenu() {
            const container = document.querySelector('.navbar-actions');
            if (!container) return;

            container.classList.remove('is-open');
            document.getElementById('mobileNavMenuBtn')?.setAttribute('aria-expanded', 'false');
        }

        function closeVersionPopover() {
            const versionRoot = document.getElementById('appVersion');
            const versionPopover = document.getElementById('appVersionPopover');
            if (!versionRoot || !versionPopover) return;

            versionRoot.classList.remove('is-open');
            document.getElementById('appVersionChip')?.setAttribute('aria-expanded', 'false');
            versionPopover.setAttribute('aria-hidden', 'true');
            versionPopover.hidden = true;
        }

        function toggleVersionPopover() {
            const versionRoot = document.getElementById('appVersion');
            const versionPopover = document.getElementById('appVersionPopover');
            if (!versionRoot || !versionPopover) return false;

            const willOpen = !versionRoot.classList.contains('is-open');
            closeNavbarActionsMenu();
            versionRoot.classList.toggle('is-open', willOpen);
            document.getElementById('appVersionChip')?.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            versionPopover.setAttribute('aria-hidden', willOpen ? 'false' : 'true');
            versionPopover.hidden = !willOpen;
            return false;
        }

        function copyAppVersion() {
            const versionText = document.getElementById('appVersionValue')?.textContent?.trim();
            if (!versionText) return;

            if (typeof copyTextToClipboard === 'function') {
                Promise.resolve(copyTextToClipboard(versionText, I18n.t("Version number copied"))).finally(closeVersionPopover);
                return;
            }

            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                navigator.clipboard.writeText(versionText).then(() => {
                    showToast(I18n.t("Version number copied"), 'success');
                    closeVersionPopover();
                }).catch(() => {
                    showToast(I18n.t("Copy failed, please copy manually"), 'error');
                });
            }
        }

        function refreshDockerUpdateButton() {
            const updateButtons = [
                document.getElementById('appVersionDockerUpdateBtn'),
                document.getElementById('releaseNoticeDockerUpdateBtn'),
            ].filter(Boolean);
            if (!updateButtons.length) return;

            const enabled = dockerUpdateStatus?.enabled === true;
            const available = dockerUpdateStatus?.available === true;
            const running = dockerUpdateStatus?.state?.running === true;
            const updateAvailable = currentVersionStatusState === 'update_available';

            updateButtons.forEach(updateButton => {
                const defaultLabel = updateButton.dataset.defaultLabel || I18n.t("Docker updates");
                const unavailableLabel = updateButton.dataset.unavailableLabel || I18n.t("Cannot be updated online");

                updateButton.hidden = !(enabled && updateAvailable);
                updateButton.disabled = !available || running;
                updateButton.textContent = running ? I18n.t("Updating...") : (available ? defaultLabel : unavailableLabel);
                updateButton.title = available
                    ? I18n.t("Start Docker online update")
                    : (dockerUpdateStatus?.reason || I18n.t("Docker updates are not available"));
            });

            const dockerHint = document.getElementById('releaseNoticeDockerHint');
            if (dockerHint) {
                dockerHint.hidden = !updateAvailable || available;
            }
        }

        async function loadDockerUpdateStatus(forceRefresh = false) {
            if (dockerUpdateStatusRequest && !forceRefresh) {
                return dockerUpdateStatusRequest;
            }

            dockerUpdateStatusRequest = fetchWithTimeout('/api/docker-update/status', {
                timeoutMs: DOCKER_UPDATE_REQUEST_TIMEOUT_MS,
                timeoutMessage: I18n.t("Docker update status acquisition timeout"),
                cache: 'no-store',
                credentials: 'same-origin'
            })
                .then(async (response) => {
                    const payload = await response.json().catch(() => ({}));
                    if (!response.ok || !payload.success || !payload.docker_update) {
                        throw new Error(payload.error || I18n.t("Docker update status acquisition failed"));
                    }
                    dockerUpdateStatus = payload.docker_update;
                    refreshDockerUpdateButton();
                    return dockerUpdateStatus;
                })
                .catch(() => {
                    dockerUpdateStatus = { enabled: false, available: false };
                    refreshDockerUpdateButton();
                    return dockerUpdateStatus;
                })
                .finally(() => {
                    dockerUpdateStatusRequest = null;
                });

            return dockerUpdateStatusRequest;
        }

        async function monitorDockerUpdateResult(attempt = 0) {
            const status = await loadDockerUpdateStatus(true);
            const state = status?.state || {};

            if (state.running) {
                if (attempt < 20) {
                    window.setTimeout(() => monitorDockerUpdateResult(attempt + 1), 2000);
                }
                return;
            }

            if (state.success === null || typeof state.success === 'undefined') {
                showToast(
                    state.message || I18n.t("The service may have been restarted, please refresh and check the current version/image"),
                    'warning'
                );
                return;
            }

            if (state.success === false) {
                showToast(state.error || state.message || I18n.t("Docker update is not completed"), 'error');
                return;
            }

            if (state.success === true) {
                showToast(state.message || I18n.t("Docker update completed"), 'success');
            }
        }

        async function startDockerUpdate() {
            const updateButton = document.getElementById('appVersionDockerUpdateBtn');
            if (updateButton?.disabled) return;

            const confirmed = window.confirm(I18n.t("A Docker online update will be initiated and the container may restart automatically. Confirm to continue?"));
            if (!confirmed) return;

            document.querySelectorAll('#appVersionDockerUpdateBtn, #releaseNoticeDockerUpdateBtn').forEach(button => {
                button.disabled = true;
                button.textContent = I18n.t("Updating...");
            });

            try {
                const response = await fetchWithTimeout('/api/docker-update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                    timeoutMs: DOCKER_UPDATE_REQUEST_TIMEOUT_MS,
                    timeoutMessage: I18n.t("Docker update startup timeout"),
                    credentials: 'same-origin'
                });
                const payload = await response.json().catch(() => ({}));
                if (!response.ok || !payload.success) {
                    throw new Error(payload.error || I18n.t("Docker update startup failed"));
                }
                dockerUpdateStatus = payload.docker_update || dockerUpdateStatus;
                refreshDockerUpdateButton();
                showToast(payload.message || I18n.t("The Docker update task has been started and the results are awaiting"), 'info');
                window.setTimeout(() => monitorDockerUpdateResult(0), 2000);
            } catch (error) {
                await loadDockerUpdateStatus(true);
                showToast(error?.message || I18n.t("Docker update startup failed"), 'error');
            }
        }

        function applyVersionStatus(versionStatus = {}) {
            const statusBadge = document.getElementById('appVersionStatus');
            const hintEl = document.getElementById('appVersionHint');
            const actionLink = document.getElementById('appVersionActionLink');
            const upgradeBadgeEl = document.getElementById('appVersionUpgradeBadge');
            const state = String(versionStatus.status || 'unknown').trim() || 'unknown';
            const badgeLabel = String(versionStatus.badge_label || I18n.t("Check failed")).trim() || I18n.t("Check failed");
            const hint = String(versionStatus.hint || I18n.t("Temporarily unable to obtain warehouse version information")).trim() || I18n.t("Temporarily unable to obtain warehouse version information");
            const updateUrl = String(versionStatus.update_url || '').trim();
            const defaultLabel = actionLink?.dataset.defaultLabel || I18n.t("View update log");
            currentVersionStatusState = state;

            if (statusBadge) {
                statusBadge.dataset.state = state;
                statusBadge.textContent = badgeLabel;
            }

            if (hintEl) {
                hintEl.textContent = hint;
            }

            if (upgradeBadgeEl) {
                const shouldShowUpgradeBadge = state === 'update_available';
                upgradeBadgeEl.hidden = !shouldShowUpgradeBadge;
            }

            if (actionLink) {
                actionLink.href = updateUrl || actionLink.href;
                actionLink.textContent = state === 'update_available' ? I18n.t("Go to update") : defaultLabel;
            }

            refreshDockerUpdateButton();
        }

        async function loadVersionStatus(forceRefresh = false) {
            if (versionStatusRequest && !forceRefresh) {
                return versionStatusRequest;
            }

            applyVersionStatus({
                status: 'checking',
                badge_label: I18n.t("Under inspection"),
                hint: I18n.t("Checking warehouse version..."),
            });

            const requestUrl = forceRefresh ? '/api/version-status?refresh=1' : '/api/version-status';
            versionStatusRequest = fetchWithTimeout(requestUrl, {
                timeoutMs: VERSION_STATUS_REQUEST_TIMEOUT_MS,
                timeoutMessage: I18n.t("Check for update timeout"),
            })
                .then(async (response) => {
                    const payload = await response.json().catch(() => ({}));
                    if (!response.ok || !payload.success || !payload.version_status) {
                        throw new Error(payload.error || I18n.t("Failed to obtain version status"));
                    }
                    applyVersionStatus(payload.version_status);
                    showUpdateNoticeIfNeeded(payload.version_status);
                    return payload.version_status;
                })
                .catch(() => {
                    const fallbackStatus = {
                        status: 'unknown',
                        badge_label: I18n.t("Check failed"),
                        hint: I18n.t("Temporarily unable to obtain warehouse version information"),
                    };
                    applyVersionStatus(fallbackStatus);
                    return fallbackStatus;
                })
                .finally(() => {
                    versionStatusRequest = null;
                });

            return versionStatusRequest;
        }

        window.toggleVersionPopover = toggleVersionPopover;
        window.copyAppVersion = copyAppVersion;
        window.startDockerUpdate = startDockerUpdate;

        function toggleNavbarActionsMenu() {
            if (!isMobileLayout()) return;

            const container = document.querySelector('.navbar-actions');
            if (!container) return;

            const willOpen = !container.classList.contains('is-open');
            closeMobilePanels();
            closeVersionPopover();
            container.classList.toggle('is-open', willOpen);
            document.getElementById('mobileNavMenuBtn')?.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        }

        function handleGlobalChromeClick(event) {
            if (!event.target.closest('.navbar-actions')) {
                closeNavbarActionsMenu();
            }
            if (!event.target.closest('.app-version')) {
                closeVersionPopover();
            }
        }

        function showMobileEmailDetail() {
            if (!isMobileLayout()) return;

            const panel = document.getElementById('emailListPanel');
            if (!panel) return;

            panel.classList.add('hidden');
            isListVisible = false;
            const toggleText = document.getElementById('toggleListText');
            if (toggleText) {
                toggleText.textContent = I18n.t("Show list");
            }
            closeMobilePanels();
            closeNavbarActionsMenu();
            updateMobileContext();
        }

        function syncResponsiveUI() {
            if (!isMobileLayout()) {
                closeMobilePanels();
                closeNavbarActionsMenu();

                const listPanel = document.getElementById('emailListPanel');
                if (listPanel) {
                    listPanel.classList.remove('hidden');
                }
                isListVisible = true;
                const toggleText = document.getElementById('toggleListText');
                if (toggleText) {
                    toggleText.textContent = I18n.t("Hide list");
                }
            }

            updateMobileContext();
            scheduleEmailListLoadCheck(0);
        }

        // ==================== CSRF Protection ====================

        const originalFetch = window.fetch.bind(window);

        // Initialize CSRF Token
        async function initCSRFToken(forceRefresh = false) {
            if (csrfToken && !forceRefresh) {
                return csrfToken;
            }

            try {
                const response = await originalFetch('/api/csrf-token', {
                    cache: 'no-store',
                    credentials: 'same-origin',
                    headers: {
                        'Cache-Control': 'no-cache'
                    }
                });
                if (!response.ok) {
                    throw new Error(`CSRF token request failed: ${response.status}`);
                }
                const data = await response.json();
                csrfToken = data.csrf_token || null;
                if (data.csrf_disabled) {
                    console.warn('CSRF protection is disabled. Install flask-wtf for better security.');
                }
                return csrfToken;
            } catch (error) {
                console.error('Failed to initialize CSRF token:', error);
                return null;
            }
        }

        function appendCSRFHeader(options, token) {
            if (!token) {
                return;
            }

            if (options.headers instanceof Headers) {
                options.headers.set('X-CSRFToken', token);
                return;
            }

            options.headers = {
                ...(options.headers || {}),
                'X-CSRFToken': token
            };
        }

        async function isCSRFFailureResponse(response) {
            if (!response || response.status !== 400) {
                return false;
            }

            try {
                const contentType = response.headers.get('content-type') || '';
                if (contentType.includes('application/json')) {
                    const payload = await response.clone().json();
                    const errorMessage = String(
                        payload?.error || payload?.message || payload?.description || ''
                    );
                    return Boolean(payload?.csrf_error) || /csrf/i.test(errorMessage);
                }

                const bodyText = await response.clone().text();
                return /csrf/i.test(bodyText);
            } catch (error) {
                console.warn('Failed to inspect CSRF error response:', error);
                return false;
            }
        }

        async function fetchWithCSRF(url, options = {}, retrying = false) {
            const requestOptions = {
                credentials: 'same-origin',
                ...(options || {})
            };
            const method = String(requestOptions.method || 'GET').toUpperCase();

            if (method !== 'GET') {
                if (!csrfToken) {
                    await initCSRFToken();
                }
                appendCSRFHeader(requestOptions, csrfToken);
            }

            const response = await originalFetch(url, requestOptions);
            if (retrying || method === 'GET') {
                return response;
            }

            if (await isCSRFFailureResponse(response)) {
                csrfToken = null;
                const refreshedToken = await initCSRFToken(true);
                if (refreshedToken) {
                    const retryOptions = {
                        credentials: 'same-origin',
                        ...(options || {})
                    };
                    appendCSRFHeader(retryOptions, refreshedToken);
                    return fetchWithCSRF(url, retryOptions, true);
                }
            }

            return response;
        }

        // Package fetch request and automatically add CSRF Token
        window.fetch = function (url, options = {}) {
            return fetchWithCSRF(url, options);
        };

        async function loadAppTimeZoneFromSettings() {
            try {
                const response = await fetch('/api/settings', {
                    method: 'GET',
                    cache: 'no-store',
                    credentials: 'same-origin'
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok || !data?.success) {
                    return null;
                }

                const timeZone = data?.settings?.app_timezone;
                if (timeZone) {
                    setAppTimeZone(timeZone);
                }
                setShowAccountCreatedAt(String(data?.settings?.show_account_created_at) !== 'false');
                setShowAccountSortOrder(String(data?.settings?.show_account_sort_order) === 'true');
                setShowGroupId(String(data?.settings?.show_group_id) !== 'false');
                setNormalMailLocalRetentionEnabled(String(data?.settings?.normal_mail_local_retention_enabled) === 'true');
                return data?.settings || null;
            } catch (error) {
                return null;
            }
        }

        // Initialization
        document.addEventListener('DOMContentLoaded', async function () {
            // Initialize theme
            initTheme();
            // Initialize CSRF Token
            await initCSRFToken();
            await loadAppTimeZoneFromSettings();
            ensureForwardingSettingsUI();
            bindPersistentButtonHandlers();
            document.addEventListener('click', closeAccountActionMenus);
            document.addEventListener('click', handleGlobalChromeClick);
            document.addEventListener('click', handleGlobalTagFilterClick);
            document.addEventListener('click', handleGlobalImportTagClick);
            document.addEventListener('click', handleGlobalEditTagClick);
            
            // Dropdown menu click handling (for batch actions and navbar settings)
            document.addEventListener('click', function(e) {
                // Batch action dropdowns
                const activeBatchDropdown = e.target.closest('.batch-dropdown');
                const batchToggle = e.target.closest('.batch-dropdown .dropdown-toggle');
                
                document.querySelectorAll('.batch-dropdown').forEach(dropdown => {
                    if (dropdown !== activeBatchDropdown) {
                        dropdown.classList.remove('is-open');
                    }
                });
                
                if (batchToggle && activeBatchDropdown) {
                    activeBatchDropdown.classList.toggle('is-open');
                    e.stopPropagation();
                }

                // Navbar dropdowns
                const activeNavDropdown = e.target.closest('.navbar-dropdown');
                const navToggle = e.target.closest('.navbar-dropdown .dropdown-toggle');
                
                document.querySelectorAll('.navbar-dropdown').forEach(dropdown => {
                    if (dropdown !== activeNavDropdown) {
                        dropdown.classList.remove('is-open');
                    }
                });
                
                if (navToggle && activeNavDropdown) {
                    activeNavDropdown.classList.toggle('is-open');
                    e.stopPropagation();
                }
            });

            document.getElementById('importImapHost')?.addEventListener('input', updateImportHint);
            document.getElementById('importImapPort')?.addEventListener('input', updateImportHint);
            document.getElementById('oauthEmailInput')?.addEventListener('input', invalidateRefreshTokenPreview);
            document.getElementById('oauthPasswordInput')?.addEventListener('input', invalidateRefreshTokenPreview);
            document.getElementById('redirectUrlInput')?.addEventListener('input', invalidateRefreshTokenPreview);
            document.getElementById('navbarActionsMenu')?.addEventListener('click', function (event) {
                if (event.target.closest('.navbar-btn')) {
                    closeNavbarActionsMenu();
                }
            });
            document.getElementById('mobileNavMenuBtn')?.addEventListener('click', function () {
                toggleNavbarActionsMenu();
            });
            document.getElementById('mobileGroupBtn')?.addEventListener('click', function () {
                toggleMobilePanel('group');
            });
            document.getElementById('mobileAccountBtn')?.addEventListener('click', function () {
                toggleMobilePanel('account');
            });
            document.getElementById('mobileListBtn')?.addEventListener('click', function () {
                showEmailList();
            });
            document.getElementById('mobilePanelScrim')?.addEventListener('click', function () {
                closeMobilePanels();
            });
            window.addEventListener('resize', function () {
                clearTimeout(responsiveUiResizeTimer);
                responsiveUiResizeTimer = window.setTimeout(syncResponsiveUI, 120);
            });
            document.addEventListener('keydown', function (event) {
                if (event.key === 'Escape') {
                    closeVersionPopover();
                }
            });

            closeAllModals(); // Fix: Close all modal boxes when the application starts to prevent browser caching from causing residual modal box background layers
            loadVersionStatus();
            loadDockerUpdateStatus();
            loadGroups();
            if (typeof loadTags === 'function') {
                loadTags();
            }
            initColorPicker();
            initEmailListScroll();
            initAccountListScroll();
            initAccountPageSizeSelect();
            initAccountSearchScopeSelect();
            initAccountSearchInput();
            if (typeof initAccountSelectionGestures === 'function') {
                initAccountSelectionGestures();
            }
            window.addEventListener('pointermove', handleGlobalGroupPointerMove, { passive: false });
            window.addEventListener('pointerup', handleGlobalGroupPointerUp);
            window.addEventListener('pointercancel', handleGlobalGroupPointerUp);

            // Bind search box event
            const searchInput = document.getElementById('globalSearch');
            if (searchInput) {
                const debouncedSearch = debounce((value) => {
                    searchAccounts(value);
                }, 300);
                searchInput.addEventListener('input', function (event) {
                    saveAccountSearchQueryPreference(event.target.value);
                    debouncedSearch(event.target.value);
                });
            }

            // Initialize folded state and minimalist mode state
            initGroupPanelCollapseState();
            initAccountMinimalModeState();

            syncResponsiveUI();
            handleExtensionLaunchHash();
        });

        function handleExtensionLaunchHash() {
            const action = String(window.location.hash || '').replace(/^#/, '').trim().toLowerCase();
            if (!action) {
                return;
            }

            const actions = {
                'settings': () => typeof showSettingsModal === 'function' && showSettingsModal(),
                'refresh': () => typeof showRefreshModal === 'function' && showRefreshModal(true),
                'export': () => typeof showExportModal === 'function' && showExportModal(),
                'import': () => typeof showAddAccountModal === 'function' && showAddAccountModal(),
                'oauth': () => typeof showGetRefreshTokenModal === 'function' && showGetRefreshTokenModal(),
                'tags': () => typeof showTagManagementModal === 'function' && showTagManagementModal(),
            };

            const openAction = actions[action];
            if (!openAction) {
                return;
            }

            window.setTimeout(openAction, 250);
        }

        function getCurrentReleaseNoticeVersion() {
            const modalVersion = document.getElementById('releaseNoticeModal')?.dataset?.latestVersion;
            return String(modalVersion || '').trim();
        }

        function getSeenReleaseNoticeVersion() {
            try {
                return localStorage.getItem(UPDATE_NOTICE_SEEN_VERSION_KEY) || '';
            } catch (error) {
                return '';
            }
        }

        function markReleaseNoticeSeen(version) {
            try {
                localStorage.setItem(UPDATE_NOTICE_SEEN_VERSION_KEY, String(version || ''));
            } catch (error) {
                // Do not block the main interface when localStorage is unavailable.
            }
        }

        function renderReleaseNotice(versionStatus = {}) {
            const modal = document.getElementById('releaseNoticeModal');
            if (!modal) {
                return false;
            }

            const currentVersion = String(versionStatus.current_version || '').trim();
            const latestVersion = String(versionStatus.latest_version || '').trim();
            const updateUrl = String(versionStatus.update_url || versionStatus.changelog_url || '').trim();
            const changelogUrl = String(versionStatus.changelog_url || updateUrl || '').trim();
            const releaseNotes = versionStatus.release_notes || {};
            const noteEntries = Array.isArray(releaseNotes.entries) && releaseNotes.entries.length > 0
                ? releaseNotes.entries.slice(0, 3)
                : [{
                    title: releaseNotes.title || latestVersion || I18n.t("Update content"),
                    items: Array.isArray(releaseNotes.items) ? releaseNotes.items : [],
                }];
            const hint = String(versionStatus.hint || I18n.t("New version found")).trim();

            modal.dataset.latestVersion = latestVersion;

            const summaryEl = document.getElementById('releaseNoticeVersionSummary');
            if (summaryEl) {
                summaryEl.textContent = I18n.tpl`Current version: ${currentVersion || '-'} / Latest version: ${latestVersion || '-'}`;
            }

            const listEl = document.getElementById('releaseNoticeNotesList');
            if (listEl) {
                const cards = noteEntries
                    .map((entry, index) => {
                        const entryTitle = String(entry?.title || (index === 0 ? latestVersion : I18n.t("Update content"))).trim();
                        const entryItems = Array.isArray(entry?.items) ? entry.items : [];
                        const itemsMarkup = entryItems.length > 0
                            ? entryItems.map(item => `<li>${escapeHtml(String(item || ''))}</li>`).join('')
                            : I18n.t("<li>The update content is temporarily unavailable, please view the complete update log.</li>");
                        const badgeMarkup = index === 0 ? I18n.t("<span class=\"release-notice-badge\">Latest</span>") : '';
                        return `
                            <div class="release-notice-card release-notice-entry">
                                <div class="release-notice-entry-header">
                                    <div class="release-notice-card-title">${escapeHtml(entryTitle)}</div>
                                    ${badgeMarkup}
                                </div>
                                <ul>${itemsMarkup}</ul>
                            </div>
                        `;
                    })
                    .join('');
                listEl.innerHTML = cards || I18n.tpl`
                    <div class="release-notice-card release-notice-entry">
                        <div class="release-notice-entry-header">
                            <div class="release-notice-card-title">Update content</div>
                            <span class="release-notice-badge">Latest</span>
                        </div>
                        <ul><li>The update content is temporarily unavailable, please view the complete update log.</li></ul>
                    </div>
                `;
            }

            const hintEl = document.getElementById('releaseNoticeHint');
            if (hintEl) {
                hintEl.textContent = I18n.tpl`${hint}. This prompt will only appear once per new version.`;
            }

            const changelogLink = document.getElementById('releaseNoticeChangelogLink');
            if (changelogLink && changelogUrl) {
                changelogLink.href = changelogUrl;
            }

            const updateLink = document.getElementById('releaseNoticeUpdateLink');
            if (updateLink && updateUrl) {
                updateLink.href = updateUrl;
            }

            return true;
        }

        function showUpdateNoticeIfNeeded(versionStatus = {}) {
            const latestVersion = String(versionStatus.latest_version || '').trim();
            if (String(versionStatus.status || '') !== 'update_available' || !latestVersion) {
                return;
            }

            if (getSeenReleaseNoticeVersion() === latestVersion) {
                return;
            }

            if (!renderReleaseNotice(versionStatus)) {
                return;
            }
            showModal('releaseNoticeModal');
        }

        function markCurrentReleaseNoticeSeen() {
            const currentVersion = getCurrentReleaseNoticeVersion();
            if (currentVersion) {
                markReleaseNoticeSeen(currentVersion);
            }
        }

        function dismissReleaseNotice() {
            markCurrentReleaseNoticeSeen();
            hideModal('releaseNoticeModal');
        }

        window.dismissReleaseNotice = dismissReleaseNotice;
        window.markCurrentReleaseNoticeSeen = markCurrentReleaseNoticeSeen;

        function closeAccountActionMenus() {
            document.querySelectorAll('.account-item.menu-open').forEach(item => {
                item.classList.remove('menu-open');
            });
        }

        function closeTagFilterDropdown() {
            document.getElementById('tagFilterDropdown')?.classList.remove('open');
        }

        function handleGlobalTagFilterClick(event) {
            if (!event.target.closest('#tagFilterDropdown')) {
                closeTagFilterDropdown();
            }
        }

        function closeImportTagDropdown() {
            document.getElementById('importTagFilterDropdown')?.classList.remove('open');
        }

        function handleGlobalImportTagClick(event) {
            if (!event.target.closest('#importTagFilterDropdown')) {
                closeImportTagDropdown();
            }
        }

        function closeEditTagDropdown() {
            document.getElementById('editTagFilterDropdown')?.classList.remove('open');
        }

        function handleGlobalEditTagClick(event) {
            if (!event.target.closest('#editTagFilterDropdown')) {
                closeEditTagDropdown();
            }
        }

        function toggleAccountActionMenu(toggleBtn) {
            const accountItem = toggleBtn?.closest('.account-item');
            if (!accountItem) return;

            const shouldOpen = !accountItem.classList.contains('menu-open');
            closeAccountActionMenus();
            if (shouldOpen) {
                accountItem.classList.add('menu-open');
            }
        }

        function bindPersistentButtonHandlers() {
            const accountList = document.getElementById('accountList');
            if (accountList && !accountList.dataset.boundActions) {
                accountList.dataset.boundActions = 'true';
                accountList.addEventListener('click', function (event) {
                    const menuToggle = event.target.closest('[data-account-menu-toggle]');
                    if (menuToggle) {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleAccountActionMenu(menuToggle);
                        return;
                    }

                    const actionBtn = event.target.closest('[data-account-action]');
                    if (!actionBtn) return;

                    event.preventDefault();
                    event.stopPropagation();
                    closeAccountActionMenus();

                    const action = actionBtn.dataset.accountAction;
                    const accountId = parseInt(actionBtn.dataset.accountId || '0', 10);
                    const accountEmail = actionBtn.dataset.accountEmail || '';
                    const accountStatus = actionBtn.dataset.accountStatus || 'active';

                    if (action === 'copy') {
                        copyEmail(accountEmail);
                    } else if (action === 'share') {
                        showCreateEmailShareModal(accountId, accountEmail);
                    } else if (action === 'forwardingLogs') {
                        showAccountForwardingLogs(accountId, accountEmail);
                    } else if (action === 'toggleStatus') {
                        toggleAccountStatus(accountId, accountStatus);
                    } else if (action === 'outlookAutoAuth') {
                        queueAccountForOutlookAutoAuth(accountId, accountEmail);
                    } else if (action === 'edit') {
                        showEditAccountModal(accountId);
                    } else if (action === 'delete') {
                        deleteAccount(accountId, accountEmail);
                    }
                });
            }
        }

        // Initialize color picker
        function initColorPicker() {
            document.querySelectorAll('.color-option').forEach(option => {
                if (option.dataset.colorPickerBound === 'true') {
                    return;
                }

                option.dataset.colorPickerBound = 'true';
                option.addEventListener('click', function () {
                    document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
                    this.classList.add('selected');
                    selectedColor = this.dataset.color;
                    // Synchronously update the custom color input box
                    document.getElementById('customColorInput').value = selectedColor;
                    document.getElementById('customColorHex').value = selectedColor;
                });
            });
        }

        // Initialize mailing list scrolling monitoring
        function initEmailListScroll() {
            const emailList = document.getElementById('emailList');
            if (!emailList) return;

            emailList.addEventListener('scroll', maybeLoadMoreEmails, { passive: true });
        }

        // Load more emails
        function buildLoadMoreEmailsUrl(nextSkip) {
            const query = new URLSearchParams({
                method: currentMethod,
                folder: currentFolder,
                skip: String(nextSkip),
                top: '20'
            });
            const cache = getEmailListCacheEntry(currentAccount, currentFolder);
            if (currentMethod === 'local' || cache?.local_retention === true) {
                query.set('source', 'local');
            }
            return `/api/emails/${encodeURIComponent(currentAccount)}?${query.toString()}`;
        }

        async function loadMoreEmails() {
            if (isLoadingMore || !hasMoreEmails) return;
            if (currentMethod === 'cloudflare-admin') {
                if (typeof loadMoreCloudflareGlobalMessages === 'function') {
                    return loadMoreCloudflareGlobalMessages();
                }
                return;
            }

            if (typeof hasPendingNewMailSync === 'function'
                && typeof applyPendingNewMailSync === 'function'
                && hasPendingNewMailSync(currentAccount, currentFolder)) {
                applyPendingNewMailSync();
            }

            isLoadingMore = true;
            const nextSkip = Math.max(Number(currentSkip) || 0, Array.isArray(currentEmails) ? currentEmails.length : 0);
            currentSkip = nextSkip;

            // Show loading status at bottom of list
            const emailList = document.getElementById('emailList');
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'loading loading-small';
            loadingDiv.id = 'loadingMore';
            loadingDiv.innerHTML = '<div class="loading-spinner"></div>';
            emailList.appendChild(loadingDiv);

            // Disable button
            const refreshBtn = document.querySelector('.refresh-btn');
            const folderTabs = document.querySelectorAll('.folder-tab');
            if (refreshBtn) {
                refreshBtn.disabled = true;
            }
            folderTabs.forEach(tab => tab.disabled = true);

            try {
                const response = await fetchWithTimeout(
                    buildLoadMoreEmailsUrl(nextSkip),
                    {
                        timeoutMs: EMAIL_LIST_REQUEST_TIMEOUT_MS,
                        timeoutMessage: I18n.t("Timeout loading more emails, please try again later.")
                    }
                );
                const data = await response.json();

                if (data.success && data.emails.length > 0) {
                    // Append new email to list
                    currentEmails = currentEmails.concat(data.emails);
                    hasMoreEmails = data.has_more;
                    currentSkip = currentEmails.length;

                    // Remove loading state
                    const loadingEl = document.getElementById('loadingMore');
                    if (loadingEl) loadingEl.remove();

                    // Re-render mailing list
                    renderEmailList(currentEmails);

                    // Update the number of emails
                    document.getElementById('emailCount').textContent = `(${currentEmails.length})`;

                    // Update cache
                    if (currentAccount && !isTempEmailGroup) {
                        const cacheKey = `${currentAccount}_${currentFolder}`;
                        if (emailListCache[cacheKey]) {
                            emailListCache[cacheKey].emails = currentEmails;
                            emailListCache[cacheKey].has_more = hasMoreEmails;
                            emailListCache[cacheKey].skip = currentSkip;
                            emailListCache[cacheKey].derived_from = null;
                            emailListCache[cacheKey].method = currentMethod;
                            if (data.method) {
                                emailListCache[cacheKey].method_label = data.method;
                            }
                            if (data.local_retention === true) {
                                emailListCache[cacheKey].local_retention = true;
                                emailListCache[cacheKey].local_retention_count = Number(data.count) || currentEmails.length;
                            }
                            if (currentFolder === 'all' && data.folder_summaries) {
                                emailListCache[cacheKey].folder_summaries = mergeFolderSummaries(
                                    emailListCache[cacheKey].folder_summaries,
                                    data.folder_summaries,
                                    { appendFetchedCount: true }
                                );
                            }
                        } else {
                            emailListCache[cacheKey] = {
                                emails: currentEmails,
                                has_more: hasMoreEmails,
                                skip: currentSkip,
                                method: currentMethod,
                                method_label: data.method || currentMethod,
                                derived_from: null,
                                local_retention: data.local_retention === true,
                                local_retention_count: Number(data.count) || currentEmails.length,
                                folder_summaries: currentFolder === 'all'
                                    ? normalizeFolderSummaries(data.folder_summaries)
                                    : undefined
                            };
                        }
                    }

                    scheduleEmailListLoadCheck(80);
                } else {
                    hasMoreEmails = false;
                    currentSkip = Array.isArray(currentEmails) ? currentEmails.length : nextSkip;
                    // Show "No more messages"
                    const loadingEl = document.getElementById('loadingMore');
                    if (loadingEl) {
                        loadingEl.innerHTML = I18n.t("<div style=\"text-align:center;padding:20px;color:#999;font-size:13px;\">No more messages</div>");
                    }
                }
            } catch (error) {
                const loadingEl = document.getElementById('loadingMore');
                if (loadingEl) loadingEl.remove();
                showToast(isTimeoutAbortError(error) ? I18n.t("Timeout loading more emails") : I18n.t("Loading failed"), 'error');
            } finally {
                isLoadingMore = false;
                // Enable button
                if (refreshBtn) {
                    refreshBtn.disabled = false;
                }
                folderTabs.forEach(tab => tab.disabled = false);
            }
        }

        // Switch folder (automatically trigger query)
        function switchFolder(folder) {
            if (currentFolder === folder) return;

            currentFolder = folder;
            currentEmailId = null;
            currentEmailDetail = null;

            // Update button status
            document.querySelectorAll('.folder-tab').forEach(tab => {
                tab.classList.toggle('active', tab.dataset.folder === folder);
            });

            const cache = getEmailListCacheEntry(currentAccount, folder);

            // Check if there is cache
            if (cache) {
                applyEmailListCache(cache, { scheduleLoadCheck: false });
            } else {
                // Clear the mailing list and display prompts
                document.getElementById('emailList').innerHTML = I18n.tpl`
                    <div class="empty-state">
                        <div class="empty-state-icon">📬</div>
                        <div class="empty-state-text">Automatically refreshing ${getFolderDisplayName(folder)}...</div>
                    </div>
                `;
                document.getElementById('emailCount').textContent = '';
                document.getElementById('methodTag').style.display = 'none';

                // Reset paging status
                currentEmails = [];
                currentSkip = 0;
                hasMoreEmails = true;
            }

            document.getElementById('emailDetail').innerHTML = I18n.tpl`
                <div class="empty-state">
                    <div class="empty-state-icon">📄</div>
                    <div class="empty-state-text">Select an email to view details</div>
                </div>
            `;
            document.getElementById('emailDetailToolbar').style.display = 'none';

            // Automatically refresh the corresponding list after switching folders
            if (currentAccount && !isTempEmailGroup && !cache) {
                loadEmails(currentAccount);
            }
        }

        // Select a custom color (color picker)
        function selectCustomColor(color) {
            selectedColor = color;
            document.getElementById('customColorHex').value = color;
            // Uncheck the preset color
            document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
        }

        // Select custom color (hex input)
        function selectCustomColorHex(value) {
            // Validate hex color format
            const hexPattern = /^#[0-9A-Fa-f]{6}$/;
            if (hexPattern.test(value)) {
                selectedColor = value;
                document.getElementById('customColorInput').value = value;
                // Uncheck the preset color
                document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
            } else {
                showToast(I18n.t("Please enter a valid hex color (e.g. #FF5500)"), 'error');
            }
        }

        // Display message prompt
        function showToast(message, type = 'info', errorDetail = null) {
            const toast = document.getElementById('toast');
            toast.innerHTML = '';

            // Message span
            const messageSpan = document.createElement('span');
            messageSpan.textContent = message;
            toast.appendChild(messageSpan);

            if (errorDetail && type === 'error') {
                const detailLink = document.createElement('a');
                detailLink.href = 'javascript:void(0)';
                detailLink.textContent = I18n.t(" [Details]");
                detailLink.style.color = '#ffdddd';
                detailLink.style.textDecoration = 'underline';
                detailLink.style.marginLeft = '8px';
                detailLink.onclick = function (e) {
                    e.stopPropagation();
                    showErrorDetailModal(errorDetail);
                };
                toast.appendChild(detailLink);

                // Ensure the toast remains visible long enough for the user to click the link
                clearTimeout(toast.timer);
                toast.timer = setTimeout(() => {
                    toast.className = 'toast';
                }, 8000); // 8 seconds for errors with details
            } else {
                clearTimeout(toast.timer);
                toast.timer = setTimeout(() => {
                    toast.className = 'toast';
                }, 3000); // 3 seconds for regular messages
            }
            toast.className = 'toast show ' + type;
        }

        function updateModalBodyState() {
            const hasVisibleModal = !!document.querySelector('.modal.show, .fullscreen-email-modal.show');
            document.body.style.overflow = hasVisibleModal ? 'hidden' : '';
        }

        function setModalVisible(modalId, visible) {
            const modal = document.getElementById(modalId);
            if (!modal) return null;
            modal.classList.toggle('show', visible);
            modal.style.display = visible ? 'flex' : 'none';
            modal.setAttribute('aria-hidden', visible ? 'false' : 'true');
            updateModalBodyState();
            return modal;
        }

        function hideModal(modalId) {
            return setModalVisible(modalId, false);
        }

        // Universal confirmation modal box - replaces native confirm()
        let _genericConfirmResolve = null;

        function showConfirmModal(message, { title = I18n.t("Confirm operation"), confirmText = I18n.t("Confirm"), danger = true } = {}) {
            return new Promise((resolve) => {
                _genericConfirmResolve = resolve;
                document.getElementById('genericConfirmTitle').textContent = title;
                document.getElementById('genericConfirmMsg').textContent = message;
                const btn = document.getElementById('genericConfirmBtn');
                btn.textContent = confirmText;
                btn.className = danger ? 'btn btn-danger' : 'btn btn-primary';
                closeNavbarActionsMenu();
                closeMobilePanels();
                setModalVisible('genericConfirmModal', true);
            });
        }

        function resolveGenericConfirm() {
            hideModal('genericConfirmModal');
            if (_genericConfirmResolve) {
                _genericConfirmResolve(true);
                _genericConfirmResolve = null;
            }
        }

        function hideGenericConfirmModal() {
            hideModal('genericConfirmModal');
            if (_genericConfirmResolve) {
                _genericConfirmResolve(false);
                _genericConfirmResolve = null;
            }
        }
        function showModal(modalId) {
            closeNavbarActionsMenu();
            closeMobilePanels();
            closeAllModals();
            return setModalVisible(modalId, true);
        }

        // Display refresh error message
        function showRefreshError(accountId, errorMessage, accountEmail, accountType = 'outlook') {
            showModal('refreshErrorModal');
            document.getElementById('refreshErrorEmail').textContent = I18n.tpl`Account: ${accountEmail || I18n.t("Unknown")}`;
            document.getElementById('refreshErrorMessage').textContent = errorMessage;
            const reauthorizeBtn = document.getElementById('reauthorizeAccountFromErrorBtn');
            const canReauthorize = !!accountId && String(accountType || 'outlook').toLowerCase() !== 'imap';
            if (reauthorizeBtn) {
                reauthorizeBtn.style.display = canReauthorize ? '' : 'none';
                reauthorizeBtn.onclick = function () {
                    hideRefreshErrorModal();
                    showReauthorizeAccountModal({ id: accountId, email: accountEmail || '' });
                };
            }
            document.getElementById('editAccountFromErrorBtn').onclick = function () {
                hideRefreshErrorModal();
                showEditAccountModal(accountId);
            };
        }

        async function triggerForwardingCheck() {
            const triggerBtn = document.getElementById('triggerForwardingCheckBtn');
            if (!triggerBtn || triggerBtn.disabled) return;

            const originalText = triggerBtn.textContent;
            triggerBtn.disabled = true;
            triggerBtn.textContent = I18n.t("Triggering...");

            try {
                if (!csrfToken) {
                    await initCSRFToken();
                }

                const response = await fetch('/api/accounts/trigger-forwarding-check', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                const data = await response.json();

                if (data.success) {
                    showToast(data.message || I18n.t("A forwarding check has been triggered"), 'success');
                    loadForwardingLogs();
                    loadFailedForwardingLogs();
                } else {
                    showToast(data.error || data.message || I18n.t("Trigger forwarding check failed"), 'error');
                }
            } catch (error) {
                showToast(I18n.t("Trigger forwarding check failed"), 'error');
            } finally {
                triggerBtn.disabled = false;
                triggerBtn.textContent = originalText;
            }
        }

        async function showAccountForwardingLogs(accountId, accountEmail) {
            currentForwardingLogAccountId = accountId;
            currentForwardingLogAccountEmail = accountEmail || '';
            const title = document.getElementById('accountForwardingLogsTitle');
            title.textContent = I18n.tpl`${accountEmail || I18n.t("This account")}’s forwarding log`;
            showModal('accountForwardingLogsModal');
            await loadAccountForwardingLogs();
        }

        async function loadAccountForwardingLogs() {
            const listEl = document.getElementById('accountForwardingLogsList');
            const failedOnly = !!document.getElementById('accountForwardingLogsFailedOnly')?.checked;
            const cursorValueEl = document.getElementById('accountForwardingCursorValue');
            const cursorHintEl = document.getElementById('accountForwardingCursorHint');
            if (!currentForwardingLogAccountId) {
                listEl.innerHTML = I18n.t("<div style=\"padding: 20px; text-align: center; color: #666;\">No account selected</div>");
                if (cursorValueEl) {
                    cursorValueEl.textContent = '-';
                }
                return;
            }

            listEl.innerHTML = I18n.t("<div style=\"padding: 20px; text-align: center; color: #666;\">Loading…</div>");

            try {
                const suffix = failedOnly ? '&failed_only=1' : '';
                const response = await fetch(`/api/accounts/${currentForwardingLogAccountId}/forwarding-logs?limit=100${suffix}`);
                const data = await response.json();
                if (!data.success || !Array.isArray(data.logs)) {
                    throw new Error(I18n.t("Loading failed"));
                }
                let account = data.account || {};
                if (!Object.keys(account).length) {
                    try {
                        const accountResp = await fetch(`/api/accounts/${currentForwardingLogAccountId}`);
                        const accountData = await accountResp.json();
                        if (accountData.success && accountData.account) {
                            account = accountData.account;
                        }
                    } catch (fallbackError) {
                        console.warn(I18n.t("Failed to load account forwarding meta information:"), fallbackError);
                    }
                }
                if (cursorValueEl) {
                    cursorValueEl.textContent = account.forward_last_checked_at
                        ? formatDateTime(account.forward_last_checked_at)
                        : I18n.t("Not set");
                }
                if (cursorHintEl) {
                    cursorHintEl.textContent = account.forward_enabled
                        ? I18n.t("After rolling back the cursor, the most recent emails will be rescanned according to the current forwarding time range; emails that have been successfully forwarded will still be deduplicated.")
                        : I18n.t("This account currently does not have forwarding enabled. You still need to enable account forwarding first after rolling back the cursor.");
                }
                if (data.logs.length === 0) {
                    listEl.innerHTML = `<div style="padding: 20px; text-align: center; color: #666;">${failedOnly ? I18n.t("There is no failed forwarding log for this account.") : I18n.t("This account has no forwarding logs yet")}</div>`;
                    return;
                }

                let html = '';
                data.logs.forEach(log => {
                    const statusColor = log.status === 'success' ? '#28a745' : '#dc3545';
                    const statusText = log.status === 'success' ? I18n.t("Success") : I18n.t("Failure");
                    html += I18n.tpl`
                        <div style="padding: 12px; border-bottom: 1px solid #e5e5e5;">
                            <div style="display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
                                <div style="font-weight: 600;">${escapeHtml(log.account_email || currentForwardingLogAccountEmail || '-')}</div>
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
            } catch (error) {
                if (cursorValueEl) {
                    cursorValueEl.textContent = I18n.t("Loading failed");
                }
                listEl.innerHTML = I18n.t("<div style=\"padding: 20px; text-align: center; color: #dc3545;\">Failed to load account forwarding log</div>");
            }
        }

        async function resetAccountForwardCursor() {
            if (!currentForwardingLogAccountId) return;

            const btn = document.getElementById('resetAccountForwardingCursorBtn');
            const originalText = btn?.textContent || I18n.t("Roll back the cursor and scan again");

            if (!(await showConfirmModal(I18n.tpl`Are you sure you want to roll back the forwarding cursor of ${currentForwardingLogAccountEmail || I18n.t("This account")} and rescan recent emails immediately? 

 Emails that have been successfully forwarded will still be skipped due to deduplication records.`, { title: I18n.t("Rollback forwarding cursor"), confirmText: I18n.t("Confirm rollback") }))) {
                return;
            }

            if (btn) {
                btn.disabled = true;
                btn.textContent = I18n.t("Processing...");
            }

            try {
                if (!csrfToken) {
                    await initCSRFToken();
                }

                const response = await fetch(`/api/accounts/${currentForwardingLogAccountId}/forwarding/reset-cursor`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        mode: 'window',
                        trigger_check: true
                    })
                });
                const data = await response.json();
                if (!data.success) {
                    throw new Error(data.error || I18n.t("Failed to reset forwarding cursor"));
                }

                showToast(data.message || I18n.t("Forward cursor rolled back and check triggered"), 'success');
                await loadAccountForwardingLogs();
                loadForwardingLogs();
                loadFailedForwardingLogs();
            } catch (error) {
                showToast(error.message || I18n.t("Failed to reset forwarding cursor"), 'error');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = originalText;
                }
            }
        }

        function toggleAccountForwardingLogFilter() {
            if (!currentForwardingLogAccountId) return;
            loadAccountForwardingLogs();
        }

        function hideAccountForwardingLogs() {
            hideModal('accountForwardingLogsModal');
        }

        // Hide refresh error modal box
        function hideRefreshErrorModal() {
            hideModal('refreshErrorModal');
        }

        // ==================== Unified error handling related ====================

        function escapeHtml(value) {
            return String(value || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function renderEmptyStateMarkup(icon, text, options = {}) {
            const {
                allowHtml = false,
                actionLabel = I18n.t("Refresh"),
                actionTitle = I18n.t("Refresh list"),
                onAction = ''
            } = options;

            const content = allowHtml ? String(text || '') : escapeHtml(text || '');
            const hasAction = typeof onAction === 'string' && onAction.trim() !== '';

            return `
                <div class="empty-state">
                    <div class="empty-state-icon">${icon}</div>
                    <div class="empty-state-text">${content}</div>
                    ${hasAction ? `
                        <button
                            class="empty-state-refresh-btn"
                            type="button"
                            onclick="${onAction}"
                            title="${escapeHtml(actionTitle)}"
                            aria-label="${escapeHtml(actionTitle)}"
                        >
                            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                                <path d="M13.5 3.5v3h-3"></path>
                                <path d="M2.5 12.5v-3h3"></path>
                                <path d="M4 6.25A4.75 4.75 0 0 1 12.05 4"></path>
                                <path d="M12 9.75A4.75 4.75 0 0 1 3.95 12"></path>
                            </svg>
                            <span>${escapeHtml(actionLabel)}</span>
                        </button>
                    ` : ''}
                </div>
            `;
        }

        function parseJsonLike(value) {
            if (typeof value !== 'string') return value;
            const text = value.trim();
            if (!text || (!text.startsWith('{') && !text.startsWith('['))) return value;
            try {
                return JSON.parse(text);
            } catch (err) {
                return value;
            }
        }

        function formatFetchErrorDetails(value) {
            const normalized = parseJsonLike(value);
            if (normalized === undefined || normalized === null || normalized === '') return '';
            if (typeof normalized === 'string') return normalized;
            try {
                return JSON.stringify(normalized, null, 2);
            } catch (err) {
                return String(normalized);
            }
        }

        function normalizeMethodError(err) {
            if (err && typeof err === 'object' && err.error && typeof err.error === 'object') {
                return err.error;
            }
            return err;
        }

        function resolveFetchErrorMethodName(method, methodNames) {
            if (methodNames[method]) return methodNames[method];
            if (typeof method === 'string' && method.includes('.')) {
                return method
                    .split('.')
                    .map((part) => methodNames[part] || part)
                    .join(' / ');
            }
            return method;
        }

        function expandFolderProtocolFetchErrors(details) {
            if (!details || typeof details !== 'object' || Array.isArray(details)) {
                return details;
            }
            if (details.message && details.code) {
                return details;
            }

            const protocolKeys = ['graph', 'imap_new', 'imap_old', 'imap_generic', 'browser'];
            const hasTopLevelProtocol = protocolKeys.some((key) => details[key] !== undefined);
            if (hasTopLevelProtocol) {
                return details;
            }

            const expanded = {};
            Object.keys(details).forEach((key) => {
                const err = normalizeMethodError(details[key]);
                const nested = err && typeof err === 'object'
                    ? parseJsonLike(err.details)
                    : null;
                const nestedProtocols = (nested && typeof nested === 'object' && !Array.isArray(nested))
                    ? protocolKeys.filter((protocolKey) => nested[protocolKey] !== undefined)
                    : [];

                if (nestedProtocols.length > 0) {
                    nestedProtocols.forEach((protocolKey) => {
                        expanded[`${key}.${protocolKey}`] = nested[protocolKey];
                    });
                    if (err && typeof err === 'object') {
                        const summary = { ...err };
                        delete summary.details;
                        expanded[key] = summary;
                    } else {
                        expanded[key] = err;
                    }
                    return;
                }

                expanded[key] = details[key];
            });
            return expanded;
        }

        // Display unified error details modal box
        function showErrorDetailModal(error) {
            showModal('errorDetailModal');
            document.getElementById('errorModalUserMessage').textContent = error.message || I18n.t("An unknown error occurred");
            document.getElementById('errorModalCode').textContent = error.code || '-';
            document.getElementById('errorModalType').textContent = error.type || '-';
            document.getElementById('errorModalStatus').textContent = error.status || '-';
            document.getElementById('errorModalTraceId').textContent = error.trace_id || '-';

            const detailsEl = document.getElementById('errorModalDetails');
            const detailsContainer = document.getElementById('errorModalDetailsContainer');
            const toggleBtn = document.getElementById('toggleTraceBtn');

            detailsEl.textContent = formatFetchErrorDetails(error && error.details) || I18n.t("No detailed technology stack information yet");

            // Reset stack display status
            detailsContainer.style.display = 'none';
            toggleBtn.textContent = I18n.t("Show stack/details");
        }

        // Hide unified error details modal box
        function hideErrorDetailModal() {
            hideModal('errorDetailModal');
        }

        // Email retrieval failure details popup box
        function showEmailFetchErrorModal(details) {
            if (!details) return;

            const methodNames = {
                'graph': 'Graph API',
                'imap_new': I18n.t("IMAP (new server)"),
                'imap_old': I18n.t("IMAP (old server)"),
                'imap_generic': I18n.t("Standard IMAP"),
                'browser': I18n.t("Browser to server"),
                'inbox': I18n.t("Inbox"),
                'junkemail': I18n.t("Junk mail"),
                'deleteditems': I18n.t("Deleted mail"),
                'all': I18n.t("All emails")
            };

            function translateError(err) {
                if (!err) return I18n.t("Unknown error");
                // err can be a string or an object
                if (typeof err === 'string') return err;

                const code = err.code || '';
                const reasonCode = err.reason_code || code;
                const details = formatFetchErrorDetails(err.details);
                const msg = err.message || '';

                // Common mistakes in translation
                if (reasonCode === 'MAIL_PROXY_FAILED') {
                    return msg || I18n.t("Proxy connection failed: Please check the proxy address, port, authentication information and fallback proxy settings");
                }
                if (reasonCode === 'MAIL_NETWORK_TIMEOUT' || code === 'EMAIL_FETCH_TIMEOUT') {
                    return msg || I18n.t("Network connection timed out: Please check network, proxy and mail service addresses");
                }
                if (reasonCode === 'MAIL_NETWORK_FAILED') {
                    return msg || I18n.t("Network connection failed: please check DNS, firewall, proxy and mail service addresses");
                }
                if (reasonCode === 'MAIL_TLS_FAILED') {
                    return msg || I18n.t("TLS/SSL connection failed: please check the mail service address, port and system certificate");
                }
                if (code === 'GRAPH_TOKEN_EXCEPTION' && details.includes('ProxyError')) {
                    return I18n.t("Proxy connection failed: Unable to connect to the proxy server, please check whether the proxy address is correct and whether the proxy is running");
                }
                if (code === 'GRAPH_TOKEN_FAILED' || code === 'IMAP_TOKEN_FAILED') {
                    if (details.includes('invalid_grant')) {
                        return I18n.t("Token has expired or permissions are insufficient: please re-authorize login or replace refresh_token");
                    }
                    if (details.includes('invalid_client')) {
                        return I18n.t("Client ID is invalid: please check whether the client_id configuration is correct");
                    }
                    return I18n.tpl`Token acquisition failed: ${msg}`;
                }
                if (code === 'EMAIL_FETCH_FAILED') {
                    return I18n.tpl`Failed to obtain email: ${msg}`;
                }
                if (code === 'IMAP_CONNECTION_FAILED') {
                    return I18n.t("IMAP connection failed: Unable to connect to mail server");
                }
                if (code === 'IMAP_FOLDER_NOT_FOUND') {
                    return I18n.tpl`IMAP folder does not exist or does not have access rights: ${msg || I18n.t("Please check the actual folder name of the mailbox server")}`;
                }
                if (code === 'IMAP_AUTH_FAILED') {
                    return I18n.tpl`IMAP authentication failed: ${msg || I18n.t("Please check your email password or authorization code")}`;
                }
                if (code === 'IMAP_UNSAFE_LOGIN_BLOCKED') {
                    return msg || I18n.t("The email service provider has blocked the current IMAP login (Unsafe Login). Please check the IMAP switch, authorization code and current network environment.");
                }
                if (code === 'IMAP_CONNECT_FAILED') {
                    return I18n.tpl`IMAP connection failed: ${msg || I18n.t("Please check IMAP host, port and network connectivity")}`;
                }
                return msg || details || I18n.t("Unknown error");
            }

            const expandedDetails = expandFolderProtocolFetchErrors(details);
            const detailEntries = (typeof expandedDetails === 'object' && !Array.isArray(expandedDetails) && !(expandedDetails.message && expandedDetails.code))
                ? expandedDetails
                : { error: expandedDetails };
            const preferredOrder = ['browser', 'graph', 'imap_new', 'imap_old', 'imap_generic', 'inbox', 'junkemail', 'deleteditems', 'all', 'error'];
            const methods = [
                ...preferredOrder.filter(method => detailEntries[method] !== undefined),
                ...Object.keys(detailEntries)
                    .filter(method => !preferredOrder.includes(method))
                    .sort((left, right) => String(left).localeCompare(String(right)))
            ];

            const summaryEl = document.getElementById('emailFetchErrorSummary');
            if (summaryEl) {
                summaryEl.textContent = methods.length > 1
                    ? I18n.t("All acquisition methods failed. The following is the detailed error information of each method:")
                    : I18n.t("Failed to obtain email, the following is the detailed error message:");
            }

            let html = '';
            methods.forEach(method => {
                const err = normalizeMethodError(detailEntries[method]);
                if (err !== undefined) {
                    const name = resolveFetchErrorMethodName(method, methodNames);
                    const reason = translateError(err);
                    const codeText = (err && typeof err === 'object') ? (err.code || '-') : '-';
                    const typeText = (err && typeof err === 'object') ? (err.type || '-') : '-';
                    const statusText = (err && typeof err === 'object') ? (err.status || '-') : '-';
                    const traceIdText = (err && typeof err === 'object') ? (err.trace_id || '-') : '-';
                    const detailText = (err && typeof err === 'object')
                        ? formatFetchErrorDetails(err.details)
                        : formatFetchErrorDetails(detailEntries[method]);
                    html += I18n.tpl`
                        <div style="background: #fff5f5; border: 1px solid #fde2e2; border-radius: 8px; padding: 14px 16px; margin-bottom: 12px;">
                            <div style="font-weight: 600; color: #dc3545; margin-bottom: 6px; font-size: 14px;">${escapeHtml(name)}</div>
                            <div style="color: #333; font-size: 13px; line-height: 1.6;">${escapeHtml(reason)}</div>
                            <div style="color: #999; font-size: 12px; margin-top: 6px; line-height: 1.6;">
                                Error code: ${escapeHtml(String(codeText))}<br>
                                Type: ${escapeHtml(String(typeText))}<br>
                                Status code: ${escapeHtml(String(statusText))}<br>
                                Trace ID: ${escapeHtml(String(traceIdText))}
                            </div>
                            ${detailText ? `<pre style="margin-top:10px; padding:10px 12px; background:#fff; border:1px solid #f3caca; border-radius:6px; color:#444; font-size:12px; line-height:1.5; white-space:pre-wrap; word-break:break-word; max-height:240px; overflow:auto;">${escapeHtml(detailText)}</pre>` : ''}
                        </div>
                    `;
                }
            });

            if (!html) {
                html = I18n.t("<div style=\"color:#666;\">No detailed error message</div>");
            }

            document.getElementById('emailFetchErrorContent').innerHTML = html;
            showModal('emailFetchErrorModal');
        }

        function hideEmailFetchErrorModal() {
            hideModal('emailFetchErrorModal');
        }

        // Toggle display/hide of stack information
        function toggleStackTrace() {
            const container = document.getElementById('errorModalDetailsContainer');
            const btn = document.getElementById('toggleTraceBtn');

            if (container.style.display === 'none') {
                container.style.display = 'block';
                btn.textContent = I18n.t("Hide stack/details");
            } else {
                container.style.display = 'none';
                btn.textContent = I18n.t("Show stack/details");
            }
        }

        // Copy error details to clipboard
        function copyErrorDetails() {
            const userMessage = document.getElementById('errorModalUserMessage').textContent;
            const details = document.getElementById('errorModalDetails').textContent;
            const code = document.getElementById('errorModalCode').textContent;
            const type = document.getElementById('errorModalType').textContent;
            const status = document.getElementById('errorModalStatus').textContent;
            const traceId = document.getElementById('errorModalTraceId').textContent;

            const fullErrorText = I18n.tpl`
[User error message] 
${userMessage}

 [Error details] 
Code: ${code}
Type: ${type}
Status: ${status}
Trace ID: ${traceId}

 [Technology Stack/Details] 
${details}
            `.trim();

            navigator.clipboard.writeText(fullErrorText).then(() => {
                showToast(I18n.t("Error details copied"), 'success');
            }).catch(() => {
                // Downgrade plan
                const textarea = document.createElement('textarea');
                textarea.value = fullErrorText;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                showToast(I18n.t("Error details copied"), 'success');
            });
        }

        // Unified handling of API response errors
        function handleApiError(data, defaultMessage = I18n.t("Request failed")) {
            if (!data.success) {
                // Check whether it is a unified error format
                if (data.error && data.error.message) {
                    const error = data.error;
                    // Use the message provided by the backend as user-friendly information
                    const userMessage = error.message;

                    // Call showToast to carry the complete error object
                    showToast(userMessage, 'error', error);
                } else {
                    // Compatibility with old or non-standard error formats
                    const errorMessage = data.error || defaultMessage;
                    showToast(errorMessage, 'error');
                }
                return true;
            }
            return false;
        }

        function escapeJs(str) {
            if (!str) return '';
            return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
        }

        function updateCurrentGroupHeader(group = null, titleOverride = '') {
            const nameEl = document.getElementById('currentGroupName');
            const idBadgeEl = document.getElementById('currentGroupIdBadge');
            const refreshBtn = document.getElementById('refreshAccountListBtn');
            if (!nameEl || !idBadgeEl) {
                return;
            }

            if (refreshBtn) {
                refreshBtn.style.display = (group || titleOverride) ? 'inline-flex' : 'none';
            }

            if (titleOverride) {
                nameEl.textContent = titleOverride;
                idBadgeEl.textContent = '';
                idBadgeEl.style.display = 'none';
                return;
            }

            if (!group) {
                nameEl.textContent = I18n.t("Select group");
                idBadgeEl.textContent = '';
                idBadgeEl.style.display = 'none';
                return;
            }

            nameEl.textContent = '';
            idBadgeEl.textContent = '';
            idBadgeEl.style.display = 'none';
        }

        // ------------------ Collapse group bar & minimalist mode ------------------
        function initGroupPanelCollapseState() {
            const isCollapsed = localStorage.getItem('outlook_group_panel_collapsed') === 'true';
            document.body.classList.toggle('group-panel-collapsed', isCollapsed);

            const collapseBtn = document.getElementById('collapseGroupPanelBtn');
            const expandBtn = document.getElementById('expandGroupPanelBtn');
            if (collapseBtn) collapseBtn.setAttribute('aria-expanded', !isCollapsed);
            if (expandBtn) expandBtn.setAttribute('aria-expanded', isCollapsed);
        }

        function toggleGroupPanelCollapse() {
            const isCollapsed = !document.body.classList.contains('group-panel-collapsed');
            document.body.classList.toggle('group-panel-collapsed', isCollapsed);
            localStorage.setItem('outlook_group_panel_collapsed', String(isCollapsed));

            const collapseBtn = document.getElementById('collapseGroupPanelBtn');
            const expandBtn = document.getElementById('expandGroupPanelBtn');
            if (collapseBtn) collapseBtn.setAttribute('aria-expanded', !isCollapsed);
            if (expandBtn) expandBtn.setAttribute('aria-expanded', isCollapsed);

            if (typeof syncResponsiveUI === 'function') {
                syncResponsiveUI();
            }
        }

        function initAccountMinimalModeState() {
            const isMinimal = localStorage.getItem('outlook_account_list_minimal') === 'true';
            const panel = document.getElementById('accountPanel');
            const btn = document.getElementById('accountMinimalBtn');
            if (panel) {
                panel.classList.toggle('minimal-mode', isMinimal);
            }
            if (btn) {
                btn.classList.toggle('active', isMinimal);
                btn.setAttribute('aria-pressed', isMinimal ? 'true' : 'false');
                btn.title = isMinimal ? I18n.t("Switch to detailed display") : I18n.t("Toggle compact view");
            }
        }

        function toggleAccountMinimalMode() {
            const panel = document.getElementById('accountPanel');
            const btn = document.getElementById('accountMinimalBtn');
            if (!panel) return;

            const isMinimal = !panel.classList.contains('minimal-mode');
            panel.classList.toggle('minimal-mode', isMinimal);
            localStorage.setItem('outlook_account_list_minimal', String(isMinimal));

            if (btn) {
                btn.classList.toggle('active', isMinimal);
                btn.setAttribute('aria-pressed', isMinimal ? 'true' : 'false');
                btn.title = isMinimal ? I18n.t("Switch to detailed display") : I18n.t("Toggle compact view");
            }
        }

        // ==================== The theme is related to list refresh ====================
        function initTheme() {
            const savedTheme = localStorage.getItem('theme');
            const currentTheme = savedTheme || 'light';
            document.documentElement.setAttribute('data-theme', currentTheme);
            updateThemeToggleIcons(currentTheme);
        }

        function toggleTheme() {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const newTheme = isDark ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            updateThemeToggleIcons(newTheme);
        }

        function updateThemeToggleIcons(theme) {
            const sunIcon = document.querySelector('#desktopThemeToggleBtn .sun-icon');
            const moonIcon = document.querySelector('#desktopThemeToggleBtn .moon-icon');
            if (sunIcon && moonIcon) {
                if (theme === 'dark') {
                    sunIcon.style.display = 'block';
                    moonIcon.style.display = 'none';
                } else {
                    sunIcon.style.display = 'none';
                    moonIcon.style.display = 'block';
                }
            }
        }

        async function refreshCurrentAccountList() {
            const refreshBtn = document.getElementById('refreshAccountListBtn');
            if (refreshBtn) {
                refreshBtn.classList.add('spinning');
                refreshBtn.disabled = true;
            }
            try {
                if (typeof refreshVisibleAccountList === 'function') {
                    await refreshVisibleAccountList(true);
                } else if (isTempEmailGroup && typeof loadTempEmails === 'function') {
                    await loadTempEmails(true);
                } else if (currentGroupId && typeof loadAccountsByGroup === 'function') {
                    await loadAccountsByGroup(currentGroupId, true);
                }
            } catch (e) {
                console.error(e);
            } finally {
                if (refreshBtn) {
                    refreshBtn.classList.remove('spinning');
                    refreshBtn.disabled = false;
                }
            }
        }

        window.toggleTheme = toggleTheme;
        window.refreshCurrentAccountList = refreshCurrentAccountList;
