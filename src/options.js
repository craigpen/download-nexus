// options.js — Download Nexus Full-Tab Settings Manager

const SERVICE_DEFAULTS = {
  synology: {
    port: 5000,
    httpsPort: 5001,
    username: "admin",
    name: "Synology NAS",
    portHint: "5000 (HTTP) or 5001 (HTTPS)"
  },
  qbittorrent: {
    port: 8080,
    httpsPort: 8080,
    username: "admin",
    name: "qBittorrent",
    portHint: "8080 (default Web UI)"
  },
  transmission: {
    port: 9091,
    httpsPort: 9091,
    username: "",
    name: "Transmission",
    portHint: "9091 (default RPC)"
  },
  deluge: {
    port: 8112,
    httpsPort: 8112,
    username: "admin",
    name: "Deluge Web",
    portHint: "8112 (default Web UI)"
  },
  jdownloader: {
    port: 3128,
    httpsPort: 3128,
    username: "",
    name: "JDownloader 2",
    portHint: "3128 (RemoteAPI) or 9666 (Click'n'Load)"
  }
};

let currentServices = [];
let editingServiceId = null;

// ── Messaging & Toast Helpers ───────────────────────────────────────────────

function sendMsg(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, resp => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      resolve(resp);
    });
  });
}

function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = `show ${type}`;
  setTimeout(() => {
    toast.className = "";
  }, 2800);
}

// ── Tab Navigation ─────────────────────────────────────────────────────────

function initTabs() {
  const tabs = document.querySelectorAll(".nav-tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      const targetPaneId = `pane-${tab.dataset.tab}`;
      document.querySelectorAll(".content-pane").forEach(pane => {
        pane.classList.toggle("active", pane.id === targetPaneId);
      });
    });
  });

  const closeBtn = document.getElementById("closeTabBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      window.close();
    });
  }
}

// ── Services Management ────────────────────────────────────────────────────

async function loadServices() {
  try {
    const resp = await sendMsg({ type: "GET_NAS_LIST" });
    currentServices = resp?.list || [];
    renderServiceList();
  } catch (err) {
    console.error("Failed to load services:", err);
    showToast("Failed to load services: " + err.message, "error");
  }
}

function getServiceWebUrl(service) {
  if (!service || !service.host) return null;
  const scheme = service.https ? "https" : "http";
  const host = service.host;
  const port = service.port;
  if (service.type === "jdownloader") {
    return null; // Desktop app, no browser web UI
  }
  if (service.type === "transmission") {
    return `${scheme}://${host}:${port}/transmission/web/`;
  }
  if (service.type === "synology") {
    return `${scheme}://${host}:${port}`;
  }
  return `${scheme}://${host}:${port}/`;
}

function renderServiceList() {
  const container = document.getElementById("serviceListContainer");
  if (!container) return;

  container.innerHTML = "";

  if (currentServices.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding: 32px 16px; color: var(--text-muted);">
        <p style="font-size:15px; font-weight:600; margin-bottom:8px;">No download services configured yet.</p>
        <p style="font-size:13px; margin-bottom:16px;">Add your Synology NAS, qBittorrent, Transmission, Deluge, or JDownloader 2 service to start managing downloads.</p>
        <button class="btn btn-primary btn-sm" id="emptyAddBtn">+ Add Service</button>
      </div>
    `;
    const emptyAddBtn = document.getElementById("emptyAddBtn");
    if (emptyAddBtn) emptyAddBtn.addEventListener("click", () => openServiceEditor());
    return;
  }

  currentServices.forEach(srv => {
    const card = document.createElement("div");
    card.className = "device-card";

    const scheme = srv.https ? "https" : "http";
    const urlStr = `${scheme}://${srv.host}:${srv.port}`;
    const webUrl = getServiceWebUrl(srv);

    const urlDisplay = webUrl
      ? `<a href="${esc(webUrl)}" target="_blank" rel="noopener noreferrer" class="device-url-link" title="Open Web UI">${esc(urlStr)} ↗</a>`
      : `<span class="device-url">${esc(urlStr)} <span style="font-size:11px; opacity:0.8">(Desktop App)</span></span>`;

    card.innerHTML = `
      <div class="device-info">
        <div class="device-title">
          <span>${esc(srv.name || "Download Service")}</span>
          <span class="device-type-badge">${esc(srv.type || "synology")}</span>
        </div>
        ${urlDisplay}
      </div>
      <div class="device-actions">
        ${webUrl ? `<a href="${esc(webUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" title="Open Web UI in new tab" style="text-decoration:none; display:inline-flex; align-items:center; gap:3px;">↗ Web</a>` : ""}
        <button class="btn btn-secondary btn-sm test-btn" data-id="${esc(srv.id)}">⚡ Test</button>
        <button class="btn btn-secondary btn-sm edit-btn" data-id="${esc(srv.id)}">✏️ Edit</button>
        <button class="btn btn-danger btn-sm del-btn" data-id="${esc(srv.id)}">🗑️</button>
      </div>
    `;

    card.querySelector(".test-btn").addEventListener("click", () => testSpecificService(srv.id));
    card.querySelector(".edit-btn").addEventListener("click", () => openServiceEditor(srv.id));
    card.querySelector(".del-btn").addEventListener("click", () => deleteService(srv.id));

    container.appendChild(card);
  });
}

