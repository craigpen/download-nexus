// background.js — NAS Download helper
// Uses a persistent session (sid) to avoid displacing DSM browser sessions.

const DEFAULT_SETTINGS = {
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
    `[SynoMagnet][${level}] ${msg}`, detail ?? ""
  );
}

// ── helpers ────────────────────────────────────────────────────────────────

function baseUrl(s) {
  const scheme = s.https ? "https" : "http";
  return `${scheme}://${s.host}:${s.port}/webapi`;
}

async function getSettings() {
  return new Promise(resolve => chrome.storage.sync.get(DEFAULT_SETTINGS, resolve));
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
// Stored in chrome.storage.local so it survives service worker restarts
// but is NOT synced across devices (it's host-specific).

async function getStoredSid() {
  return new Promise(resolve => {
    chrome.storage.local.get({ sid: null, sidHost: null }, r => {
      resolve(r);
    });
  });
}

async function storeSid(sid, host) {
  return new Promise(resolve => chrome.storage.local.set({ sid, sidHost: host }, resolve));
}

async function clearSid() {
  return new Promise(resolve => chrome.storage.local.remove(["sid", "sidHost"], resolve));
}

// ── Synology API calls ─────────────────────────────────────────────────────

async function synoFetch(label, url, options, timeoutMs = 20000) {
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
    const errMsg = err.name === "AbortError" ? `timeout after ${timeoutMs}ms` : err.message;
    dbg("ERROR", `${label} fetch threw`, `${err.name}: ${errMsg}`);
    throw err;
  }
  clearTimeout(timeoutId);
  dbg("INFO", `${label} ← HTTP ${resp.status} ${resp.statusText}`);
  return resp;
}

