(function () {
  const Storage = window.ExtensionStorage;
  const Api = window.OutlookExtensionApi;

  let currentView = 'mail';
  let busy = false;

  const mailState = {
    groups: [],
    tags: [],
    selectedGroupId: '',
    accountOffset: 0,
    accountLimit: 50,
    accounts: [],
    tempEmails: [],
    currentAccountEmail: '',
    currentEmails: [],
    currentTempEmail: '',
    currentTempMessages: [],
    cloudflareFilter: '',
    cloudflareOffset: 0,
    cloudflareHasMore: false,
    cloudflareEmails: [],
    oauthPreview: null,
  };

  const viewTitles = {
    mail: I18n.t("Mailboxes"),
    import: I18n.t("Import"),
    refresh: I18n.t("Refresh"),
    token: 'Token',
    export: I18n.t("Export"),
    tags: I18n.t("Tags"),
    settings: I18n.t("Settings"),
  };

  const normalProviders = [
    ['outlook', 'Outlook / Hotmail'],
    ['gmail', 'Gmail'],
    ['qq', 'QQ'],
    ['163', '163'],
    ['126', '126'],
    ['yahoo', 'Yahoo'],
    ['aliyun', I18n.t("Ali mailbox")],
    ['custom', I18n.t("Custom IMAP")],
  ];

  const tempProviders = [
    ['gptmail', 'GPTMail'],
    ['duckmail', 'DuckMail'],
    ['cloudflare', 'Cloudflare'],
  ];

  function getEl(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
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

  function flattenGroupTree(nodes) {
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

  function valueOf(id) {
    return (getEl(id)?.value ?? '').trim();
  }

  function checked(id) {
    return getEl(id)?.checked === true;
  }

  function toInt(value, fallback = 0) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function boolSetting(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(text);
  }

  function queryString(params) {
    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value) !== '') {
        query.set(key, String(value));
      }
    });
    return query.toString();
  }

  function pathWithQuery(path, params) {
    const query = queryString(params);
    return query ? `${path}?${query}` : path;
  }

  function encodePath(value) {
    return encodeURIComponent(String(value ?? ''));
  }

  function formatDate(value) {
    if (value === undefined || value === null || value === '') return '';
    try {
      let normalized = value;
      if (typeof value === 'number' || /^\d+$/.test(String(value))) {
        const numeric = Number(value);
        normalized = numeric < 1000000000000 ? numeric * 1000 : numeric;
      }
      const date = new Date(normalized);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString(I18n.language, { hour12: false });
    } catch {
      return String(value);
    }
  }

  function formatBytes(value) {
    const size = Number(value || 0);
    if (!Number.isFinite(size) || size <= 0) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  function providerLabel(provider) {
    const hit = [...normalProviders, ...tempProviders].find(([key]) => key === provider);
    if (hit) return hit[1];
    return provider || '';
  }

  function renderOptions(options, selectedValue) {
    return options.map(([value, label]) => {
      const selected = String(value) === String(selectedValue) ? ' selected' : '';
      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
    }).join('');
  }

  function renderTagPills(tags) {
    if (!Array.isArray(tags) || !tags.length) return '';
    return `<div class="tag-line">${tags.map((tag) => `
      <span class="tag-pill" style="--tag-color:${escapeHtml(tag.color || '#64748b')}">${escapeHtml(tag.name || '')}</span>
    `).join('')}</div>`;
  }

  function renderResult(payload) {
    return `<div class="card result-box">${escapeHtml(JSON.stringify(payload, null, 2))}</div>`;
  }

  function readConfig() {
    return {
      serverUrl: Api.trimUrl(getEl('serverUrl').value),
      password: getEl('password').value,
      rememberPassword: getEl('rememberPassword').checked,
    };
  }

  async function saveConfig() {
    const config = readConfig();
    await Storage.setConfig(config);
    return config;
  }

  function showMessage(message, type) {
    const el = getEl('message');
    el.textContent = message || '';
    el.classList.toggle('error', type === 'error');
  }

  function setBusy(isBusy) {
    busy = isBusy;
    getEl('btnLogin').disabled = isBusy;
    getEl('btnReload').disabled = isBusy;
    getEl('btnConfig').disabled = isBusy;
    document.querySelectorAll('.quick-bar button').forEach((button) => {
      button.disabled = isBusy;
    });
  }

  function setContent(html) {
    getEl('viewContent').innerHTML = html;
  }

  function setActiveView(view) {
    currentView = view;
    getEl('viewTitle').textContent = viewTitles[view] || view;
    document.querySelectorAll('.quick-bar button').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === view);
    });
  }

  async function withSession(task, loadingText = I18n.t("Logging in...")) {
    setBusy(true);
    getEl('panelStatus').textContent = loadingText;
    showMessage(loadingText);
    try {
      const config = await saveConfig();
      await Api.ensureSession(config);
      getEl('configPanel').classList.add('collapsed');
      getEl('panelStatus').textContent = config.serverUrl;
      showMessage('');
      return await task(config);
    } catch (error) {
      getEl('panelStatus').textContent = I18n.t("Operation failed");
      showMessage(Api.friendlyError(error), 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function runAction(config, task, loadingText = I18n.t("Processing...")) {
    setBusy(true);
    getEl('panelStatus').textContent = loadingText;
    showMessage(loadingText);
    try {
      await Api.ensureSession(config);
      const result = await task();
      getEl('panelStatus').textContent = config.serverUrl;
      showMessage('');
      return result;
    } catch (error) {
      getEl('panelStatus').textContent = I18n.t("Operation failed");
      showMessage(Api.friendlyError(error), 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(String(text || ''));
      showMessage(I18n.t("Copied"));
    } catch {
      showMessage(I18n.t("Copy failed"), 'error');
    }
  }

  async function loadGroups(config) {
    const payload = await Api.apiRequest(config, '/api/groups');
    mailState.groups = Array.isArray(payload.groups) ? payload.groups : [];
    return mailState.groups;
  }

  async function loadTags(config) {
    const payload = await Api.apiRequest(config, '/api/tags');
    mailState.tags = Array.isArray(payload.tags) ? payload.tags : [];
    return mailState.tags;
  }

  function groupOptions(groups, selectedId, includeTemp = true) {
    const isSystem = (g) => !!(g && (g.is_system === 1 || g.name === "\u4e34\u65f6\u90ae\u7bb1"));
    const isLastChild = (g) => {
      const pid = g.parent_id ? Number(g.parent_id) : null;
      const siblings = (groups || [])
        .filter((item) => !isSystem(item) && Number(item.id) !== 1 && (item.parent_id ? Number(item.parent_id) : null) === pid)
        .sort((left, right) => {
          const lo = Number(left.sort_order || 0);
          const ro = Number(right.sort_order || 0);
          return lo !== ro ? lo - ro : Number(left.id) - Number(right.id);
        });
      if (!siblings.length) return true;
      return Number(siblings[siblings.length - 1].id) === Number(g.id);
    };
    const getGroupById = (id) => (groups || []).find((g) => Number(g.id) === Number(id)) || null;

    const sortedGroups = flattenGroupTree(buildGroupTree(groups || []));

    return sortedGroups
      .filter((group) => includeTemp || !isTempEmailGroup(group))
      .map((group) => {
        const selected = String(group.id) === String(selectedId) ? ' selected' : '';
        const count = group.descendant_account_count ?? group.account_count ?? 0;
        
        let label = '';
        if (isSystem(group) || Number(group.id) === 1) {
          label = `${I18n.groupName(group)} (${count})`;
        } else {
          const level = Number(group.level || 1);
          if (level === 1) {
            label = `${I18n.groupName(group)} (${count})`;
          } else {
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
            label = `${prefix}${I18n.groupName(group)} (${count})`;
          }
        }
        return `<option value="${escapeHtml(group.id)}"${selected}>${escapeHtml(label)}</option>`;
      }).join('');
  }

  function tagCheckboxes(tags, selectedIds = [], name = 'tagIds') {
    const selected = new Set((selectedIds || []).map((item) => String(item)));
    if (!Array.isArray(tags) || !tags.length) {
      return I18n.t("<div class=\"item-meta\">No label yet.</div>");
    }
    return tags.map((tag) => `
      <label class="check-row inline-check">
        <input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(tag.id)}" ${selected.has(String(tag.id)) ? 'checked' : ''}>
        <span><span class="tag-dot" style="--tag-color:${escapeHtml(tag.color || '#64748b')}"></span>${escapeHtml(tag.name)}</span>
      </label>
    `).join('');
  }

  async function renderView(view = currentView) {
    setActiveView(view);
    if (view === 'mail') return renderMailView();
    if (view === 'import') return renderImportView();
    if (view === 'refresh') return renderRefreshView();
    if (view === 'token') return renderTokenView();
    if (view === 'export') return renderExportView();
    if (view === 'tags') return renderTagsView();
    if (view === 'settings') return renderSettingsView();
    return null;
  }

  function getSelectedMailGroup(groups = mailState.groups) {
    const groupId = getEl('mailGroupSelect')?.value || mailState.selectedGroupId || '';
    return (groups || []).find((group) => String(group.id) === String(groupId)) || null;
  }

  function isTempEmailGroup(group) {
    return String(group?.name || '').trim() === "\u4e34\u65f6\u90ae\u7bb1";
  }

  function revealMailPanel() {
    getEl('mailEmails')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function revealAccountsPanel() {
    getEl('mailAccounts')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function closeMailActionPanel() {
    const target = getEl('mailEmails');
    if (target) {
      target.innerHTML = I18n.t("<div class=\"card muted\">After selecting the mailbox, the mail will be displayed here.</div>");
    }
    revealAccountsPanel();
  }

  async function renderMailView() {
    setContent(I18n.t("<div class=\"card muted\">Loading groups...</div>"));
    await withSession(async (config) => {
      const groups = await loadGroups(config);
      const storedGroupId = await Storage.getSelectedMailGroupId();
      const preferredGroupId = mailState.selectedGroupId || storedGroupId;
      if (preferredGroupId && groups.some((group) => String(group.id) === String(preferredGroupId))) {
        mailState.selectedGroupId = String(preferredGroupId);
      } else {
        mailState.selectedGroupId = String(groups[0]?.id || '');
        await Storage.setSelectedMailGroupId(mailState.selectedGroupId);
      }
      setContent(I18n.tpl`
        <div class="card">
          <label><span>Groups</span><select id="mailGroupSelect">${groupOptions(groups, mailState.selectedGroupId)}</select></label>
          <label><span>Search</span><input id="accountSearch" placeholder="Email, notes, labels or aliases"></label>
          <div class="toolbar wrap">
            <button id="btnAccountSearch" class="secondary-btn" type="button">Search</button>
            <button id="btnNewGroup" class="secondary-btn" type="button">Add new group</button>
            <button id="btnEditGroup" class="secondary-btn" type="button">Edit group</button>
            <button id="btnDeleteGroup" class="danger-btn" type="button">Delete group</button>
            <button id="btnGroupUp" class="small-btn" type="button">Move up</button>
            <button id="btnGroupDown" class="small-btn" type="button">Move down</button>
          </div>
        </div>
        <div id="mailEmails" class="mail-result-panel">
          <div class="card muted">After selecting the mailbox, the mail will be displayed here.</div>
        </div>
        <div id="mailAccounts" class="list"></div>
      `);
      getEl('mailGroupSelect').addEventListener('change', async () => {
        mailState.selectedGroupId = getEl('mailGroupSelect').value;
        mailState.accountOffset = 0;
        await Storage.setSelectedMailGroupId(mailState.selectedGroupId);
        runAction(config, () => loadMailAccounts(config, groups), I18n.t("Loading account..."));
      });
      getEl('btnAccountSearch').addEventListener('click', () => {
        mailState.accountOffset = 0;
        runAction(config, () => loadMailAccounts(config, groups), I18n.t("Searching for account..."));
      });
      getEl('accountSearch').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          mailState.accountOffset = 0;
          runAction(config, () => loadMailAccounts(config, groups), I18n.t("Searching for account..."));
        }
      });
      getEl('btnNewGroup').addEventListener('click', () => showGroupEditor(config));
      getEl('btnEditGroup').addEventListener('click', () => showGroupEditor(config, getSelectedMailGroup(groups)));
      getEl('btnDeleteGroup').addEventListener('click', () => deleteSelectedGroup(config));
      getEl('btnGroupUp').addEventListener('click', () => moveSelectedGroup(config, -1));
      getEl('btnGroupDown').addEventListener('click', () => moveSelectedGroup(config, 1));
      await loadMailAccounts(config, groups);
    }, I18n.t("Loading email..."));
  }

  async function showGroupEditor(config, group = null) {
    const target = getEl('mailEmails');
    if (group && isTempEmailGroup(group)) {
      target.innerHTML = I18n.t("<div class=\"card muted\">The temporary mailbox is a system group and cannot be edited.</div>");
      return;
    }
    const isEdit = !!group;
    target.innerHTML = I18n.tpl`
      <div class="card">
        <div class="item-title">${isEdit ? I18n.t("Edit group") : I18n.t("Add new group")}</div>
        <label><span>Name</span><input id="groupName" value="${escapeHtml(group?.name || '')}"></label>
        <label><span>Description</span><textarea id="groupDescription">${escapeHtml(group?.description || '')}</textarea></label>
        <div class="row">
          <label><span>Color</span><input id="groupColor" type="color" value="${escapeHtml(group?.color || '#1a1a1a')}"></label>
          <label><span>Sort position</span><input id="groupSortPosition" type="number" min="1" value="${escapeHtml(group?.sort_position || '')}"></label>
        </div>
        <label><span>Proxy address</span><input id="groupProxyUrl" value="${escapeHtml(group?.proxy_url || '')}"></label>
        <label><span>Alternate proxy 1</span><input id="groupFallbackProxy1" value="${escapeHtml(group?.fallback_proxy_url_1 || '')}"></label>
        <label><span>Alternate proxy 2</span><input id="groupFallbackProxy2" value="${escapeHtml(group?.fallback_proxy_url_2 || '')}"></label>
        <div class="toolbar">
          <button id="btnSaveGroup" class="primary-btn" type="button">Save group</button>
          <button id="btnCancelGroup" class="secondary-btn" type="button">Cancel</button>
        </div>
      </div>
      <div id="groupEditorResult"></div>
    `;
    revealMailPanel();
    getEl('btnCancelGroup').addEventListener('click', closeMailActionPanel);
    getEl('btnSaveGroup').addEventListener('click', () => runAction(config, async () => {
      const body = {
        name: valueOf('groupName'),
        description: valueOf('groupDescription'),
        color: valueOf('groupColor') || '#1a1a1a',
        proxy_url: valueOf('groupProxyUrl'),
        fallback_proxy_url_1: valueOf('groupFallbackProxy1'),
        fallback_proxy_url_2: valueOf('groupFallbackProxy2'),
        sort_position: valueOf('groupSortPosition'),
      };
      const payload = await Api.apiRequest(config, isEdit ? `/api/groups/${group.id}` : '/api/groups', {
        method: isEdit ? 'PUT' : 'POST',
        body,
      });
      getEl('groupEditorResult').innerHTML = renderResult(payload);
      await loadGroups(config);
      renderMailView();
    }, I18n.t("Saving group...")));
  }

  async function deleteSelectedGroup(config) {
    const group = getSelectedMailGroup();
    if (!group) return;
    if (isTempEmailGroup(group)) {
      getEl('mailEmails').innerHTML = I18n.t("<div class=\"card muted\">The temporary mailbox is a system group and cannot be deleted.</div>");
      return;
    }
    if (!window.confirm(I18n.tpl`Are you sure to delete the group "${group.name}"? The account will be moved to the default group.`)) return;
    await runAction(config, async () => {
      await Api.apiRequest(config, `/api/groups/${group.id}`, { method: 'DELETE' });
      mailState.selectedGroupId = '';
      renderMailView();
    }, I18n.t("Deleting group..."));
  }

  async function moveSelectedGroup(config, delta) {
    const group = getSelectedMailGroup();
    if (!group || isTempEmailGroup(group)) return;
    const movable = mailState.groups.filter((item) => !isTempEmailGroup(item));
    const index = movable.findIndex((item) => String(item.id) === String(group.id));
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= movable.length) return;
    const ids = movable.map((item) => item.id);
    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
    await runAction(config, async () => {
      await Api.apiRequest(config, '/api/groups/reorder', {
        method: 'PUT',
        body: { group_ids: ids.map((item) => Number(item)) },
      });
      await renderMailView();
    }, I18n.t("Adjusting grouping..."));
  }

  async function loadMailAccounts(config, groups) {
    const selectedGroup = getSelectedMailGroup(groups);
    const target = getEl('mailAccounts');
    const emailTarget = getEl('mailEmails');
    if (emailTarget) {
      emailTarget.innerHTML = I18n.t("<div class=\"card muted\">After selecting the mailbox, the mail will be displayed here.</div>");
    }
    target.innerHTML = I18n.t("<div class=\"card muted\">Loading account...</div>");

    if (isTempEmailGroup(selectedGroup)) {
      await loadTempEmailAccounts(config, target);
      return;
    }

    const q = valueOf('accountSearch');
    const endpoint = q
      ? pathWithQuery('/api/accounts/search', {
        q,
        group_id: selectedGroup?.id || '',
        limit: mailState.accountLimit,
        offset: mailState.accountOffset,
      })
      : pathWithQuery('/api/accounts', {
        group_id: selectedGroup?.id || '',
        limit: mailState.accountLimit,
        offset: mailState.accountOffset,
      });
    const payload = await Api.apiRequest(config, endpoint);
    const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
    mailState.accounts = accounts;
    if (!accounts.length) {
      target.innerHTML = I18n.t("<div class=\"card muted\">There is currently no account for this group.</div>");
      return;
    }
    const pager = I18n.tpl`
      <div class="toolbar wrap">
        <button id="btnPrevAccounts" class="small-btn" type="button" ${mailState.accountOffset <= 0 ? 'disabled' : ''}>Previous page</button>
        <button id="btnNextAccounts" class="small-btn" type="button" ${payload.has_more ? '' : 'disabled'}>Next page</button>
        <span class="item-meta">Total ${escapeHtml(payload.total ?? accounts.length)}, currently ${escapeHtml(mailState.accountOffset + 1)}-${escapeHtml(mailState.accountOffset + accounts.length)}</span>
      </div>
    `;
    target.innerHTML = `${pager}${accounts.map((account, index) => {
      const forwardLabel = account.forward_enabled ? I18n.t("Turn off forwarding") : I18n.t("Enable forwarding");
      const aliases = Array.isArray(account.aliases) && account.aliases.length ? I18n.tpl` · Alias ${account.aliases.length}` : '';
      const refreshStatus = account.last_refresh_status ? ` · Token ${account.last_refresh_status}` : '';
      const remark = account.remark ? ` · ${account.remark}` : '';
      return I18n.tpl`
        <div class="item" data-account-index="${escapeHtml(index)}">
          <div class="item-title">${escapeHtml(account.email)}</div>
          <div class="item-meta">ID ${escapeHtml(account.id)} · ${escapeHtml(providerLabel(account.provider || account.account_type))} · ${escapeHtml(account.status || '')}${escapeHtml(aliases)}${escapeHtml(refreshStatus)}${escapeHtml(remark)}</div>
          ${renderTagPills(account.tags)}
          <div class="item-actions account-actions">
            <button class="small-btn" type="button" data-action="view-mails" data-email="${escapeHtml(account.email)}">Messages</button>
            <select class="account-action-select" data-account-menu data-account-id="${escapeHtml(account.id)}" data-email="${escapeHtml(account.email)}" data-label="${escapeHtml(account.email)}" data-forward="${account.forward_enabled ? '1' : '0'}" aria-label="${escapeHtml(account.email)} More operations">
              <option value="">More actions</option>
              <option value="edit-account">Edit</option>
              <option value="tag-account">Tags</option>
              <option value="toggle-forward">${escapeHtml(forwardLabel)}</option>
              <option value="refresh-account">Refresh Token</option>
              <option value="copy">Copy</option>
              <option value="delete-account">Delete</option>
            </select>
          </div>
        </div>
      `;
    }).join('')}`;
    getEl('btnPrevAccounts')?.addEventListener('click', () => {
      mailState.accountOffset = Math.max(0, mailState.accountOffset - mailState.accountLimit);
      runAction(config, () => loadMailAccounts(config, groups), I18n.t("Loading previous page..."));
    });
    getEl('btnNextAccounts')?.addEventListener('click', () => {
      mailState.accountOffset += mailState.accountLimit;
      runAction(config, () => loadMailAccounts(config, groups), I18n.t("Loading next page..."));
    });
    target.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', () => handleAccountAction(config, button));
    });
    target.querySelectorAll('[data-account-menu]').forEach((select) => {
      select.addEventListener('change', () => handleAccountMenuChange(config, select));
    });
  }

  async function handleAccountMenuChange(config, select) {
    const selectedAction = select?.value || '';
    select.value = '';
    if (!selectedAction) {
      showMessage('');
      return null;
    }
    return handleAccountAction(config, {
      dataset: {
        action: selectedAction,
        accountId: select.dataset.accountId,
        email: select.dataset.email,
        label: select.dataset.label,
        forward: select.dataset.forward,
        copy: select.dataset.email,
      },
    });
  }

  async function handleAccountAction(config, button) {
    const action = button.dataset.action;
    if (action === 'copy') return copyText(button.dataset.copy || '');
    if (action === 'view-mails') {
      return runAction(config, () => loadAccountEmails(config, button.dataset.email), I18n.t("Loading emails..."));
    }
    if (action === 'edit-account') return showAccountEditor(config, button.dataset.accountId);
    if (action === 'tag-account') return showTagAssignment(config, 'account', button.dataset.accountId, button.dataset.label || '');
    if (action === 'toggle-forward') {
      const enable = button.dataset.forward !== '1';
      return runAction(config, async () => {
        await Api.apiRequest(config, '/api/accounts/batch-update-forwarding', {
          method: 'POST',
          body: { account_ids: [Number(button.dataset.accountId)], forward_enabled: enable },
        });
        await loadMailAccounts(config, mailState.groups);
      }, I18n.t("Updating forwarding status..."));
    }
    if (action === 'refresh-account') {
      return runAction(config, async () => {
        const payload = await Api.apiRequest(config, `/api/accounts/${button.dataset.accountId}/refresh`, {
          method: 'POST',
          timeoutMs: 70000,
        });
        getEl('mailEmails').innerHTML = renderResult(payload);
        revealMailPanel();
        await loadMailAccounts(config, mailState.groups);
      }, I18n.t("Refreshing Token..."));
    }
    if (action === 'delete-account') {
      if (!window.confirm(I18n.tpl`Are you sure to delete account ${button.dataset.label || ''}?`)) return null;
      return runAction(config, async () => {
        await Api.apiRequest(config, `/api/accounts/${button.dataset.accountId}`, { method: 'DELETE' });
        await loadMailAccounts(config, mailState.groups);
      }, I18n.t("Deleting account..."));
    }
    return null;
  }

  async function showAccountEditor(config, accountId) {
    await runAction(config, async () => {
      const [accountPayload, groups] = await Promise.all([
        Api.apiRequest(config, `/api/accounts/${accountId}`),
        loadGroups(config),
      ]);
      const account = accountPayload.account || {};
      const provider = account.provider || account.account_type || 'outlook';
      const aliases = Array.isArray(account.aliases) ? account.aliases.join('\n') : '';
      getEl('mailEmails').innerHTML = I18n.tpl`
        <div class="card">
          <div class="item-title">Edit account</div>
          <label><span>Mailboxes</span><input id="editEmail" value="${escapeHtml(account.email || '')}"></label>
          <label><span>Account password</span><input id="editPassword" value="${escapeHtml(account.password || '')}" placeholder="Optional"></label>
          <div class="row">
            <label><span>Type</span><select id="editProvider">${renderOptions(normalProviders, provider)}</select></label>
            <label><span>Groups</span><select id="editGroup">${groupOptions(groups, account.group_id, false)}</select></label>
          </div>
          <label><span>Client ID</span><input id="editClientId" value="${escapeHtml(account.client_id || '')}"></label>
          <label><span>Refresh Token</span><textarea id="editRefreshToken">${escapeHtml(account.refresh_token || '')}</textarea></label>
          <div id="editImapFields">
            <div class="row">
              <label><span>IMAP host</span><input id="editImapHost" value="${escapeHtml(account.imap_host || '')}"></label>
              <label><span>IMAP port</span><input id="editImapPort" type="number" value="${escapeHtml(account.imap_port || 993)}"></label>
            </div>
            <label><span>IMAP password</span><input id="editImapPassword" value="${escapeHtml(account.imap_password || '')}" placeholder="Optional"></label>
          </div>
          <div class="row">
            <label><span>Status</span><select id="editStatus">${renderOptions([['active', 'active'], ['inactive', 'inactive']], account.status || 'active')}</select></label>
            <label><span>Sorting value</span><input id="editSortOrder" type="number" value="${escapeHtml(account.sort_order ?? '')}"></label>
          </div>
          <label><span>Notes</span><input id="editRemark" value="${escapeHtml(account.remark || '')}"></label>
          <label><span>Alias</span><textarea id="editAliases" placeholder="One alias per line">${escapeHtml(aliases)}</textarea></label>
          <label class="check-row"><input id="editForwardEnabled" type="checkbox" ${account.forward_enabled ? 'checked' : ''}><span>Enable forwarding</span></label>
          <div class="toolbar wrap">
            <button id="btnSaveAccount" class="primary-btn" type="button">Save account</button>
            <button id="btnOnlyStatusActive" class="secondary-btn" type="button">Set to active</button>
            <button id="btnOnlyStatusInactive" class="secondary-btn" type="button">Set to inactive</button>
            <button id="btnCancelAccountEditor" class="secondary-btn" type="button">Cancel</button>
          </div>
        </div>
        <div id="accountEditorResult"></div>
      `;
      revealMailPanel();
      function updateImapVisibility() {
        const selectedProvider = valueOf('editProvider');
        getEl('editImapFields').classList.toggle('hidden', selectedProvider === 'outlook');
      }
      getEl('editProvider').addEventListener('change', updateImapVisibility);
      updateImapVisibility();
      getEl('btnSaveAccount').addEventListener('click', () => runAction(config, async () => {
        const selectedProvider = valueOf('editProvider');
        const isOutlook = selectedProvider === 'outlook';
        const passwordValue = valueOf('editPassword');
        const imapPasswordValue = valueOf('editImapPassword');
        const body = {
          email: valueOf('editEmail'),
          client_id: valueOf('editClientId'),
          refresh_token: valueOf('editRefreshToken'),
          account_type: isOutlook ? 'outlook' : 'imap',
          provider: selectedProvider,
          imap_host: valueOf('editImapHost'),
          imap_port: toInt(valueOf('editImapPort'), 993),
          group_id: Number(valueOf('editGroup')),
          sort_order: valueOf('editSortOrder'),
          remark: valueOf('editRemark'),
          status: valueOf('editStatus') || 'active',
          forward_enabled: checked('editForwardEnabled'),
          aliases: valueOf('editAliases').split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean),
        };
        if (passwordValue || !account.has_password) {
          body.password = passwordValue;
        }
        if (imapPasswordValue || !account.has_imap_password) {
          body.imap_password = imapPasswordValue;
        }
        const payload = await Api.apiRequest(config, `/api/accounts/${accountId}`, {
          method: 'PUT',
          body,
        });
        getEl('accountEditorResult').innerHTML = renderResult(payload);
        await loadMailAccounts(config, mailState.groups);
      }, I18n.t("Saving account...")));
      getEl('btnOnlyStatusActive').addEventListener('click', () => updateAccountStatus(config, accountId, 'active'));
      getEl('btnOnlyStatusInactive').addEventListener('click', () => updateAccountStatus(config, accountId, 'inactive'));
      getEl('btnCancelAccountEditor').addEventListener('click', closeMailActionPanel);
    }, I18n.t("Loading account details..."));
  }

  async function updateAccountStatus(config, accountId, status) {
    await runAction(config, async () => {
      const payload = await Api.apiRequest(config, `/api/accounts/${accountId}`, {
        method: 'PUT',
        body: { status },
      });
      getEl('accountEditorResult').innerHTML = renderResult(payload);
      await loadMailAccounts(config, mailState.groups);
    }, I18n.t("Updating status..."));
  }

  async function showTagAssignment(config, type, id, label) {
    await runAction(config, async () => {
      const tags = await loadTags(config);
      const endpoint = type === 'temp' ? '/api/temp-emails/tags' : '/api/accounts/tags';
      const idKey = type === 'temp' ? 'temp_email_ids' : 'account_ids';
      getEl('mailEmails').innerHTML = I18n.tpl`
        <div class="card">
          <div class="item-title">Tag: ${escapeHtml(label)}</div>
          <label><span>Tags</span><select id="assignTagId">${tags.map((tag) => `<option value="${escapeHtml(tag.id)}">${escapeHtml(tag.name)}</option>`).join('')}</select></label>
          <div class="toolbar wrap">
            <button id="btnAddAssignedTag" class="primary-btn" type="button">Add tag</button>
            <button id="btnRemoveAssignedTag" class="secondary-btn" type="button">Remove tag</button>
            <button id="btnCancelTagAssignment" class="secondary-btn" type="button">Cancel</button>
          </div>
        </div>
        <div id="tagAssignResult"></div>
      `;
      revealMailPanel();
      async function submit(action) {
        await runAction(config, async () => {
          const payload = await Api.apiRequest(config, endpoint, {
            method: 'POST',
            body: { [idKey]: [Number(id)], tag_id: Number(valueOf('assignTagId')), action },
          });
          getEl('tagAssignResult').innerHTML = renderResult(payload);
          await loadMailAccounts(config, mailState.groups);
        }, I18n.t("Updating tags..."));
      }
      getEl('btnAddAssignedTag').addEventListener('click', () => submit('add'));
      getEl('btnRemoveAssignedTag').addEventListener('click', () => submit('remove'));
      getEl('btnCancelTagAssignment').addEventListener('click', closeMailActionPanel);
    }, I18n.t("Loading tags..."));
  }

  async function loadTempEmailAccounts(config, target) {
    target.innerHTML = I18n.t("<div class=\"card muted\">Loading temporary mailbox...</div>");
    const payload = await Api.apiRequest(config, '/api/temp-emails');
    const emails = Array.isArray(payload.emails) ? payload.emails : [];
    mailState.tempEmails = emails;
    const filter = getEl('tempProviderFilter')?.value || 'all';
    const search = (getEl('tempEmailSearch')?.value || '').trim().toLowerCase();
    const filtered = emails.filter((item) => {
      const providerOk = filter === 'all' || item.provider === filter;
      const haystack = [
        item.email,
        item.provider,
        ...(Array.isArray(item.tags) ? item.tags.map((tag) => tag.name) : []),
      ].join('\n').toLowerCase();
      return providerOk && (!search || haystack.includes(search));
    });
    const showCloudflareGlobal = (filter === 'all' || filter === 'cloudflare')
      && (!search || I18n.t("cloudflare all emails").includes(search) || 'cloudflare all messages'.includes(search));

    target.innerHTML = I18n.tpl`
      <div class="card">
        <div class="row">
          <label><span>Channel</span><select id="tempProviderFilter">${renderOptions([['all', I18n.t("All")], ...tempProviders], filter)}</select></label>
          <label><span>Search</span><input id="tempEmailSearch" value="${escapeHtml(search)}" placeholder="Temporary mailbox or label"></label>
        </div>
        <div class="toolbar wrap">
          <button id="btnFilterTempEmails" class="secondary-btn" type="button">Filter</button>
          <button id="btnGoTempImport" class="secondary-btn" type="button">Import/Generate</button>
        </div>
      </div>
      ${showCloudflareGlobal ? I18n.tpl`
        <div class="item cloudflare-entry">
          <div class="item-title">Cloudflare All Mail</div>
          <div class="item-meta">View all emails in the current Worker and filter them by recipient address.</div>
          <div class="item-actions">
            <button class="small-btn" type="button" data-temp-action="cloudflare-global">View all</button>
          </div>
        </div>
      ` : ''}
      ${filtered.length ? filtered.map((item) => {
        const provider = providerLabel(item.provider || 'gptmail');
        return I18n.tpl`
          <div class="item">
            <div class="item-title">${escapeHtml(item.email)}</div>
            <div class="item-meta">ID ${escapeHtml(item.id)} · ${escapeHtml(provider)} · Temporary email</div>
            ${renderTagPills(item.tags)}
            <div class="item-actions wrap">
              <button class="small-btn" type="button" data-temp-action="view" data-id="${escapeHtml(item.id)}" data-email="${escapeHtml(item.email)}">Messages</button>
              <button class="small-btn" type="button" data-temp-action="refresh" data-email="${escapeHtml(item.email)}">Refresh</button>
              <button class="small-btn" type="button" data-temp-action="tag" data-id="${escapeHtml(item.id)}" data-email="${escapeHtml(item.email)}">Tags</button>
              <button class="small-btn" type="button" data-temp-action="copy" data-copy="${escapeHtml(item.email)}">Copy</button>
              <button class="danger-btn" type="button" data-temp-action="delete" data-id="${escapeHtml(item.id)}" data-email="${escapeHtml(item.email)}">Delete</button>
            </div>
          </div>
        `;
      }).join('') : (!showCloudflareGlobal ? I18n.t("<div class=\"card muted\">There is no temporary email address yet.</div>") : '')}
    `;
    getEl('tempProviderFilter').addEventListener('change', () => {
      runAction(config, () => loadTempEmailAccounts(config, target), I18n.t("Filtering temporary mailbox..."));
    });
    getEl('btnFilterTempEmails').addEventListener('click', () => {
      runAction(config, () => loadTempEmailAccounts(config, target), I18n.t("Filtering temporary mailbox..."));
    });
    getEl('tempEmailSearch').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        runAction(config, () => loadTempEmailAccounts(config, target), I18n.t("Searching for temporary mailbox..."));
      }
    });
    getEl('btnGoTempImport').addEventListener('click', () => renderView('import'));
    target.querySelectorAll('[data-temp-action]').forEach((button) => {
      button.addEventListener('click', () => handleTempEmailAction(config, button));
    });
  }

  async function handleTempEmailAction(config, button) {
    const action = button.dataset.tempAction;
    if (action === 'copy') return copyText(button.dataset.copy || '');
    if (action === 'cloudflare-global') {
      return runAction(config, () => loadCloudflareGlobalMessages(config, false), I18n.t("Loading Cloudflare All Mail..."));
    }
    if (action === 'view') {
      return runAction(config, () => loadTempEmailMessages(config, button.dataset.email), I18n.t("Loading temporary mailbox messages..."));
    }
    if (action === 'refresh') {
      return runAction(config, async () => {
        const payload = await Api.apiRequest(config, `/api/temp-emails/${encodePath(button.dataset.email)}/refresh`, {
          method: 'POST',
          timeoutMs: 70000,
        });
        getEl('mailEmails').innerHTML = renderResult(payload);
        revealMailPanel();
      }, I18n.t("Refreshing temporary mailbox..."));
    }
    if (action === 'tag') return showTagAssignment(config, 'temp', button.dataset.id, button.dataset.email || '');
    if (action === 'delete') {
      if (!window.confirm(I18n.tpl`Are you sure you want to delete the temporary mailbox ${button.dataset.email || ''}?`)) return null;
      return runAction(config, async () => {
        await Api.apiRequest(config, `/api/temp-emails/${encodePath(button.dataset.email)}`, { method: 'DELETE' });
        await loadTempEmailAccounts(config, getEl('mailAccounts'));
      }, I18n.t("Deleting temporary mailbox..."));
    }
    return null;
  }

  async function loadAccountEmails(config, email) {
    mailState.currentAccountEmail = email;
    const target = getEl('mailEmails');
    const folder = getEl('mailFolder')?.value || 'all';
    const keyword = valueOf('mailKeyword');
    const subject = valueOf('mailSubject');
    const from = valueOf('mailFrom');
    target.innerHTML = I18n.tpl`<div class="card muted">Loading ${escapeHtml(email)}'s emails...</div>`;
    revealMailPanel();
    const payload = await Api.apiRequest(config, pathWithQuery(`/api/emails/${encodePath(email)}`, {
      folder,
      top: 30,
      skip: 0,
      keyword,
      subject_contains: subject,
      from_contains: from,
    }), { timeoutMs: 70000 });
    const emails = Array.isArray(payload.emails) ? payload.emails : [];
    mailState.currentEmails = emails;
    target.innerHTML = I18n.tpl`
      <div class="card">
        <div class="item-title">${escapeHtml(email)}</div>
        <div class="item-meta">${escapeHtml(payload.method || '')} · Recent ${emails.length} emails${payload.matched_alias ? I18n.tpl` · Hit alias ${escapeHtml(payload.matched_alias)}` : ''}</div>
        <div class="row">
          <label><span>Folder</span><select id="mailFolder">${renderOptions([
        ['all', I18n.t("All")],
        ['inbox', I18n.t("Inbox")],
        ['junkemail', I18n.t("Junk mail")],
        ['deleteditems', I18n.t("Deleted")],
      ], folder)}</select></label>
          <label><span>Keywords</span><input id="mailKeyword" value="${escapeHtml(keyword)}"></label>
        </div>
        <div class="row">
          <label><span>Topics include</span><input id="mailSubject" value="${escapeHtml(subject)}"></label>
          <label><span>Sender contains</span><input id="mailFrom" value="${escapeHtml(from)}"></label>
        </div>
        <div class="toolbar">
          <button id="btnReloadMails" class="secondary-btn" type="button">Refresh mail</button>
          <button id="btnBackToAccounts" class="secondary-btn" type="button">Return to account list</button>
        </div>
      </div>
      <div class="list">
        ${emails.length ? emails.map((item, index) => I18n.tpl`
          <div class="item ${item.is_read === false ? 'unread' : ''}">
            <div class="item-title">${escapeHtml(item.subject || I18n.t("No topic"))}</div>
            <div class="item-meta">${escapeHtml(item.from || '')} · ${escapeHtml(formatDate(item.date))} · ${escapeHtml(item.folder || folder)}${item.has_attachments ? I18n.t(" · With attachments") : ''}</div>
            <div class="item-meta">${escapeHtml(item.body_preview || '')}</div>
            <div class="item-actions wrap">
              <button class="small-btn" type="button" data-mail-action="detail" data-index="${escapeHtml(index)}">Details</button>
              <button class="small-btn" type="button" data-mail-action="mark-read" data-index="${escapeHtml(index)}">Read</button>
              <button class="danger-btn" type="button" data-mail-action="delete" data-index="${escapeHtml(index)}">Delete</button>
            </div>
          </div>
        `).join('') : I18n.t("<div class=\"card muted\">No mail.</div>")}
      </div>
      <div id="mailDetail"></div>
    `;
    getEl('btnReloadMails').addEventListener('click', () => {
      runAction(config, () => loadAccountEmails(config, email), I18n.t("Refreshing mail..."));
    });
    getEl('btnBackToAccounts').addEventListener('click', revealAccountsPanel);
    target.querySelectorAll('[data-mail-action]').forEach((button) => {
      button.addEventListener('click', () => handleMailAction(config, button));
    });
  }

  function getMailActionItem(button) {
    const index = toInt(button.dataset.index, -1);
    return mailState.currentEmails[index] || null;
  }

  function getMailItemMethod(item) {
    const idMode = String(item?.id_mode || '').toLowerCase();
    if (idMode && idMode !== 'graph') return 'imap';
    return item?.method || 'graph';
  }

  async function handleMailAction(config, button) {
    const item = getMailActionItem(button);
    if (!item) return null;
    const action = button.dataset.mailAction;
    const email = mailState.currentAccountEmail;
    const folder = item.folder || getEl('mailFolder')?.value || 'inbox';
    if (action === 'detail') {
      return runAction(config, async () => {
        const payload = await Api.apiRequest(config, pathWithQuery(`/api/email/${encodePath(email)}/${encodePath(item.id)}`, {
          folder,
          method: getMailItemMethod(item),
        }), { timeoutMs: 70000 });
        renderEmailDetail(config, 'mailDetail', {
          type: 'normal',
          email,
          item,
          folder,
          method: getMailItemMethod(item),
        }, payload.email || {});
      }, I18n.t("Loading email details..."));
    }
    if (action === 'mark-read') {
      return markNormalMailRead(config, email, item, folder);
    }
    if (action === 'delete') {
      return deleteNormalMail(config, email, item, folder);
    }
    return null;
  }

  async function markNormalMailRead(config, email, item, folder) {
    await runAction(config, async () => {
      const payload = await Api.apiRequest(config, '/api/emails/mark-read', {
        method: 'POST',
        body: {
          email,
          method: getMailItemMethod(item),
          folder,
          items: [{
            id: item.id,
            folder,
            id_mode: item.id_mode || (getMailItemMethod(item) === 'imap' ? 'uid' : 'graph'),
          }],
        },
        timeoutMs: 70000,
      });
      getEl('mailDetail').innerHTML = renderResult(payload);
    }, I18n.t("Marking as read..."));
  }

  async function deleteNormalMail(config, email, item, folder) {
    if (!window.confirm(I18n.t("Are you sure you want to delete this email?"))) return;
    const targetFolder = folder || item.folder || 'inbox';
    await runAction(config, async () => {
      const payload = await Api.apiRequest(config, '/api/emails/delete', {
        method: 'POST',
        body: {
          email,
          method: getMailItemMethod(item),
          folder: targetFolder,
          items: [{
            id: item.id,
            folder: targetFolder,
            id_mode: item.id_mode || (getMailItemMethod(item) === 'imap' ? 'uid' : 'graph'),
          }],
        },
        timeoutMs: 70000,
      });
      getEl('mailDetail').innerHTML = renderResult(payload);
      await loadAccountEmails(config, email);
    }, I18n.t("Deleting messages..."));
  }

  async function loadTempEmailMessages(config, email) {
    mailState.currentTempEmail = email;
    const target = getEl('mailEmails');
    target.innerHTML = I18n.tpl`<div class="card muted">Loading temporary mail for ${escapeHtml(email)}...</div>`;
    revealMailPanel();
    const payload = await Api.apiRequest(config, `/api/temp-emails/${encodePath(email)}/messages`, { timeoutMs: 70000 });
    const emails = Array.isArray(payload.emails) ? payload.emails : [];
    mailState.currentTempMessages = emails;
    target.innerHTML = I18n.tpl`
      <div class="card">
        <div class="item-title">${escapeHtml(email)}</div>
        <div class="item-meta">${escapeHtml(payload.method || I18n.t("Temporary mailboxes"))} · Recent ${emails.length} emails</div>
        <div class="toolbar wrap">
          <button id="btnRefreshTempMessages" class="secondary-btn" type="button">Refresh mail</button>
          <button id="btnBackToAccounts" class="secondary-btn" type="button">Return to account list</button>
        </div>
      </div>
      <div class="list">
        ${emails.length ? emails.map((item, index) => I18n.tpl`
          <div class="item">
            <div class="item-title">${escapeHtml(item.subject || I18n.t("No topic"))}</div>
            <div class="item-meta">${escapeHtml(item.from || '')} · ${escapeHtml(formatDate(item.date || item.timestamp))}</div>
            <div class="item-meta">${escapeHtml(item.body_preview || '')}</div>
            <div class="item-actions">
              <button class="small-btn" type="button" data-temp-mail-detail="${escapeHtml(index)}">Details</button>
            </div>
          </div>
        `).join('') : I18n.t("<div class=\"card muted\">No mail.</div>")}
      </div>
      <div id="tempMailDetail"></div>
    `;
    getEl('btnRefreshTempMessages').addEventListener('click', () => runAction(config, async () => {
      await Api.apiRequest(config, `/api/temp-emails/${encodePath(email)}/refresh`, { method: 'POST', timeoutMs: 70000 });
      await loadTempEmailMessages(config, email);
    }, I18n.t("Refreshing temporary mail...")));
    getEl('btnBackToAccounts').addEventListener('click', revealAccountsPanel);
    target.querySelectorAll('[data-temp-mail-detail]').forEach((button) => {
      button.addEventListener('click', () => loadTempEmailDetail(config, email, toInt(button.dataset.tempMailDetail, -1)));
    });
  }

  async function loadTempEmailDetail(config, email, index) {
    const item = mailState.currentTempMessages[index];
    if (!item) return;
    await runAction(config, async () => {
      const payload = await Api.apiRequest(config, `/api/temp-emails/${encodePath(email)}/messages/${encodePath(item.id)}`, {
        timeoutMs: 70000,
      });
      renderEmailDetail(config, 'tempMailDetail', { type: 'temp', email, item }, payload.email || {});
    }, I18n.t("Loading temporary email details..."));
  }

  async function loadCloudflareGlobalMessages(config, append) {
    const target = getEl('mailEmails');
    if (!append) {
      mailState.cloudflareFilter = valueOf('cloudflareAddressFilter') || mailState.cloudflareFilter || '';
      mailState.cloudflareOffset = 0;
      mailState.cloudflareHasMore = false;
      mailState.cloudflareEmails = [];
      target.innerHTML = I18n.t("<div class=\"card muted\">Loading Cloudflare All Mail...</div>");
      revealMailPanel();
    }

    const payload = await Api.apiRequest(config, pathWithQuery('/api/cloudflare/messages', {
      limit: 50,
      offset: mailState.cloudflareOffset,
      address: mailState.cloudflareFilter,
    }), { timeoutMs: 70000 });

    const emails = Array.isArray(payload.emails) ? payload.emails : [];
    mailState.cloudflareEmails = append ? mailState.cloudflareEmails.concat(emails) : emails;
    mailState.cloudflareHasMore = payload.has_more === true;
    mailState.cloudflareOffset = Number(payload.offset || 0) + Number(payload.limit || 50);
    renderCloudflareGlobalPanel(config, payload);
  }

  function renderCloudflareGlobalPanel(config, payload = {}) {
    const target = getEl('mailEmails');
    const emails = mailState.cloudflareEmails;
    const queried = payload.queried_email && payload.fallback_used ? I18n.tpl` · Actual query ${payload.queried_email}` : '';
    target.innerHTML = I18n.tpl`
      <div class="card">
        <div class="item-title">Cloudflare All Mail</div>
        <div class="item-meta">Loaded ${escapeHtml(emails.length)} / ${escapeHtml(payload.total_count ?? emails.length)}${escapeHtml(queried)}</div>
        <label><span>Recipient address filtering</span><input id="cloudflareAddressFilter" value="${escapeHtml(mailState.cloudflareFilter)}" placeholder="user@example.com"></label>
        <div class="toolbar wrap">
          <button id="btnApplyCloudflareFilter" class="secondary-btn" type="button">Query</button>
          <button id="btnClearCloudflareFilter" class="secondary-btn" type="button">All</button>
          <button id="btnMoreCloudflareMessages" class="secondary-btn" type="button" ${mailState.cloudflareHasMore ? '' : 'disabled'}>Load more</button>
          <button id="btnBackToAccounts" class="secondary-btn" type="button">Return to account list</button>
        </div>
      </div>
      <div class="list">
        ${emails.length ? emails.map((item, index) => I18n.tpl`
          <div class="item">
            <div class="item-title">${escapeHtml(item.subject || I18n.t("No topic"))}</div>
            <div class="item-meta">${escapeHtml(item.from || '')} → ${escapeHtml(item.to || '')} · ${escapeHtml(formatDate(item.date || item.timestamp))}</div>
            <div class="item-meta">${escapeHtml(item.body_preview || '')}</div>
            <div class="item-actions">
              <button class="small-btn" type="button" data-cf-detail="${escapeHtml(index)}">Details</button>
              <button class="small-btn" type="button" data-cf-copy="${escapeHtml(item.to || '')}">Copy recipient</button>
            </div>
          </div>
        `).join('') : I18n.t("<div class=\"card muted\">No mail.</div>")}
      </div>
      <div id="cloudflareMailDetail"></div>
    `;
    getEl('btnApplyCloudflareFilter').addEventListener('click', () => {
      mailState.cloudflareFilter = valueOf('cloudflareAddressFilter');
      runAction(config, () => loadCloudflareGlobalMessages(config, false), I18n.t("Loading Cloudflare All Mail..."));
    });
    getEl('btnClearCloudflareFilter').addEventListener('click', () => {
      mailState.cloudflareFilter = '';
      runAction(config, () => loadCloudflareGlobalMessages(config, false), I18n.t("Loading Cloudflare All Mail..."));
    });
    getEl('btnMoreCloudflareMessages').addEventListener('click', () => {
      runAction(config, () => loadCloudflareGlobalMessages(config, true), I18n.t("Loading more Cloudflare emails..."));
    });
    getEl('btnBackToAccounts').addEventListener('click', revealAccountsPanel);
    target.querySelectorAll('[data-cf-detail]').forEach((button) => {
      button.addEventListener('click', () => {
        const item = mailState.cloudflareEmails[toInt(button.dataset.cfDetail, -1)];
        if (!item) return;
        renderEmailDetail(config, 'cloudflareMailDetail', { type: 'cloudflare', item }, item);
      });
    });
    target.querySelectorAll('[data-cf-copy]').forEach((button) => {
      button.addEventListener('click', () => copyText(button.dataset.cfCopy || ''));
    });
  }

  function renderEmailDetail(config, targetId, context, email) {
    const target = getEl(targetId);
    const attachmentLinks = Array.isArray(email.attachments) && email.attachments.length
      ? email.attachments.map((attachment) => {
        const folder = context.folder || 'inbox';
        const method = context.method || 'graph';
        const href = `${Api.trimUrl(config.serverUrl)}/api/email/${encodePath(context.email)}/${encodePath(email.id || context.item?.id)}/attachments/${encodePath(attachment.id)}?${queryString({ folder, method })}`;
        return `<a class="small-btn attachment-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(attachment.name || I18n.t("Attachment"))} ${escapeHtml(formatBytes(attachment.size))}</a>`;
      }).join('')
      : '';
    const normalActions = context.type === 'normal' ? I18n.tpl`
      <div class="toolbar wrap">
        <button id="${targetId}MarkRead" class="secondary-btn" type="button">Mark as read</button>
        <button id="${targetId}Raw" class="secondary-btn" type="button">Source code</button>
        <button id="${targetId}Delete" class="danger-btn" type="button">Delete mail</button>
      </div>
    ` : '';
    target.innerHTML = `
      <div class="card detail-card">
        <div class="item-title">${escapeHtml(email.subject || I18n.t("No topic"))}</div>
        <div class="item-meta">From: ${escapeHtml(email.from || '')}</div>
        <div class="item-meta">To: ${escapeHtml(email.to || context.email || '')}</div>
        ${email.cc ? `<div class="item-meta">Cc: ${escapeHtml(email.cc)}</div>` : ''}
        <div class="item-meta">${escapeHtml(formatDate(email.date || email.timestamp))}</div>
        ${normalActions}
        ${attachmentLinks ? `<div class="attachment-list">${attachmentLinks}</div>` : ''}
        <div id="${targetId}Body" class="mail-body"></div>
      </div>
    `;
    renderBodyContent(`${targetId}Body`, email.body || '', email.body_type || (email.has_html ? 'html' : 'text'));
    if (context.type === 'normal') {
      getEl(`${targetId}MarkRead`).addEventListener('click', () => markNormalMailRead(config, context.email, context.item, context.folder || 'inbox'));
      getEl(`${targetId}Delete`).addEventListener('click', () => deleteNormalMail(config, context.email, context.item));
      getEl(`${targetId}Raw`).addEventListener('click', () => loadRawEmail(config, targetId, context));
    }
  }

  function renderBodyContent(targetId, body, bodyType) {
    const target = getEl(targetId);
    if (!target) return;
    target.textContent = '';
    if (String(bodyType || '').toLowerCase() === 'html') {
      const iframe = document.createElement('iframe');
      iframe.className = 'mail-frame';
      iframe.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
      iframe.srcdoc = `<!doctype html><meta charset="utf-8"><base target="_blank"><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;line-height:1.5;color:#172033;margin:12px;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style>${body || ''}`;
      target.appendChild(iframe);
      return;
    }
    const pre = document.createElement('pre');
    pre.className = 'text-mail-body';
    pre.textContent = body || '';
    target.appendChild(pre);
  }

  async function loadRawEmail(config, targetId, context) {
    await runAction(config, async () => {
      const text = await Api.apiTextRequest(config, pathWithQuery(`/api/email/${encodePath(context.email)}/${encodePath(context.item.id)}/raw`, {
        folder: context.folder || 'inbox',
        method: context.method || 'graph',
      }), { timeoutMs: 70000 });
      renderBodyContent(`${targetId}Body`, text, 'text');
    }, I18n.t("Loading source code..."));
  }

  async function renderImportView() {
    setContent(I18n.t("<div class=\"card muted\">Loading import tool...</div>"));
    await withSession(async (config) => {
      const [groups, tags] = await Promise.all([loadGroups(config), loadTags(config)]);
      const defaultGroupId = groups.find((group) => !isTempEmailGroup(group))?.id || groups[0]?.id || '';
      setContent(I18n.tpl`
        <div class="card">
          <label><span>Import objects</span><select id="importMode">${renderOptions([['normal', I18n.t("Regular mailboxes")], ['temp', I18n.t("Temporary mailboxes")]], 'normal')}</select></label>
          <div id="normalImportFields">
            <label><span>Target grouping</span><select id="importGroup">${groupOptions(groups, defaultGroupId, false)}</select></label>
            <div class="row">
              <label><span>Email type</span><select id="importProvider">${renderOptions(normalProviders, 'outlook')}</select></label>
              <label><span>Outlook format</span><select id="importFormat">${renderOptions([
        ['client_id_refresh_token', I18n.t("ClientID first")],
        ['refresh_token_client_id', I18n.t("RefreshToken first")],
      ], 'client_id_refresh_token')}</select></label>
            </div>
            <div id="customImapImportFields" class="hidden">
              <div class="row">
                <label><span>IMAP host</span><input id="importImapHost"></label>
                <label><span>IMAP port</span><input id="importImapPort" type="number" value="993"></label>
              </div>
            </div>
            <div class="row">
              <label><span>Unified remarks</span><input id="importRemark"></label>
              <label><span>Status</span><select id="importStatus">${renderOptions([['active', 'active'], ['inactive', 'inactive']], 'active')}</select></label>
            </div>
            <label class="check-row"><input id="importForward" type="checkbox"><span>Enable forwarding after importing</span></label>
            <div class="compact-box">
              <div class="item-meta">Bind tags when importing</div>
              ${tagCheckboxes(tags, [], 'importTagIds')}
            </div>
          </div>
          <div id="tempImportFields" class="hidden">
            <label><span>Temporary email channel</span><select id="tempImportProvider">${renderOptions(tempProviders, 'gptmail')}</select></label>
          </div>
          <label><span>Account content</span><textarea id="importText" placeholder="One account per line"></textarea></label>
          <button id="btnImportSubmit" class="primary-btn" type="button">Import</button>
        </div>
        <div class="card">
          <div class="item-title">Generate temporary mailbox</div>
          <div class="row">
            <label><span>Channel</span><select id="generateProvider">${renderOptions(tempProviders, 'gptmail')}</select></label>
            <label><span>Domain name</span><select id="generateDomain"></select></label>
          </div>
          <div class="row">
            <label><span>Username / prefix</span><input id="generateUsername"></label>
            <label><span>Password</span><input id="generatePassword" type="password"></label>
          </div>
          <div class="toolbar">
            <button id="btnLoadTempDomains" class="secondary-btn" type="button">Refresh domain name</button>
            <button id="btnGenerateTempEmail" class="primary-btn" type="button">Generate</button>
          </div>
        </div>
        <div id="importResult"></div>
      `);
      function updateImportMode() {
        const mode = valueOf('importMode');
        getEl('normalImportFields').classList.toggle('hidden', mode !== 'normal');
        getEl('tempImportFields').classList.toggle('hidden', mode !== 'temp');
      }
      function updateProviderFields() {
        getEl('customImapImportFields').classList.toggle('hidden', valueOf('importProvider') !== 'custom');
      }
      getEl('importMode').addEventListener('change', updateImportMode);
      getEl('importProvider').addEventListener('change', updateProviderFields);
      updateImportMode();
      updateProviderFields();
      getEl('btnImportSubmit').addEventListener('click', () => submitImport(config));
      getEl('generateProvider').addEventListener('change', () => loadTempDomains(config));
      getEl('btnLoadTempDomains').addEventListener('click', () => loadTempDomains(config));
      getEl('btnGenerateTempEmail').addEventListener('click', () => generateTempEmail(config));
      await loadTempDomains(config);
    }, I18n.t("Loading import..."));
  }

  async function submitImport(config) {
    await runAction(config, async () => {
      const mode = valueOf('importMode');
      const result = getEl('importResult');
      result.innerHTML = I18n.t("<div class=\"card muted\">Importing...</div>");
      if (mode === 'temp') {
        const payload = await Api.apiRequest(config, '/api/temp-emails/import', {
          method: 'POST',
          body: {
            provider: valueOf('tempImportProvider'),
            account_string: valueOf('importText'),
          },
          timeoutMs: 70000,
        });
        result.innerHTML = renderResult(payload);
        return;
      }
      const tagIds = Array.from(document.querySelectorAll('[name="importTagIds"]:checked')).map((item) => Number(item.value));
      const payload = await Api.apiRequest(config, '/api/accounts', {
        method: 'POST',
        body: {
          group_id: Number(valueOf('importGroup')),
          provider: valueOf('importProvider'),
          account_format: valueOf('importFormat'),
          account_string: valueOf('importText'),
          imap_host: valueOf('importImapHost'),
          imap_port: toInt(valueOf('importImapPort'), 993),
          forward_enabled: checked('importForward'),
          remark: valueOf('importRemark'),
          status: valueOf('importStatus') || 'active',
          tag_ids: tagIds,
        },
        timeoutMs: 70000,
      });
      result.innerHTML = renderResult(payload);
    }, I18n.t("Importing account..."));
  }

  async function loadTempDomains(config) {
    const provider = valueOf('generateProvider') || 'gptmail';
    const select = getEl('generateDomain');
    if (!select) return;
    select.innerHTML = I18n.t("<option value=\"\">Default</option>");
    if (provider === 'gptmail') return;
    await runAction(config, async () => {
      const endpoint = provider === 'duckmail' ? '/api/duckmail/domains' : '/api/cloudflare/domains';
      const payload = await Api.apiRequest(config, endpoint, { timeoutMs: 70000 });
      const domains = Array.isArray(payload.domains) ? payload.domains : [];
      select.innerHTML = I18n.t("<option value=\"\">Default</option>") + domains.map((item) => {
        const domain = item.domain || item;
        return `<option value="${escapeHtml(domain)}">${escapeHtml(domain)}</option>`;
      }).join('');
    }, I18n.t("Loading domain name..."));
  }

  async function generateTempEmail(config) {
    await runAction(config, async () => {
      const provider = valueOf('generateProvider') || 'gptmail';
      const body = { provider };
      const username = valueOf('generateUsername');
      const domain = valueOf('generateDomain');
      if (provider === 'gptmail') {
        body.prefix = username;
        body.domain = domain;
      } else if (provider === 'duckmail') {
        body.username = username;
        body.domain = domain;
        body.password = valueOf('generatePassword');
      } else if (provider === 'cloudflare') {
        body.username = username;
        body.domain = domain;
      }
      const payload = await Api.apiRequest(config, '/api/temp-emails/generate', {
        method: 'POST',
        body,
        timeoutMs: 70000,
      });
      getEl('importResult').innerHTML = renderResult(payload);
    }, I18n.t("Generating temporary mailbox..."));
  }

  async function renderRefreshView() {
    setContent(I18n.t("<div class=\"card muted\">Loading refresh status...</div>"));
    await withSession(async (config) => {
      const status = getEl('refreshStatusFilter')?.value || 'all';
      const q = valueOf('refreshSearch');
      const payload = await Api.apiRequest(config, pathWithQuery('/api/accounts/refresh-status-list', {
        q,
        status,
        page: 1,
        page_size: 80,
      }));
      const accounts = Array.isArray(payload.items) ? payload.items : (Array.isArray(payload.accounts) ? payload.accounts : []);
      const stats = payload.stats || {};
      setContent(I18n.tpl`
        <div class="card">
          <div class="item-title">Refresh statistics</div>
          <div class="item-meta">Total ${escapeHtml(stats.total ?? payload.total ?? 0)} · Success ${escapeHtml(stats.success_count ?? 0)} · Failure ${escapeHtml(stats.failed_count ?? 0)} · Never ${escapeHtml(stats.never_count ?? 0)} · Status ${escapeHtml(stats.last_refresh_status || 'idle')}</div>
          <div class="row">
            <label><span>Status</span><select id="refreshStatusFilter">${renderOptions([['all', I18n.t("All")], ['success', I18n.t("Success")], ['failed', I18n.t("Failure")], ['never', I18n.t("Never refreshed")]], status)}</select></label>
            <label><span>Search</span><input id="refreshSearch" value="${escapeHtml(q)}"></label>
          </div>
          <div class="toolbar wrap">
            <button id="btnFilterRefresh" class="secondary-btn" type="button">Filter</button>
            <button id="btnRefreshAll" class="primary-btn" type="button">Full refresh</button>
            <button id="btnRefreshFailedStream" class="secondary-btn" type="button">Streaming retry failed</button>
            <button id="btnRefreshFailed" class="secondary-btn" type="button">Fast retry failed</button>
            <button id="btnStopRefresh" class="danger-btn" type="button">Stop full refresh</button>
            <button id="btnLoadRefreshLogs" class="secondary-btn" type="button">Refresh log</button>
            <button id="btnLoadFailedRefreshLogs" class="secondary-btn" type="button">Failure list</button>
          </div>
        </div>
        <div id="refreshStreamLog" class="card result-box"></div>
        <div id="refreshList" class="list">
          ${accounts.map((account) => I18n.tpl`
            <div class="item">
              <div class="item-title">${escapeHtml(account.email)}</div>
              <div class="item-meta">ID ${escapeHtml(account.id)} · Status ${escapeHtml(account.last_refresh_status || 'never')} · ${escapeHtml(formatDate(account.last_refresh_at))}</div>
              ${account.last_refresh_error ? `<div class="item-meta status-bad">${escapeHtml(account.last_refresh_error)}</div>` : ''}
              <div class="item-actions wrap">
                <button class="small-btn" type="button" data-refresh-action="refresh" data-id="${escapeHtml(account.id)}">Refresh this account</button>
                <button class="small-btn" type="button" data-refresh-action="retry" data-id="${escapeHtml(account.id)}">Try again</button>
                <button class="small-btn" type="button" data-refresh-action="logs" data-id="${escapeHtml(account.id)}">Log</button>
              </div>
            </div>
          `).join('') || I18n.t("<div class=\"card muted\">There is no account to refresh.</div>")}
        </div>
      `);
      getEl('btnFilterRefresh').addEventListener('click', () => renderRefreshView());
      getEl('refreshStatusFilter').addEventListener('change', () => renderRefreshView());
      getEl('refreshSearch').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') renderRefreshView();
      });
      getEl('btnRefreshAll').addEventListener('click', () => startRefreshStream(config, '/api/accounts/refresh-all'));
      getEl('btnRefreshFailedStream').addEventListener('click', () => startRefreshStream(config, '/api/accounts/refresh-failed-stream'));
      getEl('btnRefreshFailed').addEventListener('click', () => runAction(config, async () => {
        const result = await Api.apiRequest(config, '/api/accounts/refresh-failed', { method: 'POST', timeoutMs: 10 * 60 * 1000 });
        getEl('refreshStreamLog').textContent = JSON.stringify(result, null, 2);
        await renderRefreshView();
      }, I18n.t("Retrying failed account...")));
      getEl('btnStopRefresh').addEventListener('click', () => runAction(config, async () => {
        const result = await Api.apiRequest(config, '/api/accounts/stop-full-refresh', { method: 'POST' });
        getEl('refreshStreamLog').textContent = JSON.stringify(result, null, 2);
      }, I18n.t("Stopping refresh...")));
      getEl('btnLoadRefreshLogs').addEventListener('click', () => loadRefreshLogs(config, false));
      getEl('btnLoadFailedRefreshLogs').addEventListener('click', () => loadRefreshLogs(config, true));
      getEl('refreshList').querySelectorAll('[data-refresh-action]').forEach((button) => {
        button.addEventListener('click', () => handleRefreshAccountAction(config, button));
      });
    }, I18n.t("Loading refresh..."));
  }

  async function startRefreshStream(config, path) {
    await runAction(config, async () => {
      const log = getEl('refreshStreamLog');
      log.textContent = '';
      await Api.apiStreamRequest(config, path, (event) => {
        const type = event.type || 'message';
        const line = I18n.tpl`[${type}] ${event.email || event.message || ''} ${event.current ? `${event.current}/${event.total}` : ''} Success: ${event.success_count ?? ''} Failure: ${event.failed_count ?? ''}`;
        log.textContent += `${line}\n`;
        log.scrollTop = log.scrollHeight;
      }, { timeoutMs: 30 * 60 * 1000 });
      await renderRefreshView();
    }, I18n.t("Performing refresh..."));
  }

  async function handleRefreshAccountAction(config, button) {
    const accountId = button.dataset.id;
    const action = button.dataset.refreshAction;
    if (action === 'logs') return loadRefreshLogs(config, false, accountId);
    const endpoint = action === 'retry' ? `/api/accounts/${accountId}/retry-refresh` : `/api/accounts/${accountId}/refresh`;
    await runAction(config, async () => {
      const payload = await Api.apiRequest(config, endpoint, { method: 'POST', timeoutMs: 70000 });
      getEl('refreshStreamLog').textContent = JSON.stringify(payload, null, 2);
      await renderRefreshView();
    }, I18n.t("Refreshing account..."));
  }

  async function loadRefreshLogs(config, failedOnly, accountId = '') {
    await runAction(config, async () => {
      const endpoint = accountId
        ? `/api/accounts/${accountId}/refresh-logs?limit=30`
        : (failedOnly ? '/api/accounts/refresh-logs/failed' : '/api/accounts/refresh-logs?limit=50');
      const payload = await Api.apiRequest(config, endpoint);
      const logs = Array.isArray(payload.logs) ? payload.logs : [];
      getEl('refreshStreamLog').textContent = logs.map((log) => {
        return `${log.created_at || ''} ${log.account_email || ''} ${log.status || ''} ${log.error_message || ''}`;
      }).join('\n') || I18n.t("No logs yet");
    }, I18n.t("Loading refresh log..."));
  }

  async function renderTokenView() {
    setContent(I18n.t("<div class=\"card muted\">Loading Token tool...</div>"));
    await withSession(async (config) => {
      const [authPayload, groups] = await Promise.all([
        Api.apiRequest(config, '/api/oauth/auth-url'),
        loadGroups(config),
      ]);
      const defaultGroup = groups.find((group) => !isTempEmailGroup(group))?.id || '';
      mailState.oauthPreview = null;
      setContent(I18n.tpl`
        <div class="card">
          <div class="item-title">OAuth authorization link</div>
          <div class="item-meta">Client ID: ${escapeHtml(authPayload.client_id || '')}</div>
          <textarea id="authUrlText" readonly>${escapeHtml(authPayload.auth_url || '')}</textarea>
          <div class="toolbar">
            <button id="btnCopyAuthUrl" class="secondary-btn" type="button">Copy the authorization link</button>
          </div>
        </div>
        <div class="card">
          <div class="row">
            <label><span>Mailboxes</span><input id="oauthEmailInput"></label>
            <label><span>Account password</span><input id="oauthPasswordInput" type="password"></label>
          </div>
          <label><span>Save to group</span><select id="tokenSaveGroup">${groupOptions(groups, defaultGroup, false)}</select></label>
          <label class="check-row"><input id="oauthForwardEnabled" type="checkbox"><span>Enable forwarding after saving</span></label>
          <label><span>Complete callback URL after authorization</span><textarea id="redirectedUrl" placeholder="Paste the full URL from your browser’s address bar"></textarea></label>
          <div class="toolbar wrap">
            <button id="btnExchangeToken" class="secondary-btn" type="button">Exchange and preview</button>
            <button id="btnSaveTokenAccount" class="primary-btn" type="button">Save account</button>
          </div>
        </div>
        <div id="tokenResult"></div>
      `);
      getEl('btnCopyAuthUrl').addEventListener('click', () => copyText(getEl('authUrlText').value));
      getEl('btnExchangeToken').addEventListener('click', () => exchangeToken(config));
      getEl('btnSaveTokenAccount').addEventListener('click', () => saveTokenAccount(config));
      ['oauthEmailInput', 'oauthPasswordInput', 'tokenSaveGroup', 'oauthForwardEnabled', 'redirectedUrl'].forEach((id) => {
        const el = getEl(id);
        el?.addEventListener('input', () => { mailState.oauthPreview = null; });
        el?.addEventListener('change', () => { mailState.oauthPreview = null; });
      });
    }, I18n.t("Loading Token..."));
  }

  async function exchangeToken(config) {
    return runAction(config, async () => {
      return exchangeTokenPayload(config);
    }, I18n.t("Exchange for Token..."));
  }

  async function exchangeTokenPayload(config) {
    const tokenPayload = await Api.apiRequest(config, '/api/oauth/exchange-token', {
      method: 'POST',
      body: { redirected_url: valueOf('redirectedUrl') },
      timeoutMs: 70000,
    });
    if (tokenPayload.success) {
      mailState.oauthPreview = {
        email: valueOf('oauthEmailInput'),
        password: valueOf('oauthPasswordInput'),
        client_id: tokenPayload.client_id,
        refresh_token: tokenPayload.refresh_token,
        group_id: Number(valueOf('tokenSaveGroup')),
        forward_enabled: checked('oauthForwardEnabled'),
      };
    }
    getEl('tokenResult').innerHTML = renderResult(tokenPayload);
    return tokenPayload;
  }

  async function saveTokenAccount(config) {
    await runAction(config, async () => {
      if (!mailState.oauthPreview) {
        await exchangeTokenPayload(config);
      }
      const preview = mailState.oauthPreview;
      if (!preview || !preview.email || !preview.password || !preview.client_id || !preview.refresh_token) {
        throw new Error(I18n.t("Before saving the account, you need to fill in your email address and password and successfully exchange for Token."));
      }
      const accountString = [preview.email, preview.password, preview.client_id, preview.refresh_token].join('----');
      const payload = await Api.apiRequest(config, '/api/accounts', {
        method: 'POST',
        body: {
          account_string: accountString,
          group_id: preview.group_id,
          provider: 'outlook',
          forward_enabled: preview.forward_enabled,
        },
        timeoutMs: 70000,
      });
      getEl('tokenResult').innerHTML = renderResult(payload);
    }, I18n.t("Saving account..."));
  }

  async function renderExportView() {
    setContent(I18n.t("<div class=\"card muted\">Loading export...</div>"));
    await withSession(async (config) => {
      const groups = await loadGroups(config);
      const sortedGroups = flattenGroupTree(buildGroupTree(groups));

      setContent(I18n.tpl`
        <div class="card">
          <label><span>Second verification password</span><input id="exportPassword" type="password" placeholder="Enter the web login password"></label>
          <div class="toolbar wrap">
            <button id="btnCheckAllExportGroups" class="secondary-btn" type="button">Select all groups</button>
            <button id="btnClearExportGroups" class="secondary-btn" type="button">Clear</button>
          </div>
          <div class="list">
            ${sortedGroups.map((group) => {
              const level = normalizeGroupLevel(group);
              const paddingLeft = 12 + (level - 1) * 16;
              const count = group.descendant_account_count ?? group.account_count ?? 0;
              return `
                <label class="check-row export-group-label" style="padding-left: ${paddingLeft}px; transition: opacity 0.15s;">
                  <input type="checkbox" name="exportGroup" class="export-group-checkbox" value="${escapeHtml(group.id)}">
                  <span>${escapeHtml(I18n.groupName(group))} (${escapeHtml(count)})</span>
                </label>
              `;
            }).join('')}
          </div>
          <div class="toolbar wrap">
            <button id="btnExportAll" class="primary-btn" type="button">Export all</button>
            <button id="btnExportSelected" class="secondary-btn" type="button">Export selected</button>
            <button id="btnCopyExportResult" class="secondary-btn" type="button">Copy results</button>
          </div>
        </div>
        <textarea id="exportResult" class="result-box" readonly placeholder="The exported content will be displayed here"></textarea>
      `);

      function getDescendantGroupIds(groupId) {
        const descendants = [];
        const queue = [Number(groupId)];
        while (queue.length > 0) {
          const currentId = queue.shift();
          groups.forEach((g) => {
            if (g.parent_id && Number(g.parent_id) === currentId) {
              descendants.push(g.id);
              queue.push(g.id);
            }
          });
        }
        return descendants;
      }

      function hasSelectedAncestorGroup(groupId, selectedGroupIds) {
        let current = groups.find((g) => Number(g.id) === Number(groupId));
        while (current && current.parent_id) {
          const parentId = Number(current.parent_id);
          if (selectedGroupIds.has(parentId)) {
            return true;
          }
          current = groups.find((g) => Number(g.id) === parentId);
        }
        return false;
      }

      function syncExportGroupCheckboxStates() {
        const checkboxes = Array.from(document.querySelectorAll('.export-group-checkbox'));
        const selectedGroupIds = new Set(checkboxes
          .filter((cb) => cb.checked)
          .map((cb) => Number(cb.value)));

        checkboxes.forEach((cb) => {
          const coveredByParent = hasSelectedAncestorGroup(Number(cb.value), selectedGroupIds);
          cb.disabled = coveredByParent;
          if (coveredByParent) {
            cb.checked = true;
          }
          const row = cb.closest('label');
          if (row) {
            row.style.opacity = coveredByParent ? '0.45' : '';
            row.style.cursor = coveredByParent ? 'default' : '';
          }
        });
      }

      function handleExportCheckboxChange(event) {
        const cb = event.target;
        if (!cb) return;
        const groupId = Number(cb.value);
        const isChecked = cb.checked;

        const descendants = getDescendantGroupIds(groupId);
        descendants.forEach((descId) => {
          const descCb = document.querySelector(`.export-group-checkbox[value="${descId}"]`);
          if (descCb) {
            descCb.checked = isChecked;
          }
        });
        syncExportGroupCheckboxStates();
      }

      document.querySelectorAll('.export-group-checkbox').forEach((cb) => {
        cb.addEventListener('change', handleExportCheckboxChange);
      });
      syncExportGroupCheckboxStates();

      async function getVerifyToken() {
        const verify = await Api.apiRequest(config, '/api/export/verify', {
          method: 'POST',
          body: { password: valueOf('exportPassword') },
        });
        return verify.verify_token;
      }

      getEl('btnCheckAllExportGroups').addEventListener('click', () => {
        document.querySelectorAll('.export-group-checkbox').forEach((item) => { item.checked = true; });
        syncExportGroupCheckboxStates();
      });

      getEl('btnClearExportGroups').addEventListener('click', () => {
        document.querySelectorAll('.export-group-checkbox').forEach((item) => { item.checked = false; });
        syncExportGroupCheckboxStates();
      });

      getEl('btnExportAll').addEventListener('click', () => runAction(config, async () => {
        const token = await getVerifyToken();
        getEl('exportResult').value = await Api.apiTextRequest(config, `/api/accounts/export?verify_token=${encodeURIComponent(token)}`, {
          timeoutMs: 70000,
        });
      }, I18n.t("Exporting all...")));

      getEl('btnExportSelected').addEventListener('click', () => runAction(config, async () => {
        const token = await getVerifyToken();
        const selectedGroupIds = Array.from(document.querySelectorAll('.export-group-checkbox:checked')).map((item) => Number(item.value));
        
        // Filter out subgroups whose parent group is also selected to avoid repeated exports
        const groupIds = selectedGroupIds.filter((groupId) => {
          let current = groups.find((g) => Number(g.id) === Number(groupId));
          while (current && current.parent_id) {
            if (selectedGroupIds.includes(Number(current.parent_id))) {
              return false;
            }
            current = groups.find((g) => Number(g.id) === Number(current.parent_id));
          }
          return true;
        });

        getEl('exportResult').value = await Api.apiTextRequest(config, '/api/accounts/export-selected', {
          method: 'POST',
          body: { group_ids: groupIds, verify_token: token },
          timeoutMs: 70000,
        });
      }, I18n.t("Exporting selected groups...")));

      getEl('btnCopyExportResult').addEventListener('click', () => copyText(getEl('exportResult').value));
    }, I18n.t("Loading export..."));
  }

  async function renderTagsView() {
    setContent(I18n.t("<div class=\"card muted\">Loading tags...</div>"));
    await withSession(async (config) => {
      const tags = await loadTags(config);
      setContent(I18n.tpl`
        <div class="card row">
          <input id="tagName" placeholder="Tag name">
          <input id="tagColor" type="color" value="#1a1a1a">
          <button id="btnAddTag" class="primary-btn" type="button">New</button>
        </div>
        <div class="card">
          <div class="item-title">Batch binding</div>
          <div class="row">
            <label><span>Object</span><select id="batchTagTarget">${renderOptions([['account', I18n.t("Regular accounts")], ['temp', I18n.t("Temporary mailboxes")]], 'account')}</select></label>
            <label><span>Tags</span><select id="batchTagId">${tags.map((tag) => `<option value="${escapeHtml(tag.id)}">${escapeHtml(tag.name)}</option>`).join('')}</select></label>
          </div>
          <label><span>ID list</span><textarea id="batchTagIds" placeholder="Multiple IDs separated by commas or newlines"></textarea></label>
          <div class="toolbar">
            <button id="btnBatchAddTag" class="secondary-btn" type="button">Add</button>
            <button id="btnBatchRemoveTag" class="secondary-btn" type="button">Remove</button>
          </div>
        </div>
        <div id="tagList" class="list">
          ${tags.map((tag) => I18n.tpl`
            <div class="item">
              <div class="item-title"><span class="tag-dot" style="--tag-color:${escapeHtml(tag.color || '#1a1a1a')}"></span> ${escapeHtml(tag.name)}</div>
              <div class="item-meta">ID ${escapeHtml(tag.id)}</div>
              <div class="item-actions">
                <button class="danger-btn" type="button" data-tag-id="${escapeHtml(tag.id)}">Delete</button>
              </div>
            </div>
          `).join('') || I18n.t("<div class=\"card muted\">No label yet.</div>")}
        </div>
        <div id="tagsResult"></div>
      `);
      getEl('btnAddTag').addEventListener('click', () => runAction(config, async () => {
        await Api.apiRequest(config, '/api/tags', {
          method: 'POST',
          body: { name: valueOf('tagName'), color: valueOf('tagColor') },
        });
        renderTagsView();
      }, I18n.t("Adding tags...")));
      async function batchTag(action) {
        await runAction(config, async () => {
          const ids = valueOf('batchTagIds').split(/[\s,，]+/).map((item) => Number(item)).filter(Boolean);
          const type = valueOf('batchTagTarget');
          const endpoint = type === 'temp' ? '/api/temp-emails/tags' : '/api/accounts/tags';
          const idKey = type === 'temp' ? 'temp_email_ids' : 'account_ids';
          const payload = await Api.apiRequest(config, endpoint, {
            method: 'POST',
            body: { [idKey]: ids, tag_id: Number(valueOf('batchTagId')), action },
          });
          getEl('tagsResult').innerHTML = renderResult(payload);
        }, I18n.t("Updating tags in batches..."));
      }
      getEl('btnBatchAddTag').addEventListener('click', () => batchTag('add'));
      getEl('btnBatchRemoveTag').addEventListener('click', () => batchTag('remove'));
      getEl('tagList').querySelectorAll('[data-tag-id]').forEach((button) => {
        button.addEventListener('click', () => runAction(config, async () => {
          await Api.apiRequest(config, `/api/tags/${button.dataset.tagId}`, { method: 'DELETE' });
          renderTagsView();
        }, I18n.t("Removing tags...")));
      });
    }, I18n.t("Loading tags..."));
  }

  async function renderSettingsView() {
    setContent(I18n.t("<div class=\"card muted\">Loading settings...</div>"));
    await withSession(async (config) => {
      const payload = await Api.apiRequest(config, '/api/settings');
      const settings = payload.settings || {};
      const forwardIntervalSeconds = settings.forward_check_interval_seconds
        || String((toInt(settings.forward_check_interval_minutes || '5', 5) || 5) * 60);
      const forwardExecutionMode = settings.forward_execution_mode === 'parallel' ? 'parallel' : 'serial';
      const forwardAccountDelaySeconds = forwardExecutionMode === 'parallel'
        ? '0'
        : (settings.forward_account_delay_seconds || '0');
      setContent(I18n.tpl`
        <div class="card">
          <div class="item-title">Foundation and refresh</div>
          <div class="row">
            <label><span>Application time zone</span><input id="settingTimezone" value="${escapeHtml(settings.app_timezone || 'Asia/Shanghai')}"></label>
            <label><span>Refresh cycle (days)</span><input id="settingRefreshDays" type="number" min="1" max="90" value="${escapeHtml(settings.refresh_interval_days || '30')}"></label>
          </div>
          <div class="row">
            <label><span>Refresh interval (seconds)</span><input id="settingRefreshDelay" type="number" min="0" max="60" value="${escapeHtml(settings.refresh_delay_seconds || '0')}"></label>
            <label><span>Cron</span><input id="settingRefreshCron" value="${escapeHtml(settings.refresh_cron || '0 0 */15 * *')}"></label>
          </div>
          <label class="check-row"><input id="settingUseCron" type="checkbox" ${boolSetting(settings.use_cron_schedule) ? 'checked' : ''}><span>Use Cron scheduling</span></label>
          <label class="check-row"><input id="settingScheduledRefresh" type="checkbox" ${boolSetting(settings.enable_scheduled_refresh) ? 'checked' : ''}><span>Enable scheduled refresh</span></label>
          <label class="check-row"><input id="settingShowCreated" type="checkbox" ${boolSetting(settings.show_account_created_at, true) ? 'checked' : ''}><span>Display account creation time</span></label>
          <label class="check-row"><input id="settingShowSort" type="checkbox" ${boolSetting(settings.show_account_sort_order) ? 'checked' : ''}><span>Display the account sort value</span></label>
          <label class="check-row"><input id="settingShowGroupId" type="checkbox" ${boolSetting(settings.show_group_id, true) ? 'checked' : ''}><span>Display group ID</span></label>
        </div>
        <div class="card">
          <div class="item-title">Temporary email service</div>
          <label><span>GPTMail API Key</span><input id="settingGptmailKey" value="${escapeHtml(settings.gptmail_api_key || '')}"></label>
          <label><span>DuckMail API address</span><input id="settingDuckmailBaseUrl" value="${escapeHtml(settings.duckmail_base_url || '')}"></label>
          <label><span>DuckMail API Key</span><input id="settingDuckmailApiKey" value="${escapeHtml(settings.duckmail_api_key || '')}"></label>
          <label><span>Cloudflare Worker domain name</span><input id="settingCloudflareWorkerDomain" value="${escapeHtml(settings.cloudflare_worker_domain || '')}"></label>
          <label><span>Cloudflare email domain name</span><input id="settingCloudflareEmailDomains" value="${escapeHtml(settings.cloudflare_email_domains || '')}"></label>
          <label><span>Cloudflare Admin Password</span><input id="settingCloudflareAdminPassword" type="password" value="${escapeHtml(settings.cloudflare_admin_password || '')}"></label>
        </div>
        <div class="card">
          <div class="item-title">Forward</div>
          <div class="inline-checks">
            <label class="check-row"><input name="settingForwardChannel" value="smtp" type="checkbox" ${Array.isArray(settings.forward_channels) && settings.forward_channels.includes('smtp') ? 'checked' : ''}><span>SMTP</span></label>
            <label class="check-row"><input name="settingForwardChannel" value="telegram" type="checkbox" ${Array.isArray(settings.forward_channels) && settings.forward_channels.includes('telegram') ? 'checked' : ''}><span>Telegram</span></label>
            <label class="check-row"><input name="settingForwardChannel" value="wecom" type="checkbox" ${Array.isArray(settings.forward_channels) && settings.forward_channels.includes('wecom') ? 'checked' : ''}><span>Enterprise WeChat</span></label>
          </div>
          <div class="row">
            <label><span>Check interval (seconds)</span><input id="settingForwardCheckIntervalSeconds" type="number" min="20" max="3600" value="${escapeHtml(forwardIntervalSeconds)}"></label>
            <label><span>Execution mode</span><select id="settingForwardExecutionMode">${renderOptions([['serial', I18n.t("Serial")], ['parallel', I18n.t("Parallel")]], forwardExecutionMode)}</select></label>
          </div>
          <div class="row">
            <label><span>Account interval (seconds)</span><input id="settingForwardAccountDelay" type="number" min="0" max="60" value="${escapeHtml(forwardAccountDelaySeconds)}"></label>
            <label><span>Parallel worker</span><input id="settingForwardParallelWorkers" type="number" min="1" max="10" value="${escapeHtml(settings.forward_parallel_workers || '4')}"></label>
          </div>
          <div class="row">
            <label><span>Email time window (minutes)</span><input id="settingForwardWindow" type="number" value="${escapeHtml(settings.forward_email_window_minutes || '0')}"></label>
            <label><span>SMTP type</span><select id="settingSmtpProvider">${renderOptions(normalProviders.filter(([key]) => key !== 'gmail'), settings.smtp_provider || 'custom')}</select></label>
          </div>
          <label class="check-row"><input id="settingForwardJunk" type="checkbox" ${boolSetting(settings.forward_include_junkemail) ? 'checked' : ''}><span>Forward spam emails</span></label>
          <label><span>SMTP recipient</span><input id="settingForwardRecipient" value="${escapeHtml(settings.email_forward_recipient || '')}"></label>
          <div class="row">
            <label><span>SMTP host</span><input id="settingSmtpHost" value="${escapeHtml(settings.smtp_host || '')}"></label>
            <label><span>SMTP port</span><input id="settingSmtpPort" type="number" value="${escapeHtml(settings.smtp_port || '465')}"></label>
          </div>
          <label><span>SMTP username</span><input id="settingSmtpUsername" value="${escapeHtml(settings.smtp_username || '')}"></label>
          <label><span>SMTP password</span><input id="settingSmtpPassword" type="password" value="${escapeHtml(settings.smtp_password || '')}"></label>
          <label><span>SMTP sender</span><input id="settingSmtpFromEmail" value="${escapeHtml(settings.smtp_from_email || '')}"></label>
          <label class="check-row"><input id="settingSmtpTls" type="checkbox" ${boolSetting(settings.smtp_use_tls) ? 'checked' : ''}><span>SMTP TLS</span></label>
          <label class="check-row"><input id="settingSmtpSsl" type="checkbox" ${boolSetting(settings.smtp_use_ssl, true) ? 'checked' : ''}><span>SMTP SSL</span></label>
          <label><span>Telegram Bot Token</span><input id="settingTelegramBotToken" type="password" value="${escapeHtml(settings.telegram_bot_token || '')}"></label>
          <label><span>Telegram Chat ID</span><input id="settingTelegramChatId" value="${escapeHtml(settings.telegram_chat_id || '')}"></label>
          <label><span>Telegram proxy</span><input id="settingTelegramProxyUrl" value="${escapeHtml(settings.telegram_proxy_url || '')}"></label>
          <label><span>Enterprise WeChat Webhook</span><input id="settingWecomWebhookUrl" type="password" value="${escapeHtml(settings.wecom_webhook_url || '')}"></label>
        </div>
        <div class="card">
          <div class="item-title">WebDAV Backup</div>
          <label class="check-row"><input id="settingWebdavEnabled" type="checkbox" ${boolSetting(settings.webdav_backup_enabled) ? 'checked' : ''}><span>Enable WebDAV backup</span></label>
          <label><span>WebDAV Directory URL</span><input id="settingWebdavUrl" value="${escapeHtml(settings.webdav_backup_url || '')}"></label>
          <label><span>WebDAV username</span><input id="settingWebdavUsername" value="${escapeHtml(settings.webdav_backup_username || '')}"></label>
          <label><span>WebDAV password</span><input id="settingWebdavPassword" type="password" value="${escapeHtml(settings.webdav_backup_password || '')}"></label>
          <label><span>WebDAV Cron</span><input id="settingWebdavCron" value="${escapeHtml(settings.webdav_backup_cron || '0 3 * * *')}"></label>
          <label><span>Modify/upload verification password</span><input id="settingWebdavVerifyPassword" type="password"></label>
          <div class="item-meta">Last time: ${escapeHtml(settings.webdav_backup_last_status || '')} ${escapeHtml(settings.webdav_backup_last_message || '')}</div>
        </div>
        <div class="card">
          <label><span>External API Key</span><input id="settingExternalKey" value="${escapeHtml(settings.external_api_key || '')}"></label>
          <div class="toolbar wrap">
            <button id="btnSaveSettings" class="primary-btn" type="button">Save settings</button>
            <button id="btnValidateRefreshCron" class="secondary-btn" type="button">Verify refresh Cron</button>
            <button id="btnTestSmtp" class="secondary-btn" type="button">Test SMTP</button>
            <button id="btnTestTelegram" class="secondary-btn" type="button">Test Telegram</button>
            <button id="btnTestWecom" class="secondary-btn" type="button">Test enterprise WeChat</button>
            <button id="btnTestWebdav" class="secondary-btn" type="button">Testing WebDAV</button>
            <button id="btnUploadWebdav" class="secondary-btn" type="button">Upload WebDAV backup</button>
          </div>
        </div>
        <div id="settingsResult"></div>
      `);
      getEl('btnSaveSettings').addEventListener('click', () => saveSettings(config));
      getEl('btnValidateRefreshCron').addEventListener('click', () => validateCron(config, valueOf('settingRefreshCron'), 5));
      getEl('btnTestSmtp').addEventListener('click', () => testForwardChannel(config, 'smtp'));
      getEl('btnTestTelegram').addEventListener('click', () => testForwardChannel(config, 'telegram'));
      getEl('btnTestWecom').addEventListener('click', () => testForwardChannel(config, 'wecom'));
      getEl('btnTestWebdav').addEventListener('click', () => testWebdav(config));
      getEl('btnUploadWebdav').addEventListener('click', () => uploadWebdav(config));
      const syncForwardExecutionMode = () => {
        const modeEl = getEl('settingForwardExecutionMode');
        const delayEl = getEl('settingForwardAccountDelay');
        if (!modeEl || !delayEl) return;
        const isParallel = modeEl.value === 'parallel';
        delayEl.disabled = isParallel;
        if (isParallel) {
          delayEl.value = '0';
        }
      };
      getEl('settingForwardExecutionMode')?.addEventListener('change', syncForwardExecutionMode);
      syncForwardExecutionMode();
    }, I18n.t("Loading settings..."));
  }

  function collectSettingsPayload() {
    const forwardCheckIntervalSeconds = toInt(valueOf('settingForwardCheckIntervalSeconds'), 300);
    const forwardExecutionMode = valueOf('settingForwardExecutionMode') === 'parallel' ? 'parallel' : 'serial';
    const forwardAccountDelaySeconds = forwardExecutionMode === 'parallel' ? 0 : toInt(valueOf('settingForwardAccountDelay'), 0);
    return {
      gptmail_api_key: valueOf('settingGptmailKey'),
      app_timezone: valueOf('settingTimezone'),
      refresh_interval_days: valueOf('settingRefreshDays'),
      refresh_delay_seconds: valueOf('settingRefreshDelay'),
      refresh_cron: valueOf('settingRefreshCron'),
      use_cron_schedule: checked('settingUseCron'),
      enable_scheduled_refresh: checked('settingScheduledRefresh'),
      show_account_created_at: checked('settingShowCreated'),
      show_account_sort_order: checked('settingShowSort'),
      show_group_id: checked('settingShowGroupId'),
      external_api_key: valueOf('settingExternalKey'),
      duckmail_base_url: valueOf('settingDuckmailBaseUrl'),
      duckmail_api_key: valueOf('settingDuckmailApiKey'),
      cloudflare_worker_domain: valueOf('settingCloudflareWorkerDomain'),
      cloudflare_email_domains: valueOf('settingCloudflareEmailDomains'),
      cloudflare_admin_password: valueOf('settingCloudflareAdminPassword'),
      forward_channels: Array.from(document.querySelectorAll('[name="settingForwardChannel"]:checked')).map((item) => item.value),
      forward_check_interval_seconds: forwardCheckIntervalSeconds,
      forward_check_interval_minutes: Math.max(1, Math.min(60, Math.ceil(forwardCheckIntervalSeconds / 60))),
      forward_execution_mode: forwardExecutionMode,
      forward_parallel_workers: toInt(valueOf('settingForwardParallelWorkers'), 4),
      forward_account_delay_seconds: forwardAccountDelaySeconds,
      forward_email_window_minutes: valueOf('settingForwardWindow'),
      forward_include_junkemail: checked('settingForwardJunk'),
      email_forward_recipient: valueOf('settingForwardRecipient'),
      smtp_host: valueOf('settingSmtpHost'),
      smtp_port: valueOf('settingSmtpPort'),
      smtp_username: valueOf('settingSmtpUsername'),
      smtp_password: valueOf('settingSmtpPassword'),
      smtp_from_email: valueOf('settingSmtpFromEmail'),
      smtp_provider: valueOf('settingSmtpProvider'),
      smtp_use_tls: checked('settingSmtpTls'),
      smtp_use_ssl: checked('settingSmtpSsl'),
      telegram_bot_token: valueOf('settingTelegramBotToken'),
      telegram_chat_id: valueOf('settingTelegramChatId'),
      telegram_proxy_url: valueOf('settingTelegramProxyUrl'),
      wecom_webhook_url: valueOf('settingWecomWebhookUrl'),
      webdav_backup_enabled: checked('settingWebdavEnabled'),
      webdav_backup_url: valueOf('settingWebdavUrl'),
      webdav_backup_username: valueOf('settingWebdavUsername'),
      webdav_backup_password: valueOf('settingWebdavPassword'),
      webdav_backup_cron: valueOf('settingWebdavCron'),
      webdav_backup_verify_password: valueOf('settingWebdavVerifyPassword'),
    };
  }

  async function saveSettings(config) {
    await runAction(config, async () => {
      const payload = await Api.apiRequest(config, '/api/settings', {
        method: 'PUT',
        body: collectSettingsPayload(),
        timeoutMs: 70000,
      });
      getEl('settingsResult').innerHTML = renderResult(payload);
    }, I18n.t("Saving settings..."));
  }

  async function validateCron(config, cronExpression, expectedFields) {
    await runAction(config, async () => {
      const payload = await Api.apiRequest(config, '/api/settings/validate-cron', {
        method: 'POST',
        body: {
          cron_expression: cronExpression,
          time_zone: valueOf('settingTimezone'),
          expected_fields: expectedFields,
        },
      });
      getEl('settingsResult').innerHTML = renderResult(payload);
    }, I18n.t("Verifying Cron..."));
  }

  function forwardTestConfig() {
    return {
      smtp: {
        host: valueOf('settingSmtpHost'),
        port: toInt(valueOf('settingSmtpPort'), 465),
        username: valueOf('settingSmtpUsername'),
        password: valueOf('settingSmtpPassword'),
        from_email: valueOf('settingSmtpFromEmail'),
        recipient: valueOf('settingForwardRecipient'),
        provider: valueOf('settingSmtpProvider'),
        use_tls: checked('settingSmtpTls'),
        use_ssl: checked('settingSmtpSsl'),
      },
      telegram: {
        bot_token: valueOf('settingTelegramBotToken'),
        chat_id: valueOf('settingTelegramChatId'),
        proxy_url: valueOf('settingTelegramProxyUrl'),
      },
      wecom: {
        webhook_url: valueOf('settingWecomWebhookUrl'),
      },
    };
  }

  async function testForwardChannel(config, channel) {
    await runAction(config, async () => {
      const payload = await Api.apiRequest(config, '/api/settings/test-forward-channel', {
        method: 'POST',
        body: { channel, config: forwardTestConfig() },
        timeoutMs: 70000,
      });
      getEl('settingsResult').innerHTML = renderResult(payload);
    }, I18n.tpl`Testing ${channel}...`);
  }

  function webdavConfig() {
    return {
      url: valueOf('settingWebdavUrl'),
      username: valueOf('settingWebdavUsername'),
      password: valueOf('settingWebdavPassword'),
    };
  }

  async function testWebdav(config) {
    await runAction(config, async () => {
      const payload = await Api.apiRequest(config, '/api/settings/test-webdav-backup', {
        method: 'POST',
        body: { config: webdavConfig() },
        timeoutMs: 70000,
      });
      getEl('settingsResult').innerHTML = renderResult(payload);
    }, I18n.t("Testing WebDAV..."));
  }

  async function uploadWebdav(config) {
    await runAction(config, async () => {
      const payload = await Api.apiRequest(config, '/api/settings/upload-webdav-backup', {
        method: 'POST',
        body: {
          login_password: valueOf('settingWebdavVerifyPassword'),
          config: webdavConfig(),
        },
        timeoutMs: 10 * 60 * 1000,
      });
      getEl('settingsResult').innerHTML = renderResult(payload);
    }, I18n.t("Uploading WebDAV backup..."));
  }

  function toggleConfigPanel() {
    getEl('configPanel').classList.toggle('collapsed');
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const config = await Storage.getConfig();
    getEl('serverUrl').value = config.serverUrl || '';
    getEl('password').value = config.password || '';
    getEl('rememberPassword').checked = config.rememberPassword === true;

    getEl('btnConfig').addEventListener('click', toggleConfigPanel);
    getEl('btnLogin').addEventListener('click', async () => {
      await saveConfig();
      await renderView(currentView);
    });
    getEl('btnReload').addEventListener('click', () => renderView(currentView));

    document.querySelectorAll('.quick-bar button').forEach((button) => {
      button.addEventListener('click', () => renderView(button.dataset.view || 'mail'));
    });

    setActiveView(currentView);
    if (config.serverUrl && config.password) {
      getEl('configPanel').classList.add('collapsed');
      await renderView(currentView);
    } else {
      setContent(I18n.t("<div class=\"card muted\">After filling in the service address and Web login password, directly click the function above to operate in the sidebar.</div>"));
    }
  });
})();
