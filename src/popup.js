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
  aria2: {
    defaultHost: "127.0.0.1",
    defaultPort: 6800,
    defaultUsername: "",
    defaultRpcSecret: "P3TERX",
    portHint: "6800 (default)",
    usernameHint: "Not required",
    rpcSecretHint: "RPC secret (default: P3TERX)",
    helpText: "Enter your Aria2 hostname. Default port is 6800. Supports HTTP/HTTPS downloads, torrents, and magnet links."
  }
};

// Adapter feature configuration - defines tabs, labels, and action capabilities for each adapter
// Actions: pause (stop active transfer), resume (start/retry paused/stalled task), delete (remove task, preserves files)
const ADAPTER_FEATURES = {
  synology: {
    tabs: ["downloading", "seeding", "paused", "finished", "error"],
    pausedLabel: "Paused",
    // Action support per state (true = action valid for that state)
    actions: {
      pause: ["downloading", "seeding"],          // Can pause active transfers
      resume: ["paused", "error"],                // Can resume paused or error tasks
      delete: ["downloading", "seeding", "paused", "finished", "error"]  // Can always delete
    }
  },
  qbittorrent: {
    tabs: ["downloading", "seeding", "paused", "stalled", "finished", "error"],
    pausedLabel: "Stopped",
    actions: {
      pause: ["downloading", "seeding", "uploading", "allocating", "forcedDL", "forcedUP", "metaDL", "forcedMetaDL"],
      resume: ["paused", "stalled", "error"],
      delete: ["downloading", "seeding", "paused", "stalled", "finished", "error"]
    }
  },
  transmission: {
    tabs: ["downloading", "seeding", "paused", "stalled", "finished", "error"],
    pausedLabel: "Paused",
    actions: {
      pause: ["downloading", "seeding", "uploading", "downloading-wait", "seeding-wait"],
      resume: ["paused", "stalled", "error"],
      delete: ["downloading", "seeding", "paused", "stalled", "finished", "error"]
    }
  },
  deluge: {
    tabs: ["downloading", "seeding", "paused", "stalled", "finished", "error"],
    pausedLabel: "Paused",
    actions: {
      pause: ["downloading", "seeding"],
      resume: ["paused", "stalled", "error"],
      delete: ["downloading", "seeding", "paused", "stalled", "finished", "error"]
    }
  },
  aria2: {
    tabs: ["downloading", "stalled", "finished", "error"],
    pausedLabel: "Paused",
    actions: {
      pause: ["active"],
      resume: ["waiting", "paused"],
      delete: ["downloading", "waiting", "paused", "completed", "error", "removed"]
    }
  }
};

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
let archivedAria2Gids = new Set(); // Track hidden Aria2 error tasks
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
  const counts = { all: allTasks.length, downloading: 0, seeding: 0, paused: 0, stalled: 0, finished: 0, error: 0 };
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

function shouldShowHideButton(nasId, status) {
  const device = nasList.find(n => n.id === nasId);
  return device?.type === "aria2" && status === "error";
}

async function loadArchivedAria2Gids() {
  const data = await chrome.storage.local.get("archivedAria2Gids");
  archivedAria2Gids = new Set(data.archivedAria2Gids || []);
}

async function saveArchivedAria2Gids() {
  await chrome.storage.local.set({ archivedAria2Gids: Array.from(archivedAria2Gids) });
}

async function hideAria2Task(gid) {
  archivedAria2Gids.add(gid);
  await saveArchivedAria2Gids();
  await refreshTasks();
}

async function clearArchivedAria2Tasks() {
  if (confirm("Clear all archived Aria2 tasks? They will reappear if still in error state.")) {
    archivedAria2Gids.clear();
    await saveArchivedAria2Gids();
    await refreshTasks();
  }
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
  if (action === "hide") {
    const device = nasList.find(n => n.id === currentNasId);
    if (device?.type !== "aria2") return 0;
    return selected.filter(t => t.status === "error").length;
  }
  return selected.length; // delete/remove is always available
}