async function synoLogin(s) {
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
  const resp = await synoFetch("LOGIN", url, {
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
async function getSid(s, force = false) {
  if (!force) {
    const stored = await getStoredSid();
    if (stored.sid && stored.sidHost === s.host) {
      dbg("INFO", "Reusing stored sid");
      return stored.sid;
    }
  }
  dbg("INFO", "No stored sid, logging in fresh");
  const sid = await synoLogin(s);
  await storeSid(sid, s.host);
  return sid;
}

// Call a Synology API function. If it fails with an auth error (code 105/106),
// clear the stored sid and retry once with a fresh login.
async function synoCall(s, apiFn) {
  let sid = await getSid(s);
  try {
    return await apiFn(sid);
  } catch (err) {
    // DSM auth error codes: 105 = permission denied, 106 = session expired
    if (/code (105|106|119)/.test(err.message)) {
      dbg("WARN", "Session expired, re-authenticating", err.message);
      await clearSid();
      sid = await getSid(s, true);
      return await apiFn(sid);
    }
    throw err;
  }
}

async function synoAddMagnet(s, sid, magnetUrl) {
  const params = new URLSearchParams({
    api:     "SYNO.DownloadStation.Task",
    version: "1",
    method:  "create",
    uri:     magnetUrl,
    _sid:    sid
  });
  if (s.destination) params.set("destination", s.destination);
  const url  = `${baseUrl(s)}/DownloadStation/task.cgi`;
  const resp = await synoFetch("ADD_MAGNET", url, {
    method:  "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    params.toString()
  });
  const text = await resp.text();
  dbg("INFO", "ADD_MAGNET body", text.slice(0, 300));
  let data;
  try { data = JSON.parse(text); }
  catch(e) { throw new Error(`Add-magnet response not JSON: ${text.slice(0, 120)}`); }
  if (!data.success) {
    const code = data.error?.code ?? "?";
    throw new Error(`Task creation failed (DSM code ${code})`);
  }
}

async function synoAddTorrent(s, sid, torrentUrl) {
  dbg("INFO", "FETCH_TORRENT", torrentUrl);
  const tResp = await fetch(torrentUrl, { credentials: "omit" });
  if (!tResp.ok) throw new Error(`Failed to fetch torrent file (HTTP ${tResp.status})`);
  const blob = await tResp.blob();
  dbg("INFO", "FETCH_TORRENT ok", `${blob.size} bytes`);

  const form = new FormData();
  form.append("api",     "SYNO.DownloadStation.Task");
  form.append("version", "1");
  form.append("method",  "create");
  form.append("_sid",    sid);
  if (s.destination) form.append("destination", s.destination);
  const filename = torrentUrl.split("/").pop().split("?")[0] || "download.torrent";
  form.append("file", new File([blob], filename, { type: "application/x-bittorrent" }));

  const url  = `${baseUrl(s)}/DownloadStation/task.cgi`;
  const resp = await synoFetch("ADD_TORRENT", url, {
    method: "POST",
    credentials: "include",
    body:   form
  });
  const text = await resp.text();
  dbg("INFO", "ADD_TORRENT body", text.slice(0, 300));
  let data;
  try { data = JSON.parse(text); }
  catch(e) { throw new Error(`Add-torrent response not JSON: ${text.slice(0, 120)}`); }
  if (!data.success) {
    const code = data.error?.code ?? "?";
    throw new Error(`Torrent upload failed (DSM code ${code})`);
  }
}

// ── test connection ────────────────────────────────────────────────────────

async function testConnection(s) {
  dbg("INFO", "TEST_CONNECTION start", `${s.https ? "https" : "http"}://${s.host}:${s.port}`);
  // Always do a fresh login for the test so we can verify credentials
  await clearSid();
  try {
    const sid = await getSid(s, true);
    const infoUrl = `${baseUrl(s)}/DownloadStation/info.cgi?api=SYNO.DownloadStation.Info&version=1&method=getinfo&_sid=${sid}`;
    const ir   = await synoFetch("DS_INFO", infoUrl, { credentials: "include" });
    const text = await ir.text();
    dbg("INFO", "DS_INFO body", text.slice(0, 300));
    let data;
    try { data = JSON.parse(text); }
    catch(e) { throw new Error(`DS info response not JSON: ${text.slice(0, 120)}`); }
    if (data.success) {
      dbg("INFO", "TEST_CONNECTION success", `DS version: ${data.data?.version_string}`);
      // Store the sid so subsequent sends reuse it
      await storeSid(sid, s.host);
      return { ok: true, version: data.data?.version_string ?? "", log: [...debugLog] };
    } else {
      throw new Error(`Download Station error code ${data.error?.code ?? "?"}`);
    }
  } catch (err) {
    dbg("ERROR", "TEST_CONNECTION failed", err.message);
    return { ok: false, error: err.message, log: [...debugLog] };
  }
}

// ── main send functions ────────────────────────────────────────────────────

function decodeName(magnetUrl) {
  try {
    const m = magnetUrl.match(/[?&]dn=([^&]+)/);
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "";
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

async function sendMagnet(magnetUrl) {
  const s = await getSettings();
  if (!s.password) {
    notify("⚠️ Not configured", "Open the extension options and enter your Synology credentials.");
    return;
  }
  dbg("INFO", "SEND_MAGNET", magnetUrl.slice(0, 80));
  try {
    await synoCall(s, sid => synoAddMagnet(s, sid, magnetUrl));
    notify("✅ Sent to Download Station", decodeName(magnetUrl) || magnetUrl.slice(0, 80));
  } catch (err) {
    notify("❌ Synology error", err.message);
    dbg("ERROR", "SEND_MAGNET failed", err.message);
  }
}

async function sendTorrent(torrentUrl) {
  const s = await getSettings();
  if (!s.password) {
    notify("⚠️ Not configured", "Open the extension options and enter your Synology credentials.");
    return;
  }
  dbg("INFO", "SEND_TORRENT", torrentUrl.slice(0, 80));
  try {
    await synoCall(s, sid => synoAddTorrent(s, sid, torrentUrl));
    const filename = torrentUrl.split("/").pop().split("?")[0] || torrentUrl.slice(0, 60);
    notify("✅ Torrent sent to Download Station", filename);
  } catch (err) {
    notify("❌ Synology error", err.message);
    dbg("ERROR", "SEND_TORRENT failed", err.message);
  }
}


// ── task list / control ────────────────────────────────────────────────────

async function listTasks(s, sid) {
  const url = `${baseUrl(s)}/DownloadStation/task.cgi?api=SYNO.DownloadStation.Task` +
              `&version=1&method=list&additional=transfer&_sid=${sid}`;
  const resp = await synoFetch("LIST_TASKS", url, { credentials: "include" });
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
  const resp = await synoFetch(`TASK_${action.toUpperCase()}`, url, {
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
  if (msg.type === "SEND_MAGNET") {
    sendMagnet(msg.url)
      .then(() => sendResponse({ ok: true, log: [...debugLog] }))
      .catch(e => sendResponse({ ok: false, error: e.message, log: [...debugLog] }));
    return true;
  }
  if (msg.type === "SEND_TORRENT") {
    sendTorrent(msg.url)
      .then(() => sendResponse({ ok: true, log: [...debugLog] }))
      .catch(e => sendResponse({ ok: false, error: e.message, log: [...debugLog] }));
    return true;
  }
  if (msg.type === "TEST_CONNECTION") {
    testConnection(msg.settings)
      .then(result => sendResponse(result))
      .catch(e => sendResponse({ ok: false, error: e.message, log: [...debugLog] }));
    return true;
  }
  if (msg.type === "LIST_TASKS") {
    getSettings().then(s =>
      synoCall(s, sid => listTasks(s, sid))
        .then(tasks => sendResponse({ ok: true, tasks }))
        .catch(e => sendResponse({ ok: false, error: e.message }))
    );
    return true;
  }
  if (msg.type === "TASK_ACTION") {
    getSettings().then(s =>
      synoCall(s, sid => taskAction(s, sid, msg.action, msg.ids))
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }))
    );
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
    testConnection(msg.settings ?? await getSettings())
      .then(result => sendResponse(result))
      .catch(e => sendResponse({ ok: false, error: e.message, log: [...debugLog] }));
    return true;
  }
  if (msg.type === "GET_LOG") {
    sendResponse({ log: [...debugLog] });
  }
});
