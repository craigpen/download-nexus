// popup.js — Task manager + device settings

// Service-specific configuration: defaults and help text (P1-3)
const SERVICE_DEFAULTS = {
  synology: {
    defaultHost: "192.168.1.100",
    defaultPort: 5000,
    defaultUsername: "admin",
    portHint: "5000 (HTTP) or 5001 (HTTPS)",
    usernameHint: "DSM admin username",
    helpText: "Enter your Synology NAS IP/hostname and DSM credentials. Default port is 5000 for HTTP, 5001 for HTTPS."
  },
  qbittorrent: {
    defaultHost: "192.168.1.100",
    defaultPort: 8080,
    defaultUsername: "admin",
    portHint: "8080 (default)",
    usernameHint: "qBittorrent Web UI username",
    helpText: "Enter your qBittorrent Web UI hostname and credentials. Default port is 8080. Username is typically 'admin'."
  },
  transmission: {
    defaultHost: "192.168.1.100",
    defaultPort: 9091,
    defaultUsername: "",
    portHint: "9091 (default)",
    usernameHint: "Optional if auth is enabled",
    helpText: "Enter your Transmission daemon hostname. Default port is 9091. Username/password optional if auth is disabled."
  },
  deluge: {
    defaultHost: "192.168.1.100",
    defaultPort: 8112,
    defaultUsername: "admin",
    portHint: "8112 (default)",
    usernameHint: "Not used (password only)",
    helpText: "Enter your Deluge hostname and password. Deluge uses password-only authentication. Default port is 8112."
  },
  jdownloader: {
    defaultHost: "127.0.0.1",
    defaultPort: 3128,
    defaultUsername: "",
    portHint: "3128 (RemoteAPI) or 9666 (Click'n'Load)",
    usernameHint: "Not required",
    helpText: "JDownloader 2 running locally. Use port 3128 for full remote controls or 9666 for standard link dispatch."
  }
};

// Adapter feature configuration - defines tabs, labels, and action capabilities for each adapter
// Actions: pause (stop active transfer), resume (start/retry paused/stalled task), delete (remove task, preserves files)
const ADAPTER_FEATURES = {
  synology: {
    tabs: ["downloading", "seeding", "error", "paused", "finished"],
    pausedLabel: "Paused",
    // Action support per state (true = action valid for that state)
    actions: {
      pause: ["downloading", "seeding"],          // Can pause active transfers
      resume: ["paused", "error"],                // Can resume paused or error tasks
      delete: ["downloading", "seeding", "paused", "finished", "error"]  // Can always delete
    }
  },
  qbittorrent: {
    tabs: ["downloading", "seeding", "stalled", "error", "paused", "finished"],
    pausedLabel: "Stopped",
    actions: {
      pause: ["downloading", "seeding", "uploading", "allocating", "forcedDL", "forcedUP", "metaDL", "forcedMetaDL"],
      resume: ["paused", "stalled", "error"],
      delete: ["downloading", "seeding", "paused", "stalled", "finished", "error"]
    }
  },
  transmission: {
    tabs: ["downloading", "seeding", "stalled", "error", "paused", "finished"],
    pausedLabel: "Paused",
    actions: {
      pause: ["downloading", "seeding", "uploading", "downloading-wait", "seeding-wait"],
      resume: ["paused", "stalled", "error"],
      delete: ["downloading", "seeding", "paused", "stalled", "finished", "error"]
    }
  },
  deluge: {
    tabs: ["downloading", "seeding", "stalled", "error", "paused", "finished"],
    pausedLabel: "Paused",
    actions: {
      pause: ["downloading", "seeding"],
      resume: ["paused", "stalled", "error"],
      delete: ["downloading", "seeding", "paused", "stalled", "finished", "error"]
    }
  },
  jdownloader: {
    tabs: ["downloading", "stalled", "error", "paused", "finished"],
    pausedLabel: "Paused",
    actions: {
      pause: ["downloading"],
      resume: ["paused", "stalled", "error"],
      delete: ["downloading", "paused", "stalled", "finished", "error"]
    }
  }
};

let allTasks      = [];
let filter        = "downloading";
let serviceFilters = {}; // Track user-selected filter per NAS device
const FILTER_PRIORITY = ["downloading", "seeding", "stalled", "error", "paused", "finished"];
let pollTimer     = null;
let currentDomain = null;
let whitelistSet  = new Set();
let whitelistMode = "all"; // "all" | "restricted"
let nasList       = [];
let currentNasId  = null;
let nasConnStatus = {}; // Track connection status per NAS
let editingNasId  = null;
let selectedTaskIds = new Set(); // Track user-selected tasks for bulk operations

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

function showEl(el, show = true) {
  if (typeof el === "string") el = document.getElementById(el);
  if (!el) return;
  el.classList.toggle("d-none", !show);
}

function hideEl(el) {
  showEl(el, false);
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
  el.className = isErr ? "status-msg error" : "status-msg";
}

function updateCounts() {
  const visibleTasks = allTasks;
  const counts = { all: visibleTasks.length, downloading: 0, seeding: 0, paused: 0, stalled: 0, finished: 0, error: 0 };
  for (const t of visibleTasks) {
    if (counts[t.status] !== undefined) counts[t.status]++;
  }
  for (const [k, v] of Object.entries(counts)) {
    const el = document.getElementById(`cnt-${k}`);
    if (el) el.textContent = v;
    const tabBtn = document.querySelector(`#tabBar [data-filter="${k}"]`);
    if (tabBtn) {
      tabBtn.classList.toggle("tab-empty", v === 0);
    }
  }

  // Total speeds (support both normalized and Synology formats)
  let dn = 0, up = 0;
  for (const t of visibleTasks) {
    dn += (t.speed_down !== undefined) ? t.speed_down : (t.additional?.transfer?.speed_download || 0);
    up += (t.speed_up !== undefined) ? t.speed_up : (t.additional?.transfer?.speed_upload || 0);
  }
  document.getElementById("totalDn").textContent = fmtSpeed(dn);
  document.getElementById("totalUp").textContent = fmtSpeed(up);
  document.getElementById("taskCountLabel").textContent = `${visibleTasks.length} task${visibleTasks.length !== 1 ? "s" : ""}`;
  updatePopupHeaderIcon();
}

function updatePopupHeaderIcon(isError = false) {
  const iconEl = document.getElementById("headerIcon");
  if (!iconEl) return;
  if (!nasList || nasList.length === 0) {
    iconEl.src = "icons/icon48-offline.png";
    return;
  }
  iconEl.src = "icons/icon48.png";
}

// Get action capabilities for current adapter
function getAdapterActions() {
  const device = nasList.find(n => n.id === currentNasId);
  const adapterType = device?.type || "synology";
  const features = ADAPTER_FEATURES[adapterType];
  return features?.actions || ADAPTER_FEATURES.synology.actions;
}

// Use adapter-specific action rules (different adapters have different capabilities)
function canPauseTask(status) {
  const actions = getAdapterActions();
  return actions.pause?.includes(status) ?? false;
}

function canResumeTask(status) {
  const actions = getAdapterActions();
  return actions.resume?.includes(status) ?? false;
}


function toggleTaskSelection(taskId) {
  if (selectedTaskIds.has(taskId)) {
    selectedTaskIds.delete(taskId);
  } else {
    selectedTaskIds.add(taskId);
  }
  renderTasks();
  updateFooterButtons();
}

function selectAllVisible() {
  const visible = getVisibleTasks();
  visible.forEach(t => selectedTaskIds.add(t.id));
  renderTasks();
  updateFooterButtons();
}

