// popup.js — Task manager + device settings

let allTasks      = [];
let filter        = "downloading";
let pollTimer     = null;
let currentDomain = null;
let whitelistSet  = new Set();
let whitelistMode = "all"; // "all" | "restricted"
let nasList       = [];
let currentNasId  = null;
let nasConnStatus = {}; // Track connection status per NAS
let editingNasId  = null;

// ── utilities ─────────────────────────────────────────────────────────────

function fmt(bytes) {
  if (bytes == null || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const k = 1024, sizes = ["B","KB","MB","GB","TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1) + " " + sizes[i];
}

function fmtSpeed(bps) {
  if (!bps) return "0 B/s";
  return fmt(bps) + "/s";
}

function fmtEta(seconds) {
  if (!seconds || seconds < 0 || seconds > 86400 * 30) return "";
  if (seconds < 60)  return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds/60)}m ${seconds%60}s`;
  return `${Math.floor(seconds/3600)}h ${Math.floor((seconds%3600)/60)}m`;
}

// Get display text for status based on adapter type
function getStatusDisplayText(status, nasId) {
  if (!nasId) return status;
  const device = nasList.find(n => n.id === nasId);
  if (!device) return status;

  const adapterType = device.type || "synology";
  // qBittorrent uses "stopped" terminology instead of "paused"
  if (adapterType === "qbittorrent" && status === "paused") {
    return "stopped";
  }
  return status;
}

// Get pause button text for adapter type
function getAdapterPauseText(nasId) {
  const device = nasList.find(n => n.id === nasId);
  const adapterType = device?.type || "synology";
  return adapterType === "qbittorrent" ? "Stop" : "Pause";
}

function statusClass(status) {
  const map = {
    downloading: "s-downloading",
    seeding:     "s-seeding",
    paused:      "s-paused",
    stopped:     "s-paused",
    finished:    "s-finished",
    error:       "s-error",
    waiting:     "s-waiting"
  };
  return map[status] || "s-other";
}

function progressColor(status) {
  if (status === "error")    return "#ff7b72";
  if (status === "seeding")  return "#4caf7d";
  if (status === "finished") return "#4caf7d";
  if (status === "paused")   return "#e3b341";
  return "#5b9cf6";
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── messaging ─────────────────────────────────────────────────────────────

function send(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, resp => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(resp);
    });
  });
}

// ── render ────────────────────────────────────────────────────────────────

function setStatus(msg, isErr) {
  const el = document.getElementById("statusMsg");
  el.textContent = msg;
  el.style.color = isErr ? "#ff7b72" : "#5a6880";
}

function updateCounts() {
  const counts = { all: allTasks.length, downloading: 0, seeding: 0, paused: 0, finished: 0, error: 0 };
  for (const t of allTasks) {
    if (counts[t.status] !== undefined) counts[t.status]++;
  }
  for (const [k, v] of Object.entries(counts)) {
    const el = document.getElementById(`cnt-${k}`);
    if (el) el.textContent = v;
  }

  // Total speeds (support both normalized and Synology formats)
  let dn = 0, up = 0;
  for (const t of allTasks) {
    dn += (t.speed_down !== undefined) ? t.speed_down : (t.additional?.transfer?.speed_download || 0);
    up += (t.speed_up !== undefined) ? t.speed_up : (t.additional?.transfer?.speed_upload || 0);
  }
  document.getElementById("totalDn").textContent = fmtSpeed(dn);
  document.getElementById("totalUp").textContent = fmtSpeed(up);
  document.getElementById("taskCountLabel").textContent = `${allTasks.length} task${allTasks.length !== 1 ? "s" : ""}`;
}

function getVisibleTasks() {
  const filtered = filter === "all" ? allTasks : allTasks.filter(t => t.status === filter);

  // Sort based on filter
  if (filter === "downloading") {
    // DL tab: sort by % complete (most complete first)
    return filtered.sort((a, b) => {
      const aDownloaded = a.downloaded !== undefined ? a.downloaded : (a.additional?.transfer?.size_downloaded || 0);
      const bDownloaded = b.downloaded !== undefined ? b.downloaded : (b.additional?.transfer?.size_downloaded || 0);
      const aPct = a.size > 0 ? aDownloaded / a.size : 0;
      const bPct = b.size > 0 ? bDownloaded / b.size : 0;
      return bPct - aPct;
    });
  } else {
    // All other tabs: sort by date added (newest first)
    return filtered.sort((a, b) => {
      const aTime = a.additional?.time_added || 0;
      const bTime = b.additional?.time_added || 0;
      return bTime - aTime;
    }).reverse();
  }
}

function updateFooterButtons() {
  const visible = getVisibleTasks();
  const pauseCount = visible.filter(t => t.status === "downloading").length;
  const resumeCount = visible.filter(t => t.status === "paused").length;
  const pauseBtn = document.getElementById("pauseAllBtn");
  const resumeBtn = document.getElementById("resumeAllBtn");

  pauseBtn.disabled = pauseCount === 0;
  resumeBtn.disabled = resumeCount === 0;
  pauseBtn.textContent = `⏸ Pause visible${pauseCount ? ` (${pauseCount})` : ""}`;
  resumeBtn.textContent = `▶ Resume visible${resumeCount ? ` (${resumeCount})` : ""}`;
  pauseBtn.title = `Pause only tasks visible in the current filter (${pauseCount} task${pauseCount !== 1 ? "s" : ""})`;
  resumeBtn.title = `Resume only tasks visible in the current filter (${resumeCount} task${resumeCount !== 1 ? "s" : ""})`;
}

function renderTasks() {
  const list = document.getElementById("taskList");
  const empty = document.getElementById("emptyMsg");

  const visible = getVisibleTasks();

  if (visible.length === 0) {
    empty.style.display = "flex";
    const labels = { all: "active", downloading: "downloading", seeding: "seeding", paused: "paused", finished: "done", error: "error" };
    const statusLabel = labels[filter] || filter;
    empty.textContent = allTasks.length === 0
      ? "No active downloads"
      : `No ${statusLabel} tasks`;
    // Remove old task rows
    list.querySelectorAll(".task").forEach(el => el.remove());
    updateFooterButtons();
    return;
  }

  empty.style.display = "none";

  // Build a map of existing rows by task id for efficient updates
  const existing = {};
  list.querySelectorAll(".task").forEach(el => { existing[el.dataset.id] = el; });

  const fragment = document.createDocumentFragment();
  const seen = new Set();

  for (const task of visible) {
    seen.add(task.id);
    // Support both normalized format (qBittorrent) and Synology format
    const transfer = task.additional?.transfer || {};
    const size     = task.size;
    const dlSize   = task.downloaded !== undefined ? task.downloaded : (transfer.size_downloaded || 0);
    const pct      = size > 0 ? Math.min(100, Math.round(dlSize / size * 100)) : 0;
    const spDn     = task.speed_down !== undefined ? task.speed_down : (transfer.speed_download || 0);
    const spUp     = task.speed_up !== undefined ? task.speed_up : (transfer.speed_upload || 0);
    const eta      = spDn > 0 && size > dlSize ? Math.round((size - dlSize) / spDn) : 0;
    const isPaused = task.status === "paused" || task.status === "finished" || task.status === "error";
    const color    = progressColor(task.status);

    if (existing[task.id]) {
      // Update in place
      const row = existing[task.id];
      row.querySelector(".task-name").textContent = task.title;
      row.querySelector(".progress-fill").style.width = `${pct}%`;
      row.querySelector(".progress-fill").style.background = color;
      row.querySelector(".progress-pct").textContent = `${pct}%`;
      row.querySelector(".task-dn").textContent   = fmtSpeed(spDn);
      row.querySelector(".task-up").textContent   = fmtSpeed(spUp);
      row.querySelector(".task-size").textContent = `${fmt(dlSize)} / ${fmt(size)}`;
      row.querySelector(".task-eta").textContent  = fmtEta(eta);
      row.querySelector(".status-dot").className  = `status-dot ${statusClass(task.status)}`;
      const pauseBtn  = row.querySelector(".pause-btn");
      const resumeBtn = row.querySelector(".resume-btn");
      if (pauseBtn)  pauseBtn.style.display  = isPaused ? "none" : "";
      if (resumeBtn) resumeBtn.style.display = isPaused ? "" : "none";
      fragment.appendChild(row);
    } else {
      // Create new row
      const row = document.createElement("div");
      row.className   = "task";
      row.dataset.id  = task.id;
      row.innerHTML   = `
        <div class="task-top">
          <span class="status-dot ${statusClass(task.status)}"></span>
          <span class="task-name" title="${escHtml(task.title)}">${escHtml(task.title)}</span>
          <div class="task-actions">
            <button class="task-btn pause-btn"  title="${getAdapterPauseText(currentNasId)}"  style="${isPaused ? "display:none" : ""}">⏸</button>
            <button class="task-btn resume-btn" title="Resume" style="${isPaused ? "" : "display:none"}">▶</button>
            <button class="task-btn danger delete-btn" title="Delete">✕</button>
          </div>
        </div>
        <div class="task-mid">
          <div class="progress-track">
            <div class="progress-fill" style="width:${pct}%;background:${color}"></div>
          </div>
          <span class="progress-pct">${pct}%</span>
        </div>
        <div class="task-bot">
          <span class="task-size">${fmt(dlSize)} / ${fmt(size)}</span>
          <span class="task-dn">↓ ${fmtSpeed(spDn)}</span>
          <span class="task-up">↑ ${fmtSpeed(spUp)}</span>
          <span class="task-eta">${fmtEta(eta)}</span>
        </div>`;

      row.querySelector(".pause-btn").addEventListener("click", () => taskAction("pause",  [task.id]));
      row.querySelector(".resume-btn").addEventListener("click", () => taskAction("resume", [task.id]));
      row.querySelector(".delete-btn").addEventListener("click", () => {
        if (confirm(`Delete "${task.title}"?`)) taskAction("delete", [task.id]);
      });
      fragment.appendChild(row);
    }
  }

  // Remove rows no longer in the visible set
  Object.keys(existing).forEach(id => {
    if (!seen.has(id)) existing[id].remove();
  });

  list.appendChild(fragment);
  updateFooterButtons();
}

// ── task cache (paint instantly on open, refresh in the background) ────────

function loadCachedTasks(nasId) {
  return new Promise(resolve => {
    chrome.storage.local.get({ taskCache: {} }, r => resolve(r.taskCache[nasId] || null));
  });
}

function saveCachedTasks(nasId, tasks) {
  chrome.storage.local.get({ taskCache: {} }, r => {
    const cache = r.taskCache;
    cache[nasId] = { tasks };
    chrome.storage.local.set({ taskCache: cache });
  });
}

async function paintCachedTasks() {
  if (!currentNasId) return;
  const cached = await loadCachedTasks(currentNasId);
  allTasks = cached?.tasks || [];
  document.getElementById("speedBar").style.display = "";
  document.getElementById("tabBar").style.display   = "";
  updateCounts();
  renderTasks();
  setStatus(cached ? "Showing cached data…" : "");
}

// ── data fetch ────────────────────────────────────────────────────────────

function setConnStatus(nasId, ok) {
  nasConnStatus[nasId] = ok ? "ok" : "error";
  if (nasId === currentNasId) {
    document.getElementById("connStatus").className = ok ? "ok" : "error";
    document.getElementById("connStatus").textContent = ok ? "● Connected" : "● Offline";
  }
  renderNasTabs(); // Update tabs with status
}

function showError(title, detail) {
  document.getElementById("errorTitle").textContent = title;
  document.getElementById("errorDetail").textContent = detail;
  document.getElementById("errorContainer").classList.add("show");
  document.getElementById("taskList").style.display = "none";
  document.getElementById("speedBar").style.display = "none";
  document.getElementById("tabBar").style.display = "none";
}

function hideError() {
  document.getElementById("errorContainer").classList.remove("show");
  document.getElementById("taskList").style.display = "";
}

async function refresh() {
  if (!currentNasId) return;
  try {
    const resp = await send({ type: "LIST_TASKS", nasId: currentNasId });
    if (!resp.ok) {
      setConnStatus(currentNasId, false);
      if (allTasks.length === 0) showError("⚠️ Failed to load tasks", resp.error || "Unknown error");
      setStatus(resp.error, true);
      return;
    }
    setConnStatus(currentNasId, true);
    hideError();
    allTasks = resp.tasks;
    console.log("Popup received tasks:", resp.tasks.length, "tasks");
    if (resp.tasks.length > 0) {
      console.log("First task fields:", Object.keys(resp.tasks[0]));
      console.log("First task data:", resp.tasks[0]);
    }
    saveCachedTasks(currentNasId, resp.tasks);
    document.getElementById("speedBar").style.display = "";
    document.getElementById("tabBar").style.display   = "";
    updateCounts();
    renderTasks();
    setStatus("");
  } catch (err) {
    setConnStatus(currentNasId, false);
    if (allTasks.length === 0) showError("❌ Connection error", err.message);
    setStatus(err.message, true);
  }
}

// ── task actions ──────────────────────────────────────────────────────────

async function taskAction(action, ids) {
  setStatus("…");
  try {
    const resp = await send({ type: "TASK_ACTION", nasId: currentNasId, action, ids });
    if (!resp.ok) { setStatus(resp.error, true); return; }
    await refresh();
  } catch (err) {
    setStatus(err.message, true);
  }
}

// ── NAS management (shared between main tabs and settings) ─────────────────

async function loadNasList() {
  return new Promise(resolve => {
    send({ type: "GET_NAS_LIST" }).then(resp => {
      nasList = resp.list || [];

      if (nasList.length === 0) {
        // No NAS configured
        document.getElementById("noNasContainer").classList.add("show");
        document.getElementById("taskList").style.display = "none";
        document.getElementById("speedBar").style.display = "none";
        document.getElementById("tabBar").style.display = "none";
      } else {
        // NAS configured
        document.getElementById("noNasContainer").classList.remove("show");
        document.getElementById("taskList").style.display = "";
        // Set current NAS to first in list if not set
        if (!currentNasId || !nasList.some(n => n.id === currentNasId)) {
          currentNasId = nasList[0].id;
        }
      }

      renderNasTabs(); // Render tabs after setting currentNasId
      renderSettingsNasList();
      resolve(nasList);
    });
  });
}

function renderNasTabs() {
  if (nasList.length <= 1) {
    // Hide tabs if only one or zero NAS, show header status instead
    document.getElementById("nasTabBar").style.display = "none";
    document.getElementById("connStatus").style.display = ""; // Show in header for single NAS
    return;
  }

  // Multiple NAS: hide header status, show in tabs instead
  document.getElementById("connStatus").style.display = "none";
  const tabBar = document.getElementById("nasTabBar");
  tabBar.innerHTML = nasList.map(nas => {
    const isActive = nas.id === currentNasId;
    const connStatus = nasConnStatus[nas.id] || "unknown";
    const connIndicator = connStatus === "ok" ? "Connected" : connStatus === "error" ? "Offline" : "…";
    const connColor = connStatus === "ok" ? "#4caf7d" : connStatus === "error" ? "#ff7b72" : "#8898b8";
    const nasName = escHtml(nas.name);
    const nasId = escHtml(nas.id);
    return `
      <button class="tab ${isActive ? "active" : ""}" data-nas-id="${nasId}" style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px;">
        <div>${nasName}</div>
        <div style="font-size: 9px; color: ${connColor}; opacity: 0.8;">${connIndicator}</div>
      </button>
    `;
  }).join("");
  tabBar.style.display = "flex";

  tabBar.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", async () => {
      currentNasId = tab.dataset.nasId;
      renderNasTabs();
      updateTabLabels(); // Update tab labels for this adapter
      filter = "downloading";
      // Mark the correct filter tab as active
      document.querySelectorAll('[data-filter]').forEach(t => t.classList.remove("active"));
      const activeFilterTab = document.querySelector('[data-filter="downloading"]');
      if (activeFilterTab) activeFilterTab.classList.add("active");
      await paintCachedTasks();
      refresh();
    });
  });

  updateTabLabels(); // Initial update
}

function updateTabLabels() {
  // Update tab labels based on current adapter type
  const device = nasList.find(n => n.id === currentNasId);
  const adapterType = device?.type || "synology";

  const pausedTab = document.querySelector('[data-filter="paused"]');
  if (pausedTab) {
    const countSpan = pausedTab.querySelector(".tab-count");
    const label = adapterType === "qbittorrent" ? "Stopped" : "Paused";
    pausedTab.innerHTML = label + " " + countSpan.outerHTML;
  }
}

// ── whitelist ──────────────────────────────────────────────────────────────

async function loadWhitelist() {
  try {
    const resp = await send({ type: "GET_WHITELIST" });
    whitelistSet = new Set(resp.list || []);
    whitelistMode = resp.mode === "restricted" ? "restricted" : "all";
    updateWhitelistUI();
    renderWhitelistSettings();
  } catch (err) {
    console.error("[NAS] Failed to load whitelist:", err);
  }
}

function updateWhitelistUI() {
  if (!currentDomain) return;
  const isWhitelisted = whitelistSet.has(currentDomain);
  const actionBtn = document.getElementById("whitelistAction");
  const domainInfo = document.getElementById("domainInfo");
  const btn = document.getElementById("whitelistBtn");
  domainInfo.textContent = currentDomain;
  actionBtn.textContent = isWhitelisted ? "✓ Remove from whitelist" : "+ Add to whitelist";

  if (isWhitelisted) {
    btn.style.color = "#4caf7d";
    btn.title = "Domain is whitelisted";
  } else {
    btn.style.color = "#8898b8";
    btn.title = "Whitelist current domain";
  }
}

async function toggleWhitelist() {
  if (!currentDomain) return;
  const isWhitelisted = whitelistSet.has(currentDomain);
  try {
    const msg = isWhitelisted
      ? { type: "REMOVE_WHITELIST", domain: currentDomain }
      : { type: "ADD_WHITELIST", domain: currentDomain };
    const resp = await send(msg);
    if (!resp.ok) {
      console.error("[NAS] Whitelist update failed:", resp.error);
      return;
    }
    if (isWhitelisted) {
      whitelistSet.delete(currentDomain);
    } else {
      whitelistSet.add(currentDomain);
    }
    updateWhitelistUI();
    renderWhitelistSettings();
  } catch (err) {
    console.error("[NAS] Whitelist update error:", err);
  }
}

// ── settings: view toggle ───────────────────────────────────────────────────

function showSettings() {
  document.getElementById("mainView").classList.remove("show");
  document.getElementById("settingsView").classList.add("show");
  document.getElementById("headerTitle").textContent = "Settings";
  document.getElementById("mainHeaderControls").style.display = "none";
  document.getElementById("gearIcon").style.display = "none";
  document.getElementById("backIcon").style.display = "";
  document.getElementById("settingsBtn").title = "Back";
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  showNasListView();
  renderSettingsNasList();
  renderWhitelistSettings();
}

async function showMainView() {
  document.getElementById("settingsView").classList.remove("show");
  document.getElementById("mainView").classList.add("show");
  document.getElementById("headerTitle").textContent = "NAS Download Helper";
  document.getElementById("mainHeaderControls").style.display = "flex";
  document.getElementById("gearIcon").style.display = "block";
  document.getElementById("backIcon").style.display = "none";
  document.getElementById("settingsBtn").title = "Settings";
  await paintCachedTasks();
  refresh();
  if (!pollTimer) pollTimer = setInterval(refresh, 5000);
}

// ── settings: NAS device list ───────────────────────────────────────────────

function renderSettingsNasList() {
  const container = document.getElementById("settingsNasList");
  if (!container) return;
  if (nasList.length === 0) {
    container.innerHTML = '<div class="settings-empty">No NAS devices configured yet.</div>';
    return;
  }
  container.innerHTML = nasList.map(nas => `
    <div class="nas-item" data-nas-id="${escHtml(nas.id)}">
      <div class="nas-item-info">
        <div class="nas-item-name">${escHtml(nas.name)}</div>
        <div class="nas-item-host">${escHtml(nas.host)}:${escHtml(String(nas.port))}</div>
      </div>
      <button type="button" class="mini-delete-btn" data-nas-id="${escHtml(nas.id)}">✕</button>
    </div>
  `).join("");

  container.querySelectorAll(".nas-item").forEach(item => {
    item.addEventListener("click", e => {
      if (e.target.classList.contains("mini-delete-btn")) return;
      editNas(item.dataset.nasId);
    });
  });
  container.querySelectorAll(".mini-delete-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const nas = nasList.find(n => n.id === btn.dataset.nasId);
      if (confirm(`Delete "${nas?.name}"?`)) deleteNasDevice(btn.dataset.nasId);
    });
  });
}

function showNasListView() {
  document.getElementById("settingsNasListWrap").style.display = "";
  document.getElementById("nasForm").classList.remove("show");
  editingNasId = null;
}

function showNasFormView() {
  document.getElementById("settingsNasListWrap").style.display = "none";
  document.getElementById("nasForm").classList.add("show");
}

function updateDestinationFieldVisibility() {
  const type = document.getElementById("nasType").value;
  const destinationField = document.getElementById("destinationField");
  destinationField.style.display = type === "synology" ? "" : "none";
}

function editNas(nasId) {
  editingNasId = nasId;
  const nas = nasList.find(n => n.id === nasId);
  if (!nas) return;

  document.getElementById("formTitle").textContent = `Edit ${nas.name}`;
  document.getElementById("deleteNasBtn").style.display = "";
  document.getElementById("nasName").value = nas.name;
  document.getElementById("nasType").value = nas.type || "synology";
  document.getElementById("nasHost").value = nas.host;
  document.getElementById("nasPort").value = nas.port;
  document.getElementById("nasHttps").checked = nas.https;
  document.getElementById("nasUsername").value = nas.username;
  document.getElementById("nasPassword").value = nas.password;
  document.getElementById("nasDestination").value = nas.destination || "";
  document.getElementById("nasFormStatus").textContent = "";
  document.getElementById("testNasStatus").textContent = "";

  updateDestinationFieldVisibility();
  showNasFormView();
  updateTestButtonState();
}

function addNewNas() {
  editingNasId = null;
  document.getElementById("formTitle").textContent = "Add NAS Device";
  document.getElementById("deleteNasBtn").style.display = "none";
  document.getElementById("nasName").value = "";
  document.getElementById("nasType").value = "synology";
  document.getElementById("nasHost").value = "192.168.0.1";
  document.getElementById("nasPort").value = "5000";
  document.getElementById("nasHttps").checked = false;
  document.getElementById("nasUsername").value = "admin";
  document.getElementById("nasPassword").value = "";
  document.getElementById("nasDestination").value = "";
  document.getElementById("nasFormStatus").textContent = "";
  document.getElementById("testNasStatus").textContent = "";

  updateDestinationFieldVisibility();
  showNasFormView();
  updateTestButtonState();
}

async function deleteNasDevice(nasId) {
  await send({ type: "DELETE_NAS", nasId });
  if (currentNasId === nasId) currentNasId = null;
  await loadNasList();
  showNasListView();
}

document.getElementById("nasForm").addEventListener("submit", async e => {
  e.preventDefault();
  const password = document.getElementById("nasPassword").value;
  const statusEl = document.getElementById("nasFormStatus");
  if (!password) {
    statusEl.textContent = "Password is required";
    statusEl.className = "settings-status err";
    setTimeout(() => { statusEl.textContent = ""; }, 4000);
    return;
  }

  const nasConfig = {
    type: document.getElementById("nasType").value,
    name: document.getElementById("nasName").value.trim(),
    host: document.getElementById("nasHost").value.trim(),
    port: document.getElementById("nasPort").value.trim(),
    https: document.getElementById("nasHttps").checked,
    username: document.getElementById("nasUsername").value.trim(),
    password,
    destination: document.getElementById("nasDestination").value.trim()
  };

  if (editingNasId) {
    await send({ type: "UPDATE_NAS", nasId: editingNasId, updates: nasConfig });
  } else {
    const nasId = `synology-${Date.now()}`;
    await send({ type: "ADD_NAS", nas: { id: nasId, ...nasConfig } });
  }

  statusEl.textContent = "Device saved!";
  statusEl.className = "settings-status ok";
  await loadNasList();
  setTimeout(() => { showNasListView(); }, 500);
});

document.getElementById("deleteNasBtn").addEventListener("click", e => {
  e.preventDefault();
  if (confirm("Are you sure you want to delete this NAS device?")) deleteNasDevice(editingNasId);
});

document.getElementById("nasType").addEventListener("change", updateDestinationFieldVisibility);

function updateTestButtonState() {
  const password = document.getElementById("nasPassword").value.trim();
  const testBtn = document.getElementById("testNasBtn");
  const hasPassword = password.length > 0;
  testBtn.disabled = !hasPassword;
  testBtn.title = hasPassword ? "Test connection to this NAS" : "Enter a password to test connection";
}

document.getElementById("nasPassword").addEventListener("input", updateTestButtonState);

document.getElementById("testNasBtn").addEventListener("click", async () => {
  const el = document.getElementById("testNasStatus");
  el.textContent = "Connecting…";
  el.className = "settings-status";

  const nasId = editingNasId || `test-${Date.now()}`;
  const settings = {
    name: document.getElementById("nasName").value.trim() || "Test NAS",
    host: document.getElementById("nasHost").value.trim(),
    port: document.getElementById("nasPort").value.trim(),
    https: document.getElementById("nasHttps").checked,
    username: document.getElementById("nasUsername").value.trim(),
    password: document.getElementById("nasPassword").value,
    destination: document.getElementById("nasDestination").value.trim(),
    type: document.getElementById("nasType").value
  };

  try {
    const resp = await send({ type: "TEST_CONNECTION", nasId, settings });
    if (resp?.ok) {
      el.textContent = `Connected! ${resp.version}`;
      el.className = "settings-status ok";
    } else {
      el.textContent = resp?.error ?? "Unknown error";
      el.className = "settings-status err";
    }
  } catch (err) {
    el.textContent = `Extension error: ${err.message}`;
    el.className = "settings-status err";
  }
});

// ── settings: whitelist management ──────────────────────────────────────────

function renderWhitelistSettings() {
  const toggle = document.getElementById("whitelistModeToggle");
  const textarea = document.getElementById("whitelistTextarea");
  const helpDiv = document.getElementById("whitelistHelp");
  if (!toggle || !textarea || !helpDiv) return;

  toggle.checked = whitelistMode === "restricted";
  const showContent = toggle.checked ? "" : "none";
  helpDiv.style.display = showContent;
  // Don't clobber what the user is actively typing.
  if (document.activeElement !== textarea) {
    textarea.value = Array.from(whitelistSet).join("\n");
  }
}

document.getElementById("whitelistModeToggle").addEventListener("change", async e => {
  whitelistMode = e.target.checked ? "restricted" : "all";
  renderWhitelistSettings();
  await send({ type: "SET_WHITELIST_MODE", mode: whitelistMode });
});

function isValidDomainPattern(pattern) {
  // Allow "*" for all domains
  if (pattern === "*") return true;
  // Allow "*.example.com" for wildcard subdomains
  if (pattern.startsWith("*.")) {
    const domain = pattern.slice(2); // Remove "*."
    return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(domain);
  }
  // Allow exact domain names
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(pattern);
}

document.getElementById("whitelistTextarea").addEventListener("blur", async e => {
  const patterns = Array.from(new Set(
    e.target.value.split("\n")
      .map(p => p.trim().toLowerCase())
      .filter(p => p && isValidDomainPattern(p))
  ));
  whitelistSet = new Set(patterns);
  e.target.value = patterns.join("\n");
  await send({ type: "SET_WHITELIST", domains: patterns });
  updateWhitelistUI();
});

// ── settings: backup / restore ──────────────────────────────────────────────

function exportConfig() {
  const includePasswords = document.getElementById("exportWithPasswords").checked;

  const nasListExport = nasList.map(nas => {
    const copy = { ...nas };
    if (!includePasswords) delete copy.password;
    return copy;
  });

  const config = {
    version: 1,
    nasList: nasListExport,
    whitelist: Array.from(whitelistSet)
  };

  const json = JSON.stringify(config, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nas-download-helper-config-${new Date().toISOString().split("T")[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

document.getElementById("exportBtn").addEventListener("click", exportConfig);
document.getElementById("importBtn").addEventListener("click", () => document.getElementById("importFile").click());

document.getElementById("importFile").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  const el = document.getElementById("importStatus");

  try {
    const text = await file.text();
    const config = JSON.parse(text);

    if (config.version !== 1) throw new Error("Unsupported config version");

    if (config.nasList && Array.isArray(config.nasList)) {
      for (const importedNas of config.nasList) {
        const existing = nasList.find(n => n.name === importedNas.name);
        if (existing) {
          await send({ type: "UPDATE_NAS", nasId: existing.id, updates: importedNas });
        } else {
          await send({ type: "ADD_NAS", nas: importedNas });
        }
      }
    }

    if (config.whitelist && Array.isArray(config.whitelist)) {
      for (const domain of config.whitelist) {
        await send({ type: "ADD_WHITELIST", domain });
      }
    }

    el.textContent = "Config imported successfully!";
    el.className = "settings-status ok";
    await loadNasList();
    await loadWhitelist();
    setTimeout(() => { el.textContent = ""; }, 2000);
  } catch (err) {
    el.textContent = `Import failed: ${err.message}`;
    el.className = "settings-status err";
  }

  e.target.value = "";
});

// ── init ──────────────────────────────────────────────────────────────────

// Tabs
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    filter = tab.dataset.filter;
    renderNasTabs(); // Keep device tabs showing connection status
    updateTabLabels(); // Update adapter-specific labels
    renderTasks();
  });
});

// Buttons
document.getElementById("refreshBtn").addEventListener("click", refresh);

document.getElementById("retryBtn").addEventListener("click", refresh);

document.getElementById("pauseAllBtn").addEventListener("click", () => {
  const visible = getVisibleTasks();
  const ids = visible.filter(t => t.status === "downloading").map(t => t.id);
  if (ids.length) taskAction("pause", ids);
});

document.getElementById("resumeAllBtn").addEventListener("click", () => {
  const visible = getVisibleTasks();
  const ids = visible.filter(t => t.status === "paused").map(t => t.id);
  if (ids.length) taskAction("resume", ids);
});

document.getElementById("settingsBtn").addEventListener("click", () => {
  const inSettings = document.getElementById("settingsView").classList.contains("show");
  if (inSettings) showMainView(); else showSettings();
});

document.getElementById("configureBtn").addEventListener("click", showSettings);
document.getElementById("addNasBtn").addEventListener("click", addNewNas);
document.getElementById("backToListBtn").addEventListener("click", showNasListView);

document.getElementById("openDSBtn").addEventListener("click", () => {
  if (!currentNasId) return;
  const nas = nasList.find(n => n.id === currentNasId);
  if (!nas) return;
  const scheme = nas.https ? "https" : "http";
  chrome.tabs.create({ url: `${scheme}://${nas.host}:${nas.port}` });
});

