// background.js — Download Nexus service worker
// Uses a persistent session (sid) to avoid displacing DSM browser sessions.

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
    const isTorrentUrl = /\.torrent(\?|$)/i.test(uri);

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
    console.log("[QBittorrent] testConnection called");
    if (!this.config?.host || !this.config?.port) {
      throw new Error("Settings incomplete: missing host or port");
    }

    // Token auth doesn't require username, but username/password auth does
    if (!this._isTokenAuth && !this.config?.username) {
      throw new Error("Settings incomplete: missing username (or provide API token)");
    }

    try {
      console.log("[QBittorrent] Attempting auth, isTokenAuth=" + this._isTokenAuth);
      if (this._isTokenAuth) {
        // For token auth, make a simple API call to verify the token works
        console.log("[QBittorrent] Using token auth");
        await this._fetch("/app/webapiVersion");
      } else {
        // For password auth, just verify login succeeds
        console.log("[QBittorrent] Using password auth");
        await this._login();
      }
      console.log("[QBittorrent] testConnection success");
      return { ok: true, version: "qBittorrent", type: "qBittorrent" };
    } catch (err) {
      console.log("[QBittorrent] testConnection error: " + err.message);
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
    const isTorrentUrl = /\.torrent(\?|$)/i.test(uri);

    if (!isMagnet && !isTorrentUrl) {
      throw new Error("Invalid URI: must be a magnet link or .torrent URL");
    }

    let finalUri = uri;
    if (isTorrentUrl) {
      const torrentBuffer = await downloadTorrentFile(uri);
      finalUri = await torrentToMagnet(torrentBuffer);
    }

    await this._call(async () => {
      const formData = new FormData();
      formData.append("urls", finalUri);
      const resp = await this._fetch("/torrents/add", {
        method: "POST",
        body: formData
      });
      const text = await resp.text();
      if (!text.toLowerCase().match(/^ok\.?$/)) {
        throw new Error(`qBit add torrent failed: ${text}`);
      }
    });
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

    const url = `${this._baseUrl()}/api/v2/auth/login`;
    const body = new URLSearchParams();
    body.append('username', this.config.username);
    body.append('password', this.config.password);

    const resp = await fetch(url, {
      method: "POST",
      body,
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });

    if (resp.status !== 204 && resp.status !== 200) {
      const text = await resp.text();
      throw new Error(`qBit auth failed: HTTP ${resp.status}: ${text}`);
    }
  }

  async _fetch(path, options = {}) {
    const url = `${this._baseUrl()}/api/v2${path}`;

    // Add API token header if token auth is enabled (P1-2)
    const headers = options.headers || {};
    if (this._isTokenAuth) {
      headers["X-API-Token"] = this.config.apiToken;
    }

    const resp = await fetch(url, { ...options, headers });
    if (resp.status === 403) throw new Error("qBit auth failed");
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
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });
    if (!resp.ok) throw new Error(`Transmission connection failed: HTTP ${resp.status}`);
    return { ok: true, version: "Transmission", type: "Transmission" };
  }

  async listTasks() {
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
      // Session ID expired, retry
      return this.listTasks();
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
    const isTorrentUrl = /\.torrent(\?|$)/i.test(uri);

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
        ids: ids.map(id => parseInt(id))
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
      this._isAuthenticated = true;
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
    const isTorrentUrl = /\.torrent(\?|$)/i.test(uri);

    if (!isMagnet && !isTorrentUrl) {
      throw new Error("Invalid URI: must be a magnet link or .torrent URL");
    }

    const options = {};
    if (destination) options.download_location = destination;

    if (isMagnet) {
      const resp = await this._rpc("core.add_torrent_magnet", [uri, options]);
      if (resp.error) throw new Error(`Deluge add failed: ${resp.error.message}`);
    } else {
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
        this._sessionCookie = setCookie.split(";")[0];
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

// Init log to verify service worker started
(async () => {
  try {
    const result = await storageGet('nas_debug_logs');
    const existing = result.nas_debug_logs || '';
    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 23);
    const initLog = `[${timestamp}] [INFO] Service worker loaded and ready`;
    const allLogs = existing ? existing + '\n' + initLog : initLog;
    await storageSet({ nas_debug_logs: allLogs });
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

  // Buffer log for storage (append-only pattern like hang-time)
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
    await storageSet({ nas_debug_logs: allLogs });
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

// Multi-NAS storage helpers
async function getNasList() {
  return new Promise(resolve => {
    chrome.storage.sync.get({ nasList: [] }, r => {
      let list = r.nasList || [];
      // Migrate old single-NAS config if it exists
      if (list.length === 0) {
        chrome.storage.sync.get(DEFAULT_NAS_SYNOLOGY, oldSettings => {
          if (oldSettings.host && oldSettings.host !== DEFAULT_NAS_SYNOLOGY.host) {
            // User has old settings, migrate to new format
            list = [{
              id: "synology-main",
              type: "synology",
              name: "Synology NAS",
              ...oldSettings
            }];
            chrome.storage.sync.set({ nasList: list });
          }
          resolve(list);
        });
      } else {
        resolve(list);
      }
    });
  });
}

async function getNasById(nasId) {
  const list = await getNasList();
  return list.find(n => n.id === nasId);
}

async function saveNasList(list) {
  return new Promise(resolve => chrome.storage.sync.set({ nasList: list }, resolve));
}

async function addNas(nas) {
  const list = await getNasList();
  list.push(nas);
  await saveNasList(list);
}

async function updateNas(nasId, updates) {
  const list = await getNasList();
  const idx = list.findIndex(n => n.id === nasId);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...updates };
    await saveNasList(list);
  }
}

async function deleteNas(nasId) {
  const list = await getNasList();
  const filtered = list.filter(n => n.id !== nasId);
  await saveNasList(filtered);
  // Clear session for this NAS
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
    chrome.storage.local.get({ sids: {} }, r => {
      resolve(r.sids?.[nasId] || null);
    });
  });
}