function deselectAllVisible() {
  const visible = getVisibleTasks();
  visible.forEach(t => selectedTaskIds.delete(t.id));
  renderTasks();
  updateFooterButtons();
}

function getSelectedTasks() {
  return Array.from(selectedTaskIds);
}

function getCountForAction(action) {
  const selected = getVisibleTasks().filter(t => selectedTaskIds.has(t.id));
  if (action === "pause") return selected.filter(t => canPauseTask(t.status)).length;
  if (action === "resume") return selected.filter(t => canResumeTask(t.status)).length;
  return selected.length; // delete/remove is always available
}

function getVisibleTasks() {
  let filtered = allTasks.filter(t => t.status === filter);

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
  const hasSelection = selectedTaskIds.size > 0;

  const pauseCount = getCountForAction("pause");
  const resumeCount = getCountForAction("resume");
  const removeCount = getSelectedTasks().length;

  const pauseBtn = document.getElementById("pauseAllBtn");
  const resumeBtn = document.getElementById("resumeAllBtn");
  const removeBtn = document.getElementById("removeAllBtn");
  const toggleBtn = document.getElementById("toggleSelectBtn");

  // Toggle select button
  const allSelected = visible.length > 0 && visible.length === getSelectedTasks().filter(id => {
    const task = visible.find(t => t.id === id);
    return task !== undefined;
  }).length;
  toggleBtn.classList.toggle("d-none", visible.length === 0);
  toggleBtn.textContent = allSelected && selectedTaskIds.size > 0 ? "✗ None" : "✓ All";
  toggleBtn.title = allSelected && selectedTaskIds.size > 0 ? "Deselect all" : "Select all visible";

  // Action buttons - only show if something is selected
  pauseBtn.classList.toggle("d-none", !hasSelection);
  resumeBtn.classList.toggle("d-none", !hasSelection);
  removeBtn.classList.toggle("d-none", !hasSelection);

  pauseBtn.disabled = pauseCount === 0;
  resumeBtn.disabled = resumeCount === 0;
  removeBtn.disabled = removeCount === 0;

  pauseBtn.textContent = `⏸ (${pauseCount})`;
  pauseBtn.title = `Pause ${pauseCount} task${pauseCount !== 1 ? "s" : ""}`;

  resumeBtn.textContent = `▶ (${resumeCount})`;
  resumeBtn.title = `Resume ${resumeCount} task${resumeCount !== 1 ? "s" : ""}`;

  removeBtn.textContent = `✕ (${removeCount})`;
  removeBtn.title = `Remove ${removeCount} task${removeCount !== 1 ? "s" : ""} (files will be preserved)`;

  const batchFooter = document.getElementById("batchFooter");
  if (batchFooter) {
    batchFooter.classList.toggle("d-none", visible.length === 0);
  }
}

