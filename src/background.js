// background.js — Download Nexus service worker
// Uses a persistent session (sid) to avoid displacing DSM browser sessions.

// ── Content Script Registry ────────────────────────────────────────────────
// Handles dynamic content script registration and re-injection

const CONTENT_SCRIPT_FILES = [
  'protocols.js',
  'linkDetector.js',
  'serviceFilter.js',
  'downloadSender.js',
  'content.js'
];

let isRegisteringContentScripts = false;

async function registerContentScripts() {
  if (isRegisteringContentScripts) {
    console.debug('[ContentScriptRegistry] Registration already in progress, skipping');
    return;
  }

  isRegisteringContentScripts = true;

  try {
    if (!chrome?.scripting?.registerContentScripts) {
      console.warn('[ContentScriptRegistry] chrome.scripting not available');
      return;
    }

    try {
      await chrome.scripting.unregisterContentScripts({
        ids: ['download-nexus-content'],
      });
      console.debug('[ContentScriptRegistry] Unregistered existing content scripts');
    } catch (err) {
      console.debug('[ContentScriptRegistry] No existing scripts to unregister');
    }

    await chrome.scripting.registerContentScripts([
      {
        id: 'download-nexus-content',
        matches: ['<all_urls>'],
        js: CONTENT_SCRIPT_FILES,
        runAt: 'document_idle',
      },
    ]);

    console.log('[ContentScriptRegistry] ✅ Content scripts registered persistently');
  } catch (err) {
    console.error('[ContentScriptRegistry] ❌ Failed to register content scripts:', err instanceof Error ? err.message : String(err));
  } finally {
    isRegisteringContentScripts = false;
  }
}

async function reinjectContentScripts() {
  console.log('[ContentScriptRegistry] 🔄 Re-injecting content scripts into all tabs...');
  try {
    if (!chrome?.scripting?.executeScript) {
      console.error('[ContentScriptRegistry] ❌ chrome.scripting API not available');
      return;
    }

    const allTabs = await chrome.tabs.query({
      url: ['http://*/*', 'https://*/*'],
    });

    const eligibleTabs = allTabs.filter(tab => {
      if (!tab.id || tab.discarded || tab.status === 'unloaded') return false;
      const tabUrl = tab.url || '';
      if (tabUrl.startsWith('chrome-extension://') ||
          tabUrl.startsWith('chrome://') ||
          tabUrl.startsWith('edge://') ||
          tabUrl.startsWith('edge-extension://') ||
          tabUrl.startsWith('about:')) {
        return false;
      }
      return true;
    });

    console.log(`[ContentScriptRegistry] Injecting into ${eligibleTabs.length} active tabs in parallel...`);

    const results = await Promise.allSettled(eligibleTabs.map(async tab => {
      const injectionPromise = chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: CONTENT_SCRIPT_FILES,
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Injection timeout after 2500ms")), 2500)
      );

      return await Promise.race([injectionPromise, timeoutPromise]);
    }));

    let successCount = 0;
    let failureCount = 0;
    results.forEach((res, i) => {
      if (res.status === "fulfilled") {
        successCount++;
      } else {
        failureCount++;
        console.debug(`[ContentScriptRegistry] Tab ${eligibleTabs[i].id} injection note:`, res.reason?.message);
      }
    });

    console.log(`[ContentScriptRegistry] 🏁 Re-injection complete: ${successCount} successful, ${failureCount} skipped/failed`);
  } catch (err) {
    console.error('[ContentScriptRegistry] ❌ Re-injection routine failed:', err instanceof Error ? err.message : String(err));
  }
}

// ── NAS Adapter Abstraction Layer ──────────────────────────────────────────
// Allows support for multiple NAS types (Synology, QNAP, etc.)

class NasAdapter {
  constructor(nasId, config) {
    this.nasId = nasId;
    this.config = config;
  }

  async addDownload(uri, destination) {
    throw new Error("addDownload() not implemented");
  }
}

class SynologyAdapter extends NasAdapter {
  async testConnection() {
    if (!this.config?.host || !this.config?.port || !this.config?.username) {
      throw new Error("Settings incomplete: missing host, port, or username");
    }
    await removeSid(this.nasId);
    const sid = await getSid(this.nasId, this.config, true);
    const infoUrl = `${baseUrl(this.config)}/DownloadStation/info.cgi?api=SYNO.DownloadStation.Info&version=1&method=getinfo&_sid=${sid}`;
    const resp = await nasFetch("DS_INFO", infoUrl, { credentials: "include" });
    const text = await resp.text();
    const data = JSON.parse(text);
    if (!data.success) throw new Error(`Download Station error code ${data.error?.code ?? "?"}`);
    await storeSid(this.nasId, sid);
    return { ok: true, version: data.data?.version_string ?? "" };
  }

  _displayStatus(rawStatus) {
    // Map Synology Download Station status to unified format (P0-4)
    const statusMap = {
      "downloading": "downloading",
      "completed": "finished",
      "finished": "finished",
      "active": "seeding",
      "uploading": "seeding",
      "seeding": "seeding",
      "stopped": "paused",
      "paused": "paused",
      "inactive": "paused",
      "waiting": "stalled",            // P0-4: Waiting = stalled (not user-paused)
      "error": "error"
    };
    return statusMap[rawStatus] || rawStatus;
  }

  async listTasks() {
    const sid = await getSid(this.nasId, this.config);
    const url = `${baseUrl(this.config)}/DownloadStation/task.cgi?api=SYNO.DownloadStation.Task&version=1&method=list&additional=transfer&_sid=${sid}`;
    const resp = await nasFetch("LIST_TASKS", url, { credentials: "include" });
    const text = await resp.text();
    const data = JSON.parse(text);
    if (!data.success) throw new Error(`List tasks failed (DSM code ${data.error?.code ?? "?"})`);
    const tasks = data.data.tasks || [];
    // Map status values from Synology API to UI-compatible statuses
    return tasks.map(t => ({
      ...t,
      status: this._displayStatus(t.status)
    }));
  }

  async addDownload(uri, destination) {
    const isMagnet = uri.startsWith("magnet:");
    const isTorrentUrl = !isMagnet && isValidTorrentURL(uri);

    if (!isMagnet && !isTorrentUrl) {
      throw new Error("Invalid URI: must be a magnet link or .torrent URL");
    }

    await synoAddDownload(this.config, this.nasId, uri, destination);
  }

  async taskAction(action, ids) {
    const sid = await getSid(this.nasId, this.config);
    await taskAction(this.config, sid, action, ids);
  }
}

class QBittorrentAdapter extends NasAdapter {
  constructor(nasId, config) {
    super(nasId, config);
    this._isTokenAuth = !!config?.apiToken && config.apiToken.trim().length > 0;
  }

  async testConnection() {
    if (!this.config?.host || !this.config?.port) {
      throw new Error("Settings incomplete: missing host or port");
    }

    // Token auth doesn't require username, but username/password auth does
    if (!this._isTokenAuth && !this.config?.username) {
      throw new Error("Settings incomplete: missing username (or provide API token)");
    }

    try {
      if (this._isTokenAuth) {
        // For token auth, make a simple API call to verify the token works
        await this._fetch("/app/webapiVersion");
      } else {
        // For password auth, just verify login succeeds
        await this._login();
      }
      return { ok: true, version: "qBittorrent", type: "qBittorrent" };
    } catch (err) {
      if (err.message.includes("auth")) {
        throw new Error("qBittorrent auth failed: invalid credentials or API token");
      }
      throw err;
    }
  }

  async listTasks() {
    const resp = await this._fetch("/torrents/info");
    const text = await resp.text();
    let data = JSON.parse(text);
    if (!Array.isArray(data)) return [];

    const tasks = data.map(t => ({
      id: t.hash,
      title: t.name,
      status: this._displayStatus(t.state),
      rawStatus: t.state,
      progress: t.progress * 100,
      downloaded: t.downloaded,
      uploaded: t.uploaded,
      size: t.total_size,
      speed_down: t.dlspeed,
      speed_up: t.upspeed,
      eta: t.eta
    }));
    dbg("QBittorrentAdapter.listTasks returning:", tasks.length, "tasks with fields:", tasks[0] ? Object.keys(tasks[0]) : "none");
    return tasks;
  }

  _displayStatus(rawState) {
    // Map qBittorrent states to unified format (P0-4)
    const stateMap = {
      // Active states
      "downloading": "downloading",
      "forcedDL": "downloading",
      "metaDL": "downloading",
      "uploading": "seeding",
      "forcedUP": "seeding",
      // Paused states
      "stoppedDL": "paused",
      "stoppedUP": "paused",
      // Stalled/waiting states
      "stalledDL": "stalled",
      "stalledUP": "stalled",
      "queuedForChecking": "checking",
      // Checking states
      "checkingUP": "checking",
      "checkingDL": "checking",
      // Allocating
      "allocating": "allocating",
      // Error states
      "error": "error",
      "missingFiles": "error"
    };
    return stateMap[rawState] || rawState;
  }

  async addDownload(uri, destination) {
    const isMagnet = uri.startsWith("magnet:");
    const isTorrentUrl = !isMagnet && isValidTorrentURL(uri);

    if (!isMagnet && !isTorrentUrl) {
      throw new Error("Invalid URI: must be a magnet link or .torrent URL");
    }

    let finalUri = uri;
    if (isTorrentUrl) {
      const torrentBuffer = await downloadTorrentFile(uri);
      finalUri = await torrentToMagnet(torrentBuffer);
    }

    // For password auth, ensure we're logged in first
    if (!this._isTokenAuth) {
      await this._login();
    }

    const formData = new FormData();
    formData.append("urls", finalUri);
    if (destination) {
      formData.append("savepath", destination);
    }
    const resp = await this._fetch("/torrents/add", {
      method: "POST",
      body: formData
    });

    // 409 means torrent already exists (already added), which is fine
    if (resp.status === 409) {
      return;
    }

    const text = await resp.text();
    // qBittorrent returns either "Ok" or a JSON with torrent info
    if (text.toLowerCase() !== "ok" && !text.startsWith("{")) {
      throw new Error(`qBit add torrent failed: ${text}`);
    }
  }

