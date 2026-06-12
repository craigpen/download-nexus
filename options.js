// options.js

const DEFAULT = {
  host: "192.168.0.1",
  port: "5000",
  https: false,
  username: "admin",
  password: "",
  destination: ""
};

function $(id) { return document.getElementById(id); }

// ── load saved settings ───────────────────────────────────────────────────
chrome.storage.sync.get(DEFAULT, s => {
  $("host").value        = s.host;
  $("port").value        = s.port;
  $("https").checked     = s.https;
  $("username").value    = s.username;
  $("password").value    = s.password;
  $("destination").value = s.destination;
});

// ── save ──────────────────────────────────────────────────────────────────
$("settingsForm").addEventListener("submit", e => {
  e.preventDefault();
  const settings = {
    host:        $("host").value.trim(),
    port:        $("port").value.trim(),
    https:       $("https").checked,
    username:    $("username").value.trim(),
    password:    $("password").value,
    destination: $("destination").value.trim()
  };
  chrome.storage.sync.set(settings, () => {
    const el = $("status");
    el.textContent = "✅ Settings saved!";
    el.className = "ok";
    setTimeout(() => { el.textContent = ""; }, 3000);
  });
});

// ── debug log rendering ───────────────────────────────────────────────────
function renderLog(entries) {
  const box = $("debugLog");
  if (!entries || !entries.length) {
    box.textContent = "(no log entries yet)";
    return;
  }
  box.innerHTML = "";
  for (const e of entries) {
    const line = document.createElement("div");
    line.className = `log-${e.level.toLowerCase()}`;
    const detail = e.detail ? `  →  ${e.detail}` : "";
    line.textContent = `[${e.ts}] [${e.level}] ${e.msg}${detail}`;
    box.appendChild(line);
  }
  box.scrollTop = box.scrollHeight;
}

function refreshLog() {
  chrome.runtime.sendMessage({ type: "GET_LOG" }, resp => {
    if (chrome.runtime.lastError) return;
    renderLog(resp?.log);
  });
}

$("clearLogBtn").addEventListener("click", () => {
  $("debugLog").textContent = "(log cleared)";
});

$("refreshLogBtn").addEventListener("click", refreshLog);

// ── debug toggle ─────────────────────────────────────────────────────────
$("debugToggleBtn").addEventListener("click", () => {
  const card = $("debugCard");
  const btn = $("debugToggleBtn");
  card.classList.toggle("show");
  btn.textContent = card.classList.contains("show") ? "🛠 Hide Debug Log" : "🛠 Show Debug Log";
});

// ── test connection ───────────────────────────────────────────────────────
$("testBtn").addEventListener("click", () => {
  const el = $("testStatus");
  el.textContent = "⏳ Connecting…";
  el.style.color = "#555";
  $("debugLog").textContent = "⏳ Running test…";

  const settings = {
    host:     $("host").value.trim(),
    port:     $("port").value.trim(),
    https:    $("https").checked,
    username: $("username").value.trim(),
    password: $("password").value
  };

  chrome.runtime.sendMessage({ type: "TEST_CONNECTION", settings }, resp => {
    if (chrome.runtime.lastError) {
      el.textContent = `❌ Extension error: ${chrome.runtime.lastError.message}`;
      el.style.color = "#c0392b";
      return;
    }
    if (resp?.ok) {
      el.textContent = `✅ Connected! Download Station ${resp.version}`;
      el.style.color = "#1d7c2d";
    } else {
      el.textContent = `❌ ${resp?.error ?? "Unknown error"}`;
      el.style.color = "#c0392b";
    }
    renderLog(resp?.log);
  });
});
