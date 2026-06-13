// popup.ts — Download Station task manager

let allTasks: any[] = [];
let filter = "downloading";
let pollTimer: number | null = null;
let currentDomain: string | null = null;
let whitelistSet = new Set<string>();
let nasList: any[] = [];
let currentNasId: string | null = null;
let nasConnStatus: any = {}; // Track connection status per NAS

// ── utilities ─────────────────────────────────────────────────────────────

function fmt(bytes: number | null): string {
  if (bytes == null || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const k = 1024, sizes = ["B","KB","MB","GB","TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1) + " " + sizes[i];
}

function fmtSpeed(bps: number): string {
  if (!bps) return "0 B/s";
  return fmt(bps) + "/s";
}

function fmtEta(seconds: number): string {
  if (!seconds || seconds < 0 || seconds > 86400 * 30) return "";
  if (seconds < 60)  return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds/60)}m ${seconds%60}s`;
  return `${Math.floor(seconds/3600)}h ${Math.floor((seconds%3600)/60)}m`;
}

function statusClass(status: string): string {
  const map: any = {
    downloading: "s-downloading",
    seeding:     "s-seeding",
    paused:      "s-paused",
    finished:    "s-finished",
    error:       "s-error",
    waiting:     "s-waiting"
  };
  return map[status] || "s-other";
}

function progressColor(status: string): string {
  if (status === "error")    return "#ff7b72";
  if (status === "seeding")  return "#4caf7d";
  if (status === "finished") return "#4caf7d";
  if (status === "paused")   return "#e3b341";
  return "#5b9cf6";
}

// ── messaging ─────────────────────────────────────────────────────────────

function send(msg: any): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp: any) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(resp);
    });
  });
}

// ── render ────────────────────────────────────────────────────────────────

function setStatus(msg: string, isErr: boolean = false) {
  const el = document.getElementById("statusMsg");
  if (el) {
    el.textContent = msg;
    el.style.color = isErr ? "#ff7b72" : "#5a6880";
  }
}

function updateCounts() {
  const counts: any = { all: allTasks.length, downloading: 0, seeding: 0, paused: 0, finished: 0, error: 0 };
  for (const t of allTasks) {
    if (counts[t.status] !== undefined) counts[t.status]++;
  }
  for (const [k, v] of Object.entries(counts)) {
    const el = document.getElementById(`cnt-${k}`);
    if (el) el.textContent = String(v);
  }

  // Total speeds
  let dn = 0, up = 0;
  for (const t of allTasks) {
    dn += t.additional?.transfer?.speed_download || 0;
    up += t.additional?.transfer?.speed_upload   || 0;
  }
  const dnEl = document.getElementById("totalDn");
  const upEl = document.getElementById("totalUp");
  const labelEl = document.getElementById("taskCountLabel");
  if (dnEl) dnEl.textContent = fmtSpeed(dn);
  if (upEl) upEl.textContent = fmtSpeed(up);
  if (labelEl) labelEl.textContent = `${allTasks.length} task${allTasks.length !== 1 ? "s" : ""}`;
}

function getVisibleTasks() {
  const filtered = filter === "all" ? allTasks : allTasks.filter(t => t.status === filter);

  // Sort based on filter
  if (filter === "downloading") {
    // DL tab: sort by % complete (most complete first)
    return filtered.sort((a: any, b: any) => {
      const aPct = a.size > 0 ? (a.additional?.transfer?.size_downloaded || 0) / a.size : 0;
      const bPct = b.size > 0 ? (b.additional?.transfer?.size_downloaded || 0) / b.size : 0;
      return bPct - aPct;
    });
  } else {
    // All other tabs: sort by date added (newest first)
    return filtered.sort((a: any, b: any) => {
      const aTime = a.additional?.time_added || 0;
      const bTime = b.additional?.time_added || 0;
      return bTime - aTime;
    }).reverse();
  }
}

function updateFooterButtons() {
  const visible = getVisibleTasks();
  const pauseCount = visible.filter((t: any) => t.status === "downloading").length;
  const resumeCount = visible.filter((t: any) => t.status === "paused").length;
  const pauseBtn = document.getElementById("pauseAllBtn") as any;
  const resumeBtn = document.getElementById("resumeAllBtn") as any;

  if (pauseBtn) {
    pauseBtn.disabled = pauseCount === 0;
    pauseBtn.textContent = `⏸ Pause visible${pauseCount ? ` (${pauseCount})` : ""}`;
  }
  if (resumeBtn) {
    resumeBtn.disabled = resumeCount === 0;
    resumeBtn.textContent = `▶ Resume visible${resumeCount ? ` (${resumeCount})` : ""}`;
  }
}

function renderTasks() {
  const list = document.getElementById("taskList");
  const empty = document.getElementById("emptyMsg");

  const visible = getVisibleTasks();

  if (visible.length === 0) {
    if (empty) empty.style.display = "flex";
    const labels: any = { all: "active", downloading: "downloading", seeding: "seeding", paused: "paused", finished: "done", error: "error" };
    const statusLabel = labels[filter] || filter;
    if (empty) {
      empty.innerHTML = allTasks.length === 0
        ? "<span>No active downloads</span>"
        : `<span>No ${statusLabel} tasks</span>`;
    }
    // Remove old task rows
    if (list) list.querySelectorAll(".task").forEach((el: any) => el.remove());
    updateFooterButtons();
    return;
  }

  if (empty) empty.style.display = "none";

  // Build a map of existing rows by task id for efficient updates
  const existing: any = {};
  if (list) list.querySelectorAll(".task").forEach((el: any) => { existing[el.dataset.id] = el; });

  const fragment = document.createDocumentFragment();
  const seen = new Set<string>();

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
      (row.querySelector(".task-name") as any).textContent = task.title;
      (row.querySelector(".progress-fill") as any).style.width = `${pct}%`;
      (row.querySelector(".progress-fill") as any).style.background = color;
      (row.querySelector(".progress-pct") as any).textContent = `${pct}%`;
      (row.querySelector(".task-dn") as any).textContent   = fmtSpeed(spDn);
      (row.querySelector(".task-up") as any).textContent   = fmtSpeed(spUp);
      (row.querySelector(".task-size") as any).textContent = `${fmt(dlSize)} / ${fmt(size)}`;
      (row.querySelector(".task-eta") as any).textContent  = fmtEta(eta);
      (row.querySelector(".status-dot") as any).className  = `status-dot ${statusClass(task.status)}`;
      const pauseBtn  = row.querySelector(".pause-btn");
      const resumeBtn = row.querySelector(".resume-btn");
      if (pauseBtn)  pauseBtn.style.display  = isPaused ? "none" : "";
      if (resumeBtn) resumeBtn.style.display = isPaused ? "" : "none";
      fragment.appendChild(row);
    } else {
      // Create new row
      const row = document.createElement("div");
      row.className   = "task";
      (row as any).dataset.id  = task.id;
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

      (row.querySelector(".pause-btn") as any)?.addEventListener("click", () => taskAction("pause",  [task.id]));
      (row.querySelector(".resume-btn") as any)?.addEventListener("click", () => taskAction("resume", [task.id]));
      (row.querySelector(".delete-btn") as any)?.addEventListener("click", () => {
        if (confirm(`Delete "${task.title}"?`)) taskAction("delete", [task.id]);
      });
      fragment.appendChild(row);
    }
  }

  // Remove rows no longer in the visible set
  Object.keys(existing).forEach((id: string) => {
    if (!seen.has(id)) existing[id].remove();
  });

  if (list) list.appendChild(fragment);
  updateFooterButtons();
}

function escHtml(str: string): string {
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
      const el = document.getElementById("connStatus");
      if (el) {
        el.className = "ok";
        el.textContent = "● Connected";
      }
      renderNasTabs(); // Update tabs with status
      return true;
    } else {
      throw new Error(resp.error || "Unknown error");
    }
  } catch (err: any) {
    nasConnStatus[currentNasId] = "error";
    const el = document.getElementById("connStatus");
    if (el) {
      el.className = "error";
      el.textContent = "● Offline";
    }
    renderNasTabs(); // Update tabs with status
    return false;
  }
}

function showError(title: string, detail: string) {
  const titleEl = document.getElementById("errorTitle");
  const detailEl = document.getElementById("errorDetail");
  const container = document.getElementById("errorContainer");
  const taskList = document.getElementById("taskList");
  const speedBar = document.getElementById("speedBar");
  const tabBar = document.getElementById("tabBar");

  if (titleEl) titleEl.textContent = title;
  if (detailEl) detailEl.textContent = detail;
  if (container) container.classList.add("show");
  if (taskList) taskList.style.display = "none";
  if (speedBar) speedBar.style.display = "none";
  if (tabBar) tabBar.style.display = "none";
}

function hideError() {
  const container = document.getElementById("errorContainer");
  const taskList = document.getElementById("taskList");
  if (container) container.classList.remove("show");
  if (taskList) taskList.style.display = "";
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
    const speedBar = document.getElementById("speedBar");
    const tabBar = document.getElementById("tabBar");
    if (speedBar) speedBar.style.display = "";
    if (tabBar) tabBar.style.display = "";
    updateCounts();
    renderTasks();
    setStatus("");
  } catch (err: any) {
    showError("❌ Connection error", err.message);
    setStatus(err.message, true);
  }
}

// ── task actions ──────────────────────────────────────────────────────────

async function taskAction(action: string, ids: string[]) {
  setStatus("…");
  try {
    const resp = await send({ type: "TASK_ACTION", nasId: currentNasId, action, ids });
    if (!resp.ok) { setStatus(resp.error, true); return; }
    await refresh();
  } catch (err: any) {
    setStatus(err.message, true);
  }
}

// ── NAS management ────────────────────────────────────────────────────────

async function loadNasList() {
  return new Promise(resolve => {
    send({ type: "GET_NAS_LIST" }).then((resp: any) => {
      nasList = resp.list || [];

      if (nasList.length === 0) {
        // No NAS configured
        const container = document.getElementById("noNasContainer");
        const taskList = document.getElementById("taskList");
        const speedBar = document.getElementById("speedBar");
        const tabBar = document.getElementById("tabBar");
        if (container) container.classList.add("show");
        if (taskList) taskList.style.display = "none";
        if (speedBar) speedBar.style.display = "none";
        if (tabBar) tabBar.style.display = "none";
      } else {
        // NAS configured
        const container = document.getElementById("noNasContainer");
        if (container) container.classList.remove("show");
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
    const tabBar = document.getElementById("nasTabBar");
    const connStatus = document.getElementById("connStatus");
    if (tabBar) tabBar.style.display = "none";
    if (connStatus) connStatus.style.display = "";
    return;
  }

  // Multiple NAS: hide header status, show in tabs instead
  const connStatus = document.getElementById("connStatus");
  if (connStatus) connStatus.style.display = "none";
  const tabBar = document.getElementById("nasTabBar");
  if (tabBar) {
    tabBar.innerHTML = nasList.map((nas: any) => {
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

    tabBar.querySelectorAll(".tab").forEach((tab: any) => {
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
}

// ── whitelist ──────────────────────────────────────────────────────────────

async function loadWhitelist() {
  try {
    const resp = await send({ type: "GET_WHITELIST" });
    whitelistSet = new Set(resp.list || []);
    updateWhitelistUI();
  } catch (err: any) {
    console.error("[NAS] Failed to load whitelist:", err);
  }
}

function updateWhitelistUI() {
  if (!currentDomain) return;
  const isWhitelisted = whitelistSet.has(currentDomain);
  const actionBtn = document.getElementById("whitelistAction");
  const domainInfo = document.getElementById("domainInfo");
  const btn = document.getElementById("whitelistBtn");
  if (domainInfo) domainInfo.textContent = currentDomain;
  if (actionBtn) actionBtn.textContent = isWhitelisted ? "✓ Remove from whitelist" : "+ Add to whitelist";

  if (btn) {
    if (isWhitelisted) {
      btn.style.color = "#4caf7d";
      btn.title = "Domain is whitelisted";
    } else {
      btn.style.color = "#8898b8";
      btn.title = "Whitelist current domain";
    }
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
  } catch (err: any) {
    console.error("[NAS] Whitelist update error:", err);
  }
}

// ── init ──────────────────────────────────────────────────────────────

// Tabs
document.querySelectorAll(".tab").forEach((tab: any) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t: any) => t.classList.remove("active"));
    tab.classList.add("active");
    filter = tab.dataset.filter;
    renderTasks();
  });
});

// Buttons
(document.getElementById("refreshBtn") as any)?.addEventListener("click", refresh);
(document.getElementById("retryBtn") as any)?.addEventListener("click", refresh);

(document.getElementById("pauseAllBtn") as any)?.addEventListener("click", () => {
  const visible = getVisibleTasks();
  const ids = visible.filter((t: any) => t.status === "downloading").map((t: any) => t.id);
  if (ids.length) taskAction("pause", ids);
});

(document.getElementById("resumeAllBtn") as any)?.addEventListener("click", () => {
  const visible = getVisibleTasks();
  const ids = visible.filter((t: any) => t.status === "paused").map((t: any) => t.id);
  if (ids.length) taskAction("resume", ids);
});

(document.getElementById("settingsBtn") as any)?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

(document.getElementById("configureBtn") as any)?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

(document.getElementById("openDSBtn") as any)?.addEventListener("click", () => {
  if (!currentNasId) return;
  const nas = nasList.find((n: any) => n.id === currentNasId);
  if (!nas) return;
  const scheme = nas.https ? "https" : "http";
  chrome.tabs.create({ url: `${scheme}://${nas.host}:${nas.port}` });
});

// Whitelist dropdown
(document.getElementById("whitelistBtn") as any)?.addEventListener("click", () => {
  const menu = document.getElementById("whitelistMenu");
  menu?.classList.toggle("show");
});

(document.getElementById("whitelistAction") as any)?.addEventListener("click", () => {
  toggleWhitelist();
  document.getElementById("whitelistMenu")?.classList.remove("show");
});

// Close dropdown when clicking outside
document.addEventListener("click", (e: any) => {
  const dropdown = document.querySelector(".dropdown");
  if (dropdown && !dropdown.contains(e.target)) {
    document.getElementById("whitelistMenu")?.classList.remove("show");
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
  } catch (err: any) {
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
  pollTimer = window.setInterval(refresh, 5000);
})();

window.addEventListener("unload", () => {
  if (pollTimer) clearInterval(pollTimer);
});