function renderTasks() {
  const list = document.getElementById("taskList");
  const empty = document.getElementById("emptyMsg");

  if (!list || !empty) return;

  const visible = getVisibleTasks();

  if (visible.length === 0) {
    showEl(empty, true);
    empty.innerHTML = `<span class="empty-text">No ${escHtml(filter)} tasks</span>`;
    // Remove old task rows
    list.querySelectorAll(".task").forEach(el => el.remove());
    updateFooterButtons();
    return;
  }

  hideEl(empty);

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
    const canPause = canPauseTask(task.status);
    const canResume = canResumeTask(task.status);
    const color    = progressColor(task.status);

    if (existing[task.id]) {
      // Update in place
      const row = existing[task.id];
      const checkbox = row.querySelector(".task-checkbox");
      if (checkbox) checkbox.checked = selectedTaskIds.has(task.id);
      row.querySelector(".task-name").textContent = task.title;
      const fill = row.querySelector(".progress-fill");
      fill.style.width = `${pct}%`;
      fill.className = `progress-fill fill-${statusClass(task.status).replace(/^s-/, "")}`;
      row.querySelector(".progress-pct").textContent = `${pct}%`;
      row.querySelector(".task-dn").textContent   = `↓ ${fmtSpeed(spDn)}`;
      row.querySelector(".task-up").textContent   = `↑ ${fmtSpeed(spUp)}`;
      row.querySelector(".task-size").textContent = `${fmt(dlSize)} / ${fmt(size)}`;
      row.querySelector(".task-eta").textContent  = fmtEta(eta);
      row.querySelector(".status-dot").className  = `status-dot ${statusClass(task.status)}`;
      const pauseBtn  = row.querySelector(".pause-btn");
      const resumeBtn = row.querySelector(".resume-btn");
      if (pauseBtn)  showEl(pauseBtn, canPause);
      if (resumeBtn) showEl(resumeBtn, canResume);
      fragment.appendChild(row);
    } else {
      // Create new row
      const row = document.createElement("div");
      row.className = "task";
      row.dataset.id = task.id;

      const top = document.createElement("div");
      top.className = "task-top";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "task-checkbox";
      checkbox.checked = selectedTaskIds.has(task.id);
      checkbox.addEventListener("change", () => toggleTaskSelection(task.id));

      const dot = document.createElement("span");
      dot.className = `status-dot ${statusClass(task.status)}`;
      const name = document.createElement("span");
      name.className = "task-name";
      name.title = task.title;
      name.textContent = task.title;
      const pctSpan = document.createElement("span");
      pctSpan.className = "progress-pct";
      pctSpan.textContent = `${pct}%`;

      const actions = document.createElement("div");
      actions.className = "task-actions";
      const pauseBtn = document.createElement("button");
      pauseBtn.className = "task-btn pause-btn";
      pauseBtn.title = getAdapterPauseText(currentNasId);
      showEl(pauseBtn, canPause);
      pauseBtn.textContent = "⏸";
      const resumeBtn = document.createElement("button");
      resumeBtn.className = "task-btn resume-btn";
      resumeBtn.title = "Resume";
      showEl(resumeBtn, canResume);
      resumeBtn.textContent = "▶";
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "task-btn danger delete-btn";
      deleteBtn.title = "Remove task";
      deleteBtn.textContent = "✕";
      actions.appendChild(pauseBtn);
      actions.appendChild(resumeBtn);
      actions.appendChild(deleteBtn);
      top.appendChild(checkbox);
      top.appendChild(dot);
      top.appendChild(name);
      top.appendChild(pctSpan);
      top.appendChild(actions);

      const track = document.createElement("div");
      track.className = "progress-track";
      const fill = document.createElement("div");
      fill.className = `progress-fill fill-${statusClass(task.status).replace(/^s-/, "")}`;
      fill.style.width = `${pct}%`;
      track.appendChild(fill);

      const bot = document.createElement("div");
      bot.className = "task-bot";
      const sizeSpan = document.createElement("span");
      sizeSpan.className = "task-size";
      sizeSpan.textContent = `${fmt(dlSize)} / ${fmt(size)}`;
      const dnSpan = document.createElement("span");
      dnSpan.className = "rate-pill rate-dn task-dn";
      dnSpan.textContent = `↓ ${fmtSpeed(spDn)}`;
      const upSpan = document.createElement("span");
      upSpan.className = "rate-pill rate-up task-up";
      upSpan.textContent = `↑ ${fmtSpeed(spUp)}`;
      const etaSpan = document.createElement("span");
      etaSpan.className = "task-eta";
      etaSpan.textContent = fmtEta(eta);
      bot.appendChild(sizeSpan);
      bot.appendChild(dnSpan);
      bot.appendChild(upSpan);
      bot.appendChild(etaSpan);

      row.appendChild(top);
      row.appendChild(track);
      row.appendChild(bot);

      pauseBtn.addEventListener("click", () => taskAction("pause", [task.id]));
      resumeBtn.addEventListener("click", () => taskAction("resume", [task.id]));
      deleteBtn.addEventListener("click", () => {
        if (confirm(`Remove task "${task.title}"? (files will be preserved)`)) taskAction("delete", [task.id]);
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

// In-memory task cache across services: nasId -> Array of task objects
const tasksCache = {};
let activeRequestId = 0;

function loadAllCachedTasks() {
  return new Promise(resolve => {
    chrome.storage.local.get({ taskCache: {} }, r => {
      const cache = r.taskCache || {};
      for (const [id, data] of Object.entries(cache)) {
        if (data && Array.isArray(data.tasks)) {
          tasksCache[id] = data.tasks;
        }
      }
      resolve(tasksCache);
    });
  });
}

function saveCachedTasks(nasId, tasks) {
  if (!nasId) return;
  tasksCache[nasId] = tasks;
  chrome.storage.local.get({ taskCache: {} }, r => {
    const cache = r.taskCache || {};
    cache[nasId] = { tasks, timestamp: Date.now() };
    chrome.storage.local.set({ taskCache: cache });
  });
}

function paintCachedTasks(nasId = currentNasId) {
  if (!nasId) return false;
  const cached = tasksCache[nasId];
  if (cached && Array.isArray(cached)) {
    allTasks = cached;
    filter = getBestFilterForService(nasId, cached);
    renderFilterTabs();
    showEl("speedBar", true);
    showEl("tabBar", true);
    updateCounts();
    renderTasks();
    return true;
  }
  return false;
}

// ── data fetch ────────────────────────────────────────────────────────────

function setConnStatus(nasId, ok) {
  nasConnStatus[nasId] = ok ? "ok" : "error";
  // Surgically update tab error indicator in place without DOM rebuild
  const tabBtn = document.querySelector(`.nas-tab-btn[data-nas-id="${nasId}"]`);
  if (tabBtn) {
    const warnIcon = tabBtn.querySelector(".tab-warn-icon");
    if (warnIcon) {
      showEl(warnIcon, !ok);
      warnIcon.title = ok ? "" : "Offline: Connection failed";
    }
    tabBtn.classList.toggle("tab-error", !ok);
  }
}

function showError(title, detail) {
  const errorTitle = document.getElementById("errorTitle");
  const errorDetail = document.getElementById("errorDetail");
  const errorContainer = document.getElementById("errorContainer");

  if (errorTitle) errorTitle.textContent = title;
  if (errorDetail) errorDetail.textContent = detail;
  if (errorContainer) errorContainer.classList.add("show");
  hideEl("taskList");
  hideEl("speedBar");
  hideEl("tabBar");
  updatePopupHeaderIcon(true);
}

function hideError() {
  const errorContainer = document.getElementById("errorContainer");
  if (errorContainer) errorContainer.classList.remove("show");
  showEl("taskList", true);
  updatePopupHeaderIcon();
}

async function refresh(targetNasId = currentNasId) {
  if (!targetNasId) return;
  const requestId = ++activeRequestId;
  const reqNasId = targetNasId;

  try {
    const resp = await send({ type: "LIST_TASKS", nasId: reqNasId });
    console.log(`refresh: got ${resp.tasks?.length || 0} tasks from ${reqNasId}`);

    if (resp.ok && resp.tasks) {
      saveCachedTasks(reqNasId, resp.tasks);
      setConnStatus(reqNasId, true);
    } else {
      setConnStatus(reqNasId, false);
    }

    // Discard response if user has switched to another tab while request was in-flight
    if (requestId !== activeRequestId || reqNasId !== currentNasId) {
      return;
    }

    if (!resp.ok) {
      console.error(`refresh: LIST_TASKS failed:`, resp.error);
      if (allTasks.length === 0) showError("⚠️ Failed to load tasks", resp.error || "Unknown error");
      setStatus(resp.error, true);
    } else {
      hideError();
      allTasks = resp.tasks;
      showEl("speedBar", true);
      showEl("tabBar", true);
      updateCounts();
      renderTasks();
      setStatus("");
    }
  } catch (err) {
    if (requestId !== activeRequestId || reqNasId !== currentNasId) return;
    console.error(`refresh: exception:`, err);
    setConnStatus(reqNasId, false);
    if (allTasks.length === 0) showError("❌ Connection error", err.message);
    setStatus(err.message, true);
  }
}

// ── task actions ──────────────────────────────────────────────────────────

async function taskAction(action, ids) {
  setStatus("…");
  try {
    const device = nasList.find(n => n.id === currentNasId);

    // Call the remove API
    const resp = await send({ type: "TASK_ACTION", nasId: currentNasId, action, ids });

    if (!resp.ok) {
      setStatus(resp.error, true);
      return;
    }

    await refresh();
  } catch (err) {
    console.error(`taskAction error:`, err);
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
        const noNasContainer = document.getElementById("noNasContainer");
        if (noNasContainer) noNasContainer.classList.add("show");
        hideEl("taskList");
        hideEl("speedBar");
        hideEl("tabBar");
      } else {
        // NAS configured
        const noNasContainer = document.getElementById("noNasContainer");
        if (noNasContainer) noNasContainer.classList.remove("show");
        showEl("taskList", true);
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

function getServiceWebUrl(service) {
  if (!service || !service.host) return null;
  const scheme = service.https ? "https" : "http";
  const host = service.host;
  const port = service.port;
  if (service.type === "jdownloader") {
    return null; // Desktop application
  }
  if (service.type === "transmission") {
    return `${scheme}://${host}:${port}/transmission/web/`;
  }
  if (service.type === "synology") {
    return `${scheme}://${host}:${port}`;
  }
  return `${scheme}://${host}:${port}/`;
}

function updateWebUiLauncher() {
  const btn = document.getElementById("openWebUiBtn");
  if (!btn) return;
  const currentService = nasList.find(n => n.id === currentNasId);
  const url = getServiceWebUrl(currentService);
  if (url) {
    showEl(btn, true);
    btn.title = `Open ${currentService?.name || "Service"} Web UI`;
  } else {
    hideEl(btn);
  }
}

function renderNasTabs() {
  updateWebUiLauncher();
  const nasTabBar = document.getElementById("nasTabBar");

  // Status filter tabs are adapter-specific and must be rebuilt (with their
  // click handlers) regardless of how many services exist. Without this, a
  // single-service profile with a cold task cache keeps the static markup from
  // popup.html, whose tabs have no listeners — the filters look right but do
  // nothing until the cache warms up.
  renderFilterTabs();

  if (nasList.length <= 1) {
    // Hide the service switcher if only one or zero services are configured
    hideEl(nasTabBar);
    return;
  }

  if (!nasTabBar) return;
  nasTabBar.innerHTML = '';
  nasList.forEach(nas => {
    const isActive = nas.id === currentNasId;
    const isError = nasConnStatus[nas.id] === "error";

    const btn = document.createElement("button");
    btn.className = `tab nas-tab-btn${isActive ? " active" : ""}${isError ? " tab-error" : ""}`;
    btn.dataset.nasId = nas.id;
    btn.title = nas.name;

    const nameDiv = document.createElement("span");
    nameDiv.className = "nas-tab-title";
    nameDiv.textContent = nas.name;

    const warnSpan = document.createElement("span");
    warnSpan.className = `tab-warn-icon${isError ? "" : " d-none"}`;
    warnSpan.title = isError ? "Offline: Connection failed" : "";
    warnSpan.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

    btn.appendChild(nameDiv);
    btn.appendChild(warnSpan);
    nasTabBar.appendChild(btn);
  });
  showEl(nasTabBar, true);

  if (!nasTabBar.dataset.wheelBound) {
    nasTabBar.dataset.wheelBound = "true";
    nasTabBar.addEventListener("wheel", (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        nasTabBar.scrollLeft += e.deltaY;
      }
    }, { passive: false });
  }

  const activeTab = nasTabBar.querySelector(".nas-tab-btn.active");
  if (activeTab) {
    activeTab.scrollIntoView({ behavior: "instant", inline: "nearest", block: "nearest" });
  }

  nasTabBar.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const newNasId = tab.dataset.nasId;
      if (newNasId === currentNasId) return; // Already viewing this service

      currentNasId = newNasId;
      selectedTaskIds.clear();

      // 1. Instantly update active styling on tabs
      nasTabBar.querySelectorAll(".tab").forEach(t => {
        t.classList.toggle("active", t.dataset.nasId === currentNasId);
      });
      tab.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });

      // 2. Instantly update Web UI launcher button for target service
      updateWebUiLauncher();

      // 3. Instantly pick best filter and update filter tabs for target adapter type
      filter = getBestFilterForService(currentNasId, tasksCache[currentNasId] || []);
      renderFilterTabs();

      // 4. Synchronously paint from memory cache (0ms latency)
      const hasCache = paintCachedTasks(currentNasId);
      if (!hasCache) {
        // No cache yet for this service - show clean loading spinner without layout shift
        allTasks = [];
        const taskList = document.getElementById("taskList");
        if (taskList) {
          taskList.querySelectorAll(".task").forEach(el => el.remove());
          const emptyMsg = document.getElementById("emptyMsg");
          if (emptyMsg) {
            showEl(emptyMsg, true);
            emptyMsg.innerHTML = '<span class="spinner"></span>';
          }
        }
        updateCounts();
      }

      // 5. Fetch fresh data in the background
      refresh(currentNasId);
    });
  });
}