function getVisibleTasks() {
  let filtered = allTasks.filter(t => t.status === filter);

  // Filter out archived Aria2 tasks
  filtered = filtered.filter(t => !archivedAria2Gids.has(t.id));

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
  const hideCount = getCountForAction("hide");

  const pauseBtn = document.getElementById("pauseAllBtn");
  const resumeBtn = document.getElementById("resumeAllBtn");
  const removeBtn = document.getElementById("removeAllBtn");
  const hideBtn = document.getElementById("hideAllBtn");
  const selectAllBtn = document.getElementById("selectAllBtn");
  const deselectAllBtn = document.getElementById("deselectAllBtn");

  // Select all/deselect buttons
  selectAllBtn.style.display = visible.length > 0 ? "" : "none";
  deselectAllBtn.style.display = hasSelection ? "" : "none";

  // Action buttons - only show if something is selected
  pauseBtn.style.display = hasSelection ? "" : "none";
  resumeBtn.style.display = hasSelection ? "" : "none";
  removeBtn.style.display = hasSelection ? "" : "none";
  hideBtn.style.display = hideCount > 0 ? "" : "none";

  pauseBtn.disabled = pauseCount === 0;
  resumeBtn.disabled = resumeCount === 0;
  removeBtn.disabled = removeCount === 0;
  hideBtn.disabled = hideCount === 0;

  pauseBtn.textContent = `⏸ Pause (${pauseCount})`;
  resumeBtn.textContent = `▶ Resume (${resumeCount})`;
  removeBtn.textContent = `✕ Remove (${removeCount})`;
  hideBtn.textContent = `👁 Hide (${hideCount})`;
}

