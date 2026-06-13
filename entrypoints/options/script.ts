// options.ts — Multi-NAS options page

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

let nasList: any[] = [];
let editingNasId: string | null = null;
let whitelistSet = new Set<string>();

// ── NAS list management ───────────────────────────────────────────────────

async function loadNasList() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: "GET_NAS_LIST" }, (resp: any) => {
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
  container.innerHTML = nasList.map((nas: any) => `
    <div class="nas-item" data-nas-id="${nas.id}">
      <div class="nas-item-info">
        <div class="nas-item-name">${nas.name}</div>
        <div class="nas-item-host">${nas.host}:${nas.port}</div>
      </div>
      <button class="nas-item-delete" data-nas-id="${nas.id}">✕</button>
    </div>
  `).join("");

  // Edit handler
  container.querySelectorAll(".nas-item").forEach((item: any) => {
    item.addEventListener("click", (e: any) => {
      if (e.target.classList.contains("nas-item-delete")) return;
      editNas(item.dataset.nasId);
    });
  });

  // Delete handler
  container.querySelectorAll(".nas-item-delete").forEach((btn: any) => {
    btn.addEventListener("click", (e: any) => {
      e.stopPropagation();
      if (confirm(`Delete "${nasList.find((n: any) => n.id === btn.dataset.nasId)?.name}"?`)) {
        deleteNas(btn.dataset.nasId);
      }
    });
  });
}

// ── form management ────────────────────────────────────────────────────

function showForm() {
  $("nasListContainer").style.display = "none";
  $("settingsForm").classList.add("show");
}

function hideForm() {
  $("nasListContainer").style.display = "";
  $("settingsForm").classList.remove("show");
  editingNasId = null;
}

function editNas(nasId: string) {
  editingNasId = nasId;
  const nas = nasList.find((n: any) => n.id === nasId);
  if (!nas) return;

  $("formTitle").textContent = `Edit ${nas.name}`;
  $("deleteNasBtn").style.display = "";
  ($("name") as any).value = nas.name;
  ($("host") as any).value = nas.host;
  ($("port") as any).value = nas.port;
  ($("https") as any).checked = nas.https;
  ($("username") as any).value = nas.username;
  ($("password") as any).value = nas.password;
  ($("destination") as any).value = nas.destination || "";
  $("status").textContent = "";
  $("testStatus").textContent = "";

  showForm();
  updateTestButtonState();
}

function addNewNas() {
  editingNasId = null;
  $("formTitle").textContent = "Add Synology NAS";
  $("deleteNasBtn").style.display = "none";
  ($("name") as any).value = "";
  ($("host") as any).value = "192.168.0.1";
  ($("port") as any).value = "5000";
  ($("https") as any).checked = false;
  ($("username") as any).value = "admin";
  ($("password") as any).value = "";
  ($("destination") as any).value = "";
  $("status").textContent = "";
  $("testStatus").textContent = "";

  showForm();
  updateTestButtonState();
}

($("addNasBtn") as any).addEventListener("click", addNewNas);
($("backBtn") as any).addEventListener("click", hideForm);

// ── form submission ───────────────────────────────────────────────────