// Load saved per-service filter selections from storage
function loadServiceFilters() {
  return new Promise(resolve => {
    chrome.storage.local.get(["serviceFilters"], res => {
      if (res.serviceFilters && typeof res.serviceFilters === "object") {
        serviceFilters = res.serviceFilters;
      }
      resolve();
    });
  });
}

// Get the best filter for a service based on priority and user memory
function getBestFilterForService(nasId, tasks = tasksCache[nasId] || []) {
  const enabledTabs = getEnabledTabs(nasId);

  // Count tasks by status for this service
  const counts = { downloading: 0, seeding: 0, paused: 0, stalled: 0, finished: 0, error: 0 };
  if (Array.isArray(tasks)) {
    for (const t of tasks) {
      if (counts[t.status] !== undefined) counts[t.status]++;
    }
  }

  // 1. Check if user explicitly selected a filter for this service previously
  const remembered = serviceFilters[nasId];
  if (remembered && enabledTabs.includes(remembered)) {
    // If remembered filter currently has tasks, or if all enabled categories are empty (0 tasks), preserve user's choice
    if (counts[remembered] > 0 || (Array.isArray(tasks) && tasks.length === 0)) {
      return remembered;
    }
  }

  // 2. Otherwise auto-select the highest priority non-empty filter supported by this adapter
  for (const p of FILTER_PRIORITY) {
    if (enabledTabs.includes(p) && counts[p] > 0) {
      return p;
    }
  }

  // 3. Fallback to downloading (or first enabled tab)
  return enabledTabs.includes("downloading") ? "downloading" : (enabledTabs[0] || "downloading");
}

// Get the enabled tabs for the current or specified adapter
function getEnabledTabs(nasId = currentNasId) {
  const device = nasList.find(n => n.id === nasId);
  const adapterType = device?.type || "synology";
  const features = ADAPTER_FEATURES[adapterType];
  return features ? features.tabs : ADAPTER_FEATURES.synology.tabs;
}

// Get pause/stop label for current adapter
function getPausedLabel() {
  const device = nasList.find(n => n.id === currentNasId);
  const adapterType = device?.type || "synology";
  const features = ADAPTER_FEATURES[adapterType];
  return features ? features.pausedLabel : "Paused";
}

// Select a filter and update UI
function selectFilter(filterType) {
  document.querySelectorAll('[data-filter]').forEach(t => t.classList.remove("active"));
  const activeTab = document.querySelector(`[data-filter="${filterType}"]`);
  if (activeTab) activeTab.classList.add("active");
  filter = filterType;
  if (currentNasId) {
    serviceFilters[currentNasId] = filterType;
    chrome.storage.local.set({ serviceFilters });
  }
  selectedTaskIds.clear(); // Clear selection when switching filters
  renderTasks();
}