  async taskAction(action, ids) {
    // qBittorrent API v2 action endpoints
    const actionMap = {
      "pause": "stop",      // qBittorrent uses /stop not /pause
      "resume": "start",    // qBittorrent uses /start not /resume
      "delete": "delete"    // qBittorrent uses /delete endpoint
    };

    const qbAction = actionMap[action];
    if (!qbAction) throw new Error(`Unknown action: ${action}`);

    await this._call(async () => {
      const params = new URLSearchParams();
      params.append("hashes", ids.join("|"));
      if (action === "delete") {
        params.append("deleteFiles", "false");
      }
      const resp = await this._fetch(`/torrents/${qbAction}`, {
        method: "POST",
        body: params,
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      });
      const text = await resp.text();
      // qBittorrent returns empty response (200) on success
      if (!resp.ok) {
        throw new Error(`qBit action failed: HTTP ${resp.status}`);
      }
    });
  }

  // Private methods
  async _login() {
    // Token auth doesn't require login (P1-2)
    if (this._isTokenAuth) {
      return;
    }

    const scheme = this.config.https ? "https" : "http";
    const url = `${scheme}://${this.config.host}:${this.config.port}/api/v2/auth/login`;
    const baseUrl = `${scheme}://${this.config.host}:${this.config.port}`;
    const body = new URLSearchParams();
    body.append('username', this.config.username);
    body.append('password', this.config.password);

    try {
      const resp = await fetch(url, {
        method: "POST",
        body: body,
        credentials: "include",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Referer": baseUrl,
          "Origin": baseUrl,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Accept-Encoding": "gzip, deflate",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      });

      if (resp.status === 204 || resp.status === 200) {
        return true;
      }
      const respText = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${respText.slice(0, 100)}`);
    } catch (err) {
      throw new Error(`qBit auth failed: ${err.message}`);
    }
  }

  async _fetch(path, options = {}) {
    const url = `${this._baseUrl()}/api/v2${path}`;
    const baseUrl = this._baseUrl();

    // Add API token header if token auth is enabled (P1-2)
    const headers = options.headers || {};
    if (this._isTokenAuth) {
      headers["X-API-Token"] = this.config.apiToken;
    }

    // Add browser headers for CSRF protection (required by qBittorrent)
    headers["Referer"] = baseUrl;
    headers["Origin"] = baseUrl;
    // Only set Content-Type for non-FormData requests (FormData sets its own)
    if (!(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
      headers["Accept-Language"] = "en-US,en;q=0.5";
      headers["Accept-Encoding"] = "gzip, deflate";
      headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
    }

    const resp = await fetch(url, { ...options, headers });
    if (resp.status === 403 || resp.status === 401) throw new Error("qBit auth failed");
    if (!resp.ok) throw new Error(`qBit API error: ${resp.status}`);
    return resp;
  }

  async _call(apiFn) {
    try {
      return await apiFn();
    } catch (err) {
      // Don't retry login for token auth (P1-2)
      if (err.message.includes("auth failed") && !this._isTokenAuth) {
        await this._login();
        return await apiFn();
      }
      throw err;
    }
  }

  _baseUrl() {
    const scheme = this.config.https ? "https" : "http";
    return `${scheme}://${this.config.host}:${this.config.port}`;
  }
}

class TransmissionAdapter extends NasAdapter {
  async testConnection() {
    if (!this.config?.host || !this.config?.port) {
      throw new Error("Settings incomplete: missing host or port");
    }
    const url = `${this._baseUrl()}/rpc`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Transmission-Session-Id": "test-session"
      },
      body: JSON.stringify({ method: "session-get", arguments: {} })
    });
    if (!resp.ok) throw new Error(`Transmission connection failed: HTTP ${resp.status}`);
    return { ok: true, version: "Transmission", type: "Transmission" };
  }

