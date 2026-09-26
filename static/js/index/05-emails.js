        /* global EMAIL_DETAIL_REQUEST_TIMEOUT_MS, EMAIL_LIST_REQUEST_TIMEOUT_MS, adjustIframeHeight, applyEmailListCache, closeMobilePanels, closeNavbarActionsMenu, copyCurrentEmail, currentAccount, currentAccountSummary, currentEmailDetail, currentEmailId, currentEmails, currentFolder, currentMethod, currentSkip, emailListCache, escapeHtml, fetchWithTimeout, formatDate, getEmailListCacheEntry, getFolderDisplayName, getNextEmailSkipFromCache, handleApiError, hasMoreEmails, hideModal, invalidateEmailListCache, isNormalMailLocalRetentionEnabled, isTempEmailGroup, isTimeoutAbortError, loadCloudflareGlobalMessages, mergeFolderSummaries, normalizeFolderSummaries, renderCloudflareGlobalFilterBar, renderEmptyStateMarkup, scheduleEmailListLoadCheck, showEmailFetchErrorModal, showMobileEmailDetail, showModal, showReauthorizeAccountModal, showToast, updateMobileContext, updateModalBodyState */

        // ==================== Email related ====================

        function isNormalMailboxListRequest() {
            return !isTempEmailGroup && currentMethod !== 'cloudflare-admin';
        }

        const backgroundMailboxSyncs = new Map();
        const pendingNewMailSyncs = new Map();
        const BACKGROUND_MAIL_ERROR_MODAL_COOLDOWN_MS = 5 * 60 * 1000;
        let lastBackgroundMailErrorModal = { key: '', shownAt: 0 };
        const normalDetailIframeResizeResources = { timers: [], observer: null };
        const fullscreenIframeResizeResources = { timers: [], observer: null };
        const NEW_EMAIL_HIGHLIGHT_CLEAR_DELAY_MS = 3500;
        const GRAPH_SEND_MAIL_REQUEST_TIMEOUT_MS = 45000;
        const GRAPH_SEND_MAIL_RECIPIENT_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        let graphSendMailAccountSnapshot = null;
        let isGraphSendMailSubmitting = false;

        function getGraphSendMailCandidate() {
            const account = currentAccountSummary;
            const accountId = Number(account?.id || 0);
            const accountEmail = String(account?.email || '').trim();
            const currentEmail = String(currentAccount || '').trim();
            if (
                isTempEmailGroup
                || !Number.isInteger(accountId)
                || accountId <= 0
                || !accountEmail
                || accountEmail.toLowerCase() !== currentEmail.toLowerCase()
                || String(account?.account_type || '').toLowerCase() !== 'outlook'
                || String(account?.provider || '').toLowerCase() !== 'outlook'
                || String(account?.authorization_type || '').toLowerCase() === 'imap'
                || String(account?.status || '').toLowerCase() !== 'active'
            ) {
                return null;
            }
            return { id: accountId, email: accountEmail };
        }

        function updateGraphSendMailAvailability() {
            const button = document.getElementById('composeGraphMailBtn');
            const available = !!getGraphSendMailCandidate();
            if (button) {
                button.hidden = !available;
                button.disabled = !available || isGraphSendMailSubmitting;
            }
            return available;
        }

        function parseGraphSendMailRecipients(value) {
            const rawRecipients = String(value || '').split(/[,;\n，；]+/)
                .map(recipient => recipient.trim())
                .filter(Boolean);
            if (!rawRecipients.length) {
                return { recipients: [], error: I18n.t("Please fill in at least one recipient") };
            }

            const recipients = [];
            const seenRecipients = new Set();
            for (const rawRecipient of rawRecipients) {
                if (!GRAPH_SEND_MAIL_RECIPIENT_PATTERN.test(rawRecipient)) {
                    return { recipients: [], error: I18n.t("Please fill in a valid recipient email address") };
                }
                const normalizedRecipient = rawRecipient.toLowerCase();
                if (!seenRecipients.has(normalizedRecipient)) {
                    seenRecipients.add(normalizedRecipient);
                    recipients.push(normalizedRecipient);
                }
            }
            return { recipients, error: '' };
        }

        function setGraphSendMailValidation(message = '') {
            const validation = document.getElementById('graphSendMailRecipientsError');
            const input = document.getElementById('graphSendMailRecipients');
            if (!validation || !input) {
                return;
            }
            validation.textContent = message;
            validation.hidden = !message;
            input.setAttribute('aria-invalid', message ? 'true' : 'false');
        }

        function validateGraphSendMailRecipients() {
            const input = document.getElementById('graphSendMailRecipients');
            const result = parseGraphSendMailRecipients(input?.value || '');
            setGraphSendMailValidation(result.error);
            return !result.error;
        }

        function clearGraphSendMailFeedback() {
            const status = document.getElementById('graphSendMailStatus');
            const reauthorizeButton = document.getElementById('graphSendMailReauthorizeBtn');
            if (status) {
                status.textContent = '';
                status.className = 'graph-send-mail-status';
                status.hidden = true;
            }
            if (reauthorizeButton) {
                reauthorizeButton.hidden = true;
            }
        }

        function showGraphSendMailFeedback(message, type = 'error', options = {}) {
            const status = document.getElementById('graphSendMailStatus');
            const reauthorizeButton = document.getElementById('graphSendMailReauthorizeBtn');
            if (status) {
                status.textContent = message;
                status.className = `graph-send-mail-status ${type}`;
                status.hidden = false;
            }
            if (reauthorizeButton) {
                reauthorizeButton.hidden = options.reauthorizationRequired !== true;
            }
        }

        function setGraphSendMailSubmitting(submitting) {
            isGraphSendMailSubmitting = submitting;
            const submitButton = document.getElementById('graphSendMailSubmitBtn');
            if (submitButton) {
                submitButton.disabled = submitting;
                submitButton.textContent = submitting ? I18n.t("Submitting...") : I18n.t("Submit to send");
            }
            updateGraphSendMailAvailability();
        }

        function resetGraphSendMailFormForAccount(account) {
            const accountIdInput = document.getElementById('graphSendMailAccountId');
            const accountEmailInput = document.getElementById('graphSendMailAccountEmail');
            const recipientsInput = document.getElementById('graphSendMailRecipients');
            const subjectInput = document.getElementById('graphSendMailSubject');
            const bodyInput = document.getElementById('graphSendMailBody');
            const previousAccountId = Number(accountIdInput?.value || 0);
            const accountChanged = previousAccountId !== account.id;
            if (accountIdInput) accountIdInput.value = String(account.id);
            if (accountEmailInput) accountEmailInput.value = account.email;
            if (accountChanged) {
                if (recipientsInput) recipientsInput.value = '';
                if (subjectInput) subjectInput.value = '';
                if (bodyInput) bodyInput.value = '';
                setGraphSendMailValidation('');
            }
        }

        function openGraphSendMailModal() {
            const account = getGraphSendMailCandidate();
            if (!account) {
                updateGraphSendMailAvailability();
                showToast(I18n.t("The current account does not support Graph basic sending"), 'error');
                return;
            }
            graphSendMailAccountSnapshot = account;
            resetGraphSendMailFormForAccount(account);
            clearGraphSendMailFeedback();
            showModal('graphSendMailModal');
            document.getElementById('graphSendMailRecipients')?.focus();
        }

        function hideGraphSendMailModal() {
            if (isGraphSendMailSubmitting) {
                showToast(I18n.t("The email is being submitted, please wait for the result to be returned"), 'info');
                return;
            }
            hideModal('graphSendMailModal');
        }

        function isGraphSendMailSnapshotCurrent() {
            const currentAccount = getGraphSendMailCandidate();
            return !!(
                graphSendMailAccountSnapshot
                && currentAccount
                && graphSendMailAccountSnapshot.id === currentAccount.id
                && graphSendMailAccountSnapshot.email.toLowerCase() === currentAccount.email.toLowerCase()
            );
        }

        function reauthorizeGraphSendMailAccount() {
            const account = graphSendMailAccountSnapshot || getGraphSendMailCandidate();
            if (!account) {
                showGraphSendMailFeedback(I18n.t("The current account has changed, please reselect the account before authorizing it."), 'error');
                return;
            }
            showReauthorizeAccountModal({ id: account.id, email: account.email });
        }

        function getGraphSendMailFailureFeedback(data, responseStatus) {
            const error = data?.error && typeof data.error === 'object' ? data.error : {};
            const code = String(error.code || '');
            if (code === 'GRAPH_SEND_REAUTH_REQUIRED') {
                return {
                    message: I18n.t("Insufficient permission to send messages or the authorization has expired. Please complete the Graph authorization again and try again."),
                    type: 'error',
                    reauthorizationRequired: true,
                };
            }
            if (code === 'GRAPH_SEND_THROTTLED' || responseStatus === 429) {
                const retryAfter = Number(data?.retry_after);
                const waitMessage = Number.isFinite(retryAfter) && retryAfter >= 0
                    ? I18n.tpl`Sending requests too frequently, please try again in ${retryAfter} seconds`
                    : I18n.t("Requests are sent too frequently, please try again later.");
                return { message: waitMessage, type: 'warning' };
            }
            if (code === 'GRAPH_SEND_RESULT_UNKNOWN') {
                return {
                    message: I18n.t("The result of email submission is uncertain, please confirm before deciding whether to resend."),
                    type: 'warning',
                };
            }
            return {
                message: String(error.message || I18n.t("Email submission failed, please check the recipient and account status and try again")),
                type: 'error',
            };
        }

        async function sendGraphMail() {
            if (isGraphSendMailSubmitting) {
                return;
            }
            if (!isGraphSendMailSnapshotCurrent()) {
                showGraphSendMailFeedback(I18n.t("The current account has changed, please reopen the email writing window before submitting."), 'error');
                return;
            }

            const recipientsInput = document.getElementById('graphSendMailRecipients');
            const subjectInput = document.getElementById('graphSendMailSubject');
            const bodyInput = document.getElementById('graphSendMailBody');
            const recipientResult = parseGraphSendMailRecipients(recipientsInput?.value || '');
            if (recipientResult.error) {
                setGraphSendMailValidation(recipientResult.error);
                return;
            }
            setGraphSendMailValidation('');

            const subject = String(subjectInput?.value || '');
            const body = String(bodyInput?.value || '');
            if (!subject.trim() && !body.trim()) {
                showGraphSendMailFeedback(I18n.t("The subject and body cannot be empty at the same time"), 'error');
                return;
            }
            if (/\r|\n/.test(subject)) {
                showGraphSendMailFeedback(I18n.t("The subject cannot contain line breaks"), 'error');
                return;
            }

            clearGraphSendMailFeedback();
            setGraphSendMailSubmitting(true);
            try {
                const response = await fetchWithTimeout('/api/outlook/send-mail', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        account_id: graphSendMailAccountSnapshot.id,
                        recipients: recipientResult.recipients,
                        subject,
                        body,
                    }),
                    timeoutMs: GRAPH_SEND_MAIL_REQUEST_TIMEOUT_MS,
                    timeoutMessage: I18n.t("The result of email submission is uncertain, please confirm before deciding whether to resend."),
                });
                const data = await response.json().catch(() => ({}));
                if (response.status === 202 && data?.success === true && data?.submitted === true) {
                    if (recipientsInput) recipientsInput.value = '';
                    if (subjectInput) subjectInput.value = '';
                    if (bodyInput) bodyInput.value = '';
                    showGraphSendMailFeedback(I18n.t("The email has been submitted for sending"), 'success');
                    showToast(I18n.t("The email has been submitted for sending"), 'success');
                    return;
                }

                const feedback = getGraphSendMailFailureFeedback(data, response.status);
                showGraphSendMailFeedback(feedback.message, feedback.type, feedback);
            } catch (error) {
                showGraphSendMailFeedback(
                    I18n.t("The result of email submission is uncertain, please confirm before deciding whether to resend."),
                    'warning',
                );
            } finally {
                setGraphSendMailSubmitting(false);
            }
        }

        function cleanupIframeResizeResources(resources) {
            (resources.timers || []).forEach(timerId => window.clearTimeout(timerId));
            resources.timers = [];
            if (resources.observer) {
                resources.observer.disconnect();
                resources.observer = null;
            }
        }

        function cleanupNormalDetailIframeResizeResources() {
            cleanupIframeResizeResources(normalDetailIframeResizeResources);
        }

        function cleanupFullscreenIframeResizeResources() {
            cleanupIframeResizeResources(fullscreenIframeResizeResources);
        }

        function getNormalMailboxRemoteMethod() {
            const cacheMethod = getEmailListCacheEntry(currentAccount, currentFolder)?.remote_method;
            return cacheMethod || currentMethod;
        }

        function getRemoteMailboxMethodFallback() {
            const method = String(getNormalMailboxRemoteMethod() || '').trim().toLowerCase();
            return ['graph', 'imap'].includes(method) ? method : 'graph';
        }

        function getCurrentEmailRemoteActionMethod(emailItem = {}) {
            const idMode = String(emailItem?.id_mode || emailItem?.idMode || '').trim().toLowerCase();
            if (idMode === 'graph') {
                return 'graph';
            }
            if (idMode === 'uid' || idMode === 'sequence') {
                return 'imap';
            }
            return getRemoteMailboxMethodFallback();
        }

        function buildEmailListRequestUrl(email, params = {}) {
            const query = new URLSearchParams(params);
            return `/api/emails/${encodeURIComponent(email)}?${query.toString()}`;
        }

        function setEmailListLoadingState(isLoading, options = {}) {
            const refreshBtn = document.querySelector('.refresh-btn');
            const folderTabs = document.querySelectorAll('.folder-tab');
            const isBackgroundSync = options.background === true;

            if (refreshBtn) {
                refreshBtn.disabled = isLoading && !isBackgroundSync;
                refreshBtn.classList.toggle('spinning', isLoading);
                refreshBtn.title = isLoading
                    ? (isBackgroundSync ? I18n.t("Locally retained emails are displayed and remote emails are being synchronized in the background.") : I18n.t("Fetching mail..."))
                    : I18n.t("Fetch mail");
                refreshBtn.toggleAttribute('aria-busy', isLoading);
            }
            folderTabs.forEach(tab => {
                tab.disabled = isLoading && !isBackgroundSync;
                tab.title = isLoading && isBackgroundSync
                    ? I18n.t("Locally retained emails have been displayed and background synchronization is in progress.")
                    : '';
            });
        }

        function isCurrentMailboxContext(context) {
            return currentAccount === context.account && currentFolder === context.folder;
        }

        function updateEmailListHeader(methodLabel, emailCount) {
            const methodTag = document.getElementById('methodTag');
            if (methodTag) {
                methodTag.textContent = methodLabel;
                methodTag.style.display = 'inline';
            }

            const emailCountEl = document.getElementById('emailCount');
            if (emailCountEl) {
                emailCountEl.textContent = `(${emailCount})`;
            }
        }

        function setMailSyncStatus(message = '') {
            const status = document.getElementById('mailSyncStatus');
            if (!status) {
                return;
            }

            status.textContent = message;
            status.hidden = !message;
        }

        function getEmailListMethodMetadata(data, options = {}) {
            const requestMethod = String(data.request_method || '').trim().toLowerCase();
            const optionMethod = String(options.method || '').trim().toLowerCase();
            const method = requestMethod || optionMethod || (data.method === 'Graph API' ? 'graph' : 'imap');
            return {
                method,
                remoteMethod: method === 'local' ? getRemoteMailboxMethodFallback() : method,
                methodLabel: options.methodLabel || data.method || method,
                disableLoadMore: options.disableLoadMore === true
            };
        }

        function getEmailMessageStableKey(emailItem, fallbackFolder = currentFolder) {
            const id = String(emailItem?.id || '').trim();
            if (!id) {
                return '';
            }

            const folder = String(emailItem?.folder || fallbackFolder || '').trim().toLowerCase();
            const idMode = String(emailItem?.id_mode || emailItem?.idMode || '').trim().toLowerCase();
            return `${folder}::${idMode}::${id}`;
        }

        function getEmailListTimestamp(emailItem) {
            const timestamp = Date.parse(emailItem?.date || emailItem?.received_at || '');
            return Number.isNaN(timestamp) ? 0 : timestamp;
        }

        function mergeEmailListByStableKey(existingEmails, incomingEmails, fallbackFolder = currentFolder) {
            const mergedEmails = [];
            const indexByKey = new Map();
            const newEmails = [];

            (existingEmails || []).forEach(emailItem => {
                const key = getEmailMessageStableKey(emailItem, fallbackFolder);
                if (key) {
                    indexByKey.set(key, mergedEmails.length);
                }
                mergedEmails.push(emailItem);
            });

            (incomingEmails || []).forEach(emailItem => {
                const key = getEmailMessageStableKey(emailItem, fallbackFolder);
                if (key && indexByKey.has(key)) {
                    const index = indexByKey.get(key);
                    mergedEmails[index] = { ...mergedEmails[index], ...emailItem };
                    return;
                }

                if (key) {
                    indexByKey.set(key, mergedEmails.length);
                }
                mergedEmails.push(emailItem);
                newEmails.push(emailItem);
            });

            mergedEmails.sort((left, right) => getEmailListTimestamp(right) - getEmailListTimestamp(left));
            return { emails: mergedEmails, newEmails };
        }

        function cacheEmailListResponse(cacheKey, data, method, methodLabel, options = {}) {
            const emails = Array.isArray(data.emails) ? data.emails : [];
            const disableLoadMore = options.disableLoadMore === true;
            const folderSummaries = options.folderSummaries || data.folder_summaries;
            emailListCache[cacheKey] = {
                emails,
                has_more: disableLoadMore ? false : data.has_more === true,
                skip: emails.length,
                method,
                method_label: methodLabel,
                derived_from: null,
                local_retention: data.local_retention === true,
                local_retention_count: Number(data.count) || emails.length,
                folder_summaries: currentFolder === 'all'
                    ? normalizeFolderSummaries(folderSummaries)
                    : undefined
            };

            if (options.remoteMethod) {
                emailListCache[cacheKey].remote_method = options.remoteMethod;
            }
        }

        function applyEmailListResponse(cacheKey, data, options = {}) {
            const emails = Array.isArray(data.emails) ? data.emails : [];
            const { method, remoteMethod, methodLabel, disableLoadMore } = getEmailListMethodMetadata(data, options);

            currentEmails = emails;
            currentMethod = method;
            hasMoreEmails = disableLoadMore ? false : data.has_more === true;
            currentSkip = currentEmails.length;

            cacheEmailListResponse(cacheKey, data, method, methodLabel, {
                disableLoadMore,
                remoteMethod
            });
            updateEmailListHeader(methodLabel, currentEmails.length);
            renderEmailList(currentEmails);
            scheduleEmailListLoadCheck(80);
        }

        function getPendingNewMailSyncKey(account = currentAccount, folder = currentFolder) {
            return `${account || ''}_${folder || 'all'}`;
        }

        function hasPendingNewMailSync(account = currentAccount, folder = currentFolder) {
            return pendingNewMailSyncs.has(getPendingNewMailSyncKey(account, folder));
        }

        function updateEmailListCacheRemoteMetadata(cacheKey, data, options = {}) {
            const existingCache = emailListCache[cacheKey];
            if (!existingCache) {
                return;
            }

            const { method, remoteMethod } = getEmailListMethodMetadata(data, options);
            existingCache.remote_method = remoteMethod || method;
            if (currentFolder === 'all' && data.folder_summaries) {
                existingCache.folder_summaries = mergeFolderSummaries(
                    existingCache.folder_summaries,
                    data.folder_summaries
                );
            }
        }

        function queuePendingNewMailSync(syncKey, cacheKey, data, options = {}) {
            const existingEmails = Array.isArray(currentEmails) ? currentEmails : [];
            const incomingEmails = Array.isArray(data.emails) ? data.emails : [];
            const mergedResult = mergeEmailListByStableKey(existingEmails, incomingEmails, options.folder);
            const newlySyncedRows = collectNewlySyncedEmailRows(data, mergedResult, options.folder);

            updateEmailListCacheRemoteMetadata(cacheKey, data, options);
            pendingNewMailSyncs.set(syncKey, {
                cacheKey,
                data,
                options: { ...options },
                newlySyncedRows
            });
            announceNewlySyncedEmailRows(data, newlySyncedRows, options.folder, syncKey);
            return mergedResult;
        }


        function applyPendingNewMailSync(syncKey = getPendingNewMailSyncKey()) {
            const pending = pendingNewMailSyncs.get(syncKey);
            if (!pending) {
                hideNewMailNotice();
                return false;
            }

            const listElement = document.getElementById('emailList');
            const previousScrollTop = listElement ? listElement.scrollTop : null;
            const mergeResult = mergeEmailListByStableKey(
                Array.isArray(currentEmails) ? currentEmails : [],
                pending.data.emails,
                pending.options.folder
            );
            const newlySyncedRows = collectNewlySyncedEmailRows(
                pending.data,
                mergeResult,
                pending.options.folder
            );
            const { method, remoteMethod, methodLabel } = getEmailListMethodMetadata(
                pending.data,
                pending.options
            );
            markNewlySyncedEmailRows(newlySyncedRows, pending.options.folder);
            currentEmails = mergeResult.emails;
            currentMethod = method;
            hasMoreEmails = pending.data.has_more === true;
            currentSkip = currentEmails.length;

            cacheEmailListResponse(pending.cacheKey, { ...pending.data, emails: currentEmails }, method, methodLabel, {
                remoteMethod
            });
            updateEmailListHeader(methodLabel, currentEmails.length);
            renderEmailList(currentEmails);
            if (previousScrollTop !== null) {
                const currentListElement = document.getElementById('emailList');
                if (currentListElement) {
                    currentListElement.scrollTop = previousScrollTop;
                }
            }
            scheduleEmailListLoadCheck(80);
            requestBodyRetentionForNewRows(newlySyncedRows, pending.options.folder);
            if (newlySyncedRows.length > 0) {
                scheduleNewEmailHighlightClear();
            }
            pendingNewMailSyncs.delete(syncKey);
            hideNewMailNotice();
            return true;
        }


        function applyMergedRemoteEmailSync(cacheKey, data, options = {}) {
            const syncKey = getPendingNewMailSyncKey(options.context?.account, options.context?.folder);
            if (options.announceNewRows === true && Number(data.new_count || 0) > 0) {
                return queuePendingNewMailSync(syncKey, cacheKey, data, options);
            }

            pendingNewMailSyncs.delete(syncKey);
            hideNewMailNotice();
            const mergedResult = mergeEmailListByStableKey(currentEmails, data.emails, options.folder);
            const { method, remoteMethod, methodLabel } = getEmailListMethodMetadata(data, options);
            currentEmails = mergedResult.emails;
            currentMethod = method;
            hasMoreEmails = data.has_more === true;
            currentSkip = currentEmails.length;
            cacheEmailListResponse(cacheKey, { ...data, emails: currentEmails }, method, methodLabel, { remoteMethod });
            updateEmailListHeader(methodLabel, currentEmails.length);
            renderEmailList(currentEmails);
            scheduleEmailListLoadCheck(80);
            return mergedResult;
        }

        async function tryRenderLocalRetainedEmails(email, cacheKey) {
            if (!isNormalMailLocalRetentionEnabled()) {
                setMailSyncStatus(I18n.t("Local storage is not enabled"));
                return false;
            }
            try {
                const response = await fetchWithTimeout(
                    buildEmailListRequestUrl(email, {
                        source: 'local',
                        folder: currentFolder,
                        skip: 0,
                        top: 20
                    }),
                    {
                        timeoutMs: EMAIL_LIST_REQUEST_TIMEOUT_MS,
                        timeoutMessage: I18n.t("Timeout reading local retained messages")
                    }
                );
                const data = await response.json();
                const retainedEmails = Array.isArray(data.emails) ? data.emails : [];
                if (!data.success || retainedEmails.length === 0) {
                    return false;
                }

                applyEmailListResponse(cacheKey, data, {
                    method: 'local',
                    methodLabel: data.method || 'Local Retention'
                });
                return true;
            } catch (error) {
                return false;
            }
        }

        function buildBrowserMailFetchError(error) {
            const isTimeout = isTimeoutAbortError(error);
            const message = isTimeout
                ? I18n.t("Network connection timeout: The email service did not respond within the specified time, please check the network, proxy and service address")
                : I18n.t("Network connection failed: The browser cannot connect to the email interface. Please check whether the current network, proxy and service are normal.");
            return {
                code: isTimeout ? 'MAIL_NETWORK_TIMEOUT' : 'MAIL_NETWORK_FAILED',
                message,
                type: error?.name || 'NetworkError',
                status: isTimeout ? 504 : 0,
                category: 'network',
                details: error?.message || String(error || ''),
                trace_id: '-'
            };
        }

        function getFetchErrorMessage(error) {
            return buildBrowserMailFetchError(error).message;
        }

        function showBackgroundMailFetchErrorModal(context, details) {
            const errorFingerprint = Object.entries(details || {}).map(([method, error]) => {
                const value = error && typeof error === 'object'
                    ? (error.reason_code || error.code || error.type || error.message || 'unknown')
                    : String(error || 'unknown');
                return `${method}:${value}`;
            }).sort().join('|');
            const key = `${context?.account || ''}_${context?.folder || ''}:${errorFingerprint}`;
            const now = Date.now();
            if (
                key === lastBackgroundMailErrorModal.key
                && now - lastBackgroundMailErrorModal.shownAt < BACKGROUND_MAIL_ERROR_MODAL_COOLDOWN_MS
            ) {
                return;
            }

            lastBackgroundMailErrorModal = { key, shownAt: now };
            showEmailFetchErrorModal(details);
        }

        async function fetchRemoteEmails(email, cacheKey, options = {}) {
            const requestFolder = options.folder || currentFolder;
            const requestMethod = options.method || getRemoteMailboxMethodFallback();
            const response = await fetchWithTimeout(
                buildEmailListRequestUrl(email, {
                    method: requestMethod,
                    folder: requestFolder,
                    skip: 0,
                    top: 20
                }),
                {
                    timeoutMs: EMAIL_LIST_REQUEST_TIMEOUT_MS,
                    timeoutMessage: I18n.t("Retrieval of email timed out, please check the network, proxy or account configuration and try again")
                }
            );
            const data = await response.json();

            if (data.success) {
                if (!options.context || isCurrentMailboxContext(options.context)) {
                    setMailSyncStatus('');
                    if (options.mergeWithCurrentList === true) {
                        applyMergedRemoteEmailSync(cacheKey, data, options);
                    } else {
                        applyEmailListResponse(cacheKey, data, options);
                    }
                }
                return data;
            }

            const fetchErrorDetails = data.details || (data.error ? { error: data.error } : {});
            if (options.preserveCurrentListOnError === true) {
                window._lastFetchErrorDetails = fetchErrorDetails;
                if (!options.context || isCurrentMailboxContext(options.context)) {
                    const errorMessage = data.error?.message
                        || (typeof data.error === 'string' ? data.error : '')
                        || I18n.t("Background synchronization failed, local mailing list has been retained");
                    setMailSyncStatus(I18n.tpl`Background synchronization failed: ${errorMessage}`);
                    showToast(errorMessage, 'error');
                    showBackgroundMailFetchErrorModal(options.context, fetchErrorDetails);
                }
                return false;
            }

            if (Object.keys(fetchErrorDetails).length > 0) {
                showEmailFetchErrorModal(fetchErrorDetails);
            } else {
                handleApiError(data, I18n.t("Failed to get mail"));
            }
            document.getElementById('emailList').innerHTML = renderEmptyStateMarkup(
                '⚠️',
                I18n.t("Failed to get email,<a href=\"javascript:void(0)\" onclick=\"showEmailFetchErrorModal(window._lastFetchErrorDetails)\" style=\"color:#409eff;text-decoration:underline;\">Click to view details</a>"),
                {
                    allowHtml: true,
                    onAction: 'refreshEmails()',
                    actionTitle: I18n.t("Refresh mailing list")
                }
            );
            window._lastFetchErrorDetails = fetchErrorDetails;
            return false;
        }

        function startBackgroundRemoteMailboxSync(email, cacheKey) {
            const context = {
                account: email,
                folder: currentFolder
            };
            const syncKey = `${context.account}_${context.folder}`;
            if (backgroundMailboxSyncs.has(syncKey)) {
                return;
            }

            setEmailListLoadingState(true, { background: true });
            const syncPromise = fetchRemoteEmails(email, cacheKey, {
                folder: context.folder,
                method: getRemoteMailboxMethodFallback(),
                context,
                mergeWithCurrentList: true,
                announceNewRows: true,
                preserveCurrentListOnError: true
            }).catch(error => {
                if (isCurrentMailboxContext(context)) {
                    const browserError = buildBrowserMailFetchError(error);
                    const errorMessage = getFetchErrorMessage(error);
                    setMailSyncStatus(I18n.tpl`Background synchronization failed: ${errorMessage}`);
                    showToast(errorMessage, 'error');
                    showBackgroundMailFetchErrorModal(context, { browser: browserError });
                }
            }).finally(() => {
                backgroundMailboxSyncs.delete(syncKey);
                if (isCurrentMailboxContext(context)) {
                    setEmailListLoadingState(false);
                }
            });
            backgroundMailboxSyncs.set(syncKey, syncPromise);
        }

        // Load mailing list
        async function loadEmails(email, forceRefresh = false) {
            const container = document.getElementById('emailList');

            // Clear the selected status when switching accounts/refreshing
            selectedEmailIds.clear();
            updateEmailBatchActionBar();
            hideNewMailNotice();
            pendingNewMailSyncs.delete(getPendingNewMailSyncKey(email, currentFolder));
            setMailSyncStatus('');

            const cacheKey = `${email}_${currentFolder}`;
            const cache = !forceRefresh ? getEmailListCacheEntry(email, currentFolder) : null;
            if (cache) {
                applyEmailListCache(cache, { scheduleLoadCheck: false });
                return;
            }

            setEmailListLoadingState(true);
            currentSkip = 0;
            hasMoreEmails = true;
            container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
            let startedBackgroundSync = false;

            try {
                if (isNormalMailboxListRequest() && await tryRenderLocalRetainedEmails(email, cacheKey)) {
                    startBackgroundRemoteMailboxSync(email, cacheKey);
                    startedBackgroundSync = true;
                    return;
                }
                await fetchRemoteEmails(email, cacheKey);
            } catch (error) {
                const browserError = buildBrowserMailFetchError(error);
                const errorMessage = getFetchErrorMessage(error);
                setMailSyncStatus('');
                showEmailFetchErrorModal({ browser: browserError });
                container.innerHTML = renderEmptyStateMarkup('⚠️', errorMessage, {
                    onAction: 'refreshEmails()',
                    actionTitle: I18n.t("Refresh mailing list")
                });
            } finally {
                if (!startedBackgroundSync) {
                    setEmailListLoadingState(false);
                }
            }
        }

        // Render mailing list
        // Selected email IDs
        let selectedEmailIds = new Set();
        let pendingReadEmailIds = new Set();
        let isBatchSelectMode = false;
        let highlightedNewEmailKeys = new Set();
        const requestedBodyRetentionKeys = new Set();
        const BODY_RETENTION_REQUEST_LIMIT = 5;

        function hideNewMailNotice() {
            const notice = document.getElementById('newMailNotice');
            if (!notice) {
                return;
            }

            notice.hidden = true;
            notice.innerHTML = '';
            notice.dataset.syncKey = '';
            notice.removeAttribute('role');
            notice.removeAttribute('tabindex');
            notice.onclick = null;
            notice.onkeydown = null;
        }

        function getNewMessageIdKeys(newMessageIds, fallbackFolder = currentFolder) {
            return new Set(
                (newMessageIds || [])
                    .map(item => getEmailMessageStableKey(item, fallbackFolder))
                    .filter(Boolean)
            );
        }

        function collectNewlySyncedEmailRows(data, mergeResult, fallbackFolder = currentFolder) {
            const newMessageKeys = getNewMessageIdKeys(data.new_message_ids, fallbackFolder);
            const candidateRows = Array.isArray(data.emails) ? data.emails : [];
            const rows = candidateRows.filter(emailItem => {
                const key = getEmailMessageStableKey(emailItem, fallbackFolder);
                return key && newMessageKeys.has(key);
            });

            if (rows.length > 0) {
                return rows;
            }
            return Number(data.new_count || 0) > 0 ? mergeResult.newEmails : [];
        }

        function showNewMailNotice(newCount, syncKey = getPendingNewMailSyncKey()) {
            const notice = document.getElementById('newMailNotice');
            if (!notice || newCount <= 0) {
                hideNewMailNotice();
                return;
            }

            const acceptPendingSync = () => applyPendingNewMailSync(syncKey);
            notice.hidden = false;
            notice.setAttribute('role', 'button');
            notice.setAttribute('tabindex', '0');
            notice.dataset.syncKey = syncKey;
            notice.onclick = acceptPendingSync;
            notice.onkeydown = event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    acceptPendingSync();
                }
            };
            notice.replaceChildren();
            const message = document.createElement('span');
            message.textContent = I18n.tpl`${Number(newCount)} new emails have been synchronized`;
            const hint = document.createElement('span');
            hint.className = 'new-mail-notice__hint';
            hint.textContent = I18n.t("Click to display");
            notice.append(message, hint);
        }


        function markNewlySyncedEmailRows(rows, fallbackFolder = currentFolder) {
            highlightedNewEmailKeys = new Set();
            rows.forEach(emailItem => {
                const key = getEmailMessageStableKey(emailItem, fallbackFolder);
                if (key) {
                    highlightedNewEmailKeys.add(key);
                }
            });
        }

        function scheduleNewEmailHighlightClear() {
            window.setTimeout(() => {
                highlightedNewEmailKeys = new Set();
                document.querySelectorAll('.email-item.newly-synced').forEach(item => {
                    item.classList.remove('newly-synced');
                });
            }, NEW_EMAIL_HIGHLIGHT_CLEAR_DELAY_MS);
        }

        function announceNewlySyncedEmailRows(data, rows, fallbackFolder = currentFolder, syncKey = getPendingNewMailSyncKey()) {
            const reportedCount = Number(data.new_count || 0);
            const visibleCount = reportedCount > 0 ? reportedCount : rows.length;
            if (visibleCount <= 0) {
                hideNewMailNotice();
                return;
            }

            showNewMailNotice(visibleCount, syncKey);
        }

        function buildBodyRetentionItems(rows, fallbackFolder = currentFolder) {
            const method = getRemoteMailboxMethodFallback();
            return (rows || [])
                .map(emailItem => ({
                    id: String(emailItem?.id || '').trim(),
                    folder: String(emailItem?.folder || fallbackFolder || 'inbox'),
                    id_mode: String(emailItem?.id_mode || '').trim(),
                    method
                }))
                .filter(item => item.id);
        }

        function getUnrequestedBodyRetentionItems(rows, fallbackFolder = currentFolder) {
            const items = buildBodyRetentionItems(rows, fallbackFolder);
            const unrequestedItems = items.filter(item => {
                const key = getEmailMessageStableKey(item, fallbackFolder);
                return key && !requestedBodyRetentionKeys.has(key);
            });
            return unrequestedItems.slice(0, BODY_RETENTION_REQUEST_LIMIT);
        }

        function requestBodyRetentionForNewRows(rows, fallbackFolder = currentFolder) {
            const items = getUnrequestedBodyRetentionItems(rows, fallbackFolder);
            if (!items.length || !currentAccount || isTempEmailGroup || !isNormalMailLocalRetentionEnabled()) {
                return;
            }

            const requestedKeys = items
                .map(item => getEmailMessageStableKey(item, fallbackFolder))
                .filter(Boolean);
            requestedKeys.forEach(key => requestedBodyRetentionKeys.add(key));

            fetch('/api/emails/retain-bodies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: currentAccount,
                    folder: fallbackFolder,
                    method: getRemoteMailboxMethodFallback(),
                    items
                })
            }).then(response => {
                if (!response.ok) {
                    throw new Error(`Retained body request failed with status ${response.status}`);
                }
                return response.json().catch(() => ({ success: true }));
            }).then(data => {
                if (data && data.success === false) {
                    throw new Error(data.error || 'Retained body request failed');
                }
            }).catch(error => {
                requestedKeys.forEach(key => requestedBodyRetentionKeys.delete(key));
                console.warn('Retained mail body background fetch failed:', error);
            });
        }

        function buildEmailDetailRequestUrl(messageId, folder, selectedEmail = {}) {
            const query = new URLSearchParams({
                method: getCurrentEmailRemoteActionMethod(selectedEmail),
                folder
            });
            if (isNormalMailboxListRequest() && isNormalMailLocalRetentionEnabled()) {
                query.set('prefer_local', '1');
            }
            appendEmailIdModeParam(query, selectedEmail);
            return `/api/email/${encodeURIComponent(currentAccount)}/${encodeURIComponent(messageId)}?${query.toString()}`;
        }

        function getRecipientDisplayLabel(emailItem) {
            if (isTempEmailGroup && currentMethod !== 'cloudflare-admin') {
                return '';
            }

            const normalizedCurrentAccount = String(currentAccount || '').trim().toLowerCase();
            const toValue = String(emailItem?.to || '').trim();
            if (!normalizedCurrentAccount || !toValue) {
                return '';
            }

            const recipientCandidates = toValue.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
            const recipients = recipientCandidates.length > 0
                ? recipientCandidates.map(recipient => recipient.trim().toLowerCase())
                : [toValue.toLowerCase()];

            if (recipients.includes(normalizedCurrentAccount)) {
                return '';
            }

            return `to: ${toValue}`;
        }

        function getEmailSourceLabel(emailItem) {
            if (currentMethod === 'cloudflare-admin') {
                return 'Cloudflare';
            }
            if (isTempEmailGroup || currentFolder !== 'all' || !emailItem?.folder) {
                return '';
            }
            return getFolderDisplayName(emailItem?.folder);
        }

        function formatAttachmentSize(size) {
            const numericSize = Number(size) || 0;
            if (numericSize < 1024) {
                return `${numericSize} B`;
            }
            if (numericSize < 1024 * 1024) {
                return `${(numericSize / 1024).toFixed(1).replace(/\.0$/, '')} KB`;
            }
            return `${(numericSize / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
        }

        function appendEmailIdModeParam(query, email) {
            const idMode = String(email?.id_mode || email?.idMode || '').trim().toLowerCase();
            if (idMode) {
                query.set('id_mode', idMode);
            }
        }

        function buildAttachmentDownloadUrl(email, attachment) {
            const query = new URLSearchParams();
            query.set('method', getCurrentEmailRemoteActionMethod(email));
            query.set('folder', email?.folder || currentFolder || 'inbox');
            appendEmailIdModeParam(query, email);
            return `/api/email/${encodeURIComponent(currentAccount)}/${encodeURIComponent(email.id)}/attachments/${encodeURIComponent(attachment.id)}?${query.toString()}`;
        }

        function buildAllAttachmentsDownloadUrl(email) {
            const query = new URLSearchParams();
            query.set('method', getCurrentEmailRemoteActionMethod(email));
            query.set('folder', email?.folder || currentFolder || 'inbox');
            appendEmailIdModeParam(query, email);
            return `/api/email/${encodeURIComponent(currentAccount)}/${encodeURIComponent(email.id)}/attachments/download-all?${query.toString()}`;
        }

        function parseDownloadFilename(response, fallbackFilename) {
            const disposition = response.headers.get('content-disposition') || '';
            const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
            if (encodedMatch) {
                try {
                    return decodeURIComponent(encodedMatch[1].trim().replace(/^"|"$/g, '')) || fallbackFilename;
                } catch (error) {
                    return fallbackFilename;
                }
            }

            const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
            return filenameMatch ? filenameMatch[1] : fallbackFilename;
        }

        function triggerAttachmentDownload(blob, filename) {
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename || 'attachment';
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
        }

        function setAttachmentDownloadState(link, isDownloading) {
            link.dataset.downloading = isDownloading ? 'true' : 'false';
            link.classList.toggle('is-downloading', isDownloading);
            link.setAttribute('aria-busy', isDownloading ? 'true' : 'false');

            if (link.classList.contains('email-attachments__download-all')) {
                if (!link.dataset.defaultLabel) {
                    link.dataset.defaultLabel = link.textContent.trim() || I18n.t("Download all");
                }
                link.textContent = isDownloading ? I18n.t("Packing...") : link.dataset.defaultLabel;
                return;
            }

            const action = link.querySelector('.email-attachment-item__action');
            if (action) {
                action.textContent = isDownloading ? I18n.t("Downloading...") : I18n.t("Download");
            }
        }

        async function downloadEmailAttachmentFile(event, link) {
            event.preventDefault();
            if (!link || link.dataset.downloading === 'true') {
                return;
            }

            const isDownloadAll = link.classList.contains('email-attachments__download-all');
            const fallbackFilename = link.getAttribute('download') || (isDownloadAll ? 'attachments.zip' : 'attachment');
            const pendingMessage = isDownloadAll ? I18n.t("Packing attachments...") : I18n.t("Downloading attachment...");
            const failureMessage = isDownloadAll ? I18n.t("All attachments failed to download") : I18n.t("Attachment download failed");
            const successMessage = isDownloadAll ? I18n.t("The attachment has been packaged and the download has started") : I18n.t("Attachment download has started");

            setAttachmentDownloadState(link, true);
            showToast(pendingMessage, 'info');

            try {
                const response = await fetch(link.href, {
                    method: 'GET',
                    cache: 'no-store',
                    credentials: 'same-origin'
                });
                const contentType = response.headers.get('content-type') || '';
                const disposition = response.headers.get('content-disposition') || '';
                const isFileResponse = /attachment/i.test(disposition);

                if (!response.ok || (!isFileResponse && contentType.includes('application/json'))) {
                    const data = contentType.includes('application/json')
                        ? await response.json().catch(() => null)
                        : null;
                    if (data) {
                        handleApiError(data, failureMessage);
                    } else {
                        showToast(`${failureMessage}（HTTP ${response.status}）`, 'error');
                    }
                    return;
                }

                const blob = await response.blob();
                triggerAttachmentDownload(blob, parseDownloadFilename(response, fallbackFilename));
                showToast(successMessage, 'success');
            } catch (error) {
                showToast(I18n.tpl`${failureMessage}, please check the network and try again`, 'error');
            } finally {
                setAttachmentDownloadState(link, false);
            }
        }

        function renderAttachmentSection(email) {
            const attachments = Array.isArray(email?.attachments) ? email.attachments : [];
            if (attachments.length === 0) {
                return '';
            }

            return I18n.tpl`
                <section class="email-attachments" aria-label="Email attachment">
                    <div class="email-attachments__header">
                        <div class="email-attachments__summary">
                            <div class="email-attachments__title">Attachment</div>
                            <div class="email-attachments__count">${attachments.length}</div>
                        </div>
                        ${attachments.length > 1 ? I18n.tpl`
                            <a class="email-attachments__download-all"
                               href="${buildAllAttachmentsDownloadUrl(email)}"
                               download="attachments.zip"
                               onclick="downloadEmailAttachmentFile(event, this)">Download all</a>
                        ` : ''}
                    </div>
                    <div class="email-attachments__list">
                        ${attachments.map(attachment => I18n.tpl`
                            <a class="email-attachment-item"
                               href="${buildAttachmentDownloadUrl(email, attachment)}"
                               download="${escapeHtml(attachment.name || 'attachment')}"
                               onclick="downloadEmailAttachmentFile(event, this)">
                                <span class="email-attachment-item__icon" aria-hidden="true">📎</span>
                                <span class="email-attachment-item__content">
                                    <span class="email-attachment-item__name">${escapeHtml(attachment.name || 'attachment')}</span>
                                    <span class="email-attachment-item__meta">
                                        ${attachment.is_inline ? I18n.t("<span class=\"email-attachment-item__badge\">Inline</span>") : ''}
                                        <span>${formatAttachmentSize(attachment.size)}</span>
                                        <span>${escapeHtml(attachment.content_type || 'application/octet-stream')}</span>
                                    </span>
                                </span>
                                <span class="email-attachment-item__action">Download</span>
                            </a>
                        `).join('')}
                    </div>
                </section>
            `;
        }

        function renderEmailList(emails) {
            const container = document.getElementById('emailList');

            if (emails.length === 0) {
                const emptyStateText = isTempEmailGroup
                    ? I18n.t("No email yet")
                    : I18n.tpl`${getFolderDisplayName(currentFolder)} is empty`;
                const emptyPrefix = currentMethod === 'cloudflare-admin' && typeof renderCloudflareGlobalFilterBar === 'function'
                    ? renderCloudflareGlobalFilterBar()
                    : '';
                container.innerHTML = emptyPrefix + renderEmptyStateMarkup('📭', emptyStateText, {
                    onAction: 'refreshEmails()',
                    actionTitle: I18n.t("Refresh mailing list")
                });
                // Reset selection
                selectedEmailIds.clear();
                currentEmailId = null;
                updateEmailBatchActionBar();
                return;
            }

            bindEmailListDelegatedEvents();
            const listPrefix = currentMethod === 'cloudflare-admin' && typeof renderCloudflareGlobalFilterBar === 'function'
                ? renderCloudflareGlobalFilterBar()
                : '';

            container.innerHTML = listPrefix + emails.map((email, index) => {
                const isChecked = selectedEmailIds.has(email.id);
                const isActive = currentEmailId === email.id;
                const recipientDisplayLabel = getRecipientDisplayLabel(email);
                const sourceLabel = getEmailSourceLabel(email);
                const hasAttachments = Boolean(email.has_attachments);
                const isNewlySynced = highlightedNewEmailKeys.has(getEmailMessageStableKey(email));
                return `
                <div class="email-item ${email.is_read === false ? 'unread' : ''} ${isActive ? 'active' : ''} ${isNewlySynced ? 'newly-synced' : ''}"
                     data-email-id="${escapeHtml(String(email.id || ''))}"
                     data-email-index="${index}">
                    <div class="email-checkbox-wrapper" data-email-id="${escapeHtml(String(email.id || ''))}">
                        <input type="checkbox" class="email-checkbox" ${isChecked ? 'checked' : ''} style="pointer-events: none;">
                    </div>
                    <div class="email-body">
                        <div class="email-top-row">
                            <div class="email-top-main">
                                ${email.is_read === false ? I18n.t("<span class=\"email-unread-dot\" title=\"unread\" aria-label=\"unread\"></span>") : ''}
                                <div class="email-sender-block">
                                    <div class="email-from" title="${escapeHtml(email.from || I18n.t("Unknown sender"))}">${escapeHtml(email.from || I18n.t("Unknown sender"))}</div>
                                    ${recipientDisplayLabel ? `<div class="email-recipient" title="${escapeHtml(recipientDisplayLabel)}">${escapeHtml(recipientDisplayLabel)}</div>` : ''}
                                </div>
                                ${hasAttachments ? I18n.t("<span class=\"email-attachment-indicator\" title=\"With attachments\" aria-label=\"With attachments\">📎</span>") : ''}
                                ${sourceLabel ? `<span class="email-folder-badge email-folder-badge--${escapeHtml(String(email.folder || '').toLowerCase())}">${escapeHtml(sourceLabel)}</span>` : ''}
                            </div>
                            <div class="email-date">${formatDate(email.date)}</div>
                        </div>
                        <div class="email-subject">${escapeHtml(email.subject || I18n.t("No topic"))}</div>
                        <div class="email-preview">${escapeHtml((email.body_preview || '').trim() || I18n.t("No preview content yet"))}</div>
                    </div>
                </div>
            `}).join('');

            updateEmailBatchActionBar();
        }

        function handleEmailListClick(event) {
            const checkboxWrapper = event.target.closest('.email-checkbox-wrapper[data-email-id]');
            if (checkboxWrapper) {
                event.stopPropagation();
                toggleEmailSelection(checkboxWrapper.dataset.emailId);
                return;
            }

            const emailItem = event.target.closest('.email-item[data-email-id]');
            if (!emailItem || !emailItem.parentElement?.contains(event.target)) {
                return;
            }

            const emailId = emailItem.dataset.emailId || '';
            const emailIndex = Number(emailItem.dataset.emailIndex || 0);
            if (currentMethod === 'cloudflare-admin') {
                getCloudflareGlobalMessageDetail(emailId, emailIndex);
            } else if (isTempEmailGroup) {
                getTempEmailDetail(emailId, emailIndex);
            } else {
                selectEmail(emailId, emailIndex);
            }
        }

        function bindEmailListDelegatedEvents() {
            const container = document.getElementById('emailList');
            if (!container || container.dataset.emailListClickBound === 'true') {
                return;
            }
            container.dataset.emailListClickBound = 'true';
            container.addEventListener('click', handleEmailListClick);
        }

        function getSelectedEmailItems() {
            const selectedIds = new Set(Array.from(selectedEmailIds).map(id => String(id)));
            if (!selectedIds.size) {
                return [];
            }

            return currentEmails.filter(email => selectedIds.has(String(email.id)));
        }

        function applyEmailReadState(updatedIds, isRead = true) {
            const normalizedIds = new Set((updatedIds || []).map(id => String(id)).filter(Boolean));
            if (!normalizedIds.size) {
                return;
            }

            const applyToEmailList = (emails) => {
                if (!Array.isArray(emails)) {
                    return;
                }

                emails.forEach(email => {
                    if (normalizedIds.has(String(email.id))) {
                        email.is_read = isRead;
                    }
                });
            };

            applyToEmailList(currentEmails);

            const cachePrefix = `${currentAccount || ''}_`;
            Object.entries(emailListCache).forEach(([cacheKey, cacheValue]) => {
                if (!cacheKey.startsWith(cachePrefix)) {
                    return;
                }
                applyToEmailList(cacheValue?.emails);
            });

            if (currentEmailDetail && normalizedIds.has(String(currentEmailDetail.id))) {
                currentEmailDetail.is_read = isRead;
            }
        }

        async function requestMarkEmailsAsRead(items, { silent = false } = {}) {
            const normalizedItems = (items || [])
                .map(item => {
                    if (!item?.id) {
                        return null;
                    }
                    return {
                        id: String(item.id),
                        folder: String(item.folder || currentFolder || 'inbox'),
                        id_mode: String(item.id_mode || '')
                    };
                })
                .filter(Boolean)
                .filter(item => !pendingReadEmailIds.has(item.id));

            if (!normalizedItems.length) {
                return {
                    success: true,
                    success_count: 0,
                    failed_count: 0,
                    updated_ids: [],
                    errors: []
                };
            }

            normalizedItems.forEach(item => pendingReadEmailIds.add(item.id));

            try {
                const response = await fetch('/api/emails/mark-read', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: currentAccount,
                        method: getRemoteMailboxMethodFallback(),
                        folder: currentFolder,
                        items: normalizedItems
                    })
                });
                const result = await response.json();
                const updatedIds = Array.isArray(result.updated_ids) ? result.updated_ids : [];

                if (updatedIds.length > 0) {
                    applyEmailReadState(updatedIds, true);
                    renderEmailList(currentEmails);
                }

                if (!silent) {
                    if (result.success_count > 0 && result.failed_count === 0) {
                        showToast(I18n.tpl`${result.success_count} messages have been set as read`);
                    } else if (result.success_count > 0) {
                        showToast(I18n.tpl`${result.success_count} seals have been set as read, ${result.failed_count} seals have failed`, 'warning');
                    } else {
                        handleApiError(result, I18n.t("Failed to set as read"));
                    }
                }

                if (result.failed_count > 0 && Array.isArray(result.errors) && result.errors.length > 0) {
                    console.warn('Mark read errors:', result.errors);
                }

                return result;
            } catch (error) {
                if (!silent) {
                    showToast(I18n.t("Failed to set as read, please check the network and try again"), 'error');
                }
                return {
                    success: false,
                    success_count: 0,
                    failed_count: normalizedItems.length,
                    updated_ids: [],
                    errors: [error]
                };
            } finally {
                normalizedItems.forEach(item => pendingReadEmailIds.delete(item.id));
            }
        }

        function toggleEmailSelection(emailId) {
            if (selectedEmailIds.has(emailId)) {
                selectedEmailIds.delete(emailId);
            } else {
                selectedEmailIds.add(emailId);
            }

            // Re-render to update checkbox UI (or efficiently update DOM)
            // For simplicity, we just find the checkbox and update it
            // implementation below is cheap
            renderEmailList(currentEmails);
        }

        function updateEmailBatchActionBar() {
            const bar = document.getElementById('emailBatchActionBar');
            const selectAllBtn = document.getElementById('emailSelectAllBtn');
            const markReadBtn = document.getElementById('batchMarkReadBtn');
            const panel = document.getElementById('emailListPanel');
            const selectedEmails = getSelectedEmailItems();
            const unreadSelectedCount = selectedEmails.filter(email => email.is_read === false).length;
            if (isTempEmailGroup) {
                bar.style.display = 'none';
                panel?.classList.remove('batch-toolbar-active');
                if (markReadBtn) {
                    markReadBtn.disabled = false;
                    markReadBtn.dataset.loading = 'false';
                    markReadBtn.textContent = I18n.t("Set as read");
                    markReadBtn.title = '';
                }
                return;
            }
            if (selectedEmailIds.size > 0) {
                bar.style.display = 'flex';
                panel?.classList.add('batch-toolbar-active');
                document.getElementById('emailSelectedCount').textContent = I18n.tpl`${selectedEmailIds.size} item selected`;
                if (selectAllBtn) {
                    selectAllBtn.textContent = currentEmails.length > 0 && selectedEmailIds.size === currentEmails.length
                        ? I18n.t("Deselect all")
                        : I18n.t("Select all");
                }
                if (markReadBtn) {
                    const isMarking = markReadBtn.dataset.loading === 'true';
                    markReadBtn.disabled = unreadSelectedCount === 0 || isMarking;
                    markReadBtn.title = unreadSelectedCount === 0 ? I18n.t("All selected emails have been read") : '';
                    if (!isMarking) {
                        markReadBtn.textContent = unreadSelectedCount > 0
                            ? I18n.tpl`Set as read${unreadSelectedCount !== selectedEmails.length ? ` (${unreadSelectedCount})` : ''}`
                            : I18n.t("Set as read");
                    }
                }
            } else {
                bar.style.display = 'none';
                panel?.classList.remove('batch-toolbar-active');
                if (markReadBtn) {
                    markReadBtn.disabled = false;
                    markReadBtn.dataset.loading = 'false';
                    markReadBtn.textContent = I18n.t("Set as read");
                    markReadBtn.title = '';
                }
            }
        }

        function toggleSelectAllEmails() {
            if (!currentEmails.length) return;

            const shouldClear = selectedEmailIds.size === currentEmails.length;
            if (shouldClear) {
                selectedEmailIds.clear();
            } else {
                currentEmails.forEach(email => selectedEmailIds.add(email.id));
            }
            renderEmailList(currentEmails);
        }

        function clearEmailSelection() {
            if (selectedEmailIds.size === 0) return;
            selectedEmailIds.clear();
            renderEmailList(currentEmails);
        }

        async function markSelectedEmailsAsRead() {
            const btn = document.getElementById('batchMarkReadBtn');
            if (!btn || btn.disabled) return;

            const unreadItems = getSelectedEmailItems()
                .filter(email => email.is_read === false)
                .map(email => ({
                    id: email.id,
                    folder: email.folder || currentFolder || 'inbox',
                    id_mode: email.id_mode || ''
                }));

            if (!unreadItems.length) {
                showToast(I18n.t("All selected emails have been read"));
                return;
            }

            btn.disabled = true;
            btn.dataset.loading = 'true';
            btn.textContent = I18n.t("Setting up...");

            try {
                await requestMarkEmailsAsRead(unreadItems);
            } finally {
                btn.dataset.loading = 'false';
                updateEmailBatchActionBar();
            }
        }

        function buildEmailDeleteItems(sourceItems) {
            return (sourceItems || [])
                .map(item => {
                    if (!item) {
                        return null;
                    }
                    if (typeof item !== 'object') {
                        const messageId = String(item || '').trim();
                        if (!messageId) {
                            return null;
                        }
                        return {
                            id: messageId,
                            folder: currentFolder || 'inbox',
                            id_mode: ''
                        };
                    }
                    const messageId = String(item.id || item.message_id || '').trim();
                    if (!messageId) {
                        return null;
                    }
                    return {
                        id: messageId,
                        folder: String(item.folder || currentFolder || 'inbox'),
                        id_mode: String(item.id_mode || item.idMode || '').trim()
                    };
                })
                .filter(Boolean);
        }

        async function confirmBatchDeleteEmails() {
            if (selectedEmailIds.size === 0) return;

            if (!(await showConfirmModal(I18n.tpl`Are you sure you want to permanently delete the selected ${selectedEmailIds.size} emails? This operation is irreversible!`, { title: I18n.t("Delete emails in batches"), confirmText: I18n.t("Confirm deletion") }))) {
                return;
            }

            await deleteEmails(getSelectedEmailItems());
        }

        async function confirmDeleteCurrentEmail() {
            if (isTempEmailGroup) return;
            if (!currentEmailDetail || !currentEmailDetail.id) return;

            if (!(await showConfirmModal(I18n.t("Are you sure you want to permanently delete this message? This operation is irreversible!"), { title: I18n.t("Delete mail"), confirmText: I18n.t("Confirm deletion") }))) {
                return;
            }

            await deleteEmails([currentEmailDetail]);
        }

        function removeDeletedEmailsFromCachedLists(deletedIds, account = currentAccount) {
            const normalizedIds = new Set(Array.from(deletedIds || []).map(id => String(id)));
            if (!normalizedIds.size) {
                return;
            }

            const cachePrefix = `${account || ''}_`;
            Object.entries(emailListCache).forEach(([cacheKey, cacheValue]) => {
                if (!cacheKey.startsWith(cachePrefix) || !Array.isArray(cacheValue?.emails)) {
                    return;
                }
                cacheValue.emails = cacheValue.emails.filter(email => !normalizedIds.has(String(email.id)));
                cacheValue.skip = cacheValue.emails.length;
                if (typeof cacheValue.local_retention_count === 'number') {
                    cacheValue.local_retention_count = Math.max(0, cacheValue.local_retention_count - normalizedIds.size);
                }
            });
        }

        async function deleteEmails(sourceItems) {
            const items = buildEmailDeleteItems(sourceItems);
            if (!items.length) {
                return;
            }

            showToast(I18n.t("Deleting..."), 'info');

            try {
                const response = await fetch('/api/emails/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: currentAccount,
                        method: getRemoteMailboxMethodFallback(),
                        folder: currentFolder,
                        items
                    })
                });

                const result = await response.json();
                const deletedIdList = Array.isArray(result.deleted_ids) && result.deleted_ids.length
                    ? result.deleted_ids
                    : (Array.isArray(result.updated_ids) ? result.updated_ids : []);
                const deletedIds = new Set(
                    (deletedIdList.length ? deletedIdList : (result.success ? items.map(item => item.id) : []))
                        .map(id => String(id))
                );

                if (result.success || deletedIds.size > 0) {
                    if (result.success && result.failed_count === 0) {
                        showToast(I18n.tpl`${result.success_count || deletedIds.size} emails successfully deleted`);
                    } else if (deletedIds.size > 0) {
                        showToast(I18n.tpl`${deletedIds.size} seal deleted, ${result.failed_count || 0} seal failed`, 'warning');
                    }

                    currentEmails = currentEmails.filter(e => !deletedIds.has(String(e.id)));
                    removeDeletedEmailsFromCachedLists(deletedIds);
                    selectedEmailIds.clear();
                    if (currentEmailId && deletedIds.has(String(currentEmailId))) {
                        currentEmailId = null;
                    }

                    renderEmailList(currentEmails);

                    // If current viewed email was deleted, clear view
                    if (currentEmailDetail && deletedIds.has(String(currentEmailDetail.id))) {
                        currentEmailId = null;
                        currentEmailDetail = null;
                        document.getElementById('emailDetail').innerHTML = I18n.tpl`
                            <div class="empty-state">
                                <div class="empty-state-icon">🗑️</div>
                                <div class="empty-state-text">Message deleted</div>
                            </div>
                        `;
                        document.getElementById('emailDetailToolbar').style.display = 'none';
                    }

                    // If errors
                    if (result.failed_count > 0) {
                        console.warn('Deletion errors:', result.errors);
                    }
                } else {
                    const errorMessage = result.error && result.error.message
                        ? result.error.message
                        : (result.error || I18n.t("Unknown error"));
                    showToast(I18n.t("Delete failed: ") + errorMessage, 'error');
                }
            } catch (e) {
                showToast(I18n.t("Network error"), 'error');
                console.error(e);
            }
        }

        // Select email
        async function selectEmail(messageId, index) {
            currentEmailId = messageId;
            const selectedEmail = currentEmails.find(email => email.id === messageId);
            const requestFolder = currentFolder === 'all'
                ? (selectedEmail?.folder || 'inbox')
                : currentFolder;
            // Update UI
            document.querySelectorAll('.email-item').forEach((item, i) => {
                item.classList.toggle('active', i === index);
            });

            // CurrentEmailDetail is not reset here, but will be set after fetch is successful.

            // Reset trust mode
            const trustCheckbox = document.getElementById('trustEmailCheckbox');
            trustCheckbox.checked = false;
            isTrustedMode = false;
            updateTrustToggleState(trustCheckbox);

            // Show toolbar
            document.getElementById('emailDetailToolbar').style.display = 'flex';
            const deleteBtn = document.querySelector('#emailDetailToolbar .batch-btn.danger');
            if (deleteBtn) deleteBtn.style.display = '';
            showMobileEmailDetail();

            // Load email details
            const container = document.getElementById('emailDetail');
            container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

            try {
                const response = await fetchWithTimeout(
                    buildEmailDetailRequestUrl(messageId, requestFolder, selectedEmail),
                    {
                        timeoutMs: EMAIL_DETAIL_REQUEST_TIMEOUT_MS,
                        timeoutMessage: I18n.t("Loading email details timed out, please try again later.")
                    }
                );
                const data = await response.json();

                if (data.success) {
                    currentEmailDetail = {
                        ...data.email,
                        folder: requestFolder,
                        id_mode: data.email?.id_mode || selectedEmail?.id_mode || ''
                    };
                    renderEmailDetail(currentEmailDetail);
                    if (selectedEmail?.is_read === false) {
                        void requestMarkEmailsAsRead([{
                            id: messageId,
                            folder: requestFolder,
                            id_mode: selectedEmail.id_mode || ''
                        }], { silent: true });
                    }
                } else {
                    handleApiError(data, I18n.t("Failed to load email details"));
                    const detailErrorMessage = data.error?.message
                        || (typeof data.error === 'string' ? data.error : '')
                        || I18n.t("Loading failed");
                    const hasProtocolDetails = data.details
                        && typeof data.details === 'object'
                        && Object.keys(data.details).length > 0;
                    if (hasProtocolDetails) {
                        window._lastFetchErrorDetails = data.details;
                    }
                    container.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-state-icon">⚠️</div>
                            <div class="empty-state-text"></div>
                            ${hasProtocolDetails ? I18n.t("<div class=\"empty-state-actions\" style=\"margin-top:12px;\"><a href=\"javascript:void(0)\" class=\"email-detail-error-link\" style=\"color:#409eff;text-decoration:underline;\">Click to view details</a></div>") : ''}
                        </div>
                    `;
                    const errorText = container.querySelector('.empty-state-text');
                    if (errorText) {
                        errorText.textContent = detailErrorMessage;
                    }
                    const detailLink = container.querySelector('.email-detail-error-link');
                    if (detailLink) {
                        detailLink.addEventListener('click', () => {
                            showEmailFetchErrorModal(window._lastFetchErrorDetails);
                        });
                    }
                }
            } catch (error) {
                const errorMessage = isTimeoutAbortError(error)
                    ? I18n.t("Loading email details timed out, please try again.")
                    : I18n.t("Network error, please try again");
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">⚠️</div>
                        <div class="empty-state-text">${errorMessage}</div>
                    </div>
                `;
            }
        }

        // Render email details
        function renderEmailDetail(email) {
            cleanupNormalDetailIframeResizeResources();
            const container = document.getElementById('emailDetail');
            const compactMobileMeta = typeof isMobileLayout === 'function' && isMobileLayout();

            const isHtml = email.body_type === 'html' ||
                (email.body && (email.body.includes('<html') || email.body.includes('<div') || email.body.includes('<p>')));

            const bodyContent = isHtml
                ? `<iframe id="emailBodyFrame" sandbox="allow-same-origin" onload="adjustIframeHeight(this)"></iframe>`
                : `<div class="email-body-text">${escapeHtml(email.body)}</div>`;

            const detailMetaRows = I18n.tpl`
                <div class="email-detail-meta-row">
                    <span class="email-detail-meta-label">Sender</span>
                    <span class="email-detail-meta-value">${escapeHtml(email.from)}</span>
                </div>
                <div class="email-detail-meta-row">
                    <span class="email-detail-meta-label">Recipients</span>
                    <span class="email-detail-meta-value">${escapeHtml(email.to || '-')}</span>
                </div>
                ${email.cc ? I18n.tpl`
                <div class="email-detail-meta-row">
                    <span class="email-detail-meta-label">CC</span>
                    <span class="email-detail-meta-value">${escapeHtml(email.cc)}</span>
                </div>
                ` : ''}
                <div class="email-detail-meta-row">
                    <span class="email-detail-meta-label">Time</span>
                    <span class="email-detail-meta-value">${formatDate(email.date)}</span>
                </div>
            `;

            const detailHeader = compactMobileMeta
                ? I18n.tpl`
                <div class="email-detail-header email-detail-header--compact">
                    <div class="email-detail-subject">${escapeHtml(email.subject || I18n.t("No topic"))}</div>
                    <div class="email-detail-meta-inline">
                        <span class="email-detail-meta-inline__from">${escapeHtml(email.from || I18n.t("Unknown sender"))}</span>
                        <span class="email-detail-meta-inline__dot"></span>
                        <span class="email-detail-meta-inline__time">${formatDate(email.date)}</span>
                    </div>
                    <details class="email-detail-meta-collapsible">
                        <summary class="email-detail-meta-collapsible__summary">View email messages</summary>
                        <div class="email-detail-meta email-detail-meta--compact">
                            ${detailMetaRows}
                        </div>
                    </details>
                </div>
                `
                : `
                <div class="email-detail-header">
                    <div class="email-detail-subject">${escapeHtml(email.subject || I18n.t("No topic"))}</div>
                    <div class="email-detail-meta">
                        ${detailMetaRows}
                    </div>
                </div>
                `;

            container.innerHTML = `
                ${detailHeader}
                <div class="email-detail-body">
                    ${renderAttachmentSection(email)}
                    ${bodyContent}
                </div>
            `;

            // If it is HTML content, set iframe content
            if (isHtml) {
                const iframe = document.getElementById('emailBodyFrame');
                if (iframe) {
                    let sanitizedBody;
                    if (isTrustedMode) {
                        sanitizedBody = email.body; // Trust mode: no filtering
                    } else {
                        // Use DOMPurify to sanitize HTML content and prevent XSS attacks
                        sanitizedBody = DOMPurify.sanitize(email.body, {
                            ALLOWED_TAGS: ['a', 'b', 'i', 'u', 'strong', 'em', 'p', 'br', 'div', 'span', 'img', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code'],
                            ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'style', 'class', 'width', 'height', 'align', 'border', 'cellpadding', 'cellspacing'],
                            ALLOW_DATA_ATTR: false,
                            FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
                            FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur']
                        });
                    }

                    const htmlContent = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="UTF-8">
                            <style>
                                body {
                                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                                    font-size: 15px;
                                    line-height: 1.6;
                                    color: #333;
                                    margin: 0;
                                    padding: 0;
                                    background-color: #ffffff;
                                }
                                img {
                                    max-width: 100%;
                                    height: auto;
                                }
                                a {
                                    color: #0078d4;
                                }
                            </style>
                        </head>
                        <body>${sanitizedBody}</body>
                        </html>
                    `;
                    iframe.srcdoc = htmlContent;
                }
            }
        }

        // Dynamically adjust iframe height
        function adjustIframeHeight(iframe) {
            cleanupNormalDetailIframeResizeResources();
            try {
                const adjustHeight = () => {
                    if (!iframe.isConnected) {
                        return;
                    }
                    if (iframe.contentDocument && iframe.contentDocument.body) {
                        const body = iframe.contentDocument.body;
                        const html = iframe.contentDocument.documentElement;
                        const height = Math.max(
                            body.scrollHeight,
                            body.offsetHeight,
                            html.clientHeight,
                            html.scrollHeight,
                            html.offsetHeight
                        );
                        iframe.style.height = Math.max(height + 100, 600) + 'px';
                    }
                };

                adjustHeight();
                [100, 300, 500, 1000, 2000].forEach(delay => {
                    normalDetailIframeResizeResources.timers.push(window.setTimeout(adjustHeight, delay));
                });

                if (iframe.contentDocument) {
                    normalDetailIframeResizeResources.observer = new MutationObserver(adjustHeight);
                    normalDetailIframeResizeResources.observer.observe(iframe.contentDocument.body, {
                        childList: true,
                        subtree: true,
                        attributes: true
                    });

                    const images = iframe.contentDocument.querySelectorAll('img');
                    images.forEach(img => {
                        img.addEventListener('load', adjustHeight);
                        img.addEventListener('error', adjustHeight);
                    });
                }
            } catch (e) {
                console.log('Cannot adjust iframe height:', e);
            }
        }

        // View email in full screen
        let currentFullscreenEmail = null;
        let currentRawEmailSource = '';
        let currentRawEmailFilename = 'message.eml';

        function openFullscreenEmail() {
            const emailDetail = document.getElementById('emailDetail');
            const modal = document.getElementById('fullscreenEmailModal');
            const content = document.getElementById('fullscreenEmailContent');
            const title = document.getElementById('fullscreenEmailTitle');

            // Get the title of the current email
            const subjectElement = emailDetail.querySelector('.email-detail-subject');
            if (subjectElement) {
                title.textContent = subjectElement.textContent;
            }

            // Clone email content
            const emailHeader = emailDetail.querySelector('.email-detail-header');
            const emailBody = emailDetail.querySelector('.email-detail-body');

            if (emailHeader && emailBody) {
                cleanupFullscreenIframeResizeResources();
                // Clear content
                content.innerHTML = '';

                // Clone header information
                const headerClone = emailHeader.cloneNode(true);
                content.appendChild(headerClone);

                // Process the email body
                const iframe = emailBody.querySelector('iframe');
                const textContent = emailBody.querySelector('.email-body-text');

                if (iframe) {
                    // If it is an HTML email, create a new iframe
                    const newIframe = document.createElement('iframe');
                    newIframe.id = 'fullscreenEmailBodyFrame';
                    newIframe.style.width = '100%';
                    newIframe.style.border = 'none';
                    newIframe.style.backgroundColor = '#ffffff';

                    // Copy the content of the original iframe
                    if (iframe.contentDocument) {
                        const htmlContent = iframe.contentDocument.documentElement.outerHTML;
                        newIframe.srcdoc = htmlContent;
                    }

                    content.appendChild(newIframe);

                    // Adjust iframe height
                    newIframe.onload = function () {
                        adjustFullscreenIframeHeight(newIframe);
                    };
                } else if (textContent) {
                    // If it is a plain text email, clone it directly
                    const textClone = textContent.cloneNode(true);
                    content.appendChild(textClone);
                }

                // Show modal box
                modal.classList.add('show');
                updateModalBodyState();
            }
        }

        // Switch trust mode
        function updateTrustToggleState(checkbox) {
            checkbox?.closest('.email-trust-toggle')?.classList.toggle('is-active', !!checkbox?.checked);
        }

        async function toggleTrustMode(checkbox) {
            updateTrustToggleState(checkbox);
            if (checkbox.checked) {
                if (await showConfirmModal(I18n.t("⚠️ Warning: Enabling trust mode will directly display the original content of the email without any security filtering. \n\nThis may contain malicious scripts or unsafe content. Are you sure you want to continue?"), { title: I18n.t("Enable trust mode"), confirmText: I18n.t("Confirm activation") })) {
                    isTrustedMode = true;
                    if (currentEmailDetail) {
                        renderEmailDetail(currentEmailDetail);
                    }
                } else {
                    checkbox.checked = false;
                    updateTrustToggleState(checkbox);
                }
            } else {
                isTrustedMode = false;
                if (currentEmailDetail) {
                    renderEmailDetail(currentEmailDetail);
                }
            }
        }

        function closeFullscreenEmail() {
            cleanupFullscreenIframeResizeResources();
            const modal = document.getElementById('fullscreenEmailModal');
            if (!modal) return;
            modal.classList.remove('show');
            updateModalBodyState();
        }

        async function openRawEmailModal() {
            if (!currentEmailDetail || !currentEmailDetail.id || !currentAccount) {
                showToast(I18n.t("Please select an email first"), 'warning');
                return;
            }

            const modal = document.getElementById('rawEmailModal');
            const content = document.getElementById('rawEmailContent');
            const title = document.getElementById('rawEmailTitle');
            const warning = document.getElementById('rawEmailWarning');
            if (!modal || !content) return;

            currentRawEmailSource = '';
            currentRawEmailFilename = `${currentEmailDetail.id || 'message'}.eml`;
            title.textContent = currentEmailDetail.subject ? I18n.tpl`Original email: ${currentEmailDetail.subject}` : I18n.t("Original email");
            warning.textContent = I18n.t("The original email contains complete email headers and routing information, please share with caution.");
            content.textContent = I18n.t("Loading original email source code...");
            modal.classList.add('show');
            updateModalBodyState();

            const folder = encodeURIComponent(currentEmailDetail.folder || currentFolder || 'inbox');
            const method = encodeURIComponent(getCurrentEmailRemoteActionMethod(currentEmailDetail));
            try {
                const response = await fetchWithTimeout(
                    `/api/email/${encodeURIComponent(currentAccount)}/${encodeURIComponent(currentEmailDetail.id)}/raw?method=${method}&folder=${folder}`,
                    {
                        timeoutMs: EMAIL_DETAIL_REQUEST_TIMEOUT_MS,
                        timeoutMessage: I18n.t("Timeout loading original email, please try again later.")
                    }
                );
                const data = await response.json();
                if (!data.success) {
                    handleApiError(data, I18n.t("Failed to load original email"));
                    content.textContent = data.error && data.error.message ? data.error.message : (data.error || I18n.t("Failed to load original email"));
                    return;
                }
                currentRawEmailSource = data.raw || '';
                currentRawEmailFilename = data.filename || currentRawEmailFilename;
                if (data.warning) {
                    warning.textContent = data.warning;
                }
                content.textContent = currentRawEmailSource || I18n.t("The original email is empty");
            } catch (error) {
                const errorMessage = isTimeoutAbortError(error)
                    ? I18n.t("Timeout loading original email, please try again")
                    : I18n.t("Network error, please try again");
                content.textContent = errorMessage;
                showToast(errorMessage, 'error');
            }
        }

        function closeRawEmailModal() {
            const modal = document.getElementById('rawEmailModal');
            if (!modal) return;
            modal.classList.remove('show');
            updateModalBodyState();
        }

        function closeRawEmailOnBackdrop(event) {
            if (event.target.id === 'rawEmailModal') {
                closeRawEmailModal();
            }
        }

        async function copyRawEmailSource() {
            if (!currentRawEmailSource) {
                showToast(I18n.t("There is currently no copy of the original email content."), 'warning');
                return;
            }
            try {
                await navigator.clipboard.writeText(currentRawEmailSource);
                showToast(I18n.t("Original message copied"));
            } catch (error) {
                showToast(I18n.t("Copy failed, please select copy manually"), 'error');
            }
        }

        function downloadRawEmailSource() {
            if (!currentRawEmailSource) {
                showToast(I18n.t("The original email content is currently unavailable for download."), 'warning');
                return;
            }
            const blob = new Blob([currentRawEmailSource], { type: 'message/rfc822;charset=utf-8' });
            triggerAttachmentDownload(blob, currentRawEmailFilename || 'message.eml');
            showToast(I18n.t("Original email download has started"));
        }

        function closeFullscreenEmailOnBackdrop(event) {
            // Only closes when clicking on the background, not closing when clicking on the content area
            if (event.target.id === 'fullscreenEmailModal') {
                closeFullscreenEmail();
            }
        }

        function adjustFullscreenIframeHeight(iframe) {
            cleanupFullscreenIframeResizeResources();
            try {
                const adjustHeight = () => {
                    if (!iframe.isConnected) {
                        return;
                    }
                    if (iframe.contentDocument && iframe.contentDocument.body) {
                        const body = iframe.contentDocument.body;
                        const html = iframe.contentDocument.documentElement;
                        const height = Math.max(
                            body.scrollHeight,
                            body.offsetHeight,
                            html.clientHeight,
                            html.scrollHeight,
                            html.offsetHeight
                        );
                        iframe.style.height = (height + 100) + 'px';
                    }
                };

                adjustHeight();
                [100, 300, 500, 1000].forEach(delay => {
                    fullscreenIframeResizeResources.timers.push(window.setTimeout(adjustHeight, delay));
                });

                if (iframe.contentDocument) {
                    fullscreenIframeResizeResources.observer = new MutationObserver(adjustHeight);
                    fullscreenIframeResizeResources.observer.observe(iframe.contentDocument.body, {
                        childList: true,
                        subtree: true,
                        attributes: true
                    });

                    const images = iframe.contentDocument.querySelectorAll('img');
                    images.forEach(img => {
                        img.addEventListener('load', adjustHeight);
                        img.addEventListener('error', adjustHeight);
                    });
                }
            } catch (e) {
                console.log('Cannot adjust fullscreen iframe height:', e);
            }
        }
        // Display mailing list (mobile version)
        function showEmailList({ scheduleLoadCheck = true } = {}) {
            document.getElementById('emailListPanel').classList.remove('hidden');
            isListVisible = true;
            document.getElementById('toggleListText').textContent = I18n.t("Hide list");
            closeMobilePanels();
            closeNavbarActionsMenu();
            updateMobileContext();
            if (scheduleLoadCheck) {
                scheduleEmailListLoadCheck(0);
            }
        }

        // Refresh mail
        function refreshEmails() {
            if (currentAccount) {
                if (isTempEmailGroup) {
                    if (currentMethod === 'cloudflare-admin') {
                        loadCloudflareGlobalMessages();
                    } else {
                        loadTempEmailMessages(currentAccount);
                    }
                } else {
                    // Clear the current cache and force refresh
                    invalidateEmailListCache(currentAccount, currentFolder);
                    loadEmails(currentAccount, true);
                }
            } else {
                showToast(I18n.t("Please select an email account first"), 'error');
            }
        }

        function copyTextToClipboard(text, successMessage = I18n.t("Content copied")) {
            const fallbackCopy = () => {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                showToast(successMessage, 'success');
            };

            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                return navigator.clipboard.writeText(text).then(() => {
                    showToast(successMessage, 'success');
                }).catch(() => {
                    fallbackCopy();
                });
            }

            fallbackCopy();
            return Promise.resolve();
        }

        // Copy email address
        function copyEmail(email) {
            copyTextToClipboard(email, I18n.t("Email address copied"));
        }

        // Copy current mailbox
        function copyCurrentEmail() {
            const emailElement = document.getElementById('currentAccountEmail');
            if (emailElement && emailElement.textContent) {
                const email = emailElement.textContent.replace(I18n.t(" (temporary)"), '').trim();
                copyEmail(email);
            }
        }

        // Sign out
        async function logout() {
            if (await showConfirmModal(I18n.t("Are you sure you want to log out?"), { title: I18n.t("Sign out"), confirmText: I18n.t("Confirm to exit"), danger: false })) {
                window.location.href = '/logout';
            }
        }
