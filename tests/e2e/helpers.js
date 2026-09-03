/**
 * helpers.js — navigation, form-filling and assertion helpers for the E2E suite.
 *
 * Locators lean on the extension's existing, stable element IDs and CSS classes
 * (`#serviceForm`, `.device-card`, `.task[data-id]`, …). No `data-testid`
 * attributes were bolted onto the shipped HTML: the IDs are already unique and
 * are exercised by the unit suite too, so keeping the source untouched avoids a
 * second, redundant contract to maintain.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const { expect } = require("@playwright/test");
const { encryptCredentials } = require("../../src/crypto");

// ── options page ────────────────────────────────────────────────────────────

/** Switch the options page to one of: services | capture | whitelist | backup. */
async function openOptionsTab(page, tabName) {
  await page.click(`.nav-tab[data-tab="${tabName}"]`);
  await expect(page.locator(`#pane-${tabName}`)).toHaveClass(/active/);
}

/**
 * Add a service through the options-page form (the real user flow).
 * Leaving `port` undefined keeps whatever default the type dropdown applied.
 */
async function addServiceViaOptions(page, {
  type = "qbittorrent",
  name,
  host,
  port,
  https = false,
  username,
  password,
  defaultPath
} = {}) {
  await openOptionsTab(page, "services");
  await page.click("#addServiceBtn, #emptyAddBtn");
  await expect(page.locator("#serviceEditorCard")).toBeVisible();

  // Type first: changing it resets name/username/port defaults.
  await page.selectOption("#serviceType", type);
  if (https) await page.check("#serviceHttps");
  if (name !== undefined) await page.fill("#serviceName", name);
  if (host !== undefined) await page.fill("#serviceHost", host);
  if (port !== undefined) await page.fill("#servicePort", String(port));
  if (username !== undefined) await page.fill("#serviceUsername", username);
  if (password !== undefined) await page.fill("#servicePassword", password);
  if (defaultPath !== undefined) await page.fill("#serviceDefaultPath", defaultPath);

  await page.click("#saveServiceBtn");
}

/** All service cards currently rendered on the options page. */
function serviceCards(page) {
  return page.locator("#serviceListContainer .device-card");
}

function serviceCardByName(page, name) {
  return page.locator("#serviceListContainer .device-card")
    .filter({ has: page.locator(".device-title", { hasText: name }) });
}

/** Wait for the options-page toast and return its text. */
async function expectToast(page, matcher) {
  const toast = page.locator("#toast");
  await expect(toast).toHaveClass(/show/, { timeout: 10000 });
  if (matcher) await expect(toast).toContainText(matcher, { timeout: 10000 });
  return toast.textContent();
}

// ── popup ───────────────────────────────────────────────────────────────────

/** Open the popup's settings view via the gear icon. */
async function openPopupSettings(page) {
  await page.click("#settingsBtn");
  await expect(page.locator("#settingsView")).toHaveClass(/show/);
}

/** Return to the popup's main task view. */
async function openPopupMain(page) {
  const onMain = await page.locator("#mainView.show").count();
  if (!onMain) await page.click("#settingsBtn");
  await expect(page.locator("#mainView")).toHaveClass(/show/);
}

/**
 * Add a service through the popup's settings form.
 * Mirrors the signature requested in the brief: addService(popup, name, host, port).
 */
async function addService(popup, name, host, port, opts = {}) {
  const { type = "qbittorrent", username = "admin", password = "adminadmin" } = opts;

  await openPopupSettings(popup);
  await popup.click("#addNasBtn");
  await expect(popup.locator("#nasForm")).toHaveClass(/show/);

  await popup.selectOption("#nasType", type);
  await popup.fill("#nasName", name);
  await popup.fill("#nasHost", String(host));
  await popup.fill("#nasPort", String(port));
  if (await popup.locator("#usernameField:not(.d-none)").count()) {
    await popup.fill("#nasUsername", username);
  }
  if (await popup.locator("#passwordField:not(.d-none)").count()) {
    await popup.fill("#nasPassword", password);
  }
  await popup.locator("#nasForm button[type=submit], #nasForm .btn-primary").first().click();
  await expect(popup.locator("#nasFormStatus")).toContainText("saved", { timeout: 10000 });
}

/** Wait until the popup has rendered at least one task row. */
async function waitForTasks(page, timeout = 15000) {
  await expect(page.locator("#taskList .task").first()).toBeVisible({ timeout });
}

/** Click a status filter tab (downloading | seeding | paused | stalled | finished | error). */
async function selectFilter(page, filterName) {
  await page.click(`#tabBar [data-filter="${filterName}"]`);
  await expect(page.locator(`#tabBar [data-filter="${filterName}"]`)).toHaveClass(/active/);
}

/** Locator for a single task row by its title text. */
function taskByName(page, name) {
  return page.locator("#taskList .task").filter({ has: page.locator(".task-name", { hasText: name }) });
}

/**
 * Start recording every value #statusMsg takes.
 *
 * The popup's "Added N downloads!" message is written *before* the background
 * refresh that follows it clears the status line, so polling for the text is
 * inherently racy. Recording the transitions is not.
 */
async function recordStatusMessages(page) {
  await page.evaluate(() => {
    window.__statusLog = [];
    const el = document.getElementById("statusMsg");
    const push = () => {
      const t = (el.textContent || "").trim();
      if (t && window.__statusLog[window.__statusLog.length - 1] !== t) window.__statusLog.push(t);
    };
    push();
    new MutationObserver(push).observe(el, { childList: true, characterData: true, subtree: true });
  });
  return {
    /** Every non-empty status message seen so far, in order. */
    all: () => page.evaluate(() => window.__statusLog.slice())
  };
}