  async listTasks(retryCount = 0) {
    const auth = this.config.username ? `${this.config.username}:${this.config.password}` : null;
    const headers = {
      "Content-Type": "application/json",
      "X-Transmission-Session-Id": await this._getSessionId()
    };
    if (auth) headers["Authorization"] = `Basic ${btoa(auth)}`;

    const body = {
      method: "torrent-get",
      arguments: {
        fields: ["id", "name", "status", "percentDone", "downloadedEver", "uploadedEver", "totalSize", "rateDownload", "rateUpload", "eta"]
      }
    };

    const resp = await fetch(`${this._baseUrl()}/transmission/rpc`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    if (resp.status === 409) {
      // Session ID expired, retry up to 3 times
      if (retryCount < 3) {
        return this.listTasks(retryCount + 1);
      }
      throw new Error("Transmission session refresh failed after 3 retries");
    }

    const data = await resp.json();
    if (!data.result || data.result !== "success") {
      throw new Error(`Transmission get torrents failed: ${data.result}`);
    }

    const torrents = data.arguments?.torrents || [];
    return torrents.map(t => ({
      id: t.id.toString(),
      title: t.name,
      status: this._statusString(t.status),
      rawStatus: t.status,
      progress: t.percentDone * 100,
      downloaded: t.downloadedEver,
      uploaded: t.uploadedEver,
      size: t.totalSize,
      speed_down: t.rateDownload,
      speed_up: t.rateUpload,
      eta: t.eta > 0 ? t.eta : 0
    }));
  }

  async addDownload(uri, destination) {
    const isMagnet = uri.startsWith("magnet:");
    const isTorrentUrl = !isMagnet && isValidTorrentURL(uri);

    if (!isMagnet && !isTorrentUrl) {
      throw new Error("Invalid URI: must be a magnet link or .torrent URL");
    }

    const auth = this.config.username ? `${this.config.username}:${this.config.password}` : null;
    const headers = {
      "Content-Type": "application/json",
      "X-Transmission-Session-Id": await this._getSessionId()
    };
    if (auth) headers["Authorization"] = `Basic ${btoa(auth)}`;

    let filename = null;
    if (isTorrentUrl) {
      const torrentBuffer = await downloadTorrentFile(uri);
      filename = arrayBufferToBase64(torrentBuffer);
    }

    const body = {
      method: "torrent-add",
      arguments: {
        ...(isMagnet ? { filename: uri } : { metainfo: filename }),
        ...(destination ? { "download-dir": destination } : {})
      }
    };

    const resp = await fetch(`${this._baseUrl()}/transmission/rpc`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    const data = await resp.json();
    if (data.result !== "success") {
      throw new Error(`Transmission add torrent failed: ${data.result}`);
    }
  }

  async taskAction(action, ids) {
    const actionMap = {
      "pause": "torrent-stop",
      "resume": "torrent-start",
      "delete": "torrent-remove"
    };

    const transmissionAction = actionMap[action];
    if (!transmissionAction) throw new Error(`Unknown action: ${action}`);

    const auth = this.config.username ? `${this.config.username}:${this.config.password}` : null;
    const headers = {
      "Content-Type": "application/json",
      "X-Transmission-Session-Id": await this._getSessionId()
    };
    if (auth) headers["Authorization"] = `Basic ${btoa(auth)}`;

    const body = {
      method: transmissionAction,
      arguments: {
        ids: ids.map(id => parseInt(id)),
        ...(action === "delete" ? { "delete-local-data": false } : {})
      }
    };

    const resp = await fetch(`${this._baseUrl()}/transmission/rpc`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    const data = await resp.json();
    if (data.result !== "success") {
      throw new Error(`Transmission action failed: ${data.result}`);
    }
  }

  _statusString(numericStatus) {
    // Map Transmission numeric status to unified format (P0-4)
    const stateMap = {
      0: "paused",       // Stopped
      1: "checking",     // Check pending
      2: "checking",     // Checking
      3: "stalled",      // Download pending (P0-4: not active, so stalled)
      4: "downloading",  // Downloading
      5: "stalled",      // Seed pending (P0-4: not active, so stalled)
      6: "seeding"       // Seeding
    };
    return stateMap[numericStatus] || "paused";
  }

  _baseUrl() {
    const scheme = this.config.https ? "https" : "http";
    return `${scheme}://${this.config.host}:${this.config.port}`;
  }

  async _getSessionId() {
    const auth = this.config.username ? `${this.config.username}:${this.config.password}` : null;
    const headers = {
      "Content-Type": "application/json"
    };
    if (auth) headers["Authorization"] = `Basic ${btoa(auth)}`;

    const resp = await fetch(`${this._baseUrl()}/transmission/rpc`, {
      method: "POST",
      headers,
      body: JSON.stringify({ method: "session-get" })
    });

    const sessionId = resp.headers.get("X-Transmission-Session-Id");
    if (sessionId) return sessionId;

    throw new Error("Failed to get Transmission session ID");
  }
}

class DelugeAdapter extends NasAdapter {
  constructor(nasId, config) {
    super(nasId, config);
    this._sessionCookie = null;
    this._isAuthenticated = false;
  }

  _baseUrl() {
    const scheme = this.config.https ? "https" : "http";
    return `${scheme}://${this.config.host}:${this.config.port}`;
  }

  async _ensureAuthenticated() {
    if (this._isAuthenticated) return;

    if (!this.config?.password) {
      throw new Error("Deluge password not configured");
    }

    dbg("INFO", "DelugeAdapter._ensureAuthenticated calling auth.login");
    const resp = await this._rpcRaw("auth.login", [this.config.password]);

    if (resp.error) {
      dbg("ERROR", "DelugeAdapter auth.login failed", resp.error.message);
      throw new Error(`Deluge authentication failed: ${resp.error.message}`);
    }

    if (resp.result === true) {
      dbg("INFO", "DelugeAdapter authenticated successfully");
      // Verify we can actually make API calls - if login succeeds but API calls fail,
      // it means the password change prompt is active
      try {
        await this._rpcRaw("core.get_torrents_status", [{}, []]);
        this._isAuthenticated = true;
      } catch (err) {
        dbg("ERROR", "DelugeAdapter password change prompt detected", err.message);
        throw new Error("Deluge password change required: Access the Deluge web UI and complete the password change prompt before using the extension");
      }
    } else {
      dbg("ERROR", "DelugeAdapter authentication rejected", `result=${resp.result}`);
      throw new Error("Deluge authentication failed: invalid password or daemon rejected login");
    }
  }

  async testConnection() {
    if (!this.config?.host || !this.config?.port) {
      throw new Error("Settings incomplete: missing host or port");
    }
    try {
      dbg("INFO", "DelugeAdapter.testConnection starting", `${this.config.host}:${this.config.port}`);
      await this._ensureAuthenticated();
      dbg("INFO", "DelugeAdapter.testConnection authenticated successfully");
      return { ok: true, version: "Deluge" };
    } catch (err) {
      dbg("ERROR", "DelugeAdapter.testConnection failed", err.message);
      throw new Error(`Deluge connection failed: ${err.message}`);
    }
  }

  async listTasks() {
    dbg("INFO", "DelugeAdapter.listTasks starting");
    await this._ensureAuthenticated();
    dbg("INFO", "DelugeAdapter authenticated, calling core.get_torrents_status");
    const resp = await this._rpc("core.get_torrents_status", [
      {},
      ["name", "state", "progress", "total_done", "total_uploaded", "total_size", "download_payload_rate", "upload_payload_rate", "eta", "time_added"]
    ]);
    dbg("INFO", "DelugeAdapter got response", resp.error ? `error: ${resp.error.message}` : "success");

    if (resp.error) throw new Error(`Deluge list failed: ${resp.error.message}`);

    const torrents = resp.result || {};
    return Object.entries(torrents).map(([hash, t]) => ({
      id: hash,
      title: t.name,
      status: this._displayStatus(t.state),
      rawStatus: t.state,
      progress: (t.progress || 0) * 100,
      downloaded: t.total_done || 0,
      uploaded: t.total_uploaded || 0,
      size: t.total_size || 0,
      speed_down: t.download_payload_rate || 0,
      speed_up: t.upload_payload_rate || 0,
      eta: t.eta > 0 ? t.eta : 0,
      additional: { time_added: t.time_added || 0 }
    }));
  }

  _displayStatus(rawState) {
    // Map Deluge states to UI-compatible strings
    const stateMap = {
      "Downloading": "downloading",
      "Seeding": "seeding",
      "Paused": "paused",
      "Queued": "stalled",          // Queued = waiting
      "Checking": "checking",        // Unmapped state
      "Allocating": "allocating",    // Unmapped state
      "Error": "error"
    };
    return stateMap[rawState] || rawState;
  }

  async addDownload(uri, destination) {
    await this._ensureAuthenticated();
    const isMagnet = uri.startsWith("magnet:");
    const isTorrentUrl = !isMagnet && isValidTorrentURL(uri);

    if (!isMagnet && !isTorrentUrl) {
      throw new Error("Invalid URI: must be a magnet link or .torrent URL");
    }

    const options = {};
    if (destination) options.download_location = destination;

    if (isMagnet) {
      const resp = await this._rpc("core.add_torrent_magnet", [uri, options]);
      if (resp.error) throw new Error(`Deluge add failed: ${resp.error.message}`);
    } else if (isTorrentUrl) {
      const torrentBuffer = await downloadTorrentFile(uri);
      const filedata = arrayBufferToBase64(torrentBuffer);
      const resp = await this._rpc("core.add_torrent_file", ["", filedata, options]);
      if (resp.error) throw new Error(`Deluge add torrent failed: ${resp.error.message}`);
    }
  }

  async taskAction(action, ids) {
    await this._ensureAuthenticated();
    if (action === "pause") {
      const resp = await this._rpc("core.pause_torrents", [ids]);
      if (resp.error) throw new Error(`Deluge pause failed: ${resp.error.message}`);
    } else if (action === "resume") {
      const resp = await this._rpc("core.resume_torrents", [ids]);
      if (resp.error) throw new Error(`Deluge resume failed: ${resp.error.message}`);
    } else if (action === "delete") {
      const resp = await this._rpc("core.remove_torrents", [ids, false]);
      if (resp.error) throw new Error(`Deluge delete failed: ${resp.error.message}`);
    }
  }

  async _rpc(method, params = []) {
    return this._rpcRaw(method, params);
  }

  async _rpcRaw(method, params = []) {
    // Deluge RPC via web UI JSON endpoint
    // Note: Cookies are not automatically managed in Node.js fetch, so use credentials: 'include'
    const payload = { method, params, id: Date.now() };
    const url = `${this._baseUrl()}/json`;

    dbg("INFO", `Deluge RPC call: ${method}`, `params=${JSON.stringify(params).slice(0, 100)}`);

    try {
      const headers = {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest"
      };

      // Add session cookie if we have one
      if (this._sessionCookie) {
        headers["Cookie"] = this._sessionCookie;
      }

      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        credentials: "include"
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      // Extract and store session cookie from response
      const setCookie = resp.headers.get("set-cookie");
      if (setCookie) {
        // Extract cookie name=value (before first semicolon) and trim whitespace
        const cookiePart = setCookie.split(";")[0]?.trim();
        if (cookiePart) {
          this._sessionCookie = cookiePart;
        }
      }

      const data = await resp.json();
      dbg("INFO", `Deluge RPC response: ${method}`, `result=${!!data.result}, error=${data.error?.message || 'none'}`);

      // Deluge returns { result: ... } or { error: ... }
      if (data.error) {
        throw new Error(data.error.message || "RPC error");
      }
      return data;
    } catch (err) {
      throw new Error(`Deluge RPC failed: ${err.message}`);
    }
  }
}

class JDownloaderAdapter extends NasAdapter {
  constructor(nasId, config) {
    super(nasId, config);
  }

  _getBaseUrl() {
    const host = this.config?.host || "127.0.0.1";
    const port = this.config?.port || 3128;
    const scheme = this.config?.https ? "https" : "http";
    return `${scheme}://${host}:${port}`;
  }

  _displayStatus(item, isLinkCollector = false) {
    if (isLinkCollector) return "stalled";
    if (item.finished) return "finished";
    if (item.skipped) return "paused";

    const s = String(item.status || "").toLowerCase();
    const ext = String(item.extractionStatus || "").toLowerCase();

    // Error states (download failure, plugin defect, file missing, extraction error, bad CRC)
    if (ext.includes("error") || s.includes("error") || s.includes("fail") || s.includes("defect") || s.includes("missing") || s.includes("crc")) {
      return "error";
    }

    // Paused states
    if (s.includes("pause") || s.includes("stop")) {
      return "paused";
    }

    // Stalled / Waiting / Queued states
    if (s.includes("wait") || s.includes("queue") || s.includes("captcha") || s.includes("reconnect") || s.includes("limit")) {
      return "stalled";
    }

    // Active downloading states
    if (item.running || (item.speed && item.speed > 0) || s.includes("download") || s.includes("start") || s.includes("connect") || ext.includes("running")) {
      return "downloading";
    }

    return "downloading";
  }

  async testConnection() {
    const baseUrl = this._getBaseUrl();
    dbg("INFO", `JDownloader testConnection → ${baseUrl}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const resp = await fetch(`${baseUrl}/jd/version`, { method: "GET", signal: controller.signal });

      if (resp.ok) {
        const resJson = await resp.json();
        const build = resJson?.data || "Active";
        dbg("INFO", `JDownloader RemoteAPI connected, build:`, build);
        return { ok: true, version: `JDownloader 2 (Build ${build})` };
      }
      throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    } catch (err) {
      throw new Error(`Cannot connect to JDownloader 2 on ${baseUrl}. Make sure JDownloader is running, and in Settings → Advanced Settings, 'RemoteAPI.deprecatedapienabled' is set to true on port 3128.`);
    } finally {
      clearTimeout(timeout);
    }
  }

  async listTasks() {
    const baseUrl = this._getBaseUrl();
    const tasks = [];

    // 1. Query active / finished downloads via /downloadsV2/queryLinks
    try {
      const resp = await fetch(`${baseUrl}/downloadsV2/queryLinks?params=%7B%22bytesLoaded%22%3Atrue%2C%22bytesTotal%22%3Atrue%2C%22speed%22%3Atrue%2C%22status%22%3Atrue%2C%22eta%22%3Atrue%2C%22finished%22%3Atrue%2C%22running%22%3Atrue%2C%22extractionStatus%22%3Atrue%2C%22skipped%22%3Atrue%7D`, { method: "GET" });
      if (resp.ok) {
        const data = await resp.json();
        const links = data?.data || [];
        for (const item of links) {
          const total = item.bytesTotal || 0;
          const loaded = item.bytesLoaded || 0;
          const percent = total > 0 ? (loaded / total) * 100 : (item.finished ? 100 : 0);

          tasks.push({
            id: String(item.uuid || item.id || item.name),
            title: item.name || "Download",
            status: this._displayStatus(item, false),
            progress: Math.min(100, Math.max(0, percent)),
            downloaded: loaded,
            size: total,
            speed_down: item.speed || 0,
            speed_up: 0
          });
        }
      }
    } catch (err) {
      dbg("INFO", "JDownloader downloadsV2 queryLinks failed:", err.message);
    }

    // 2. Query LinkGrabber queued items via /linkcollector/queryLinks
    try {
      const resp = await fetch(`${baseUrl}/linkcollector/queryLinks?params=%7B%22name%22%3Atrue%2C%22bytesTotal%22%3Atrue%2C%22status%22%3Atrue%2C%22packageUUID%22%3Atrue%7D`, { method: "GET" });
      if (resp.ok) {
        const data = await resp.json();
        const links = data?.data || [];
        for (const item of links) {
          tasks.push({
            id: String(item.uuid || item.uniqueID || item.name),
            title: item.name || "Queued Link",
            status: this._displayStatus(item, true),
            progress: 0,
            downloaded: 0,
            size: item.bytesTotal || 0,
            speed_down: 0,
            speed_up: 0
          });
        }
      }
    } catch (err) {
      dbg("INFO", "JDownloader linkcollector queryLinks failed:", err.message);
    }

    return tasks;
  }

  async addDownload(uri, destination) {
    const baseUrl = this._getBaseUrl();
    dbg("INFO", `JDownloader addDownload → ${baseUrl}`, uri.slice(0, 80));

    try {
      const destParam = destination ? `&destinationFolder=${encodeURIComponent(destination)}` : "";
      const addUrl = `${baseUrl}/linkcollector/addLinks?links=${encodeURIComponent(uri)}&packageName=DownloadNexus&extractPassword=&downloadPassword=${destParam}`;
      const addResp = await fetch(addUrl, { method: "GET" });
      if (addResp.ok) {
        // Trigger download start in JDownloader
        fetch(`${baseUrl}/toolbar/startDownloads`, { method: "GET" }).catch(() => {});
        return { ok: true };
      }
      throw new Error(`HTTP ${addResp.status}`);
    } catch (err) {
      dbg("ERROR", "JDownloader addDownload failed:", err.message);
      throw new Error(`Failed to send to JDownloader 2 on ${baseUrl}: ${err.message}. Ensure JDownloader is running with RemoteAPI enabled on port 3128.`);
    }
  }

  async taskAction(action, ids) {
    const baseUrl = this._getBaseUrl();
    dbg("INFO", `JDownloader taskAction: ${action}`, ids);

    try {
      if (action === "pause") {
        await fetch(`${baseUrl}/toolbar/togglePauseDownloads`, { method: "GET" });
      } else if (action === "resume") {
        await fetch(`${baseUrl}/toolbar/startDownloads`, { method: "GET" });
      } else if (action === "delete") {
        const linkIds = Array.isArray(ids) ? ids.map(id => isNaN(Number(id)) ? id : Number(id)) : [];
        const encodedLinks = encodeURIComponent(JSON.stringify(linkIds));
        await fetch(`${baseUrl}/downloadsV2/removeLinks?linkIds=${encodedLinks}&packageIds=%5B%5D`, { method: "GET" });
        await fetch(`${baseUrl}/linkcollector/removeLinks?linkIds=${encodedLinks}&packageIds=%5B%5D`, { method: "GET" });
      }
      return { ok: true };
    } catch (err) {
      dbg("WARN", `JDownloader taskAction ${action} error:`, err.message);
      return { ok: false, error: err.message };
    }
  }
}

function getAdapter(nasId, config) {
  const type = config.type || "synology";
  switch (type) {
    case "synology":
      return new SynologyAdapter(nasId, config);
    case "qbittorrent":
      return new QBittorrentAdapter(nasId, config);
    case "transmission":
      return new TransmissionAdapter(nasId, config);
    case "deluge":
      return new DelugeAdapter(nasId, config);
    case "jdownloader":
      return new JDownloaderAdapter(nasId, config);
    default:
      throw new Error(`Unknown NAS type: ${type}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_NAS_SYNOLOGY = {
  host: "192.168.0.1",
  port: "5000",
  https: false,
  username: "admin",
  password: "",
  destination: ""
};

// ── debug log ──────────────────────────────────────────────────────────────

const debugLog = [];
let logBuffer = [];
let flushTimer = null;

// Promise-based wrappers for chrome.storage.local API
async function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(result);
      }
    });
  });
}