function renderTasks() {
  const list = document.getElementById("taskList");
  const empty = document.getElementById("emptyMsg");

  if (!list || !empty) return;

  const visible = getVisibleTasks();

  if (visible.length === 0) {
    empty.style.display = "flex";
    empty.textContent = "No tasks";
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
    const canPause = canPauseTask(task.status);
    const canResume = canResumeTask(task.status);
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
      if (pauseBtn)  pauseBtn.style.display  = canPause ? "" : "none";
      if (resumeBtn) resumeBtn.style.display = canResume ? "" : "none";
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
      const actions = document.createElement("div");
      actions.className = "task-actions";
      const pauseBtn = document.createElement("button");
      pauseBtn.className = "task-btn pause-btn";
      pauseBtn.title = getAdapterPauseText(currentNasId);
      pauseBtn.style.display = canPause ? "" : "none";
      pauseBtn.textContent = "⏸";
      const resumeBtn = document.createElement("button");
      resumeBtn.className = "task-btn resume-btn";
      resumeBtn.title = "Resume";
      resumeBtn.style.display = canResume ? "" : "none";
      resumeBtn.textContent = "▶";
      const showHideBtn = shouldShowHideButton(currentNasId, task.status);
      const deleteBtn = document.createElement("button");
      deleteBtn.className = showHideBtn ? "task-btn hide-btn" : "task-btn danger delete-btn";
      deleteBtn.title = showHideBtn ? "Hide from list (archived)" : "Remove task";
      deleteBtn.textContent = showHideBtn ? "👁" : "✕";
      deleteBtn.dataset.action = showHideBtn ? "hide" : "delete";
      actions.appendChild(pauseBtn);
      actions.appendChild(resumeBtn);
      actions.appendChild(deleteBtn);
      top.appendChild(checkbox);
      top.appendChild(dot);
      top.appendChild(name);
      top.appendChild(actions);

      const mid = document.createElement("div");
      mid.className = "task-mid";
      const track = document.createElement("div");
      track.className = "progress-track";
      const fill = document.createElement("div");
      fill.className = "progress-fill";
      fill.style.width = `${pct}%`;
      fill.style.background = color;
      track.appendChild(fill);
      const pctSpan = document.createElement("span");
      pctSpan.className = "progress-pct";
      pctSpan.textContent = `${pct}%`;
      mid.appendChild(track);
      mid.appendChild(pctSpan);

      const bot = document.createElement("div");
      bot.className = "task-bot";
      const sizeSpan = document.createElement("span");
      sizeSpan.className = "task-size";
      sizeSpan.textContent = `${fmt(dlSize)} / ${fmt(size)}`;
      const dnSpan = document.createElement("span");
      dnSpan.className = "task-dn";
      dnSpan.textContent = `↓ ${fmtSpeed(spDn)}`;
      const upSpan = document.createElement("span");
      upSpan.className = "task-up";
      upSpan.textContent = `↑ ${fmtSpeed(spUp)}`;
      const etaSpan = document.createElement("span");
      etaSpan.className = "task-eta";
      etaSpan.textContent = fmtEta(eta);
      bot.appendChild(sizeSpan);
      bot.appendChild(dnSpan);
      bot.appendChild(upSpan);
      bot.appendChild(etaSpan);

      row.appendChild(top);
      row.appendChild(mid);
      row.appendChild(bot);

      pauseBtn.addEventListener("click", () => taskAction("pause", [task.id]));
      resumeBtn.addEventListener("click", () => taskAction("resume", [task.id]));
      deleteBtn.addEventListener("click", () => {
        if (deleteBtn.dataset.action === "hide") {
          hideAria2Task(task.id);
        } else {
          if (confirm(`Remove task "${task.title}"? (files will be preserved)`)) taskAction("delete", [task.id]);
        }
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
  const speedBar = document.getElementById("speedBar");
  const tabBar = document.getElementById("tabBar");
  if (speedBar) speedBar.style.display = "";
  if (tabBar) tabBar.style.display   = "";
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
  const errorTitle = document.getElementById("errorTitle");
  const errorDetail = document.getElementById("errorDetail");
  const errorContainer = document.getElementById("errorContainer");
  const taskList = document.getElementById("taskList");
  const speedBar = document.getElementById("speedBar");
  const tabBar = document.getElementById("tabBar");

  if (errorTitle) errorTitle.textContent = title;
  if (errorDetail) errorDetail.textContent = detail;
  if (errorContainer) errorContainer.classList.add("show");
  if (taskList) taskList.style.display = "none";
  if (speedBar) speedBar.style.display = "none";
  if (tabBar) tabBar.style.display = "none";
}

function hideError() {
  const errorContainer = document.getElementById("errorContainer");
  const taskList = document.getElementById("taskList");
  if (errorContainer) errorContainer.classList.remove("show");
  if (taskList) taskList.style.display = "";
}

async function refresh() {
  if (!currentNasId) return;
  try {
    const resp = await send({ type: "LIST_TASKS", nasId: currentNasId });
    console.log(`refresh: got ${resp.tasks?.length || 0} tasks from ${currentNasId}`);
    if (!resp.ok) {
      console.error(`refresh: LIST_TASKS failed:`, resp.error);
      setConnStatus(currentNasId, false);
      if (allTasks.length === 0) showError("⚠️ Failed to load tasks", resp.error || "Unknown error");
      setStatus(resp.error, true);
      return;
    }
    setConnStatus(currentNasId, true);
    hideError();
    allTasks = resp.tasks;
    console.log("refresh: allTasks updated to", allTasks.length, "tasks");
    console.log("Popup received tasks:", resp.tasks.length, "tasks");
    if (resp.tasks.length > 0) {
      console.log("First task fields:", Object.keys(resp.tasks[0]));
      console.log("First task data:", resp.tasks[0]);
    }
    saveCachedTasks(currentNasId, resp.tasks);
    const speedBar = document.getElementById("speedBar");
    const tabBar = document.getElementById("tabBar");
    if (speedBar) speedBar.style.display = "";
    if (tabBar) tabBar.style.display   = "";
    updateCounts();
    renderTasks();
    setStatus("");
  } catch (err) {
    console.error(`refresh: exception:`, err);
    setConnStatus(currentNasId, false);
    if (allTasks.length === 0) showError("❌ Connection error", err.message);
    setStatus(err.message, true);
  }
}

// ── task actions ──────────────────────────────────────────────────────────

async function taskAction(action, ids) {
  setStatus("…");
  try {
    console.log(`taskAction: ${action} on ${ids.join(",")} for NAS ${currentNasId}`);
    const resp = await send({ type: "TASK_ACTION", nasId: currentNasId, action, ids });
    console.log(`taskAction response:`, resp);
    if (!resp.ok) { setStatus(resp.error, true); return; }
    console.log(`taskAction: calling refresh after ${action}`);
    await refresh();
    console.log(`taskAction: refresh complete, allTasks now has ${allTasks.length} tasks`);
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
        const taskList = document.getElementById("taskList");
        const speedBar = document.getElementById("speedBar");
        const tabBar = document.getElementById("tabBar");
        if (noNasContainer) noNasContainer.classList.add("show");
        if (taskList) taskList.style.display = "none";
        if (speedBar) speedBar.style.display = "none";
        if (tabBar) tabBar.style.display = "none";
      } else {
        // NAS configured
        const noNasContainer = document.getElementById("noNasContainer");
        const taskList = document.getElementById("taskList");
        if (noNasContainer) noNasContainer.classList.remove("show");
        if (taskList) taskList.style.display = "";
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
  const nasTabBar = document.getElementById("nasTabBar");
  const connStatus = document.getElementById("connStatus");

  if (nasList.length <= 1) {
    // Hide tabs if only one or zero NAS, show header status instead
    if (nasTabBar) nasTabBar.style.display = "none";
    if (connStatus) connStatus.style.display = ""; // Show in header for single NAS
    return;
  }

  // Multiple NAS: hide header status, show in tabs instead
  if (connStatus) connStatus.style.display = "none";
  if (!nasTabBar) return;
  nasTabBar.innerHTML = '';
  nasList.forEach(nas => {
    const isActive = nas.id === currentNasId;
    const connStatus = nasConnStatus[nas.id] || "unknown";
    const connIndicator = connStatus === "ok" ? "Connected" : connStatus === "error" ? "Offline" : "…";
    const connColor = connStatus === "ok" ? "#4caf7d" : connStatus === "error" ? "#ff7b72" : "#8898b8";

    const btn = document.createElement("button");
    btn.className = `tab${isActive ? " active" : ""}`;
    btn.dataset.nasId = nas.id;
    btn.style.cssText = "flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px;";

    const nameDiv = document.createElement("div");
    nameDiv.textContent = nas.name;
    const connDiv = document.createElement("div");
    connDiv.style.cssText = `font-size: 9px; color: ${connColor}; opacity: 0.8;`;
    connDiv.textContent = connIndicator;

    btn.appendChild(nameDiv);
    btn.appendChild(connDiv);
    nasTabBar.appendChild(btn);
  });
  nasTabBar.style.display = "flex";

  nasTabBar.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", async () => {
      currentNasId = tab.dataset.nasId;
      // Clear all state for the new service
      allTasks = [];
      filter = "downloading";

      // Clear task rows to avoid showing ghost data from previous service
      const taskList = document.getElementById("taskList");
      if (taskList) {
        taskList.querySelectorAll(".task").forEach(el => el.remove());
        const emptyMsg = document.getElementById("emptyMsg");
        if (emptyMsg) {
          emptyMsg.style.display = "flex";
          emptyMsg.innerHTML = '<span class="spinner"></span>';
        }
      }

      // Update UI for new service
      renderNasTabs();
      renderFilterTabs(); // Render filter tabs based on new adapter
      updateCounts(); // Clear counts immediately

      await paintCachedTasks();
      refresh();
    });
  });

  renderFilterTabs(); // Initial render based on current adapter
}

