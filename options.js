// options.js — Multi-NAS options page

function $(id) { return document.getElementById(id); }

let nasList = [];
let editingNasId = null;

// ── NAS list management ───────────────────────────────────────────────────

async function loadNasList() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: "GET_NAS_LIST" }, resp => {
      nasList = resp?.list || [];
      renderNasList();
      resolve(nasList);
    });
  });
}

function renderNasList() {
  const container = $("nasList");
  if (nasList.length === 0) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = nasList.map(nas => `
    <div class="nas-item" data-nas-id="${nas.id}">
      <div class="nas-item-info">
        <div class="nas-item-name">${nas.name}</div>
        <div class="nas-item-host">${nas.host}:${nas.port}</div>
      </div>
      <button class="nas-item-delete" data-nas-id="${nas.id}">✕</button>
    </div>
  `).join("");

  // Edit handler
  container.querySelectorAll(".nas-item").forEach(item => {
    item.addEventListener("click", (e) => {
      if (e.target.classList.contains("nas-item-delete")) return;
      editNas(item.dataset.nasId);
    });
  });

  // Delete handler
  container.querySelectorAll(".nas-item-delete").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm(`Delete "${nasList.find(n => n.id === btn.dataset.nasId)?.name}"?`)) {
        deleteNas(btn.dataset.nasId);
      }
    });
  });
}

// ── form management ────────────────────────────────────────────────────────

function showForm() {
  $("nasListContainer").style.display = "none";
  $("settingsForm").classList.add("show");
}

function hideForm() {
  $("nasListContainer").style.display = "";
  $("settingsForm").classList.remove("show");
  editingNasId = null;
}

function editNas(nasId) {
  editingNasId = nasId;
  const nas = nasList.find(n => n.id === nasId);
  if (!nas) return;

  $("formTitle").textContent = `Edit ${nas.name}`;
  $("deleteNasBtn").style.display = "";
  $("name").value = nas.name;
  $("host").value = nas.host;
  $("port").value = nas.port;
  $("https").checked = nas.https;
  $("username").value = nas.username;
  $("password").value = nas.password;
  $("destination").value = nas.destination || "";
  $("status").textContent = "";
  $("testStatus").textContent = "";

  showForm();
  updateTestButtonState();
}

function addNewNas() {
  editingNasId = null;
  $("formTitle").textContent = "Add Synology NAS";
  $("deleteNasBtn").style.display = "none";
  $("name").value = "";
  $("host").value = "192.168.0.1";
  $("port").value = "5000";
  $("https").checked = false;
  $("username").value = "admin";
  $("password").value = "";
  $("destination").value = "";
  $("status").textContent = "";
  $("testStatus").textContent = "";

  showForm();
  updateTestButtonState();
}

$("addNasBtn").addEventListener("click", addNewNas);
$("backBtn").addEventListener("click", hideForm);

// ── form submission ───────────────────────────────────────────────────────

$("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = $("password").value;
  if (!password) {
    const el = $("status");
    el.textContent = "⚠️ Password is required";
    el.className = "err";
    setTimeout(() => { el.textContent = ""; }, 4000);
    return;
  }

  const nasConfig = {
    type: "synology",
    name: $("name").value.trim(),
    host: $("host").value.trim(),
    port: $("port").value.trim(),
    https: $("https").checked,
    username: $("username").value.trim(),
    password: password,
    destination: $("destination").value.trim()
  };

  if (editingNasId) {
    // Update existing
    chrome.runtime.sendMessage({
      type: "UPDATE_NAS",
      nasId: editingNasId,
      updates: nasConfig
    }, () => {
      const el = $("status");
      el.textContent = "✅ Device saved!";
      el.className = "ok";
      setTimeout(() => {
        loadNasList().then(() => hideForm());
      }, 500);
    });
  } else {
    // Add new
    const nasId = `synology-${Date.now()}`;
    chrome.runtime.sendMessage({
      type: "ADD_NAS",
      nas: { id: nasId, ...nasConfig }
    }, () => {
      const el = $("status");
      el.textContent = "✅ Device added!";
      el.className = "ok";
      setTimeout(() => {
        loadNasList().then(() => hideForm());
      }, 500);
    });
  }
});

function deleteNas(nasId) {
  chrome.runtime.sendMessage({ type: "DELETE_NAS", nasId }, () => {
    loadNasList().then(() => hideForm());
  });
}

$("deleteNasBtn").addEventListener("click", (e) => {
  e.preventDefault();
  if (confirm("Are you sure you want to delete this NAS device?")) {
    deleteNas(editingNasId);
  }
});

// ── test button state management ───────────────────────────────────────────