function openServiceEditor(serviceId = null) {
  editingServiceId = serviceId;
  const editorCard = document.getElementById("serviceEditorCard");
  const editorTitle = document.getElementById("editorTitle");
  const form = document.getElementById("serviceForm");

  if (!editorCard || !form) return;

  editorCard.style.display = "block";
  editorCard.scrollIntoView({ behavior: "smooth" });

  if (serviceId) {
    const srv = currentServices.find(s => s.id === serviceId);
    if (!srv) return;
    editorTitle.textContent = `Edit Service: ${srv.name}`;
    document.getElementById("serviceId").value = srv.id;
    document.getElementById("serviceType").value = srv.type || "synology";
    document.getElementById("serviceName").value = srv.name || "";
    document.getElementById("serviceHost").value = srv.host || "";
    document.getElementById("servicePort").value = srv.port || 5000;
    document.getElementById("serviceHttps").checked = !!srv.https;
    document.getElementById("serviceUsername").value = srv.username || "";
    document.getElementById("servicePassword").value = srv.password || "";
    document.getElementById("serviceDefaultPath").value = srv.defaultPath || "";
  } else {
    editorTitle.textContent = "Add New Download Service";
    form.reset();
    document.getElementById("serviceId").value = "";
    document.getElementById("serviceType").value = "synology";
    applyServiceTypeDefaults("synology");
  }
}

function applyServiceTypeDefaults(type) {
  const defaults = SERVICE_DEFAULTS[type] || SERVICE_DEFAULTS.synology;
  const isHttps = document.getElementById("serviceHttps").checked;
  document.getElementById("servicePort").value = isHttps ? defaults.httpsPort : defaults.port;
  document.getElementById("serviceName").value = defaults.name;
  document.getElementById("serviceUsername").value = defaults.username;
  document.getElementById("portHint").textContent = defaults.portHint;

  const hostEl = document.getElementById("serviceHost");
  if (type === "jdownloader" && (!hostEl.value || hostEl.value === "192.168.0.1")) {
    hostEl.value = "127.0.0.1";
  }
}

function closeServiceEditor() {
  const editorCard = document.getElementById("serviceEditorCard");
  if (editorCard) editorCard.style.display = "none";
  editingServiceId = null;
}

async function saveServiceForm(e) {
  e.preventDefault();

  const id = document.getElementById("serviceId").value || `nas-${Date.now()}`;
  const type = document.getElementById("serviceType").value;
  const name = document.getElementById("serviceName").value.trim() || "Download Service";
  const host = document.getElementById("serviceHost").value.trim();
  const port = parseInt(document.getElementById("servicePort").value, 10) || 5000;
  const https = document.getElementById("serviceHttps").checked;
  const username = document.getElementById("serviceUsername").value.trim();
  const password = document.getElementById("servicePassword").value;
  const defaultPath = document.getElementById("serviceDefaultPath").value.trim();

  const servicePayload = {
    id,
    type,
    name,
    host,
    port,
    https,
    username,
    password,
    defaultPath
  };

  try {
    const list = [...currentServices];
    const existingIdx = list.findIndex(s => s.id === id);

    if (existingIdx >= 0) {
      list[existingIdx] = servicePayload;
    } else {
      list.push(servicePayload);
    }

    await sendMsg({ type: "SAVE_NAS_LIST", list });
    currentServices = list;
    renderServiceList();
    closeServiceEditor();
    showToast(`Service "${name}" saved successfully!`);
  } catch (err) {
    console.error("Failed to save service:", err);
    showToast("Error saving service: " + err.message, "error");
  }
}