// Whitelist dropdown
document.getElementById("whitelistBtn").addEventListener("click", () => {
  const menu = document.getElementById("whitelistMenu");
  menu.classList.toggle("show");
});

document.getElementById("whitelistAction").addEventListener("click", () => {
  toggleWhitelist();
  document.getElementById("whitelistMenu").classList.remove("show");
});

// Close dropdown when clicking outside
document.addEventListener("click", (e) => {
  const dropdown = document.querySelector(".dropdown");
  if (!dropdown.contains(e.target)) {
    document.getElementById("whitelistMenu").classList.remove("show");
  }
});

// Get current tab domain
async function getCurrentDomain() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      try {
        const url = new URL(tab.url);
        currentDomain = url.hostname;
        updateWhitelistUI();
      } catch {
        currentDomain = null;
      }
    }
  } catch (err) {
    console.error("[NAS] Failed to get current tab:", err);
  }
}

// Check connection status for all devices
async function checkAllDeviceConnections() {
  for (const nas of nasList) {
    try {
      const resp = await send({ type: "TEST_CONNECTION", nasId: nas.id });
      setConnStatus(nas.id, resp.ok);
    } catch (e) {
      setConnStatus(nas.id, false);
    }
  }
}

// Initial load + 5s poll while popup is open
(async () => {
  await loadNasList();
  checkAllDeviceConnections(); // Check all device statuses on open
  getCurrentDomain();
  loadWhitelist();
  await paintCachedTasks();
  refresh();
  pollTimer = setInterval(refresh, 5000);
})();

window.addEventListener("unload", () => clearInterval(pollTimer));
