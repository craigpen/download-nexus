// popup.js — Download Station task manager

let allTasks     = [];
let filter       = "downloading";
let pollTimer    = null;
let currentDomain = null;
let whitelistSet = new Set();
let nasList      = [];
let currentNasId = null;
let nasConnStatus = {}; // Track connection status per NAS

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

function statusClass(status) {
  const map = {
    downloading: "s-downloading",
    seeding:     "s-seeding",
    paused:      "s-paused",
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

  // Total speeds
  let dn = 0, up = 0;
  for (const t of allTasks) {
    dn += t.additional?.transfer?.speed_download || 0;
    up += t.additional?.transfer?.speed_upload   || 0;
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
      const aPct = a.size > 0 ? (a.additional?.transfer?.size_downloaded || 0) / a.size : 0;
      const bPct = b.size > 0 ? (b.additional?.transfer?.size_downloaded || 0) / b.size : 0;
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
    empty.innerHTML = allTasks.length === 0
      ? "<span>No active downloads</span>"
      : `<span>No ${statusLabel} tasks</span>`;
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
    const transfer = task.additional?.transfer || {};
    const size     = task.size;
    const dlSize   = transfer.size_downloaded || 0;
    const pct      = size > 0 ? Math.min(100, Math.round(dlSize / size * 100)) : 0;
    const spDn     = transfer.speed_download || 0;
    const spUp     = transfer.speed_upload   || 0;
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
            <button class="task-btn pause-btn"  title="Pause"  style="${isPaused ? "display:none" : ""}">⏸</button>
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

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── data fetch ────────────────────────────────────────────────────────────

async function checkConnection() {
  if (!currentNasId) return false;
  try {
    const resp = await send({ type: "CHECK_CONNECTION", nasId: currentNasId });
    if (resp.ok) {
      nasConnStatus[currentNasId] = "ok";
      document.getElementById("connStatus").className = "ok";
      document.getElementById("connStatus").textContent = "● Connected";
      renderNasTabs(); // Update tabs with status
      return true;
    } else {
      throw new Error(resp.error || "Unknown error");
    }
  } catch (err) {
    nasConnStatus[currentNasId] = "error";
    document.getElementById("connStatus").className = "error";
    document.getElementById("connStatus").textContent = "● Offline";
    renderNasTabs(); // Update tabs with status
    return false;
  }
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
      showError("⚠️ Failed to load tasks", resp.error || "Unknown error");
      setStatus(resp.error, true);
      return;
    }
    hideError();
    allTasks = resp.tasks;
    document.getElementById("speedBar").style.display = "";
    document.getElementById("tabBar").style.display   = "";
    updateCounts();
    renderTasks();
    setStatus("");
  } catch (err) {
    showError("❌ Connection error", err.message);
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

// ── NAS management ────────────────────────────────────────────────────────

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
        // Set current NAS to first in list if not set
        if (!currentNasId) {
          currentNasId = nasList[0].id;
        }
      }

      renderNasTabs(); // Render tabs after setting currentNasId
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
    const connIndicator = connStatus === "ok" ? "● Connected" : connStatus === "error" ? "● Offline" : "● …";
    const connColor = connStatus === "ok" ? "#4caf7d" : connStatus === "error" ? "#ff7b72" : "#8898b8";
    return `
      <button class="tab ${isActive ? "active" : ""}" data-nas-id="${nas.id}" style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px;">
        <div>${nas.name}</div>
        <div style="font-size: 9px; color: ${connColor}; opacity: 0.8;">${connIndicator}</div>
      </button>
    `;
  }).join("");
  tabBar.style.display = "flex";

  tabBar.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      currentNasId = tab.dataset.nasId;
      renderNasTabs();
      allTasks = [];
      filter = "downloading";
      checkConnection();
      refresh();
    });
  });
}

// ── whitelist ──────────────────────────────────────────────────────────────

async function loadWhitelist() {
  try {
    const resp = await send({ type: "GET_WHITELIST" });
    whitelistSet = new Set(resp.list || []);
    updateWhitelistUI();
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
  } catch (err) {
    console.error("[NAS] Whitelist update error:", err);
  }
}

// ── init ──────────────────────────────────────────────────────────────────

// Tabs
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    filter = tab.dataset.filter;
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
  chrome.runtime.openOptionsPage();
});

document.getElementById("configureBtn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

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

// Initial load + 5s poll while popup is open
(async () => {
  await loadNasList();
  getCurrentDomain();
  loadWhitelist();
  checkConnection();
  refresh();
  pollTimer = setInterval(refresh, 5000);
})();

window.addEventListener("unload", () => clearInterval(pollTimer));