($("settingsForm") as any).addEventListener("submit", async (e: any) => {
  e.preventDefault();
  const password = ($("password") as any).value;
  if (!password) {
    const el = $("status");
    el.textContent = "⚠️ Password is required";
    el.className = "err";
    setTimeout(() => { el.textContent = ""; }, 4000);
    return;
  }

  const nasConfig = {
    type: "synology",
    name: ($("name") as any).value.trim(),
    host: ($("host") as any).value.trim(),
    port: ($("port") as any).value.trim(),
    https: ($("https") as any).checked,
    username: ($("username") as any).value.trim(),
    password: password,
    destination: ($("destination") as any).value.trim()
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

function deleteNas(nasId: string) {
  chrome.runtime.sendMessage({ type: "DELETE_NAS", nasId }, () => {
    loadNasList().then(() => hideForm());
  });
}

($("deleteNasBtn") as any).addEventListener("click", (e: any) => {
  e.preventDefault();
  if (confirm("Are you sure you want to delete this NAS device?")) {
    deleteNas(editingNasId!);
  }
});

// ── test button state management ───────────────────────────────────────────

function updateTestButtonState() {
  const password = ($("password") as any).value.trim();
  const testBtn = $("testBtn") as any;
  const hasPassword = password.length > 0;
  testBtn.disabled = !hasPassword;
  testBtn.title = hasPassword
    ? "Test connection to this NAS"
    : "Enter a password to test connection";
}

($("password") as any).addEventListener("input", updateTestButtonState);
($("password") as any).addEventListener("change", updateTestButtonState);

// ── test connection ───────────────────────────────────────────────────────

($("testBtn") as any).addEventListener("click", () => {
  const el = $("testStatus");
  el.textContent = "⏳ Connecting…";
  (el as any).style.color = "#555";
  $("debugLog").textContent = "⏳ Running test…";

  const nasId = editingNasId || `test-${Date.now()}`;
  const settings = {
    name: ($("name") as any).value.trim() || "Test NAS",
    host: ($("host") as any).value.trim(),
    port: ($("port") as any).value.trim(),
    https: ($("https") as any).checked,
    username: ($("username") as any).value.trim(),
    password: ($("password") as any).value,
    destination: ($("destination") as any).value.trim(),
    type: "synology"
  };

  chrome.runtime.sendMessage({ type: "TEST_CONNECTION", nasId, settings }, (resp: any) => {
    if (chrome.runtime.lastError) {
      el.textContent = `❌ Extension error: ${chrome.runtime.lastError.message}`;
      (el as any).style.color = "#c0392b";
      return;
    }
    if (resp?.ok) {
      el.textContent = `✅ Connected! Download Station ${resp.version}`;
      (el as any).style.color = "#1d7c2d";
    } else {
      el.textContent = `❌ ${resp?.error ?? "Unknown error"}`;
      (el as any).style.color = "#c0392b";
    }
    renderLog(resp?.log);
  });
});

// ── debug log rendering ───────────────────────────────────────────────────

function renderLog(entries: any) {
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
  (box as any).scrollTop = (box as any).scrollHeight;
}

function refreshLog() {
  chrome.runtime.sendMessage({ type: "GET_LOG" }, (resp: any) => {
    if (chrome.runtime.lastError) return;
    renderLog(resp?.log);
  });
}

($("clearLogBtn") as any).addEventListener("click", () => {
  $("debugLog").textContent = "(log cleared)";
});

($("refreshLogBtn") as any).addEventListener("click", refreshLog);

// ── debug toggle ─────────────────────────────────────────────────────────

($("debugToggleBtn") as any).addEventListener("click", () => {
  const card = $("debugCard");
  const btn = $("debugToggleBtn");
  card.classList.toggle("show");
  btn.textContent = card.classList.contains("show") ? "🛠 Hide Debug Log" : "🛠 Show Debug Log";
});

// ── whitelist management ──────────────────────────────────────────────────

function renderWhitelist() {
  chrome.runtime.sendMessage({ type: "GET_WHITELIST" }, (resp: any) => {
    const list = resp?.list || [];
    whitelistSet = new Set(list); // Keep in sync for export
    const container = $("whitelistList");
    if (list.length === 0) {
      container.innerHTML = '<div class="whitelist-empty">No domains whitelisted. Whitelist will be populated as you add domains.</div>';
      return;
    }
    container.innerHTML = list.map((domain: string) => `
      <div class="whitelist-item">
        <span class="whitelist-domain">${domain}</span>
        <button class="whitelist-remove" data-domain="${domain}">Remove</button>
      </div>
    `).join("");
    container.querySelectorAll(".whitelist-remove").forEach((btn: any) => {
      btn.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "REMOVE_WHITELIST", domain: btn.dataset.domain }, () => renderWhitelist());
      });
    });
  });
}