// Render filter tabs based on current adapter capabilities
function renderFilterTabs() {
  const enabledTabs = getEnabledTabs();
  const tabLabels = {
    downloading: "DL",
    seeding: "Seed",
    paused: getPausedLabel(),
    stalled: "Stalled",
    finished: "Done",
    error: "Error"
  };

  const tabsContainer = document.getElementById("tabBar");
  if (!tabsContainer) return;

  // Clear existing tabs and show container
  tabsContainer.innerHTML = "";
  showEl(tabsContainer, true);

  // Create tabs for enabled filters
  enabledTabs.forEach(filterType => {
    const button = document.createElement("button");
    button.className = `tab ${filter === filterType ? "active" : ""}`;
    button.dataset.filter = filterType;

    const countSpan = document.createElement("span");
    countSpan.className = "tab-count";
    countSpan.id = `cnt-${filterType}`;
    countSpan.textContent = "0";

    button.textContent = tabLabels[filterType];
    button.appendChild(countSpan);

    button.addEventListener("click", () => selectFilter(filterType));
    tabsContainer.appendChild(button);
  });

  // Restore counts
  updateCounts();
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
  // Show whitelist button only when whitelist mode is "restricted"
  showEl("whitelistDropdown", whitelistMode === "restricted");

  if (!currentDomain) return;
  const isWhitelisted = whitelistSet.has(currentDomain);
  const actionBtn = document.getElementById("whitelistAction");
  const domainInfo = document.getElementById("domainInfo");
  const btn = document.getElementById("whitelistBtn");
  domainInfo.textContent = currentDomain;
  actionBtn.textContent = isWhitelisted ? "✓ Remove from whitelist" : "+ Add to whitelist";

  if (isWhitelisted) {
    btn.classList.add("whitelisted");
    btn.title = "Domain is whitelisted";
  } else {
    btn.classList.remove("whitelisted");
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
  document.getElementById("addDownloadView")?.classList.remove("show");
  document.getElementById("settingsView").classList.add("show");
  document.getElementById("headerTitle").textContent = "Settings";
  hideEl("mainHeaderControls");
  hideEl("gearIcon");
  showEl("backIcon", true);
  showEl("openInTabBtn", true);
  document.getElementById("settingsBtn").title = "Back";
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  showNasListView();
  renderSettingsNasList();
  renderWhitelistSettings();
  loadProtocolSettings();
  loadDownloadExtensions();
}

async function showMainView() {
  document.getElementById("settingsView").classList.remove("show");
  document.getElementById("addDownloadView")?.classList.remove("show");
  document.getElementById("mainView").classList.add("show");
  document.getElementById("headerTitle").textContent = "Download Nexus";
  showEl("mainHeaderControls", true);
  showEl("gearIcon", true);
  hideEl("backIcon");
  hideEl("openInTabBtn");
  document.getElementById("settingsBtn").title = "Settings";
  paintCachedTasks();
  updateWhitelistUI();
  refresh();
  if (!pollTimer) pollTimer = setInterval(refresh, 5000);
}

// ── settings: NAS device list ───────────────────────────────────────────────

function renderSettingsNasList() {
  const container = document.getElementById("settingsNasList");
  if (!container) return;
  container.innerHTML = '';
  if (nasList.length === 0) {
    const empty = document.createElement("div");
    empty.className = "settings-empty";
    empty.textContent = "No download services configured yet.";
    container.appendChild(empty);
    return;
  }
  nasList.forEach(nas => {
    const item = document.createElement("div");
    item.className = "nas-item";
    item.dataset.nasId = nas.id;

    const info = document.createElement("div");
    info.className = "nas-item-info";

    const titleRow = document.createElement("div");
    titleRow.className = "nas-item-title-row";

    const name = document.createElement("span");
    name.className = "nas-item-name";
    name.textContent = nas.name;

    const badge = document.createElement("span");
    badge.className = "nas-item-badge";
    badge.textContent = nas.type;

    titleRow.appendChild(name);
    titleRow.appendChild(badge);

    const scheme = nas.https ? "https" : "http";
    const host = document.createElement("div");
    host.className = "nas-item-host";
    host.textContent = `${scheme}://${nas.host}:${nas.port}`;

    const testStatus = document.createElement("div");
    testStatus.className = "nas-test-status d-none";
    testStatus.id = `nas-test-${nas.id}`;

    info.appendChild(titleRow);
    info.appendChild(host);
    info.appendChild(testStatus);

    const actions = document.createElement("div");
    actions.className = "nas-item-actions";

    const webUrl = getServiceWebUrl(nas);
    if (webUrl) {
      const webBtn = document.createElement("button");
      webBtn.type = "button";
      webBtn.className = "btn-action-mini";
      webBtn.title = "Open Web UI";
      webBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
      webBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        chrome.tabs.create({ url: webUrl });
      });
      actions.appendChild(webBtn);
    }

    const testBtn = document.createElement("button");
    testBtn.type = "button";
    testBtn.className = "btn-action-mini";
    testBtn.title = "Test Connection";
    testBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
    testBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const statusEl = document.getElementById(`nas-test-${nas.id}`);
      if (statusEl) {
        statusEl.className = "nas-test-status";
        statusEl.textContent = "Connecting…";
        statusEl.classList.remove("d-none");
      }
      try {
        const resp = await send({ type: "TEST_CONNECTION", nasId: nas.id });
        if (statusEl) {
          if (resp && resp.ok) {
            statusEl.className = "nas-test-status ok";
            statusEl.textContent = `Connected (v${resp.version || "ok"})`;
          } else {
            statusEl.className = "nas-test-status err";
            statusEl.textContent = `Failed: ${resp?.error || "Unknown"}`;
          }
        }
      } catch (err) {
        if (statusEl) {
          statusEl.className = "nas-test-status err";
          statusEl.textContent = `Error: ${err.message}`;
        }
      }
    });
    actions.appendChild(testBtn);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-action-mini";
    editBtn.title = "Edit Service";
    editBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      editNas(nas.id);
    });
    actions.appendChild(editBtn);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn-action-mini danger";
    delBtn.title = "Delete Service";
    delBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm(`Delete "${nas.name}"?`)) deleteNasDevice(nas.id);
    });
    actions.appendChild(delBtn);

    item.appendChild(info);
    item.appendChild(actions);
    container.appendChild(item);
  });
}

function showNasListView() {
  showEl("settingsNasListWrap", true);
  document.getElementById("nasForm").classList.remove("show");
  editingNasId = null;
}

function showNasFormView() {
  hideEl("settingsNasListWrap");
  document.getElementById("nasForm").classList.add("show");
}

function updateDestinationFieldVisibility() {
  const type = document.getElementById("nasType").value;
  showEl("destinationField", type === "synology");
}

function updateFormFieldsForType() {
  const type = document.getElementById("nasType").value;
  const defaults = SERVICE_DEFAULTS[type] || SERVICE_DEFAULTS.synology;

  // Update all field placeholders with service-specific defaults (P1-3)
  document.getElementById("nasHost").placeholder = defaults.defaultHost;
  document.getElementById("nasPort").placeholder = defaults.defaultPort.toString();
  document.getElementById("nasUsername").placeholder = defaults.defaultUsername || "Not required";

  // Update help text (P1-3)
  const helpEl = document.getElementById("serviceHelpText");
  if (helpEl) {
    helpEl.textContent = defaults.helpText;
  }

  // Show/hide API Token field for qBittorrent (P1-2)
  showEl("apiTokenField", type === "qbittorrent");

  const usernameInput = document.getElementById("nasUsername");
  const passwordInput = document.getElementById("nasPassword");

  // Show/hide fields based on adapter type
  // Synology and qBittorrent require username/password
  // Transmission and JDownloader require neither
  // Deluge requires password only (no username)
  const showUsername = type === "synology" || type === "qbittorrent" || type === "transmission";
  const showPassword = type === "synology" || type === "qbittorrent" || type === "deluge" || type === "transmission";

  showEl("usernameField", showUsername);
  showEl("passwordField", showPassword);

  // Update required attribute and set default port based on adapter type (P1-3)
  if (type === "synology") {
    document.getElementById("nasPort").value = "5000";
    usernameInput.placeholder = defaults.defaultUsername;
    usernameInput.required = true;
    passwordInput.required = true;
  } else if (type === "qbittorrent") {
    document.getElementById("nasPort").value = "8080";
    usernameInput.placeholder = defaults.defaultUsername;
    usernameInput.required = true;
    passwordInput.required = true;
  } else if (type === "deluge") {
    document.getElementById("nasPort").value = "8112";
    passwordInput.required = true;  // Deluge RPC only needs password
  } else if (type === "transmission") {
    document.getElementById("nasPort").value = "9091";
    usernameInput.placeholder = defaults.defaultUsername || "Optional";
    usernameInput.required = false;
    passwordInput.required = false;
  } else if (type === "jdownloader") {
    document.getElementById("nasPort").value = "3128";
    document.getElementById("nasHost").value = "127.0.0.1";
    usernameInput.required = false;
    passwordInput.required = false;
  }

  document.getElementById("nasHttps").checked = false;
}

function editNas(nasId) {
  editingNasId = nasId;
  const nas = nasList.find(n => n.id === nasId);
  if (!nas) return;

  document.getElementById("formTitle").textContent = `Edit ${nas.name}`;
  showEl("deleteNasBtn", true);
  document.getElementById("nasName").value = nas.name;
  document.getElementById("nasType").value = nas.type || "synology";
  document.getElementById("nasHost").value = nas.host;
  document.getElementById("nasPort").value = nas.port;
  document.getElementById("nasHttps").checked = nas.https;
  document.getElementById("nasUsername").value = nas.username;
  document.getElementById("nasPassword").value = nas.password;
  document.getElementById("nasDestination").value = nas.destination || "";
  document.getElementById("nasApiToken").value = nas.apiToken || "";
  document.getElementById("nasFormStatus").textContent = "";
  document.getElementById("testNasStatus").textContent = "";

  updateFormFieldsForType();
  updateDestinationFieldVisibility();
  showNasFormView();
  updateTestButtonState();
}