async function storeSid(nasId, sid) {
  return new Promise(resolve => {
    chrome.storage.local.get({ sids: {} }, r => {
      const sids = r.sids || {};
      sids[nasId] = sid;
      chrome.storage.local.set({ sids }, resolve);
    });
  });
}

async function removeSid(nasId) {
  return new Promise(resolve => {
    chrome.storage.local.get({ sids: {} }, r => {
      const sids = r.sids || {};
      delete sids[nasId];
      chrome.storage.local.set({ sids }, resolve);
    });
  });
}

async function clearAllSids() {
  return new Promise(resolve => chrome.storage.local.set({ sids: {} }, resolve));
}

// ── Synology API calls ─────────────────────────────────────────────────────

async function nasFetch(label, url, options, timeoutMs = 20000) {
  const safeBody = typeof options?.body === "string"
    ? options.body.replace(/passwd=[^&]+/, "passwd=***")
    : "";
  dbg("INFO", `${label} → ${url.replace(/passwd=[^&]+/, "passwd=***")}`, safeBody);
  
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
  const body = new URLSearchParams();
  body.append('username', s.username);
  body.append('password', s.password);

  console.log("[qbLogin] Attempting login to", url);
  try {
    const resp = await fetch(url, {
      method: "POST",
      body: body,
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });
    console.log("[qbLogin] Response:", resp.status, resp.statusText);
    const respText = await resp.text();
    console.log("[qbLogin] Body:", respText.slice(0, 50));

    if (resp.status === 204 || resp.status === 200) {
      console.log("[qbLogin] SUCCESS");
      return true;
    }
    throw new Error(`HTTP ${resp.status}: ${respText.slice(0, 100)}`);
  } catch (err) {
    console.error("[qbLogin] FAILED:", err.message);
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

async function qbListTasks(s) {
  const resp = await qbFetch(s, "/torrents/info");
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`qBit list response not JSON: ${text.slice(0, 120)}`);
  }

  // Convert qBittorrent torrents to generic task format
  if (!Array.isArray(data)) {
    dbg("WARN", "qBit torrents/info returned non-array", typeof data);
    return [];
  }

  return data.map(torrent => ({
    id: torrent.hash,
    title: torrent.name,
    status: torrent.state, // "downloading", "uploading", etc.
    progress: torrent.progress * 100, // qBit uses 0-1, we use 0-100
    size: torrent.total_size,
    downloaded: torrent.downloaded,
    uploaded: torrent.uploaded,
    speed_down: torrent.dl_speed,
    speed_up: torrent.up_speed,
    eta: torrent.eta
  }));
}

async function qbAddDownload(s, deviceId, uri) {
  // Validate URI
  if (!isValidMagnetURI(uri) && !isValidTorrentURL(uri)) {
    dbg("ERROR", "Invalid URI rejected", uri.slice(0, 80));
    throw new Error("Invalid URI format (must be magnet link or .torrent URL)");
  }

  // Convert .torrent URL to magnet if needed
  let finalUri = uri;
  if (isValidTorrentURL(uri)) {
    dbg("INFO", "Converting .torrent URL to magnet", uri.slice(0, 80));
    try {
      const torrentBuffer = await downloadTorrentFile(uri);
      finalUri = await torrentToMagnet(torrentBuffer);
      dbg("INFO", "Torrent converted to magnet", finalUri.slice(0, 80));
    } catch (err) {
      throw new Error(`Failed to parse torrent: ${err.message}`);
    }
  }

  // qBittorrent API: POST /api/v2/torrents/add with magnet link
  await qbCall(deviceId, s, async () => {
    const formData = new FormData();
    formData.append("urls", finalUri);

    const resp = await qbFetch(s, "/torrents/add", {
      method: "POST",
      body: formData
    });

    const text = await resp.text();
    dbg("INFO", "qBit add torrent response", text);
    // qBittorrent returns "Ok." on success or error text otherwise
    if (text.toLowerCase() === "ok." || text.toLowerCase() === "ok") {
      dbg("INFO", "qBit add download successful", finalUri.slice(0, 80));
    } else if (text.toLowerCase().includes("already")) {
      dbg("WARN", "qBit: torrent already added", finalUri.slice(0, 80));
    } else {
      throw new Error(`qBit add torrent failed: ${text.slice(0, 200)}`);
    }
  });
}

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
  const infoStart = bufStr.indexOf(infoStartMarker) + 5; // skip "4:info"

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