async function storageSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

const MAX_STORED_LOG_LINES = 300;

function trimLogs(logString) {
  if (!logString) return '';
  const lines = logString.split('\n');
  if (lines.length > MAX_STORED_LOG_LINES) {
    return lines.slice(lines.length - MAX_STORED_LOG_LINES).join('\n');
  }
  return logString;
}

// Init log to verify service worker started
(async () => {
  try {
    const result = await storageGet('nas_debug_logs');
    const existing = result.nas_debug_logs || '';
    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 23);
    const initLog = `[${timestamp}] [INFO] Service worker loaded and ready`;
    const allLogs = existing ? existing + '\n' + initLog : initLog;
    await storageSet({ nas_debug_logs: trimLogs(allLogs) });
    console.log('[NAS] Init log written to storage');
  } catch (error) {
    console.error('[NAS] Failed to write init log:', error);
  }
})();

function dbg(level, msg, detail) {
  const entry = {
    ts: new Date().toISOString().replace("T", " ").slice(0, 23),
    level,
    msg,
    detail: detail ?? ""
  };
  debugLog.push(entry);
  if (debugLog.length > 200) debugLog.shift();

  const logLine = `[${entry.ts}] [${level}] ${msg}${detail ? ' | ' + detail : ''}`;
  console[level === "ERROR" ? "error" : level === "WARN" ? "warn" : "log"](
    `[NAS][${level}] ${msg}`, detail ?? ""
  );

  // Buffer log for storage (append-only pattern with trimming)
  logBuffer.push(logLine);
  if (!flushTimer) {
    flushTimer = setTimeout(() => _flushLogs(), 500);
  }
}

