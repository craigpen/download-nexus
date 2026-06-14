// background.js — NAS Download helper
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
  async addDownload(uri, destination) {
    const isMagnet = uri.startsWith("magnet:");
    const isTorrentUrl = /\.torrent(\?|$)/i.test(uri);

    if (!isMagnet && !isTorrentUrl) {
      throw new Error("Invalid URI: must be a magnet link or .torrent URL");
    }

    await synoAddDownload(this.config, this.nasId, uri, destination);
  }
}

function getAdapter(nasId, config) {
  const type = config.type || "synology";
  switch (type) {
    case "synology":
      return new SynologyAdapter(nasId, config);
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
function dbg(level, msg, detail) {
  const entry = {
    ts: new Date().toISOString().replace("T", " ").slice(0, 23),
    level,
    msg,
    detail: detail ?? ""
  };
  debugLog.push(entry);
  if (debugLog.length > 200) debugLog.shift();
  console[level === "ERROR" ? "error" : level === "WARN" ? "warn" : "log"](
    `[NAS][${level}] ${msg}`, detail ?? ""
  );
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

async function addToWhitelist(domain) {
  const list = await getWhitelist();
  if (!list.includes(domain)) {
    list.push(domain);
    return new Promise(resolve => chrome.storage.sync.set({ whitelist: list }, resolve));
  }
}

async function removeFromWhitelist(domain) {
  let list = await getWhitelist();
  list = list.filter(d => d !== domain);
  return new Promise(resolve => chrome.storage.sync.set({ whitelist: list }, resolve));
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

// ── test connection ────────────────────────────────────────────────────────

async function testConnection(nasId, s) {
  dbg("INFO", "TEST_CONNECTION start", `${s.https ? "https" : "http"}://${s.host}:${s.port}`);
  // Always do a fresh login for the test so we can verify credentials
  await removeSid(nasId);
  try {
    if (!s || !s.host || !s.port || !s.username) {
      throw new Error("Settings incomplete: missing host, port, or username");
    }
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
    notify("✅ Sent to Download Station", displayName || uri.slice(0, 80));
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
    dbg("INFO", "Message received", msg.type);

    if (msg.type === "SEND_MAGNET") {
      sendMagnet(msg.url, msg.nasId)
        .then(() => sendResponse({ ok: true, log: [...debugLog] }))
        .catch(e => sendResponse({ ok: false, error: e.message, log: [...debugLog] }));
      return true;
    }
    if (msg.type === "TEST_CONNECTION") {
      dbg("INFO", "TEST_CONNECTION handler called");
      testConnection(msg.nasId, msg.settings)
        .then(result => {
          dbg("INFO", "TEST_CONNECTION sending response", result.ok ? "success" : result.error);
          sendResponse(result);
        })
        .catch(e => {
          dbg("ERROR", "TEST_CONNECTION catch block", e.message);
          sendResponse({ ok: false, error: e.message, log: [...debugLog] });
        });
      return true;
    }
    if (msg.type === "LIST_TASKS") {
      (async () => {
        const s = await getNasById(msg.nasId);
        if (!s) return sendResponse({ ok: false, error: "NAS not found" });
        nasCall(msg.nasId, s, sid => listTasks(s, sid))
          .then(tasks => sendResponse({ ok: true, tasks }))
          .catch(e => sendResponse({ ok: false, error: e.message }));
      })();
      return true;
    }
    if (msg.type === "TASK_ACTION") {
      (async () => {
        const s = await getNasById(msg.nasId);
        if (!s) return sendResponse({ ok: false, error: "NAS not found" });
        nasCall(msg.nasId, s, sid => taskAction(s, sid, msg.action, msg.ids))
          .then(() => sendResponse({ ok: true }))
          .catch(e => sendResponse({ ok: false, error: e.message }));
      })();
      return true;
    }
    if (msg.type === "GET_NAS_LIST") {
      getNasList().then(list => sendResponse({ list }));
      return true;
    }
    if (msg.type === "GET_WHITELIST") {
      getWhitelist().then(list => sendResponse({ list }));
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
    if (msg.type === "CHECK_CONNECTION") {
      (async () => {
        const s = await getNasById(msg.nasId);
        if (!s) return sendResponse({ ok: false, error: "NAS not found" });
        testConnection(msg.nasId, s)
          .then(result => sendResponse(result))
          .catch(e => sendResponse({ ok: false, error: e.message, log: [...debugLog] }));
      })();
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
    if (msg.type === "GET_LOG") {
      sendResponse({ log: [...debugLog] });
    }
  } catch (err) {
    dbg("ERROR", "Message listener error", err.message);
    sendResponse({ ok: false, error: err.message, log: [...debugLog] });
  }
});
