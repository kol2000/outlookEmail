(function () {
  const Storage = window.ExtensionStorage;
  const Api = window.OutlookExtensionApi;

  function getEl(id) {
    return document.getElementById(id);
  }

  function setBusy(isBusy) {
    ['btnTest', 'btnOpen', 'btnLogout', 'btnClear'].forEach((id) => {
      const el = getEl(id);
      if (el) el.disabled = isBusy;
    });
    document.querySelectorAll('.quick-btn').forEach((button) => {
      button.disabled = isBusy;
    });
  }

  function showMessage(message, type) {
    const el = getEl('message');
    el.textContent = message || '';
    el.classList.toggle('error', type === 'error');
  }

  function setConnected(connected) {
    const pill = getEl('statusPill');
    pill.textContent = connected ? I18n.t("Verified") : I18n.t("Not connected");
    pill.classList.toggle('ok', connected);
  }

  function readFormConfig() {
    return {
      serverUrl: Api.trimUrl(getEl('serverUrl').value),
      password: getEl('password').value,
      rememberPassword: getEl('rememberPassword').checked,
    };
  }

  async function saveFormConfig(config) {
    await Storage.setConfig(config);
  }

  async function openSidePanel(nextPath) {
    const config = readFormConfig();
    await saveFormConfig(config);
    await Storage.setSidePanelPath(nextPath || '/');
    setBusy(true);
    showMessage(I18n.t("Opening sidebar..."));
    try {
      if (!chrome.sidePanel || !chrome.sidePanel.open) {
        throw new Error(I18n.t("The current browser does not support Side Panel, please upgrade Chrome / Edge"));
      }
      const currentWindow = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: currentWindow.id });
      setConnected(true);
      showMessage(I18n.t("Sidebar console opened"));
    } catch (error) {
      setConnected(false);
      showMessage(Api.friendlyError(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function testLogin() {
    const config = readFormConfig();
    await saveFormConfig(config);
    setBusy(true);
    showMessage(I18n.t("Verifying password..."));
    try {
      await Api.loginForLaunch(config, '/');
      setConnected(true);
      showMessage(I18n.t("Password verification is passed and the console can be opened."));
    } catch (error) {
      if (Api.isMissingExtensionLogin(error)) {
        try {
          await Api.loginWithPasswordSession(config);
          setConnected(true);
          showMessage(I18n.t("After the compatibility mode password verification is passed, you can open the sidebar console"));
          return;
        } catch (fallbackError) {
          setConnected(false);
          showMessage(Api.friendlyError(fallbackError), 'error');
          return;
        }
      }
      setConnected(false);
      showMessage(Api.friendlyError(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function openLogout() {
    const config = readFormConfig();
    if (!config.serverUrl) {
      showMessage(I18n.t("Please fill in the service address first"), 'error');
      return;
    }
    await openSidePanel('/logout');
  }

  async function clearConfig() {
    await Storage.clearConfig();
    getEl('serverUrl').value = '';
    getEl('password').value = '';
    getEl('rememberPassword').checked = false;
    setConnected(false);
    showMessage(I18n.t("Local configuration cleared"));
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const config = await Storage.getConfig();
    getEl('serverUrl').value = config.serverUrl || '';
    getEl('password').value = config.password || '';
    getEl('rememberPassword').checked = config.rememberPassword === true;

    getEl('btnTest').addEventListener('click', testLogin);
    getEl('btnOpen').addEventListener('click', () => openSidePanel('/'));
    getEl('btnLogout').addEventListener('click', openLogout);
    getEl('btnClear').addEventListener('click', clearConfig);

    document.querySelectorAll('.quick-btn').forEach((button) => {
      button.addEventListener('click', () => openSidePanel(button.dataset.next || '/'));
    });
  });
})();
