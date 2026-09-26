(function () {
  const REQUEST_TIMEOUT_MS = 15000;
  let cachedCsrfToken = '';

  function trimUrl(serverUrl) {
    return String(serverUrl || '').trim().replace(/\/+$/, '');
  }

  function buildOriginPattern(serverUrl) {
    const parsed = new URL(serverUrl);
    return `${parsed.protocol}//${parsed.host}/*`;
  }

  function requestPermission(permissions) {
    return new Promise((resolve) => {
      chrome.permissions.request(permissions, (granted) => {
        resolve(granted === true);
      });
    });
  }

  function containsPermission(permissions) {
    return new Promise((resolve) => {
      chrome.permissions.contains(permissions, (granted) => {
        resolve(granted === true);
      });
    });
  }

  async function ensureHostPermission(serverUrl) {
    const origin = buildOriginPattern(serverUrl);
    const permissions = { origins: [origin] };
    if (await containsPermission(permissions)) {
      return true;
    }
    return requestPermission(permissions);
  }

  async function fetchRaw(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
    const requestOptions = {
      ...options,
      credentials: 'include',
      headers: { ...options.headers, 'X-Outlook-Language': I18n.language },
      signal: controller.signal,
    };
    delete requestOptions.timeoutMs;

    try {
      return await fetch(url, requestOptions);
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchJson(url, options = {}) {
    const response = await fetchRaw(url, options);
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const message = payload && (payload.error || payload.message)
        ? (payload.error || payload.message)
        : `HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async function fetchText(url, options = {}) {
    const response = await fetchRaw(url, options);
    const text = await response.text();
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
      if (payload && (payload.error || payload.message)) {
        message = payload.error || payload.message;
      }
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return text;
  }

  function friendlyError(error) {
    if (error && error.name === 'AbortError') {
      return I18n.t("Request timed out, please check the service address or network");
    }
    if (error instanceof TypeError && /fetch/i.test(error.message)) {
      return I18n.t("Unable to connect to the server, please check the address and browser permissions");
    }
    return (error && error.message) || I18n.t("Unknown error");
  }

  function isMissingExtensionLogin(error) {
    const message = String((error && error.message) || '').toLowerCase();
    return message.includes('404 not found') || message.includes('not found on the server');
  }

  function waitForTabComplete(tabId, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        reject(new Error(I18n.t("Login page loading timeout")));
      }, timeoutMs);

      function onUpdated(updatedTabId, changeInfo) {
        if (updatedTabId !== tabId || changeInfo.status !== 'complete') {
          return;
        }
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }

      chrome.tabs.onUpdated.addListener(onUpdated);
    });
  }

  async function loginForLaunch(config, nextPath = '/') {
    const serverUrl = trimUrl(config.serverUrl);
    const password = String(config.password || '');
    if (!serverUrl) {
      throw new Error(I18n.t("Please fill in the service address first"));
    }
    if (!password) {
      throw new Error(I18n.t("Please fill in the login password first"));
    }

    const granted = await ensureHostPermission(serverUrl);
    if (!granted) {
      throw new Error(I18n.t("You need to allow access to the service address before you can continue."));
    }

    const payload = await fetchJson(`${serverUrl}/api/extension/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password,
        next: nextPath || '/',
      }),
    });

    if (!payload || payload.success === false || !payload.launch_url) {
      throw new Error((payload && (payload.error || payload.message)) || I18n.t("Login failed"));
    }

    return {
      launchUrl: new URL(payload.launch_url, serverUrl).href,
      expiresIn: payload.expires_in || 60,
    };
  }

  async function loginWithPasswordSession(config) {
    const serverUrl = trimUrl(config.serverUrl);
    const password = String(config.password || '');
    if (!serverUrl || !password) {
      throw new Error(I18n.t("Please fill in the service address and login password first"));
    }

    const granted = await ensureHostPermission(serverUrl);
    if (!granted) {
      throw new Error(I18n.t("You need to allow access to the service address before you can continue."));
    }

    const payload = await fetchJson(`${serverUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (!payload || payload.success !== true) {
      throw new Error((payload && (payload.error || payload.message)) || I18n.t("Login failed"));
    }
    return true;
  }

  async function openConsole(config, nextPath = '/') {
    try {
      const result = await loginForLaunch(config, nextPath);
      await chrome.tabs.create({ url: result.launchUrl });
      return result;
    } catch (error) {
      if (!isMissingExtensionLogin(error)) {
        throw error;
      }
      return openConsoleWithLoginPage(config, nextPath);
    }
  }

  async function getEmbeddedConsoleUrl(config, nextPath = '/') {
    const serverUrl = trimUrl(config.serverUrl);
    try {
      const result = await loginForLaunch(config, nextPath);
      return result.launchUrl;
    } catch (error) {
      if (!isMissingExtensionLogin(error)) {
        throw error;
      }
      await loginWithPasswordSession(config);
      return `${serverUrl}${nextPath || '/'}`;
    }
  }

  async function openConsoleWithLoginPage(config, nextPath = '/') {
    const serverUrl = trimUrl(config.serverUrl);
    const password = String(config.password || '');
    if (!serverUrl || !password) {
      throw new Error(I18n.t("Please fill in the service address and login password first"));
    }

    const granted = await ensureHostPermission(serverUrl);
    if (!granted) {
      throw new Error(I18n.t("You need to allow access to the service address before you can continue."));
    }

    const tab = await chrome.tabs.create({ url: `${serverUrl}/login`, active: true });
    if (!tab || !tab.id) {
      throw new Error(I18n.t("Unable to open login page"));
    }

    await waitForTabComplete(tab.id);
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [password, nextPath || '/', I18n.t("Login failed"), I18n.language],
      func: async (loginPassword, targetPath, loginFailure, language) => {
        function showLoginError(message) {
          const errorMessage = document.getElementById('errorMessage');
          if (errorMessage) {
            errorMessage.textContent = message;
            errorMessage.classList.add('show');
          }
        }

        try {
          const response = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Outlook-Language': language },
            body: JSON.stringify({ password: loginPassword }),
          });
          const data = await response.json();
          if (!data || data.success !== true) {
            const message = (data && (data.error || data.message)) || loginFailure;
            showLoginError(message);
            return { success: false, error: message };
          }
          window.location.href = targetPath || '/';
          return { success: true };
        } catch (err) {
          const message = (err && err.message) || loginFailure;
          showLoginError(message);
          return { success: false, error: message };
        }
      },
    });

    const result = results && results[0] ? results[0].result : null;
    if (!result || result.success !== true) {
      throw new Error((result && result.error) || I18n.t("Login failed"));
    }
    return { fallback: 'login-page' };
  }

  async function getCsrfToken(config) {
    const serverUrl = trimUrl(config.serverUrl);
    const payload = await fetchJson(`${serverUrl}/api/csrf-token`, {
      method: 'GET',
    });
    cachedCsrfToken = payload && payload.csrf_token ? payload.csrf_token : '';
    return cachedCsrfToken;
  }

  async function ensureSession(config) {
    const serverUrl = trimUrl(config.serverUrl);
    if (!serverUrl) {
      throw new Error(I18n.t("Please fill in the service address first"));
    }

    const granted = await ensureHostPermission(serverUrl);
    if (!granted) {
      throw new Error(I18n.t("You need to allow access to the service address before you can continue."));
    }

    try {
      await getCsrfToken(config);
      return true;
    } catch {
      cachedCsrfToken = '';
    }

    try {
      const launch = await loginForLaunch(config, '/');
      await fetchRaw(launch.launchUrl, { method: 'GET' });
      await getCsrfToken(config);
      return true;
    } catch (error) {
      if (!isMissingExtensionLogin(error)) {
        cachedCsrfToken = '';
      }
    }

    await loginWithPasswordSession(config);
    await getCsrfToken(config);
    return true;
  }

  async function apiRequest(config, path, options = {}) {
    const serverUrl = trimUrl(config.serverUrl);
    const method = String(options.method || 'GET').toUpperCase();
    const headers = { ...(options.headers || {}) };
    let body = options.body;

    if (body && typeof body !== 'string') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }

    await ensureSession(config);

    if (method !== 'GET' && method !== 'HEAD') {
      if (cachedCsrfToken) {
        headers['X-CSRFToken'] = cachedCsrfToken;
      }
    }

    const normalizedPath = String(path || '').startsWith('/') ? path : `/${path}`;
    return fetchJson(`${serverUrl}${normalizedPath}`, {
      method,
      headers,
      body,
      timeoutMs: options.timeoutMs,
    });
  }

  async function apiTextRequest(config, path, options = {}) {
    const serverUrl = trimUrl(config.serverUrl);
    const method = String(options.method || 'GET').toUpperCase();
    const headers = { ...(options.headers || {}) };
    let body = options.body;

    if (body && typeof body !== 'string') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }

    await ensureSession(config);
    if (method !== 'GET' && method !== 'HEAD' && cachedCsrfToken) {
      headers['X-CSRFToken'] = cachedCsrfToken;
    }

    const normalizedPath = String(path || '').startsWith('/') ? path : `/${path}`;
    return fetchText(`${serverUrl}${normalizedPath}`, {
      method,
      headers,
      body,
      timeoutMs: options.timeoutMs,
    });
  }

  async function apiStreamRequest(config, path, onEvent, options = {}) {
    const serverUrl = trimUrl(config.serverUrl);
    const method = String(options.method || 'GET').toUpperCase();
    const headers = { ...(options.headers || {}) };
    let body = options.body;

    if (body && typeof body !== 'string') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }

    await ensureSession(config);
    if (method !== 'GET' && method !== 'HEAD' && cachedCsrfToken) {
      headers['X-CSRFToken'] = cachedCsrfToken;
    }

    const normalizedPath = String(path || '').startsWith('/') ? path : `/${path}`;
    const response = await fetchRaw(`${serverUrl}${normalizedPath}`, {
      method,
      headers,
      body,
      timeoutMs: options.timeoutMs || 10 * 60 * 1000,
    });

    if (!response.ok) {
      const text = await response.text();
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
      const message = payload && (payload.error || payload.message)
        ? (payload.error || payload.message)
        : `HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    function emitBlock(block) {
      const dataLines = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart());
      if (!dataLines.length) return;
      const rawData = dataLines.join('\n').trim();
      if (!rawData) return;
      try {
        onEvent(JSON.parse(rawData));
      } catch {
        onEvent({ type: 'message', message: rawData });
      }
    }

    if (!response.body || !response.body.getReader) {
      const text = await response.text();
      text.split(/\n\n+/).forEach(emitBlock);
      return true;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\n\n+/);
      buffer = blocks.pop() || '';
      blocks.forEach(emitBlock);
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      emitBlock(buffer);
    }
    return true;
  }

  window.OutlookExtensionApi = {
    trimUrl,
    ensureHostPermission,
    loginForLaunch,
    loginWithPasswordSession,
    openConsole,
    openConsoleWithLoginPage,
    getEmbeddedConsoleUrl,
    getCsrfToken,
    ensureSession,
    apiRequest,
    apiTextRequest,
    apiStreamRequest,
    friendlyError,
    isMissingExtensionLogin,
  };
})();