async function _flushLogs() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (logBuffer.length === 0) return;

  try {
    const newLogs = logBuffer.join('\n');
    const result = await storageGet('nas_debug_logs');
    const existing = result.nas_debug_logs || '';
    const allLogs = existing ? existing + '\n' + newLogs : newLogs;
    await storageSet({ nas_debug_logs: trimLogs(allLogs) });
    logBuffer = [];
  } catch (error) {
    console.error('[NAS] Failed to flush logs:', error);
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function baseUrl(s) {
  const scheme = s.https ? "https" : "http";
  return `${scheme}://${s.host}:${s.port}/webapi`;
}

// ── Credential Storage Hardening & Multi-NAS storage helpers ──────────────
// Sensitive credentials (passwords, tokens) are isolated to chrome.storage.local.
// Non-sensitive metadata (names, host, port, whitelist) resides in chrome.storage.sync.

async function getStoredCredentials() {
  return new Promise(resolve => {
    chrome.storage.local.get({ nasCredentials: {} }, r => resolve(r.nasCredentials || {}));
  });
}

async function saveStoredCredentials(creds) {
  return new Promise(resolve => {
    chrome.storage.local.set({ nasCredentials: creds }, resolve);
  });
}

async function getNasList() {
  return new Promise(resolve => {
    chrome.storage.sync.get({ nasList: [] }, async r => {
      let list = r.nasList || [];
      const creds = await getStoredCredentials();
      let needsMigration = false;

      // Migrate old single-NAS config if it exists
      if (list.length === 0) {
        const oldSettings = await new Promise(res => {
          chrome.storage.sync.get(DEFAULT_NAS_SYNOLOGY, res);
        });
        if (oldSettings.host && oldSettings.host !== DEFAULT_NAS_SYNOLOGY.host) {
          list = [{
            id: "synology-main",
            type: "synology",
            name: "Synology NAS",
            ...oldSettings
          }];
          needsMigration = true;
        }
      }

      // Check for and migrate sensitive credentials from sync to local
      for (const item of list) {
        if (!item || !item.id) continue;
        if (item.password !== undefined || item.apiToken !== undefined) {
          needsMigration = true;
          creds[item.id] = {
            password: item.password || "",
            apiToken: item.apiToken || ""
          };
          delete item.password;
          delete item.apiToken;
        }
      }

      if (needsMigration) {
        await saveStoredCredentials(creds);
        await new Promise(res => chrome.storage.sync.set({ nasList: list }, res));
      }

      // Merge local credentials with sync metadata in memory
      const fullList = list.map(item => {
        const itemCreds = creds[item.id] || {};
        return {
          ...item,
          password: itemCreds.password || item.password || "",
          apiToken: itemCreds.apiToken || item.apiToken || ""
        };
      });

      resolve(fullList);
    });
  });
}

async function getNasById(nasId) {
  const list = await getNasList();
  return list.find(n => n.id === nasId);
}

async function saveNasList(list) {
  const creds = await getStoredCredentials();
  const sanitizedList = [];

  for (const item of list) {
    if (!item || !item.id) continue;
    // Extract credentials to local storage
    if (item.password !== undefined || item.apiToken !== undefined) {
      creds[item.id] = {
        password: item.password || "",
        apiToken: item.apiToken || ""
      };
    }
    // Strip sensitive fields from sync payload
    const sanitized = { ...item };
    delete sanitized.password;
    delete sanitized.apiToken;
    sanitizedList.push(sanitized);
  }

  await saveStoredCredentials(creds);
  await new Promise(resolve => chrome.storage.sync.set({ nasList: sanitizedList }, resolve));
  await updateContextMenu().catch(() => {});
}

async function addNas(nas) {
  const list = await getNasList();
  list.push(nas);
  await saveNasList(list);
}

async function updateNas(nasId, updates) {
  const list = await getNasList();
  const idx = list.findIndex(n => n.id === nasId);
  if (idx < 0) {
    throw new Error(`NAS device not found: ${nasId}`);
  }
  list[idx] = { ...list[idx], ...updates };
  await saveNasList(list);
}

async function deleteNas(nasId) {
  const list = await getNasList();
  const filtered = list.filter(n => n.id !== nasId);
  await saveNasList(filtered);

  // Clear credentials and session for this NAS
  const creds = await getStoredCredentials();
  if (creds[nasId]) {
    delete creds[nasId];
    await saveStoredCredentials(creds);
  }
  await removeSid(nasId);
}

// For backward compatibility, expose getSettings() that returns first NAS
async function getSettings() {
  const list = await getNasList();
  return list.length > 0 ? list[0] : DEFAULT_NAS_SYNOLOGY;
}

// ── whitelist management ──────────────────────────────────────────────────

async function getWhitelist() {
  return new Promise(resolve => {
    chrome.storage.sync.get({ whitelist: [] }, r => resolve(r.whitelist || []));
  });
}

async function setWhitelist(list) {
  return new Promise(resolve => chrome.storage.sync.set({ whitelist: list }, resolve));
}

async function addToWhitelist(domain) {
  const list = await getWhitelist();
  if (!list.includes(domain)) {
    list.push(domain);
    return setWhitelist(list);
  }
}

async function removeFromWhitelist(domain) {
  const list = await getWhitelist();
  return setWhitelist(list.filter(d => d !== domain));
}

// "all" (default) scans every page; "restricted" scans only domains in the
// whitelist array. Kept as an explicit flag (not derived from list length)
// so the list survives toggling back and forth between modes.
async function getWhitelistMode() {
  return new Promise(resolve => {
    chrome.storage.sync.get({ whitelistMode: "all" }, r => resolve(r.whitelistMode));
  });
}

async function setWhitelistMode(mode) {
  return new Promise(resolve => chrome.storage.sync.set({ whitelistMode: mode }, resolve));
}

// ── persistent session ─────────────────────────────────────────────────────
// Stored in chrome.storage.local keyed by NAS id so it survives service worker restarts
// but is NOT synced across devices (it's host-specific).

async function getStoredSid(nasId) {
  return new Promise(resolve => {
    const sidKey = `sid_${nasId}`;
    chrome.storage.local.get([sidKey], r => {
      resolve(r[sidKey] || null);
    });
  });
}

async function storeSid(nasId, sid) {
  return new Promise((resolve, reject) => {
    // Use sids key as atomic unit with just this entry
    const sidKey = `sid_${nasId}`;
    chrome.storage.local.set({ [sidKey]: sid }, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

async function removeSid(nasId) {
  return new Promise((resolve, reject) => {
    // Use sids key as atomic unit with just this entry
    const sidKey = `sid_${nasId}`;
    chrome.storage.local.remove([sidKey], () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

async function clearAllSids() {
  // Get all NAS IDs and clear their SIDs
  const list = await getNasList();
  const sidKeys = list.map(nas => `sid_${nas.id}`);
  return new Promise((resolve, reject) => {
    if (sidKeys.length === 0) {
      resolve();
    } else {
      chrome.storage.local.remove(sidKeys, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    }
  });
}

// ── Network Resilience & Retry Helpers ─────────────────────────────────────

async function withRetry(fn, { maxRetries = 2, delayMs = 350, label = "Operation" } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const isTransient = /Failed to fetch|NetworkError|ECONNRESET|ECONNREFUSED|timeout|socket hang up|AbortError/i.test(err.message);
      if (attempt < maxRetries && isTransient) {
        const wait = delayMs * Math.pow(2, attempt - 1);
        dbg("WARN", `${label} transient error (attempt ${attempt}/${maxRetries}), retrying in ${wait}ms:`, err.message);
        await new Promise(r => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
}

// ── Synology API calls ─────────────────────────────────────────────────────

async function nasFetch(label, url, options, timeoutMs = 20000) {
  const safeBody = typeof options?.body === "string"
    ? options.body.replace(/passwd=[^&]+/, "passwd=***")
    : "";
  dbg("INFO", `${label} → ${url.replace(/passwd=[^&]+/, "passwd=***")}`, safeBody);
  
  return await withRetry(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    let resp;
    try {
      resp = await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        const errMsg = `timeout after ${timeoutMs}ms`;
        dbg("ERROR", `${label} fetch timeout`, errMsg);
        throw new Error(errMsg);
      }
      dbg("ERROR", `${label} fetch threw`, err.message);
      throw err;
    }
    clearTimeout(timeoutId);
    dbg("INFO", `${label} ← HTTP ${resp.status} ${resp.statusText}`);
    return resp;
  }, { maxRetries: 2, delayMs: 400, label: label });
}

async function nasLogin(s) {
  const url  = `${baseUrl(s)}/auth.cgi`;
  const body = new URLSearchParams({
    api:     "SYNO.API.Auth",
    version: "3",
    method:  "login",
    account: s.username,
    passwd:  s.password,
    session: "DownloadStation",
    format:  "sid"
  });
  const resp = await nasFetch("LOGIN", url, {
    method:  "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    body.toString()
  });
  const text = await resp.text();
  dbg("INFO", "LOGIN body", text.slice(0, 300));
  let data;
  try { data = JSON.parse(text); }
  catch(e) { throw new Error(`Login response not JSON: ${text.slice(0, 120)}`); }
  if (!data.success) throw new Error(`Login failed (DSM code ${data.error?.code ?? "?"})`);
  if (!data.data?.sid) throw new Error("Login response missing session ID");
  dbg("INFO", "LOGIN ok, got sid");
  return data.data.sid;
}

// Get a valid sid — reuse stored one if available, otherwise login fresh.
// Pass force=true to skip the cached sid and always re-authenticate.
async function getSid(nasId, s, force = false) {
  if (!force) {
    const stored = await getStoredSid(nasId);
    if (stored) {
      dbg("INFO", "Reusing stored sid for NAS", nasId);
      return stored;
    }
  }
  dbg("INFO", "No stored sid for NAS, logging in fresh", nasId);
  const sid = await nasLogin(s);
  await storeSid(nasId, sid);
  return sid;
}

// Call a Synology API function. If it fails with an auth error (code 105/106),
// clear the stored sid and retry once with a fresh login.
async function nasCall(nasId, s, apiFn) {
  let sid = await getSid(nasId, s);
  try {
    return await apiFn(sid);
  } catch (err) {
    // DSM auth error codes: 105 = permission denied, 106 = session expired
    if (/code (105|106|119)/.test(err.message)) {
      dbg("WARN", "Session expired, re-authenticating", err.message);
      await removeSid(nasId);
      sid = await getSid(nasId, s, true);
      return await apiFn(sid);
    }
    throw err;
  }
}

// ── qBittorrent API ────────────────────────────────────────────────────────

async function qbLogin(s) {
  const scheme = s.https ? "https" : "http";
  const url = `${scheme}://${s.host}:${s.port}/api/v2/auth/login`;
  const baseUrl = `${scheme}://${s.host}:${s.port}`;
  const body = new URLSearchParams();
  body.append('username', s.username);
  body.append('password', s.password);

  try {
    const resp = await fetch(url, {
      method: "POST",
      body: body,
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": baseUrl,
        "Origin": baseUrl,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    if (resp.status === 204 || resp.status === 200) {
      return true;
    }
    const respText = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${respText.slice(0, 100)}`);
  } catch (err) {
    throw new Error(`qBit auth failed: ${err.message}`);
  }
}

async function qbFetch(s, path, options = {}) {
  const scheme = s.https ? "https" : "http";
  const url = `${scheme}://${s.host}:${s.port}/api/v2${path}`;
  const resp = await fetch(url, { ...options });
  if (resp.status === 403) throw new Error("qBit auth failed");
  if (!resp.ok) throw new Error(`qBit API error: ${resp.status}`);
  return resp;
}

async function qbCall(deviceId, s, apiFn) {
  try {
    return await apiFn();
  } catch (err) {
    if (err.message.includes("auth failed")) {
      dbg("WARN", "qBit session lost, re-authenticating");
      await qbLogin(s);
      return await apiFn();
    }
    throw err;
  }
}

// Note: qbListTasks and qbAddDownload removed - functionality moved to QBittorrentAdapter class
// Old qBittorrent functions (qbLogin, qbFetch, qbCall) kept for backward compatibility in testConnection

// ── Torrent file parser ───────────────────────────────────────────────────
// Converts .torrent files to magnet links

class BencodedParser {
  constructor(buffer) {
    this.buffer = new Uint8Array(buffer);
    this.pos = 0;
  }

  parse() {
    return this.decodeValue();
  }

  decodeValue() {
    if (this.pos >= this.buffer.length) throw new Error("Unexpected end of buffer");
    const byte = this.buffer[this.pos];
    if (byte === 100) return this.decodeDict();      // 'd'
    else if (byte === 108) return this.decodeList(); // 'l'
    else if (byte === 105) return this.decodeInteger(); // 'i'
    else if (byte >= 48 && byte <= 57) return this.decodeString(); // '0'-'9'
    throw new Error(`Invalid bencode at position ${this.pos}`);
  }

  decodeDict() {
    this.pos++; // skip 'd'
    const obj = {};
    while (this.pos < this.buffer.length && this.buffer[this.pos] !== 101) { // 'e'
      const key = this.decodeString();
      const value = this.decodeValue();
      obj[key] = value;
    }
    if (this.pos < this.buffer.length) this.pos++; // skip 'e'
    return obj;
  }

  decodeList() {
    this.pos++; // skip 'l'
    const arr = [];
    while (this.pos < this.buffer.length && this.buffer[this.pos] !== 101) { // 'e'
      arr.push(this.decodeValue());
    }
    if (this.pos < this.buffer.length) this.pos++; // skip 'e'
    return arr;
  }

  decodeInteger() {
    this.pos++; // skip 'i'
    let num = 0;
    while (this.pos < this.buffer.length && this.buffer[this.pos] !== 101) { // 'e'
      num = num * 10 + (this.buffer[this.pos] - 48);
      this.pos++;
    }
    if (this.pos < this.buffer.length) this.pos++; // skip 'e'
    return num;
  }

  decodeString() {
    let len = 0;
    while (this.pos < this.buffer.length && this.buffer[this.pos] !== 58) { // ':'
      len = len * 10 + (this.buffer[this.pos] - 48);
      this.pos++;
    }
    if (this.pos < this.buffer.length) this.pos++; // skip ':'
    const str = new TextDecoder().decode(this.buffer.slice(this.pos, this.pos + len));
    this.pos += len;
    return str;
  }
}

async function torrentToMagnet(torrentBuffer) {
  try {
    const parser = new BencodedParser(torrentBuffer);
    const torrent = parser.parse();

    if (!torrent.info) throw new Error("Invalid torrent: missing info dict");

    // Get the name
    const name = torrent.info.name || "download";

    // Calculate info hash by re-parsing to get raw info dict bytes
    const infoHash = await calculateTorrentInfoHash(torrentBuffer, torrent);

    // Build magnet link
    const magnet = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}`;

    // Add trackers if present
    if (torrent.announce) {
      return `${magnet}&tr=${encodeURIComponent(torrent.announce)}`;
    }

    return magnet;
  } catch (err) {
    dbg("ERROR", "Torrent parsing failed", err.message);
    throw err;
  }
}

async function calculateTorrentInfoHash(torrentBuffer, torrent) {
  // Find the raw info dictionary bytes in the buffer
  const infoStartMarker = "4:infod"; // "info" in bencoding
  const buffer = new Uint8Array(torrentBuffer);
  const bufStr = new TextDecoder().decode(buffer);
  const markerIndex = bufStr.indexOf(infoStartMarker);
  if (markerIndex === -1) {
    throw new Error("Invalid torrent: missing info dictionary");
  }
  const infoStart = markerIndex + 5; // skip "4:info"

  // Find the end of the info dict by finding the matching 'e'
  let depth = 1;
  let pos = infoStart + 1; // start after 'd'
  while (depth > 0 && pos < buffer.length) {
    if (buffer[pos] === 100) depth++; // 'd'
    else if (buffer[pos] === 108) depth++; // 'l'
    else if (buffer[pos] === 101) depth--; // 'e'
    pos++;
  }

  const infoBytes = buffer.slice(infoStart, pos);

  // SHA1 hash the info dict
  const hashBuffer = await crypto.subtle.digest("SHA-1", infoBytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

  return hashHex;
}

// ── URL validation ─────────────────────────────────────────────────────────
// Note: These are also defined in linkDetector.js; duplicated here for adapter use

function isValidMagnetURI(url) {
  if (!url.startsWith("magnet:?")) return false;
  return /[&?](xt|dn|tr)=/.test(url);
}

function isValidTorrentURL(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return /\.torrent(\?|$)/i.test(u.pathname);
  } catch {
    return false;
  }
}

async function synoAddDownload(s, nasId, uri, overrideDestination) {
  const isMagnet = uri.startsWith("magnet:");
  const isTorrent = !isMagnet && isValidTorrentURL(uri);

  // Secondary validation check
  if (!isMagnet && !isTorrent) {
    dbg("ERROR", "Invalid URI rejected", uri.slice(0, 80));
    throw new Error("Invalid URI format (must be magnet link or .torrent URL)");
  }

  // If it's a .torrent URL, download and convert to magnet
  let finalUri = uri;
  if (isTorrent) {
    dbg("INFO", "Converting .torrent URL to magnet", uri.slice(0, 80));
    try {
      const torrentBuffer = await downloadTorrentFile(uri);
      finalUri = await torrentToMagnet(torrentBuffer);
      dbg("INFO", "Torrent converted to magnet", finalUri.slice(0, 80));
    } catch (err) {
      throw new Error(`Failed to parse torrent: ${err.message}`);
    }
  }

  // Use provided destination or fall back to config default
  const destination = overrideDestination || s.destination;

  await nasCall(nasId, s, sid => {
    const params = new URLSearchParams({
      api:     "SYNO.DownloadStation.Task",
      version: "1",
      method:  "create",
      uri:     finalUri,
      _sid:    sid
    });
    if (destination) params.set("destination", destination);
    const url  = `${baseUrl(s)}/DownloadStation/task.cgi`;
    return nasFetch("ADD_DOWNLOAD", url, {
      method:  "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    params.toString()
    }).then(async resp => {
      const text = await resp.text();
      dbg("INFO", "ADD_DOWNLOAD body", text.slice(0, 300));
      let data;
      try { data = JSON.parse(text); }
      catch(e) { throw new Error(`Add-download response not JSON: ${text.slice(0, 120)}`); }
      if (!data.success) {
        const code = data.error?.code ?? "?";
        throw new Error(`Task creation failed (DSM code ${code})`);
      }
    });
  });
}

async function downloadTorrentFile(url) {
  const resp = await fetch(url, { credentials: "omit" });
  if (!resp.ok) throw new Error(`Failed to download torrent: HTTP ${resp.status}`);
  return resp.arrayBuffer();
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ── test connection ────────────────────────────────────────────────────────

async function testConnection(nasId, s) {
  const type = s.type || "synology";
  dbg("INFO", "TEST_CONNECTION start", `${type} @ ${s.https ? "https" : "http"}://${s.host}:${s.port}`);
  try {
    if (!s || !s.host || !s.port || !s.username) {
      throw new Error("Settings incomplete: missing host, port, or username");
    }

    if (type === "qbittorrent") {
      // qBittorrent: test by attempting to login
      await qbLogin(s);
      dbg("INFO", "TEST_CONNECTION success (qBittorrent)");
      return { ok: true, version: "qBittorrent", log: [...debugLog] };
    } else {
      // Synology: test by fetching DownloadStation info
      // Always do a fresh login for the test so we can verify credentials
      await removeSid(nasId);
      const sid = await getSid(nasId, s, true);
      const infoUrl = `${baseUrl(s)}/DownloadStation/info.cgi?api=SYNO.DownloadStation.Info&version=1&method=getinfo&_sid=${sid}`;
      const ir   = await nasFetch("DS_INFO", infoUrl, { credentials: "include" });
      const text = await ir.text();
      dbg("INFO", "DS_INFO body", text.slice(0, 300));
      let data;
      try { data = JSON.parse(text); }
      catch(e) { throw new Error(`DS info response not JSON: ${text.slice(0, 120)}`); }
      if (data.success) {
        dbg("INFO", "TEST_CONNECTION success", `DS version: ${data.data?.version_string}`);
        // Store the sid so subsequent sends reuse it
        await storeSid(nasId, sid);
        return { ok: true, version: data.data?.version_string ?? "", log: [...debugLog] };
      } else {
        throw new Error(`Download Station error code ${data.error?.code ?? "?"}`);
      }
    }
  } catch (err) {
    const msg = err?.message || String(err) || "Unknown error";
    dbg("ERROR", "TEST_CONNECTION failed", msg);
    return { ok: false, error: msg, log: [...debugLog] };
  }
}

// ── main send functions ────────────────────────────────────────────────────

function decodeName(magnetUrl) {
  try {
    const m = magnetUrl.match(/[?&]dn=([^&]+)/);
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "";
  } catch { return ""; }
}

function extractFileName(uri) {
  try {
    const url = new URL(uri);
    const pathname = url.pathname;
    const filename = pathname.split('/').pop();
    return filename.replace(/\.torrent$/i, "") || "";
  } catch { return ""; }
}

async function sendDownload(uri, nasId = null, destination = null) {
  const list = await getNasList();
  if (!nasId && list.length > 0) nasId = list[0].id;

  const s = await getNasById(nasId);
  if (!s) {
    throw new Error("No download service configured. Add a download service in extension options.");
  }

  const isMagnet = uri.startsWith("magnet:");
  dbg("INFO", isMagnet ? "SEND_MAGNET" : "SEND_TORRENT", uri.slice(0, 80));

  try {
    const adapter = getAdapter(nasId, s);
    await adapter.addDownload(uri, destination);
    const displayName = isMagnet ? decodeName(uri) : extractFileName(uri);
    dbg("INFO", `Sent to ${s.name}`, displayName || uri.slice(0, 80));
  } catch (err) {
    dbg("ERROR", "SEND_DOWNLOAD failed", err.message);
    throw err;
  }
}


// ── task list / control ────────────────────────────────────────────────────

async function listTasks(s, sid) {
  const url = `${baseUrl(s)}/DownloadStation/task.cgi?api=SYNO.DownloadStation.Task` +
              `&version=1&method=list&additional=transfer&_sid=${sid}`;
  const resp = await nasFetch("LIST_TASKS", url, { credentials: "include" });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); }
  catch(e) { throw new Error(`List tasks response not JSON: ${text.slice(0, 120)}`); }
  if (!data.success) throw new Error(`List tasks failed (DSM code ${data.error?.code ?? "?"})`);
  return data.data?.tasks || [];
}

async function taskAction(s, sid, action, ids) {
  const params = new URLSearchParams({
    api:     "SYNO.DownloadStation.Task",
    version: "1",
    method:  action,
    id:      ids.join(","),
    _sid:    sid
  });
  // For delete action, delete the torrent file but not the downloads (non-destructive)
  if (action === "delete") {
    params.append("delete_file", "true");
  }
  const url  = `${baseUrl(s)}/DownloadStation/task.cgi`;
  const resp = await nasFetch(`TASK_${action.toUpperCase()}`, url, {
    method:  "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    params.toString()
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); }
  catch(e) { throw new Error(`Task ${action} response not JSON`); }
  if (!data.success) throw new Error(`Task ${action} failed (DSM code ${data.error?.code ?? "?"})`);
}

// ── context menu ───────────────────────────────────────────────────────────

let contextMenuServiceIds = [];

async function initContextMenu() {
  try {
    // Remove old menu if it exists (handles extension reload)
    await new Promise((resolve) => {
      chrome.contextMenus.remove("download-nexus-menu", () => {
        // Ignore errors - menu might not exist yet
        chrome.runtime.lastError; // Clear error
        resolve();
      });
    });

    // Create parent menu item
    await new Promise((resolve, reject) => {
      chrome.contextMenus.create({
        id: "download-nexus-menu",
        title: "Download to…",
        contexts: ["link", "selection"]
      }, () => {
        if (chrome.runtime.lastError) {
          dbg("ERROR", "initContextMenu", `Failed to create parent menu: ${chrome.runtime.lastError.message}`);
          reject(chrome.runtime.lastError);
        } else {
          dbg("INFO", "initContextMenu", "Parent menu created");
          resolve();
        }
      });
    });

    // Create submenu items for each service
    await updateContextMenu();
  } catch (err) {
    dbg("ERROR", "initContextMenu", `${err.message}`);
  }
}

async function updateContextMenu() {
  // Remove old submenu items by ID (tracked locally)
  for (const id of contextMenuServiceIds) {
    chrome.contextMenus.remove(id).catch(() => {});
  }
  contextMenuServiceIds = [];

  // Add current services as submenu items
  const nasList = await getNasList();
  dbg("INFO", "updateContextMenu", `Found ${nasList.length} services`);

  nasList.forEach((nas) => {
    const id = `download-nexus-service-${nas.id}`;
    chrome.contextMenus.create({
      id,
      parentId: "download-nexus-menu",
      title: nas.name,
      contexts: ["link", "selection"]
    }, () => {
      if (chrome.runtime.lastError) {
        dbg("ERROR", "createContextMenu", `Failed to create menu for ${nas.name}: ${chrome.runtime.lastError.message}`);
      } else {
        dbg("INFO", "createContextMenu", `Created menu item for ${nas.name}`);
      }
    });
    contextMenuServiceIds.push(id);
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info.menuItemId.startsWith("download-nexus-service-")) return;

  const nasId = info.menuItemId.replace("download-nexus-service-", "");
  let url = info.linkUrl;

  if (!url && info.selectionText) {
    const text = info.selectionText.trim();
    const magnetMatch = text.match(/magnet:\?[^\s"'<>]+/);
    if (magnetMatch) {
      url = magnetMatch[0];
    } else if (text.startsWith("http://") || text.startsWith("https://") || text.startsWith("ftp://")) {
      url = text;
    }
  }

  if (!url && info.srcUrl) {
    url = info.srcUrl;
  }

  if (!url) {
    dbg("WARN", "contextMenus.onClicked", "No valid URL found in context menu action");
    return;
  }

  try {
    dbg("INFO", "contextMenus.onClicked", `Sending ${url.slice(0, 80)} to NAS ${nasId}`);
    await sendDownload(url, nasId);
    // Show success notification
    chrome.notifications.create({
      type: "basic",
      iconUrl: "/icons/icon128.png",
      title: "Download Sent",
      message: `Link sent to download service`,
      priority: 1
    });
  } catch (e) {
    dbg("ERROR", "contextMenus.onClicked", `${e.message}`);
    // Show error notification
    chrome.notifications.create({
      type: "basic",
      iconUrl: "/icons/icon128.png",
      title: "Download Failed",
      message: e.message || "Failed to send download",
      priority: 2
    });
  }
});

// Auto-update context menu and icon state when services list changes in storage
chrome.storage.onChanged?.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.nasList) {
    updateContextMenu().catch(() => {});
    checkActiveTasksAndUpdateIcon().catch(() => {});
  }
});

// ── Toolbar Icon State Management ──────────────────────────────────────────

const BASE_ICONS = {
  "16": "icons/icon16.png",
  "24": "icons/icon24.png",
  "32": "icons/icon32.png",
  "48": "icons/icon48.png",
  "128": "icons/icon128.png"
};

const OFFLINE_ICONS = {
  "16": "icons/icon16-offline.png",
  "24": "icons/icon24-offline.png",
  "32": "icons/icon32-offline.png",
  "48": "icons/icon48-offline.png",
  "128": "icons/icon128-offline.png"
};

const ICON_STATES = {
  idle: {
    path: BASE_ICONS,
    defaultTitle: "Download Nexus"
  },
  active: {
    path: BASE_ICONS,
    defaultTitle: "Download Nexus: Downloading"
  },
  paused: {
    path: BASE_ICONS,
    defaultTitle: "Download Nexus: Paused / Waiting"
  },
  error: {
    path: BASE_ICONS,
    defaultTitle: "Download Nexus: Connection Error"
  },
  offline: {
    path: OFFLINE_ICONS,
    defaultTitle: "Download Nexus: Offline"
  }
};

let currentIconState = "idle";

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return "0 B/s";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  const i = Math.min(Math.floor(Math.log(bytesPerSec) / Math.log(1024)), units.length - 1);
  const val = (bytesPerSec / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0);
  return `${val} ${units[i]}`;
}

async function updateExtensionIconState(state, details = {}) {
  const stateConfig = ICON_STATES[state] || ICON_STATES.idle;
  currentIconState = state;

  const actionApi = (typeof chrome !== "undefined" && chrome.action) ? chrome.action : (typeof chrome !== "undefined" && chrome.browserAction ? chrome.browserAction : null);
  if (!actionApi) return;

  try {
    // 1. Set state-specific icon
    if (actionApi.setIcon) {
      await new Promise(resolve => actionApi.setIcon({ path: stateConfig.path }, resolve));
    }

    // 2. Set native hanging badge (Play ▶, Pause II, Error !)
    if (actionApi.setBadgeText) {
      let badgeText = "";
      let badgeColor = "#1a6fb5";

      if (state === "active") {
        badgeText = "▶";
        badgeColor = "#16a34a"; // Green
      } else if (state === "paused") {
        badgeText = "II";
        badgeColor = "#d97706"; // Orange / Amber
      } else if (state === "error") {
        badgeText = "!";
        badgeColor = "#dc2626"; // Red
      }

      actionApi.setBadgeText({ text: badgeText }, () => chrome.runtime.lastError);
      if (actionApi.setBadgeBackgroundColor) {
        actionApi.setBadgeBackgroundColor({ color: badgeColor }, () => chrome.runtime.lastError);
      }
      if (badgeText && actionApi.setBadgeTextColor) {
        actionApi.setBadgeTextColor({ color: "#ffffff" }, () => chrome.runtime.lastError);
      }
    }

    // 3. Set clean tooltip title
    let title = stateConfig.defaultTitle;
    if (state === "active" && details.activeCount) {
      title = `Download Nexus: ${details.activeCount} active`;
    } else if (state === "paused" && details.pausedCount) {
      title = `Download Nexus: ${details.pausedCount} paused/waiting`;
    } else if (state === "idle") {
      title = "Download Nexus: Idle";
    } else if (state === "error" && details.errorMessage) {
      title = `Download Nexus: ${details.errorMessage}`;
    } else if (state === "offline") {
      title = "Download Nexus: Offline";
    }

    if (actionApi.setTitle) {
      actionApi.setTitle({ title }, () => chrome.runtime.lastError);
    }
  } catch (err) {
    dbg("WARN", "updateExtensionIconState", err.message);
  }
}

async function checkActiveTasksAndUpdateIcon() {
  try {
    const list = await getNasList();
    if (!list || list.length === 0) {
      await updateExtensionIconState("offline");
      return;
    }

    let totalActive = 0;
    let totalPaused = 0;
    let totalError = 0;
    let totalSpeedDown = 0;
    let totalSpeedUp = 0;
    let anyConnected = false;

    // Check tasks across configured download services
    for (const nas of list) {
      try {
        const adapter = getAdapter(nas.id, nas);
        const tasks = await adapter.listTasks();
        anyConnected = true;

        for (const t of tasks) {
          const status = (t.status || "").toLowerCase();
          if (status === "downloading" || status === "active") {
            totalActive++;
            totalSpeedDown += (t.speed_down || t.downloadSpeed || 0);
            totalSpeedUp += (t.speed_up || t.uploadSpeed || 0);
          } else if (status === "paused" || status === "waiting" || status === "stalled" || status === "allocating" || status === "checking") {
            totalPaused++;
            totalSpeedDown += (t.speed_down || t.downloadSpeed || 0);
            totalSpeedUp += (t.speed_up || t.uploadSpeed || 0);
          } else if (status === "error") {
            totalError++;
          }
        }
      } catch (err) {
        dbg("WARN", "checkActiveTasksAndUpdateIcon", `NAS ${nas.name || nas.id} poll failed: ${err.message}`);
      }
    }

    if (!anyConnected && list.length > 0) {
      await updateExtensionIconState("error", { errorMessage: "Unable to connect to download service" });
    } else if (totalActive > 0) {
      await updateExtensionIconState("active", { activeCount: totalActive, speedDown: totalSpeedDown, speedUp: totalSpeedUp });
    } else if (totalPaused > 0) {
      await updateExtensionIconState("paused", { pausedCount: totalPaused, speedDown: totalSpeedDown, speedUp: totalSpeedUp });
    } else if (totalError > 0) {
      await updateExtensionIconState("error", { errorMessage: `${totalError} download error(s)` });
    } else {
      await updateExtensionIconState("idle", { speedDown: totalSpeedDown, speedUp: totalSpeedUp });
    }
  } catch (err) {
    dbg("ERROR", "checkActiveTasksAndUpdateIcon", err.message);
  }
}

async function updateIconFromTaskList(tasks) {
  if (!tasks || !Array.isArray(tasks)) return;
  let totalActive = 0;
  let totalPaused = 0;
  let totalError = 0;
  let totalSpeedDown = 0;
  let totalSpeedUp = 0;

  for (const t of tasks) {
    const status = (t.status || "").toLowerCase();
    if (status === "downloading" || status === "active") {
      totalActive++;
      totalSpeedDown += (t.speed_down || t.downloadSpeed || 0);
      totalSpeedUp += (t.speed_up || t.uploadSpeed || 0);
    } else if (status === "paused" || status === "waiting" || status === "stalled" || status === "allocating" || status === "checking" || status === "stopped") {
      totalPaused++;
    } else if (status === "error") {
      totalError++;
    }
  }

  if (totalActive > 0) {
    await updateExtensionIconState("active", { activeCount: totalActive, speedDown: totalSpeedDown, speedUp: totalSpeedUp });
  } else if (totalPaused > 0) {
    await updateExtensionIconState("paused", { pausedCount: totalPaused });
  } else if (totalError > 0) {
    await updateExtensionIconState("error", { errorMessage: `${totalError} download error(s)` });
  } else {
    await updateExtensionIconState("idle");
  }
}

// ── message listener ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  try {
    // Handle log retrieval (for debugging)
    if (msg.type === "GET_LOGS") {
      sendResponse({ logs: [...debugLog] });
      return;
    }

    dbg("INFO", "Message received", msg.type);
    dbg("INFO", "msg.type value", `type="${msg.type}" typeof=${typeof msg.type} length=${msg.type?.length ?? "null"}`);

    if (msg.type === "SEND_MAGNET") {
      if (!msg.url || typeof msg.url !== "string") {
        dbg("ERROR", "SEND_MAGNET", "Invalid URL");
        sendResponse({ ok: false, error: "Invalid URL parameter" });
        return true;
      }
      dbg("INFO", "SEND_MAGNET handler START");
      sendDownload(msg.url, msg.nasId, msg.destination).then(() => {
        dbg("INFO", "SEND_MAGNET", "Success");
        sendResponse({ ok: true, log: [...debugLog] });
        checkActiveTasksAndUpdateIcon().catch(() => {});
      }).catch(e => {
        dbg("ERROR", "SEND_MAGNET", e.message);
        sendResponse({ ok: false, error: e.message, log: [...debugLog] });
      });
      return true;
    }
    if (msg.type === "PARSE_TORRENT_FILE") {
      (async () => {
        try {
          const binary = atob(msg.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          const magnet = await torrentToMagnet(bytes.buffer);
          sendResponse({ ok: true, magnet });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;
    }
    if (msg.type === "TEST_CONNECTION") {
      (async () => {
        try {
          dbg("INFO", "TEST_CONNECTION", `Starting handler, nasId=${msg.nasId}, has settings=${!!msg.settings}`);
          // If settings provided, use them; otherwise look up by nasId
          const settings = msg.settings || await getNasById(msg.nasId);
          dbg("INFO", "TEST_CONNECTION", `Got settings, type=${settings?.type}`);
          if (!settings) {
            dbg("ERROR", "TEST_CONNECTION", `Device not found for nasId=${msg.nasId}`);
            return sendResponse({ ok: false, error: "Device not found" });
          }

          dbg("INFO", "TEST_CONNECTION", `Creating adapter for type=${settings.type}`);
          const adapter = getAdapter(msg.nasId, settings);
          dbg("INFO", "TEST_CONNECTION", `Created adapter, calling testConnection`);
          const result = await adapter.testConnection();
          dbg("INFO", "TEST_CONNECTION", `testConnection returned success`);
          sendResponse({ ok: result.ok, version: result.version });
        } catch (e) {
          dbg("ERROR", "TEST_CONNECTION", `Exception: ${e.message}`);
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;
    }
    if (msg.type === "LIST_TASKS") {
      (async () => {
        const s = await getNasById(msg.nasId);
        if (!s) return sendResponse({ ok: false, error: "Download service not found" });

        try {
          const adapter = getAdapter(msg.nasId, s);
          const tasks = await adapter.listTasks();
          sendResponse({ ok: true, tasks });
          // Instantly sync toolbar icon with the freshly fetched tasks in real-time
          updateIconFromTaskList(tasks).catch(() => {});
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;
    }
    if (msg.type === "TASK_ACTION") {
      if (!msg.nasId || !msg.action || !Array.isArray(msg.ids)) {
        dbg("ERROR", "TASK_ACTION", "Invalid parameters");
        sendResponse({ ok: false, error: "Invalid parameters: nasId, action, and ids array required" });
        return true;
      }
      (async () => {
        const s = await getNasById(msg.nasId);
        if (!s) return sendResponse({ ok: false, error: "Download service not found" });

        try {
          const adapter = getAdapter(msg.nasId, s);
          await adapter.taskAction(msg.action, msg.ids);
          sendResponse({ ok: true });
          setTimeout(() => checkActiveTasksAndUpdateIcon().catch(() => {}), 250);
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;
    }
    if (msg.type === "GET_NAS_LIST") {
      getNasList()
        .then(list => sendResponse({ list }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }
    if (msg.type === "GET_WHITELIST") {
      Promise.all([getWhitelist(), getWhitelistMode()])
        .then(([list, mode]) => sendResponse({ list, mode }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }
    if (msg.type === "ADD_WHITELIST") {
      if (!msg.domain || typeof msg.domain !== "string") {
        dbg("ERROR", "ADD_WHITELIST", "Invalid domain");
        sendResponse({ ok: false, error: "Invalid domain parameter" });
        return true;
      }
      addToWhitelist(msg.domain)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }
    if (msg.type === "REMOVE_WHITELIST") {
      if (!msg.domain || typeof msg.domain !== "string") {
        dbg("ERROR", "REMOVE_WHITELIST", "Invalid domain");
        sendResponse({ ok: false, error: "Invalid domain parameter" });
        return true;
      }
      removeFromWhitelist(msg.domain)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }
    if (msg.type === "SET_WHITELIST") {
      const list = msg.list || msg.domains;
      if (!Array.isArray(list)) {
        dbg("ERROR", "SET_WHITELIST", "Invalid domains/list");
        sendResponse({ ok: false, error: "Invalid parameter - must be array" });
        return true;
      }
      setWhitelist(list)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }
    if (msg.type === "SAVE_NAS_LIST") {
      if (!Array.isArray(msg.list)) {
        dbg("ERROR", "SAVE_NAS_LIST", "Invalid list");
        sendResponse({ ok: false, error: "Invalid list parameter - must be array" });
        return true;
      }
      saveNasList(msg.list)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }
    if (msg.type === "SET_WHITELIST_MODE") {
      if (!msg.mode || typeof msg.mode !== "string") {
        dbg("ERROR", "SET_WHITELIST_MODE", "Invalid mode");
        sendResponse({ ok: false, error: "Invalid mode parameter" });
        return true;
      }
      setWhitelistMode(msg.mode)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }
    if (msg.type === "ADD_NAS") {
      if (!msg.nas || typeof msg.nas !== "object") {
        dbg("ERROR", "ADD_NAS", "Invalid NAS config");
        sendResponse({ ok: false, error: "Invalid NAS config parameter" });
        return true;
      }
      addNas(msg.nas)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }
    if (msg.type === "UPDATE_NAS") {
      if (!msg.nasId || !msg.updates) {
        dbg("ERROR", "UPDATE_NAS", "Invalid parameters");
        sendResponse({ ok: false, error: "Invalid parameters: nasId and updates required" });
        return true;
      }
      updateNas(msg.nasId, msg.updates)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }
    if (msg.type === "DELETE_NAS") {
      if (!msg.nasId || typeof msg.nasId !== "string") {
        dbg("ERROR", "DELETE_NAS", "Invalid nasId");
        sendResponse({ ok: false, error: "Invalid nasId parameter" });
        return true;
      }
      deleteNas(msg.nasId)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }
    // No matching message type - send error response
    sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
  } catch (err) {
    dbg("ERROR", "Message listener error", err.message);
    sendResponse({ ok: false, error: err.message, log: [...debugLog] });
  }
});

// ── Extension Lifecycle ────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[Background] Extension ${details.reason}`);

  try {
    if (details.reason === 'install') {
      await registerContentScripts();
      await reinjectContentScripts();
      await initContextMenu();
    } else if (details.reason === 'update') {
      console.log('[Background] Extension updated, re-registering and re-injecting content scripts...');
      await registerContentScripts();
      await reinjectContentScripts();
      await initContextMenu();
    }
  } catch (err) {
    console.error('[Background] Failed to handle extension installation/update:', err);
  }

  // Setup periodic polling alarm and initialize icon
  chrome.alarms?.create("pollTaskStatus", { periodInMinutes: 0.5 });
  checkActiveTasksAndUpdateIcon().catch(() => {});
});

chrome.runtime.onStartup?.addListener(async () => {
  console.log('[Background] Extension startup detected');
  try {
    await reinjectContentScripts();
    await initContextMenu();
  } catch (err) {
    console.error('[Background] Failed to re-inject content scripts on startup:', err);
  }

  chrome.alarms?.create("pollTaskStatus", { periodInMinutes: 0.5 });
  checkActiveTasksAndUpdateIcon().catch(() => {});
});

// Automatically ensure content scripts and context menus are initialized on service worker start/reload
if (typeof chrome !== "undefined" && chrome.runtime) {
  (async () => {
    try {
      await registerContentScripts();
      await reinjectContentScripts();
      await initContextMenu();
    } catch (err) {
      console.debug('[Background] Service worker boot init note:', err?.message || err);
    }
  })();
}

// Periodic alarm listener for status polling
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === "pollTaskStatus") {
    checkActiveTasksAndUpdateIcon().catch(() => {});
  }
});

// Export for unit tests
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ICON_STATES,
    formatSpeed,
    updateExtensionIconState,
    checkActiveTasksAndUpdateIcon,
    getAdapter,
    sendDownload,
    synoAddDownload,
    isValidMagnetURI,
    isValidTorrentURL
  };
}