function addNewNas() {
  editingNasId = null;
  document.getElementById("formTitle").textContent = "Add Download Service";
  hideEl("deleteNasBtn");
  document.getElementById("nasName").value = "";
  document.getElementById("nasType").value = "synology";
  document.getElementById("nasHost").value = "192.168.0.1";
  document.getElementById("nasUsername").value = "";
  document.getElementById("nasPassword").value = "";
  document.getElementById("nasDestination").value = "";
  document.getElementById("nasApiToken").value = "";
  document.getElementById("nasFormStatus").textContent = "";
  document.getElementById("testNasStatus").textContent = "";

  updateFormFieldsForType();
  updateDestinationFieldVisibility();
  showNasFormView();
  updateTestButtonState();
}

async function deleteNasDevice(nasId) {
  delete tasksCache[nasId];
  chrome.storage.local.get({ taskCache: {} }, r => {
    const cache = r.taskCache || {};
    delete cache[nasId];
    chrome.storage.local.set({ taskCache: cache });
  });
  await send({ type: "DELETE_NAS", nasId });
  if (currentNasId === nasId) currentNasId = null;
  await loadNasList();
  showNasListView();
}

// ── Protocol Settings ──────────────────────────────────────────────────────

function loadProtocolSettings() {
  const defaults = window.DownloadNexus.ServiceFilter.getDefaultProtocolSettings();
  chrome.storage.local.get({ enabledProtocols: defaults }, (result) => {
    const settings = window.DownloadNexus.ServiceFilter.normalizeProtocolSettings(result.enabledProtocols);
    document.getElementById("enableMagnet").checked = settings.magnet;
    document.getElementById("enableTorrent").checked = settings.torrent;
    document.getElementById("enableHttp").checked = settings.otherFileTypes;
    updateFileTypesVisibility();
  });
}

const DEFAULT_FILE_EXTENSIONS = "zip\nrar\n7z\ntar\ngz\nbz2\niso\nexe\nmsi\npdf\ndoc\ndocx\nxls\nxlsx\nmp4\nmkv\nzip\napk";

function updateFileTypesVisibility() {
  const isEnabled = document.getElementById("enableHttp").checked;
  showEl("fileTypesSection", isEnabled);

  if (isEnabled) {
    const textarea = document.getElementById("downloadExtensionsTextarea");
    // If empty, populate with defaults
    if (!textarea.value.trim()) {
      textarea.value = DEFAULT_FILE_EXTENSIONS;
    }
  }
}

function saveProtocolSettings() {
  const settings = {
    magnet: document.getElementById("enableMagnet").checked,
    torrent: document.getElementById("enableTorrent").checked,
    otherFileTypes: document.getElementById("enableHttp").checked
  };
  chrome.storage.local.set({ enabledProtocols: settings }, () => {
    // Notify all tabs to refresh content scripts with new protocol settings
    chrome.tabs.query({}, tabs => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: "PROTOCOL_SETTINGS_CHANGED" }).catch(() => {
          // Ignore errors for tabs that don't have content script (e.g., chrome:// pages)
        });
      });
    });
  });
}

// ── Download File Types ────────────────────────────────────────────────────

function loadDownloadExtensions() {
  chrome.storage.sync.get({ downloadExtensions: "" }, (result) => {
    const textarea = document.getElementById("downloadExtensionsTextarea");
    const value = result.downloadExtensions;
    // If no saved extensions, use defaults (will be shown if toggle is enabled)
    textarea.value = value || DEFAULT_FILE_EXTENSIONS;
  });
}

function saveDownloadExtensions() {
  const textarea = document.getElementById("downloadExtensionsTextarea");
  const extensions = textarea.value
    .split("\n")
    .map(line => line.trim().toLowerCase())
    .filter(line => line && /^[a-z0-9]+$/.test(line));

  chrome.storage.sync.set({ downloadExtensions: extensions.join("\n") }, () => {
    // Notify all tabs to refresh content scripts with new file extensions
    chrome.tabs.query({}, tabs => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: "DOWNLOAD_EXTENSIONS_CHANGED" }).catch(() => {
          // Ignore errors for tabs that don't have content script
        });
      });
    });
  });
}

document.getElementById("downloadExtensionsTextarea").addEventListener("blur", saveDownloadExtensions);

document.getElementById("nasForm").addEventListener("submit", async e => {
  e.preventDefault();
  const statusEl = document.getElementById("nasFormStatus");

  // Form validation is now handled by HTML required attributes per adapter type
  // (Synology/qBittorrent require username/password, Transmission doesn't show them)

  const type = document.getElementById("nasType").value;
  const nasConfig = {
    type,
    name: document.getElementById("nasName").value.trim(),
    host: document.getElementById("nasHost").value.trim(),
    port: document.getElementById("nasPort").value.trim(),
    https: document.getElementById("nasHttps").checked,
    username: document.getElementById("nasUsername").value.trim(),
    password: document.getElementById("nasPassword").value,
    destination: document.getElementById("nasDestination").value.trim()
  };

  // Add apiToken for qBittorrent if provided (P1-2)
  if (type === "qbittorrent") {
    const apiToken = document.getElementById("nasApiToken").value.trim();
    if (apiToken) {
      nasConfig.apiToken = apiToken;
    }
  }

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
  if (confirm("Are you sure you want to delete this download service?")) deleteNasDevice(editingNasId);
});

document.getElementById("nasType").addEventListener("change", () => {
  updateDestinationFieldVisibility();
  updateFormFieldsForType();
});

function updateTestButtonState() {
  const type = document.getElementById("nasType").value;
  const host = document.getElementById("nasHost").value.trim();
  const password = document.getElementById("nasPassword").value.trim();
  const apiToken = document.getElementById("nasApiToken").value.trim();
  const testBtn = document.getElementById("testNasBtn");

  // Host is always required
  let isReady = host.length > 0;

  // Check auth based on adapter type
  if (type === "qbittorrent") {
    // qBittorrent: either password OR apiToken sufficient
    isReady = isReady && (password.length > 0 || apiToken.length > 0);
  } else if (type === "synology") {
    // Synology: requires username and password (username checked in form required attr)
    isReady = isReady && password.length > 0;
  }
  // Transmission and Deluge don't require auth, just host

  testBtn.disabled = !isReady;
  testBtn.title = isReady ? "Test connection to this NAS" : "Enter host to test connection";
}

document.getElementById("nasHost").addEventListener("input", updateTestButtonState);
document.getElementById("nasPassword").addEventListener("input", updateTestButtonState);
document.getElementById("nasApiToken").addEventListener("input", updateTestButtonState);