async function testSpecificService(serviceId) {
  const srv = currentServices.find(s => s.id === serviceId);
  if (!srv) return;

  showToast(`Testing connection to ${srv.name}…`, "info");
  try {
    const resp = await sendMsg({ type: "TEST_CONNECTION", nasId: serviceId, settings: srv });
    if (resp?.ok) {
      showToast(`✅ Connected successfully! Version: ${resp.version || "OK"}`);
    } else {
      showToast(`❌ Connection failed: ${resp?.error || "Unknown error"}`, "error");
    }
  } catch (err) {
    showToast(`❌ Connection error: ${err.message}`, "error");
  }
}

async function testFormConnection() {
  const type = document.getElementById("serviceType").value;
  const name = document.getElementById("serviceName").value.trim() || "Service";
  const host = document.getElementById("serviceHost").value.trim();
  const port = parseInt(document.getElementById("servicePort").value, 10) || 5000;
  const https = document.getElementById("serviceHttps").checked;
  const username = document.getElementById("serviceUsername").value.trim();
  const password = document.getElementById("servicePassword").value;

  if (!host || !port) {
    showToast("Please enter host and port first.", "error");
    return;
  }

  const tempSettings = { type, name, host, port, https, username, password };
  showToast(`Testing connection to ${host}:${port}…`, "info");

  try {
    const resp = await sendMsg({ type: "TEST_CONNECTION", settings: tempSettings });
    if (resp?.ok) {
      showToast(`✅ Connection succeeded! (${resp.version || "OK"})`);
    } else {
      showToast(`❌ Connection failed: ${resp?.error || "Unknown error"}`, "error");
    }
  } catch (err) {
    showToast(`❌ Connection error: ${err.message}`, "error");
  }
}

async function deleteService(serviceId) {
  const srv = currentServices.find(s => s.id === serviceId);
  const name = srv?.name || "this service";

  if (!confirm(`Are you sure you want to delete "${name}"?`)) return;

  try {
    const list = currentServices.filter(s => s.id !== serviceId);
    await sendMsg({ type: "SAVE_NAS_LIST", list });
    currentServices = list;
    renderServiceList();
    showToast(`Service "${name}" deleted.`);
  } catch (err) {
    showToast("Error deleting service: " + err.message, "error");
  }
}

// ── Downloadable Link Types Settings ───────────────────────────────────────

const DEFAULT_FILE_EXTENSIONS = "zip\nrar\n7z\ntar\ngz\nbz2\niso\nexe\nmsi\npdf\ndoc\ndocx\nxls\nxlsx\nmp4\nmkv\napk";

async function loadCaptureSettings() {
  chrome.storage.local.get({ enabledProtocols: { magnet: true, torrent: true, otherFileTypes: false } }, res => {
    const p = res.enabledProtocols || {};
    document.getElementById("captureMagnet").checked = p.magnet !== false;
    document.getElementById("captureTorrent").checked = p.torrent !== false;
    const otherChecked = !!p.otherFileTypes;
    document.getElementById("captureOther").checked = otherChecked;
    document.getElementById("fileTypesSection").style.display = otherChecked ? "block" : "none";
  });

  chrome.storage.sync.get({ downloadExtensions: DEFAULT_FILE_EXTENSIONS }, res => {
    document.getElementById("customExtensions").value = res.downloadExtensions || DEFAULT_FILE_EXTENSIONS;
  });

  document.getElementById("captureOther")?.addEventListener("change", (e) => {
    document.getElementById("fileTypesSection").style.display = e.target.checked ? "block" : "none";
  });
}

async function saveCaptureSettings() {
  const enabledProtocols = {
    magnet: document.getElementById("captureMagnet").checked,
    torrent: document.getElementById("captureTorrent").checked,
    otherFileTypes: document.getElementById("captureOther").checked
  };

  const extensions = document.getElementById("customExtensions").value
    .split("\n")
    .map(s => s.trim().replace(/^\./, ""))
    .filter(Boolean);

  await new Promise(r => chrome.storage.local.set({ enabledProtocols }, r));
  await new Promise(r => chrome.storage.sync.set({ downloadExtensions: extensions.join("\n") }, r));

  showToast("Downloadable link settings saved!");
}