// Get the enabled tabs for the current adapter
function getEnabledTabs() {
  const device = nasList.find(n => n.id === currentNasId);
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
  tabsContainer.style.display = "flex";

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
  const whitelistDropdown = document.getElementById("whitelistDropdown");
  if (whitelistDropdown) {
    whitelistDropdown.style.display = whitelistMode === "restricted" ? "block" : "none";
  }

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
  loadProtocolSettings();
}

async function showMainView() {
  document.getElementById("settingsView").classList.remove("show");
  document.getElementById("mainView").classList.add("show");
  document.getElementById("headerTitle").textContent = "Download Nexus";
  document.getElementById("mainHeaderControls").style.display = "flex";
  document.getElementById("gearIcon").style.display = "block";
  document.getElementById("backIcon").style.display = "none";
  document.getElementById("settingsBtn").title = "Settings";
  await paintCachedTasks();
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
    const name = document.createElement("div");
    name.className = "nas-item-name";
    name.textContent = nas.name;
    const host = document.createElement("div");
    host.className = "nas-item-host";
    host.textContent = `${nas.host}:${nas.port}`;
    info.appendChild(name);
    info.appendChild(host);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mini-delete-btn";
    btn.dataset.nasId = nas.id;
    btn.textContent = "✕";

    item.appendChild(info);
    item.appendChild(btn);
    container.appendChild(item);
  });

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