document.getElementById("testNasBtn").addEventListener("click", async () => {
  const el = document.getElementById("testNasStatus");
  el.textContent = "Connecting…";
  el.className = "settings-status";

  const nasId = editingNasId || `test-${Date.now()}`;
  const type = document.getElementById("nasType").value;
  const settings = {
    name: document.getElementById("nasName").value.trim() || "Test NAS",
    host: document.getElementById("nasHost").value.trim(),
    port: document.getElementById("nasPort").value.trim(),
    https: document.getElementById("nasHttps").checked,
    username: document.getElementById("nasUsername").value.trim(),
    password: document.getElementById("nasPassword").value,
    destination: document.getElementById("nasDestination").value.trim(),
    type
  };

  // Add apiToken for qBittorrent if provided (P1-2)
  if (type === "qbittorrent") {
    const apiToken = document.getElementById("nasApiToken").value.trim();
    if (apiToken) {
      settings.apiToken = apiToken;
    }
  }

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

// ── settings: whitelist & domain routing ────────────────────────────────────

function updateWhitelistModeVisibility() {
  const select = document.getElementById("whitelistModeSelect");
  const wrap = document.getElementById("whitelistDomainsWrap");
  const label = document.getElementById("whitelistDomainsLabel");
  if (!select || !wrap) return;

  const mode = select.value;
  if (mode === "all") {
    wrap.classList.add("d-none");
  } else {
    wrap.classList.remove("d-none");
    if (label) {
      label.textContent = mode === "whitelist"
        ? "Whitelisted Domains (One per line)"
        : "Blacklisted Domains (One per line)";
    }
  }
}

async function renderWhitelistSettings() {
  const select = document.getElementById("whitelistModeSelect");
  const textarea = document.getElementById("whitelistTextarea");
  if (!select || !textarea) return;

  try {
    const [modeResp, listResp] = await Promise.all([
      send({ type: "GET_WHITELIST_MODE" }),
      send({ type: "GET_WHITELIST" })
    ]);
    select.value = modeResp?.mode || "all";
    updateWhitelistModeVisibility();
    if (document.activeElement !== textarea) {
      textarea.value = (listResp?.list || []).join("\n");
    }
  } catch (err) {
    console.warn("Failed to load whitelist:", err);
  }
}

document.getElementById("whitelistModeSelect")?.addEventListener("change", updateWhitelistModeVisibility);

async function saveWhitelistSettings() {
  const select = document.getElementById("whitelistModeSelect");
  const textarea = document.getElementById("whitelistTextarea");
  const mode = select?.value || "all";
  const domains = (textarea?.value || "")
    .split("\n")
    .map(d => d.trim().toLowerCase())
    .filter(Boolean);

  try {
    await Promise.all([
      send({ type: "SET_WHITELIST_MODE", mode }),
      send({ type: "SET_WHITELIST", list: domains })
    ]);
    setStatus("Domain routing rules saved!");
    await loadWhitelist();
    updateWhitelistUI();
  } catch (err) {
    setStatus("Failed to save rules: " + err.message, true);
  }
}

document.getElementById("saveDomainRulesBtn")?.addEventListener("click", saveWhitelistSettings);

// ── settings: link capture & extensions ─────────────────────────────────────

async function saveCaptureSettings() {
  const enabledProtocols = {
    magnet: document.getElementById("enableMagnet").checked,
    torrent: document.getElementById("enableTorrent").checked,
    otherFileTypes: document.getElementById("enableHttp").checked
  };

  const extensions = (document.getElementById("downloadExtensionsTextarea")?.value || "")
    .split("\n")
    .map(s => s.trim().replace(/^\./, ""))
    .filter(Boolean);

  await new Promise(r => chrome.storage.local.set({ enabledProtocols }, r));
  await new Promise(r => chrome.storage.sync.set({ downloadExtensions: extensions.join("\n") }, r));

  // Notify active tabs
  chrome.tabs.query({}, tabs => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { type: "PROTOCOL_SETTINGS_CHANGED" }).catch(() => {});
    });
  });

  setStatus("Downloadable link settings saved!");
}

document.getElementById("saveCaptureSettingsBtn")?.addEventListener("click", saveCaptureSettings);

// Protocol toggles change handlers
["enableMagnet", "enableTorrent", "enableHttp"].forEach(id => {
  document.getElementById(id)?.addEventListener("change", () => {
    updateFileTypesVisibility();
  });
});

// ── settings: backup & restore ──────────────────────────────────────────────

async function popupExportConfig() {
  try {
    const [nasResp, whiteResp, modeResp] = await Promise.all([
      send({ type: "GET_NAS_LIST" }),
      send({ type: "GET_WHITELIST" }),
      send({ type: "GET_WHITELIST_MODE" })
    ]);

    const manifest = chrome.runtime.getManifest();
    const backup = {
      version: manifest.version,
      exportedAt: new Date().toISOString(),
      services: (nasResp?.list || []).map(s => ({ ...s, password: "", apiToken: "" })),
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
    setStatus("Backup downloaded!");
  } catch (err) {
    setStatus("Export failed: " + err.message, true);
  }
}

document.getElementById("popupExportBtn")?.addEventListener("click", popupExportConfig);
document.getElementById("popupOpenTabBackupBtn")?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
});

// ── init ──────────────────────────────────────────────────────────────────

// Note: Filter tabs are now dynamically created by renderFilterTabs()
// and click handlers are attached there, so no static initialization needed here.

// Buttons
document.getElementById("refreshBtn").addEventListener("click", refresh);

document.getElementById("retryBtn").addEventListener("click", refresh);

document.getElementById("pauseAllBtn").addEventListener("click", () => {
  const visible = getVisibleTasks();
  const ids = visible.filter(t => selectedTaskIds.has(t.id) && canPauseTask(t.status)).map(t => t.id);
  if (ids.length) taskAction("pause", ids);
});

document.getElementById("resumeAllBtn").addEventListener("click", () => {
  const visible = getVisibleTasks();
  const ids = visible.filter(t => selectedTaskIds.has(t.id) && canResumeTask(t.status)).map(t => t.id);
  if (ids.length) taskAction("resume", ids);
});

document.getElementById("removeAllBtn").addEventListener("click", () => {
  const ids = getSelectedTasks();
  if (ids.length && confirm(`Remove ${ids.length} task${ids.length !== 1 ? "s" : ""}? (files will be preserved)`)) {
    taskAction("delete", ids);
  }
});

document.getElementById("toggleSelectBtn").addEventListener("click", () => {
  const visible = getVisibleTasks();
  const selected = getSelectedTasks().filter(id => visible.some(t => t.id === id));
  if (selected.length === visible.length && visible.length > 0) {
    deselectAllVisible();
  } else {
    selectAllVisible();
  }
});

document.getElementById("settingsBtn")?.addEventListener("click", () => {
  const isMain = document.getElementById("mainView").classList.contains("show");
  if (isMain) {
    showSettings();
  } else {
    showMainView();
  }
});

document.getElementById("configureBtn")?.addEventListener("click", () => {
  showSettings();
});

document.getElementById("openInTabBtn")?.addEventListener("click", () => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL("options.html"));
  }
});

// ── Add Downloads View Handlers ─────────────────────────────────────────────

let selectedTorrentFiles = [];

const SERVICE_CAPABILITIES = {
  synology: {
    text: "Supports: Magnets, .torrent files, & direct web links",
    allowTorrents: true,
    pathHint: "Supports custom download destination."
  },
  qbittorrent: {
    text: "Supports: Magnet links & .torrent files",
    allowTorrents: true,
    pathHint: "Supports custom save path."
  },
  transmission: {
    text: "Supports: Magnet links & .torrent files",
    allowTorrents: true,
    pathHint: "Supports custom download directory."
  },
  deluge: {
    text: "Supports: Magnet links & .torrent files",
    allowTorrents: true,
    pathHint: "Supports custom download location."
  },
  jdownloader: {
    text: "Supports: Direct web & media links (HTTP/HTTPS/FTP)",
    allowTorrents: false,
    pathHint: "Supports custom package destination folder."
  }
};

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function updateAddDlServiceCapabilities() {
  const select = document.getElementById("addDlServiceSelect");
  const nasId = select?.value;
  const nas = nasList.find(n => n.id === nasId);
  const type = nas?.type || "synology";
  const cap = SERVICE_CAPABILITIES[type] || SERVICE_CAPABILITIES.synology;

  const capText = document.getElementById("addDlCapabilityText");
  if (capText) capText.textContent = cap.text;

  const torrentSection = document.getElementById("addDlTorrentSection");
  if (torrentSection) {
    torrentSection.classList.toggle("d-none", !cap.allowTorrents);
  }

  const pathHint = document.getElementById("addDlPathHint");
  if (pathHint) {
    pathHint.textContent = (nas?.destination ? `Default: ${nas.destination}. ` : "") + cap.pathHint;
  }
  const pathInput = document.getElementById("addDlPathInput");
  if (pathInput && !pathInput.value && nas?.destination) {
    pathInput.placeholder = nas.destination;
  }
}