function updateTestButtonState() {
  const password = $("password").value.trim();
  const testBtn = $("testBtn");
  const hasPassword = password.length > 0;
  testBtn.disabled = !hasPassword;
  testBtn.title = hasPassword
    ? "Test connection to this NAS"
    : "Enter a password to test connection";
}

$("password").addEventListener("input", updateTestButtonState);
$("password").addEventListener("change", updateTestButtonState);

// ── test connection ───────────────────────────────────────────────────────

$("testBtn").addEventListener("click", () => {
  const el = $("testStatus");
  el.textContent = "⏳ Connecting…";
  el.style.color = "#555";
  $("debugLog").textContent = "⏳ Running test…";

  const nasId = editingNasId || `test-${Date.now()}`;
  const settings = {
    name: $("name").value.trim() || "Test NAS",
    host: $("host").value.trim(),
    port: $("port").value.trim(),
    https: $("https").checked,
    username: $("username").value.trim(),
    password: $("password").value,
    destination: $("destination").value.trim(),
    type: "synology"
  };

  chrome.runtime.sendMessage({ type: "TEST_CONNECTION", nasId, settings }, resp => {
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

// ── whitelist management ──────────────────────────────────────────────────

function renderWhitelist() {
  chrome.runtime.sendMessage({ type: "GET_WHITELIST" }, resp => {
    const list = resp?.list || [];
    whitelistSet = new Set(list); // Keep in sync for export
    const container = $("whitelistList");
    if (list.length === 0) {
      container.innerHTML = '<div class="whitelist-empty">No domains whitelisted. Whitelist will be populated as you add domains.</div>';
      return;
    }
    container.innerHTML = list.map(domain => `
      <div class="whitelist-item">
        <span class="whitelist-domain">${domain}</span>
        <button class="whitelist-remove" data-domain="${domain}">Remove</button>
      </div>
    `).join("");
    container.querySelectorAll(".whitelist-remove").forEach(btn => {
      btn.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "REMOVE_WHITELIST", domain: btn.dataset.domain }, () => renderWhitelist());
      });
    });
  });
}

$("whitelistAddBtn").addEventListener("click", () => {
  const input = $("whitelistInput");
  const domain = input.value.trim().toLowerCase();
  if (!domain) return;
  chrome.runtime.sendMessage({ type: "ADD_WHITELIST", domain }, () => {
    input.value = "";
    renderWhitelist();
  });
});

$("whitelistInput").addEventListener("keypress", (e) => {
  if (e.key === "Enter") $("whitelistAddBtn").click();
});

// ── backup/restore ───────────────────────────────────────────────────────

function exportConfig() {
  const includePasswords = $("exportWithPasswords").checked;

  // Prepare NAS list
  let nasListExport = nasList.map(nas => {
    const copy = { ...nas };
    if (!includePasswords) {
      delete copy.password; // Remove plaintext password if not wanted
    }
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

function importConfig() {
  $("importFile").click();
}

$("exportBtn").addEventListener("click", exportConfig);
$("importBtn").addEventListener("click", importConfig);

$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const config = JSON.parse(text);

    if (config.version !== 1) {
      throw new Error("Unsupported config version");
    }

    // Import NAS list (merge with existing, overwrite by name)
    if (config.nasList && Array.isArray(config.nasList)) {
      for (const importedNas of config.nasList) {
        // Check if NAS with same name already exists
        const existing = nasList.find(n => n.name === importedNas.name);
        if (existing) {
          // Update existing NAS
          await new Promise(resolve => {
            chrome.runtime.sendMessage({
              type: "UPDATE_NAS",
              nasId: existing.id,
              updates: importedNas
            }, resolve);
          });
        } else {
          // Add new NAS
          await new Promise(resolve => {
            chrome.runtime.sendMessage({
              type: "ADD_NAS",
              nas: importedNas
            }, resolve);
          });
        }
      }
    }

    // Import whitelist
    if (config.whitelist && Array.isArray(config.whitelist)) {
      for (const domain of config.whitelist) {
        await new Promise(resolve => {
          chrome.runtime.sendMessage({
            type: "ADD_WHITELIST",
            domain: domain
          }, resolve);
        });
      }
    }

    const el = $("importStatus");
    el.textContent = "✅ Config imported successfully!";
    el.style.color = "#1d7c2d";

    setTimeout(() => {
      loadNasList();
      renderWhitelist();
      el.textContent = "";
    }, 1500);
  } catch (err) {
    const el = $("importStatus");
    el.textContent = `❌ Import failed: ${err.message}`;
    el.style.color = "#c0392b";
  }

  // Reset input so same file can be selected again
  e.target.value = "";
});

// ── initialization ────────────────────────────────────────────────────────

loadNasList();
renderWhitelist();