/** Tick the checkbox on the Nth visible task row. */
async function selectTask(page, index = 0) {
  await page.locator("#taskList .task .task-checkbox").nth(index).check();
}

// ── content-script test page ────────────────────────────────────────────────

/**
 * Navigate to the stub's magnet/torrent fixture page and wait for the content
 * script to finish decorating links.
 */
async function mockTorrentSite(context, stub, { expectButtons = true } = {}) {
  const page = await context.newPage();
  await page.goto(stub.testPageUrl);
  await page.waitForLoadState("domcontentloaded");
  if (expectButtons) {
    await page.waitForSelector('button[data-syno-injected="btn"]', { timeout: 15000 });
  }
  return page;
}

/** All injected "send to service" buttons on a page. */
function injectedButtons(page) {
  return page.locator('button[data-syno-injected="btn"]');
}

/** The injected button immediately following the anchor with the given id. */
function injectedButtonFor(page, anchorId) {
  return page.locator(`#${anchorId} + button[data-syno-injected="btn"]`);
}

// ── backup files ────────────────────────────────────────────────────────────

// ── .torrent fixtures ───────────────────────────────────────────────────────

/** Minimal bencode encoder (strings, Buffers, ints, lists, dicts). */
function bencode(value) {
  if (Buffer.isBuffer(value)) {
    return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  }
  if (typeof value === "string") {
    const b = Buffer.from(value, "utf8");
    return Buffer.concat([Buffer.from(`${b.length}:`), b]);
  }
  if (typeof value === "number") {
    return Buffer.from(`i${Math.trunc(value)}e`);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([Buffer.from("l"), ...value.map(bencode), Buffer.from("e")]);
  }
  const keys = Object.keys(value).sort();
  return Buffer.concat([
    Buffer.from("d"),
    ...keys.map(k => Buffer.concat([bencode(k), bencode(value[k])])),
    Buffer.from("e")
  ]);
}

/**
 * Write a structurally valid single-file .torrent to a temp path so the
 * background's bencode parser and SHA-1 info-hash step get real input.
 */
function writeTorrentFile(name = "e2e-fixture.bin") {
  const torrent = {
    announce: "http://tracker.example/announce",
    "creation date": 1700000000,
    info: {
      length: 16384,
      name,
      "piece length": 16384,
      pieces: Buffer.alloc(20, 0x2a)
    }
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-nexus-torrent-"));
  const file = path.join(dir, `${name}.torrent`);
  fs.writeFileSync(file, bencode(torrent));
  return { path: file, name, fileName: `${name}.torrent` };
}

/** Write a backup JSON file to a temp dir and return its path. */
function writeBackupFile(name, data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-nexus-backup-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data, null, 2), "utf8");
  return file;
}

/** Build an unencrypted backup payload matching what the extension exports. */
function makeBackup({ services = [], whitelist = [], whitelistMode = "all", version = "1.1.9" } = {}) {
  return {
    version,
    exportedAt: new Date().toISOString(),
    services: services.map(s => ({ ...s, password: "", apiToken: "" })),
    whitelist,
    whitelistMode
  };
}

/**
 * Build an encrypted backup using the extension's own crypto module, so the
 * fixture and the code under test agree on the envelope format.
 */
async function makeEncryptedBackup({ services = [], whitelist = [], whitelistMode = "all", password }) {
  const backup = makeBackup({ services, whitelist, whitelistMode });
  const credsMap = {};
  services.forEach(s => {
    credsMap[s.id] = { password: s.password || "", apiToken: s.apiToken || "" };
  });
  backup.encryptedCredentials = await encryptCredentials(credsMap, password);
  return backup;
}

// ── service-worker introspection ────────────────────────────────────────────

/**
 * Record every chrome.contextMenus.create() call made while `fn` runs inside
 * the background service worker, then restore the original API.
 */
async function captureContextMenuCreates(serviceWorker, fnBodyName) {
  return serviceWorker.evaluate(async (name) => {
    const created = [];
    const origCreate = chrome.contextMenus.create;
    const origRemove = chrome.contextMenus.remove;
    chrome.contextMenus.create = function (props, cb) {
      created.push({ id: props.id, title: props.title, parentId: props.parentId, contexts: props.contexts });
      if (typeof cb === "function") setTimeout(cb, 0);
      return props.id;
    };
    chrome.contextMenus.remove = function (id, cb) {
      if (typeof cb === "function") { setTimeout(cb, 0); return; }
      return Promise.resolve();
    };
    try {
      await globalThis[name]();
    } finally {
      chrome.contextMenus.create = origCreate;
      chrome.contextMenus.remove = origRemove;
    }
    return created;
  }, fnBodyName);
}

module.exports = {
  // options
  openOptionsTab,
  addServiceViaOptions,
  serviceCards,
  serviceCardByName,
  expectToast,
  // popup
  openPopupSettings,
  openPopupMain,
  addService,
  waitForTasks,
  selectFilter,
  taskByName,
  selectTask,
  recordStatusMessages,
  // content script
  mockTorrentSite,
  injectedButtons,
  injectedButtonFor,
  // torrent fixtures
  bencode,
  writeTorrentFile,
  // backups
  writeBackupFile,
  makeBackup,
  makeEncryptedBackup,
  // service worker
  captureContextMenuCreates
};