function isValidMagnetURI(url) {
  if (!url.startsWith("magnet:?")) return false;
  return /[&?](xt|dn|tr)=/.test(url);
}

function isValidTorrentURL(url) {
  try {
    const u = new URL(url);
    return /\.torrent(\?|$)/i.test(u.pathname);
  } catch {
    return false;
  }
}

async function synoAddDownload(s, nasId, uri, overrideDestination) {
  // Secondary validation check
  if (!isValidMagnetURI(uri) && !isValidTorrentURL(uri)) {
    dbg("ERROR", "Invalid URI rejected", uri.slice(0, 80));
    throw new Error("Invalid URI format (must be magnet link or .torrent URL)");
  }

  // If it's a .torrent URL, download and convert to magnet
  let finalUri = uri;
  if (isValidTorrentURL(uri)) {
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

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title,
    message: message.slice(0, 200)
  });
}

async function sendDownload(uri, nasId = null) {
  const list = await getNasList();
  if (!nasId && list.length > 0) nasId = list[0].id;

  const s = await getNasById(nasId);
  if (!s) {
    notify("⚠️ NAS not found", "Configure a NAS device in extension options.");
    return;
  }
  if (!s.password) {
    notify("⚠️ Not configured", "Open the extension options and enter your NAS credentials.");
    return;
  }

  const isMagnet = uri.startsWith("magnet:");
  dbg("INFO", isMagnet ? "SEND_MAGNET" : "SEND_TORRENT", uri.slice(0, 80));

  try {
    const adapter = getAdapter(nasId, s);
    await adapter.addDownload(uri);
    const displayName = isMagnet ? decodeName(uri) : extractFileName(uri);
    notify(`✅ Sent to ${s.name}`, displayName || uri.slice(0, 80));
  } catch (err) {
    notify("❌ NAS error", err.message);
    dbg("ERROR", "SEND_DOWNLOAD failed", err.message);
  }
}

// Backward compatibility alias
const sendMagnet = sendDownload;


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
  return data.data.tasks || [];
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

// ── message listener ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  try {
    // Handle log retrieval (for debugging)
    if (msg.type === "GET_LOGS") {
      sendResponse({ logs: [...debugLog] });
      return;
    }

    dbg("INFO", "Message received", msg.type);

    if (msg.type === "SEND_MAGNET") {
      sendMagnet(msg.url, msg.nasId)
        .then(() => sendResponse({ ok: true, log: [...debugLog] }))
        .catch(e => sendResponse({ ok: false, error: e.message, log: [...debugLog] }));
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

          dbg("INFO", "TEST_CONNECTION", `Calling testConnection for type=${settings.type}`);
          const result = await testConnection(msg.nasId, settings);
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
        if (!s) return sendResponse({ ok: false, error: "NAS not found" });

        try {
          const adapter = getAdapter(msg.nasId, s);
          const tasks = await adapter.listTasks();
          sendResponse({ ok: true, tasks });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;
    }
    if (msg.type === "TASK_ACTION") {
      (async () => {
        const s = await getNasById(msg.nasId);
        if (!s) return sendResponse({ ok: false, error: "NAS not found" });

        try {
          const adapter = getAdapter(msg.nasId, s);
          await adapter.taskAction(msg.action, msg.ids);
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;
    }
    if (msg.type === "GET_NAS_LIST") {
      getNasList().then(list => sendResponse({ list }));
      return true;
    }
    if (msg.type === "GET_WHITELIST") {
      Promise.all([getWhitelist(), getWhitelistMode()])
        .then(([list, mode]) => sendResponse({ list, mode }));
      return true;
    }
    if (msg.type === "ADD_WHITELIST") {
      addToWhitelist(msg.domain).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type === "REMOVE_WHITELIST") {
      removeFromWhitelist(msg.domain).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type === "SET_WHITELIST") {
      setWhitelist(msg.domains).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type === "SET_WHITELIST_MODE") {
      setWhitelistMode(msg.mode).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type === "ADD_NAS") {
      addNas(msg.nas).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type === "UPDATE_NAS") {
      updateNas(msg.nasId, msg.updates).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type === "DELETE_NAS") {
      deleteNas(msg.nasId).then(() => sendResponse({ ok: true }));
      return true;
    }
  } catch (err) {
    dbg("ERROR", "Message listener error", err.message);
    sendResponse({ ok: false, error: err.message, log: [...debugLog] });
  }
});