function updateFormFieldsForType() {
  const type = document.getElementById("nasType").value;
  const defaults = SERVICE_DEFAULTS[type] || SERVICE_DEFAULTS.synology;

  // Update all field placeholders with service-specific defaults (P1-3)
  document.getElementById("nasHost").placeholder = defaults.defaultHost;
  document.getElementById("nasPort").placeholder = defaults.defaultPort.toString();
  document.getElementById("nasUsername").placeholder = defaults.defaultUsername || "Not required";

  // Update RPC secret placeholder for aria2
  const rpcSecretInput = document.getElementById("nasRpcSecret");
  if (rpcSecretInput && defaults.defaultRpcSecret) {
    rpcSecretInput.placeholder = defaults.defaultRpcSecret;
  }

  // Update help text (P1-3)
  const helpEl = document.getElementById("serviceHelpText");
  if (helpEl) {
    helpEl.textContent = defaults.helpText;
    helpEl.style.color = "#888";
    helpEl.style.fontStyle = "italic";
  }

  // Show/hide API Token field for qBittorrent (P1-2)
  const apiTokenField = document.getElementById("apiTokenField");
  if (apiTokenField) {
    apiTokenField.style.display = type === "qbittorrent" ? "" : "none";
  }

  // Show/hide RPC Secret field for aria2
  const rpcSecretField = document.getElementById("rpcSecretField");
  if (rpcSecretField) {
    rpcSecretField.style.display = type === "aria2" ? "" : "none";
  }

  const usernameField = document.getElementById("usernameField");
  const passwordField = document.getElementById("passwordField");
  const usernameInput = document.getElementById("nasUsername");
  const passwordInput = document.getElementById("nasPassword");

  // Synology and qBittorrent require username/password; Transmission hides them
  // Deluge shows them but they're optional
  const needsAuth = type === "synology" || type === "qbittorrent" || type === "deluge";

  usernameField.style.display = needsAuth ? "" : "none";
  passwordField.style.display = needsAuth ? "" : "none";

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
    usernameInput.placeholder = "Not required (password only)";
    usernameInput.required = false;
    passwordInput.required = true;  // Deluge RPC only needs password
  } else if (type === "transmission") {
    document.getElementById("nasPort").value = "9091";
    usernameInput.placeholder = defaults.defaultUsername || "Optional";
    usernameInput.required = false;
    passwordInput.required = false;
  } else if (type === "aria2") {
    document.getElementById("nasPort").value = "6800";
    usernameInput.placeholder = "Not required";
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
  document.getElementById("deleteNasBtn").style.display = "";
  document.getElementById("nasName").value = nas.name;
  document.getElementById("nasType").value = nas.type || "synology";
  document.getElementById("nasHost").value = nas.host;
  document.getElementById("nasPort").value = nas.port;
  document.getElementById("nasHttps").checked = nas.https;
  document.getElementById("nasUsername").value = nas.username;
  document.getElementById("nasPassword").value = nas.password;
  document.getElementById("nasDestination").value = nas.destination || "";
  document.getElementById("nasApiToken").value = nas.apiToken || "";
  document.getElementById("nasRpcSecret").value = nas.rpcSecret || "";
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
  document.getElementById("deleteNasBtn").style.display = "none";
  document.getElementById("nasName").value = "";
  document.getElementById("nasType").value = "synology";
  document.getElementById("nasHost").value = "192.168.0.1";
  document.getElementById("nasUsername").value = "";
  document.getElementById("nasPassword").value = "";
  document.getElementById("nasDestination").value = "";
  document.getElementById("nasApiToken").value = "";
  document.getElementById("nasRpcSecret").value = "";
  document.getElementById("nasFormStatus").textContent = "";
  document.getElementById("testNasStatus").textContent = "";

  updateFormFieldsForType();
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

// ── Protocol Settings ──────────────────────────────────────────────────────

function loadProtocolSettings() {
  const defaults = window.DownloadNexus.ServiceFilter.getDefaultProtocolSettings();
  chrome.storage.local.get({ enabledProtocols: defaults }, (result) => {
    const settings = window.DownloadNexus.ServiceFilter.normalizeProtocolSettings(result.enabledProtocols);
    document.getElementById("enableMagnet").checked = settings.magnet;
    document.getElementById("enableTorrent").checked = settings.torrent;
    document.getElementById("enableHttp").checked = settings.http;
    document.getElementById("enableHttps").checked = settings.https;
    document.getElementById("enableFtp").checked = settings.ftp;
  });
}

function saveProtocolSettings() {
  const settings = {
    magnet: document.getElementById("enableMagnet").checked,
    torrent: document.getElementById("enableTorrent").checked,
    http: document.getElementById("enableHttp").checked,
    https: document.getElementById("enableHttps").checked,
    ftp: document.getElementById("enableFtp").checked
  };
  chrome.storage.local.set({ enabledProtocols: settings });
}

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

  // Add rpcSecret for aria2
  if (type === "aria2") {
    const rpcSecret = document.getElementById("nasRpcSecret").value.trim();
    nasConfig.rpcSecret = rpcSecret || "P3TERX";  // Default to P3TERX if empty
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

  // Add rpcSecret for aria2
  if (type === "aria2") {
    const rpcSecret = document.getElementById("nasRpcSecret").value.trim();
    settings.rpcSecret = rpcSecret || "P3TERX";
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

// Protocol settings change handlers
["enableMagnet", "enableTorrent", "enableHttp", "enableHttps", "enableFtp"].forEach(id => {
  document.getElementById(id).addEventListener("change", saveProtocolSettings);
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

// Schema validation for config import (P1-5)
const VALID_ADAPTER_TYPES = new Set(['synology', 'qbittorrent', 'transmission', 'deluge']);

function validateNasConfig(nas, index) {
  const errors = [];

  // Check required fields
  if (!nas.id || typeof nas.id !== 'string') {
    errors.push(`Device ${index}: missing or invalid id`);
  }
  if (!nas.name || typeof nas.name !== 'string') {
    errors.push(`Device ${index}: missing or invalid name`);
  }
  if (!nas.type || !VALID_ADAPTER_TYPES.has(nas.type)) {
    errors.push(`Device ${index}: invalid type "${nas.type}" (must be synology, qbittorrent, transmission, or deluge)`);
  }
  if (!nas.host || typeof nas.host !== 'string') {
    errors.push(`Device ${index}: missing or invalid host`);
  }
  if (!nas.port || (typeof nas.port !== 'number' && typeof nas.port !== 'string')) {
    errors.push(`Device ${index}: missing or invalid port`);
  }

  // Validate port is in valid range
  const port = typeof nas.port === 'string' ? parseInt(nas.port) : nas.port;
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push(`Device ${index}: port must be between 1 and 65535`);
  }

  // Check optional but important fields
  if (nas.password !== undefined && typeof nas.password !== 'string') {
    errors.push(`Device ${index}: password must be a string`);
  }
  if (nas.username !== undefined && typeof nas.username !== 'string') {
    errors.push(`Device ${index}: username must be a string`);
  }
  if (nas.destination !== undefined && typeof nas.destination !== 'string') {
    errors.push(`Device ${index}: destination must be a string`);
  }
  if (nas.https !== undefined && typeof nas.https !== 'boolean') {
    errors.push(`Device ${index}: https must be a boolean`);
  }
  if (nas.apiToken !== undefined && typeof nas.apiToken !== 'string') {
    errors.push(`Device ${index}: apiToken must be a string`);
  }

  return errors;
}

function validateConfigSchema(config) {
  const errors = [];

  // Check required top-level fields
  if (config.version === undefined) {
    errors.push("Missing version field");
  } else if (config.version !== 1) {
    errors.push(`Unsupported config version: ${config.version} (expected 1)`);
  }

  // Validate nasList if present
  if (config.nasList !== undefined) {
    if (!Array.isArray(config.nasList)) {
      errors.push("nasList must be an array");
    } else if (config.nasList.length > 0) {
      config.nasList.forEach((nas, i) => {
        if (typeof nas !== 'object' || nas === null) {
          errors.push(`nasList[${i}]: must be an object`);
        } else {
          errors.push(...validateNasConfig(nas, i));
        }
      });
    }
  }

  // Validate whitelist if present
  if (config.whitelist !== undefined) {
    if (!Array.isArray(config.whitelist)) {
      errors.push("whitelist must be an array");
    } else {
      config.whitelist.forEach((domain, i) => {
        if (typeof domain !== 'string') {
          errors.push(`whitelist[${i}]: must be a string`);
        } else if (!isValidDomainPattern(domain)) {
          errors.push(`whitelist[${i}]: invalid domain pattern "${domain}"`);
        }
      });
    }
  }

  // Validate whitelistMode if present
  if (config.whitelistMode !== undefined) {
    if (!['all', 'restricted'].includes(config.whitelistMode)) {
      errors.push(`whitelistMode must be "all" or "restricted", got "${config.whitelistMode}"`);
    }
  }

  return errors;
}

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, 256);
  return crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptConfig(config, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const enc = new TextEncoder();
  const plaintext = enc.encode(JSON.stringify(config));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const encrypted = {
    encrypted: true,
    salt: Array.from(salt),
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(ciphertext))
  };
  return JSON.stringify(encrypted);
}

async function decryptConfig(encryptedJson, password) {
  const encrypted = JSON.parse(encryptedJson);
  if (!encrypted.encrypted) throw new Error("File is not encrypted");
  const salt = new Uint8Array(encrypted.salt);
  const iv = new Uint8Array(encrypted.iv);
  const key = await deriveKey(password, salt);
  const ciphertext = new Uint8Array(encrypted.data);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  const dec = new TextDecoder();
  return JSON.parse(dec.decode(plaintext));
}

async function exportConfig() {
  const shouldEncrypt = document.getElementById("encryptExport").checked;
  let password = null;

  if (shouldEncrypt) {
    password = prompt("Enter a password to encrypt your backup:");
    if (password === null) return;
    if (!password) { alert("Password cannot be empty"); return; }
  }

  const nasListExport = nasList.map(nas => {
    const copy = { ...nas };
    return copy;
  });

  const config = {
    version: 1,
    nasList: nasListExport,
    whitelist: Array.from(whitelistSet),
    whitelistMode: whitelistMode
  };

  try {
    let content;
    if (shouldEncrypt) {
      content = await encryptConfig(config, password);
    } else {
      content = JSON.stringify(config, null, 2);
    }

    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const suffix = shouldEncrypt ? "-encrypted" : "";
    a.download = `download-nexus-config-${new Date().toISOString().split("T")[0]}${suffix}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(`Export failed: ${err.message}`);
  }
}

document.getElementById("exportBtn").addEventListener("click", exportConfig);
document.getElementById("importBtn").addEventListener("click", () => document.getElementById("importFile").click());
document.getElementById("clearArchivedBtn").addEventListener("click", clearArchivedAria2Tasks);

document.getElementById("importFile").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  const el = document.getElementById("importStatus");

  try {
    const text = await file.text();
    let config;

    try {
      const parsed = JSON.parse(text);
      if (parsed.encrypted) {
        const password = prompt("This backup is encrypted. Enter the password:");
        if (password === null) throw new Error("Decryption cancelled");
        config = await decryptConfig(text, password);
      } else {
        config = parsed;
      }
    } catch (err) {
      if (err.message.includes("Decryption")) throw err;
      throw new Error("Invalid backup file format");
    }

    // Validate config schema before importing (P1-5)
    const validationErrors = validateConfigSchema(config);
    if (validationErrors.length > 0) {
      const errorMsg = validationErrors.join("\n");
      throw new Error(`Config validation failed:\n${errorMsg}`);
    }

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

    if (config.whitelistMode) {
      await send({ type: "SET_WHITELIST_MODE", mode: config.whitelistMode });
    }

    el.textContent = `Config imported successfully! (${config.nasList?.length || 0} devices, ${config.whitelist?.length || 0} whitelist entries)`;
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

document.getElementById("hideAllBtn").addEventListener("click", async () => {
  const ids = getSelectedTasks();
  if (ids.length) {
    for (const id of ids) {
      await hideAria2Task(id);
    }
  }
});

document.getElementById("selectAllBtn").addEventListener("click", () => {
  selectAllVisible();
});

document.getElementById("deselectAllBtn").addEventListener("click", () => {
  deselectAllVisible();
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
  await loadArchivedAria2Gids();
  checkAllDeviceConnections(); // Check all device statuses on open
  getCurrentDomain();
  loadWhitelist();
  await paintCachedTasks();
  refresh();
  pollTimer = setInterval(refresh, 5000);
})();

window.addEventListener("unload", () => clearInterval(pollTimer));