// ── Whitelist Settings ─────────────────────────────────────────────────────

async function loadWhitelistSettings() {
  try {
    const [modeResp, listResp] = await Promise.all([
      sendMsg({ type: "GET_WHITELIST_MODE" }),
      sendMsg({ type: "GET_WHITELIST" })
    ]);

    document.getElementById("whitelistMode").value = modeResp?.mode || "all";
    document.getElementById("whitelistDomains").value = (listResp?.list || []).join("\n");
  } catch (err) {
    console.error("Failed to load whitelist:", err);
  }
}

async function saveWhitelistSettings() {
  const mode = document.getElementById("whitelistMode").value;
  const domains = document.getElementById("whitelistDomains").value
    .split("\n")
    .map(d => d.trim().toLowerCase())
    .filter(Boolean);

  try {
    await Promise.all([
      sendMsg({ type: "SET_WHITELIST_MODE", mode }),
      sendMsg({ type: "SET_WHITELIST", list: domains })
    ]);
    showToast("Domain routing rules saved!");
  } catch (err) {
    showToast("Failed to save whitelist: " + err.message, "error");
  }
}

// ── Backup & Restore ───────────────────────────────────────────────────────

async function exportConfig() {
  try {
    const [nasResp, whiteResp, modeResp] = await Promise.all([
      sendMsg({ type: "GET_NAS_LIST" }),
      sendMsg({ type: "GET_WHITELIST" }),
      sendMsg({ type: "GET_WHITELIST_MODE" })
    ]);

    const backup = {
      version: "1.1.9",
      exportedAt: new Date().toISOString(),
      services: (nasResp?.list || []).map(s => ({ ...s, password: "" })), // Exclude plaintext passwords for safety
      whitelist: whiteResp?.list || [],
      whitelistMode: modeResp?.mode || "all"
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `download-nexus-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Configuration exported!");
  } catch (err) {
    showToast("Export failed: " + err.message, "error");
  }
}

function importConfig() {
  const fileInput = document.getElementById("importFileInput");
  if (fileInput) fileInput.click();
}

async function handleFileImport(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.services || !Array.isArray(data.services)) {
      throw new Error("Invalid backup file format: missing services array.");
    }

    if (confirm(`Import ${data.services.length} services from "${file.name}"?`)) {
      await sendMsg({ type: "SAVE_NAS_LIST", list: data.services });
      if (data.whitelist && Array.isArray(data.whitelist)) {
        await sendMsg({ type: "SET_WHITELIST", list: data.whitelist });
      }
      if (data.whitelistMode) {
        await sendMsg({ type: "SET_WHITELIST_MODE", mode: data.whitelistMode });
      }
      await loadServices();
      await loadWhitelistSettings();
      showToast("Configuration imported successfully!");
    }
  } catch (err) {
    showToast("Import failed: " + err.message, "error");
  } finally {
    e.target.value = "";
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Initialization ─────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  loadServices();
  loadCaptureSettings();
  loadWhitelistSettings();

  // Version banner
  const manifest = chrome.runtime.getManifest();
  if (manifest?.version) {
    const verEl = document.getElementById("extVersion");
    if (verEl) verEl.textContent = `v${manifest.version}`;
  }

  // Event Listeners
  document.getElementById("addServiceBtn")?.addEventListener("click", () => openServiceEditor());
  document.getElementById("cancelEditBtn")?.addEventListener("click", closeServiceEditor);
  document.getElementById("cancelEditBtn2")?.addEventListener("click", closeServiceEditor);
  document.getElementById("serviceForm")?.addEventListener("submit", saveServiceForm);
  document.getElementById("testConnBtn")?.addEventListener("click", testFormConnection);
  document.getElementById("serviceType")?.addEventListener("change", (e) => applyServiceTypeDefaults(e.target.value));

  document.getElementById("saveCaptureSettingsBtn")?.addEventListener("click", saveCaptureSettings);
  document.getElementById("saveWhitelistBtn")?.addEventListener("click", saveWhitelistSettings);

  document.getElementById("exportBtn")?.addEventListener("click", exportConfig);
  document.getElementById("importBtn")?.addEventListener("click", importConfig);
  document.getElementById("importFileInput")?.addEventListener("change", handleFileImport);
});