($("whitelistAddBtn") as any).addEventListener("click", () => {
  const input = $("whitelistInput") as any;
  const domain = input.value.trim().toLowerCase();
  if (!domain) return;
  chrome.runtime.sendMessage({ type: "ADD_WHITELIST", domain }, () => {
    input.value = "";
    renderWhitelist();
  });
});

($("whitelistInput") as any).addEventListener("keypress", (e: any) => {
  if (e.key === "Enter") ($("whitelistAddBtn") as any).click();
});

// ── backup/restore ───────────────────────────────────────────────────────

function exportConfig() {
  const includePasswords = ($("exportWithPasswords") as any).checked;

  // Prepare NAS list
  let nasListExport = nasList.map((nas: any) => {
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
  ($("importFile") as any).click();
}

($("exportBtn") as any).addEventListener("click", exportConfig);
($("importBtn") as any).addEventListener("click", importConfig);

($("importFile") as any).addEventListener("change", async (e: any) => {
  const file = e.target.files[0];
  if (!file) return;

  const el = $("importStatus");

  try {
    el.textContent = "⏳ Importing...";
    (el as any).style.color = "#555";

    const text = await file.text();
    const config = JSON.parse(text);

    if (config.version !== 1) {
      throw new Error("Unsupported config version");
    }

    // Import NAS list (merge with existing, overwrite by name)
    if (config.nasList && Array.isArray(config.nasList)) {
      console.log("[NAS] Importing", config.nasList.length, "NAS devices");
      for (const importedNas of config.nasList) {
        // Check if NAS with same name already exists
        const existing = nasList.find((n: any) => n.name === importedNas.name);
        if (existing) {
          // Update existing NAS
          console.log("[NAS] Updating NAS:", existing.id);
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("UPDATE_NAS timeout")), 5000);
            try {
              chrome.runtime.sendMessage({
                type: "UPDATE_NAS",
                nasId: existing.id,
                updates: importedNas
              }, (resp: any) => {
                clearTimeout(timeout);
                console.log("[NAS] UPDATE_NAS response:", resp);
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else {
                  resolve();
                }
              });
            } catch (err) {
              clearTimeout(timeout);
              reject(err);
            }
          });
        } else {
          // Add new NAS
          console.log("[NAS] Adding new NAS:", importedNas.name);
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("ADD_NAS timeout")), 5000);
            try {
              chrome.runtime.sendMessage({
                type: "ADD_NAS",
                nas: importedNas
              }, (resp: any) => {
                clearTimeout(timeout);
                console.log("[NAS] ADD_NAS response:", resp);
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else {
                  resolve();
                }
              });
            } catch (err) {
              clearTimeout(timeout);
              reject(err);
            }
          });
        }
      }
    }

    // Import whitelist
    if (config.whitelist && Array.isArray(config.whitelist)) {
      console.log("[NAS] Importing", config.whitelist.length, "whitelist domains");
      for (const domain of config.whitelist) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("ADD_WHITELIST timeout")), 5000);
          try {
            chrome.runtime.sendMessage({
              type: "ADD_WHITELIST",
              domain: domain
            }, (resp: any) => {
              clearTimeout(timeout);
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve();
              }
            });
          } catch (err) {
            clearTimeout(timeout);
            reject(err);
          }
        });
      }
    }

    el.textContent = "✅ Config imported successfully!";
    (el as any).style.color = "#1d7c2d";

    setTimeout(() => {
      loadNasList();
      renderWhitelist();
      el.textContent = "";
    }, 1500);
  } catch (err: any) {
    console.error("[NAS] Import error:", err);
    el.textContent = `❌ Import failed: ${err.message}`;
    (el as any).style.color = "#c0392b";
  }

  // Reset input so same file can be selected again
  e.target.value = "";
});

// ── initialization ────────────────────────────────────────────────────────

console.log("[Options] Initializing options page");
loadNasList();
renderWhitelist();