function showAddDownloadView() {
  document.getElementById("mainView").classList.remove("show");
  document.getElementById("settingsView").classList.remove("show");
  document.getElementById("addDownloadView").classList.add("show");
  document.getElementById("headerTitle").textContent = "Add Downloads";
  hideEl("mainHeaderControls");
  hideEl("gearIcon");
  hideEl("openInTabBtn");
  showEl("backIcon", true);
  document.getElementById("settingsBtn").title = "Back";
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }

  // Populate services dropdown
  const select = document.getElementById("addDlServiceSelect");
  if (select) {
    select.innerHTML = "";
    nasList.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.type})`;
      if (s.id === currentNasId) opt.selected = true;
      select.appendChild(opt);
    });
  }

  updateAddDlServiceCapabilities();
  setTimeout(() => document.getElementById("addDlUrls")?.focus(), 50);
}

function renderSelectedTorrentFiles() {
  const container = document.getElementById("addDlFileList");
  if (!container) return;

  if (selectedTorrentFiles.length === 0) {
    container.classList.add("d-none");
    container.innerHTML = "";
    return;
  }

  container.classList.remove("d-none");
  container.innerHTML = "";
  selectedTorrentFiles.forEach((file, index) => {
    const pill = document.createElement("div");
    pill.className = "file-pill";

    const nameSpan = document.createElement("span");
    nameSpan.className = "file-pill-name";
    nameSpan.textContent = `${file.name} (${formatBytes(file.size)})`;

    const removeBtn = document.createElement("button");
    removeBtn.className = "file-pill-remove";
    removeBtn.textContent = "✕";
    removeBtn.title = "Remove";
    removeBtn.addEventListener("click", () => {
      selectedTorrentFiles.splice(index, 1);
      renderSelectedTorrentFiles();
    });

    pill.appendChild(nameSpan);
    pill.appendChild(removeBtn);
    container.appendChild(pill);
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function submitAddDownloads() {
  const select = document.getElementById("addDlServiceSelect");
  const nasId = select?.value;
  const nas = nasList.find(n => n.id === nasId);
  if (!nas) {
    setStatus("Please select a target service.", true);
    return;
  }

  const urlsText = document.getElementById("addDlUrls")?.value || "";
  const lines = urlsText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const destination = document.getElementById("addDlPathInput")?.value.trim() || undefined;

  const cap = SERVICE_CAPABILITIES[nas.type] || SERVICE_CAPABILITIES.synology;

  if (lines.length === 0 && selectedTorrentFiles.length === 0) {
    setStatus("Enter at least 1 link or choose a .torrent file.", true);
    return;
  }

  // Pre-validate links against target service capabilities
  if (nas.type === "jdownloader") {
    const magnet = lines.find(l => l.startsWith("magnet:"));
    if (magnet) {
      setStatus("JDownloader does not support magnet links.", true);
      return;
    }
  } else if (["qbittorrent", "transmission", "deluge"].includes(nas.type)) {
    const invalidUrl = lines.find(l => !l.startsWith("magnet:") && !l.toLowerCase().includes(".torrent"));
    if (invalidUrl) {
      setStatus(`${nas.name} only accepts torrents or magnets.`, true);
      return;
    }
  }

  const submitBtn = document.getElementById("addDlSubmitBtn");
  if (submitBtn) submitBtn.disabled = true;
  setStatus("Adding downloads...");

  let successCount = 0;
  let failCount = 0;

  // 1. Process URLs
  for (const url of lines) {
    try {
      const resp = await send({ type: "SEND_MAGNET", url, nasId, destination });
      if (resp && resp.ok) {
        successCount++;
      } else {
        failCount++;
      }
    } catch (err) {
      failCount++;
    }
  }

  // 2. Process .torrent files
  if (cap.allowTorrents) {
    for (const file of selectedTorrentFiles) {
      try {
        const base64 = await readFileAsBase64(file);
        const parseResp = await send({ type: "PARSE_TORRENT_FILE", base64 });
        if (parseResp && parseResp.ok && parseResp.magnet) {
          const resp = await send({ type: "SEND_MAGNET", url: parseResp.magnet, nasId, destination });
          if (resp && resp.ok) {
            successCount++;
          } else {
            failCount++;
          }
        } else {
          failCount++;
        }
      } catch (err) {
        failCount++;
      }
    }
  }

  if (submitBtn) submitBtn.disabled = false;

  // Reset form
  const urlsArea = document.getElementById("addDlUrls");
  if (urlsArea) urlsArea.value = "";
  const pathInp = document.getElementById("addDlPathInput");
  if (pathInp) pathInp.value = "";
  selectedTorrentFiles = [];
  renderSelectedTorrentFiles();

  // Return to main view and refresh
  currentNasId = nasId;
  await showMainView();

  if (failCount === 0) {
    setStatus(`Added ${successCount} download${successCount !== 1 ? "s" : ""}!`);
  } else {
    setStatus(`Added ${successCount} download${successCount !== 1 ? "s" : ""}, ${failCount} failed.`, true);
  }
}

document.getElementById("addDownloadBtn")?.addEventListener("click", () => {
  showAddDownloadView();
});
document.getElementById("addDlServiceSelect")?.addEventListener("change", updateAddDlServiceCapabilities);
document.getElementById("addDlPasteBtn")?.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text && text.trim()) {
      const area = document.getElementById("addDlUrls");
      if (area) {
        area.value = (area.value ? area.value.trim() + "\n" : "") + text.trim();
        area.focus();
      }
    }
  } catch (err) {
    console.warn("Clipboard access denied:", err);
  }
});
document.getElementById("addDlChooseFilesBtn")?.addEventListener("click", () => {
  document.getElementById("addDlTorrentInput")?.click();
});
document.getElementById("addDlTorrentInput")?.addEventListener("change", (e) => {
  const files = Array.from(e.target.files || []);
  if (files.length > 0) {
    selectedTorrentFiles.push(...files);
    renderSelectedTorrentFiles();
  }
  e.target.value = "";
});
document.getElementById("addDlCancelBtn")?.addEventListener("click", () => {
  showMainView();
});
document.getElementById("addDlSubmitBtn")?.addEventListener("click", submitAddDownloads);

document.getElementById("addNasBtn").addEventListener("click", addNewNas);
document.getElementById("backToListBtn").addEventListener("click", showNasListView);

document.getElementById("openWebUiBtn")?.addEventListener("click", () => {
  if (!currentNasId) return;
  const nas = nasList.find(n => n.id === currentNasId);
  const url = getServiceWebUrl(nas);
  if (url) {
    chrome.tabs.create({ url });
  }
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
  await loadAllCachedTasks();
  await loadServiceFilters();
  checkAllDeviceConnections(); // Check all device statuses on open
  getCurrentDomain();
  loadWhitelist();
  paintCachedTasks();
  refresh();
  pollTimer = setInterval(refresh, 5000);
})();

window.addEventListener("unload", () => clearInterval(pollTimer));

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getServiceWebUrl,
    SERVICE_DEFAULTS,
    ADAPTER_FEATURES
  };
}
