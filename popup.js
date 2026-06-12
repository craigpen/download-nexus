// popup.js — Download Station task manager

let allTasks   = [];
let filter     = "downloading";
let pollTimer  = null;

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
  return filter === "all" ? allTasks : allTasks.filter(t => t.status === filter);
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

async function refresh() {
  try {
    const resp = await send({ type: "LIST_TASKS" });
    if (!resp.ok) { setStatus(resp.error, true); return; }
    allTasks = resp.tasks;
    document.getElementById("speedBar").style.display = "";
    document.getElementById("tabBar").style.display   = "";
    updateCounts();
    renderTasks();
    setStatus("");
  } catch (err) {
    setStatus(err.message, true);
  }
}

// ── task actions ──────────────────────────────────────────────────────────

async function taskAction(action, ids) {
  setStatus("…");
  try {
    const resp = await send({ type: "TASK_ACTION", action, ids });
    if (!resp.ok) { setStatus(resp.error, true); return; }
    await refresh();
  } catch (err) {
    setStatus(err.message, true);
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

document.getElementById("openDSBtn").addEventListener("click", () => {
  chrome.storage.sync.get({ host: "192.168.0.1", port: "5000", https: false }, s => {
    const scheme = s.https ? "https" : "http";
    chrome.tabs.create({ url: `${scheme}://${s.host}:${s.port}` });
  });
});

// Initial load + 5s poll while popup is open
refresh();
pollTimer = setInterval(refresh, 5000);
window.addEventListener("unload", () => clearInterval(pollTimer));
