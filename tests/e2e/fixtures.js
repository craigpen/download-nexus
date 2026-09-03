/**
 * fixtures.js — Playwright fixtures for the Download Nexus extension.
 *
 * Provides:
 *   context      — a persistent Chromium context with the unpacked extension loaded
 *   extensionId  — the runtime id of the loaded extension
 *   serviceWorker— the MV3 background service worker (for white-box assertions)
 *   stub         — an isolated HTTP stub standing in for a download service
 *   popupPage    — popup.html opened as a tab, ready to drive
 *   optionsPage  — options.html opened as a tab, ready to drive
 *   ext          — a small API for seeding/reading extension state
 *
 * NOTE ON LANGUAGE: this repo is vanilla CommonJS JavaScript with no TypeScript
 * toolchain, so the helpers are `.js` rather than `.ts`. Playwright loads them
 * identically; JSDoc gives editors the same autocomplete.
 *
 * NOTE ON BROWSERS: Chromium-family only. Playwright cannot load a WebExtension
 * into Firefox, so the Firefox build is verified structurally instead
 * (see 07-cross-browser.spec.js).
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const { test: base, chromium, expect } = require("@playwright/test");
const { startStubServer } = require("./stub-server");

const REPO_ROOT = path.join(__dirname, "..", "..");
const EXTENSION_PATH = path.join(REPO_ROOT, "dist", "chrome-mv3");

/**
 * The extension uses window.confirm() for destructive actions. Playwright blocks
 * on unhandled dialogs, so every page we drive gets a default "accept" handler
 * plus a one-shot queue tests can push onto:
 *
 *   page.onNextDialog(d => { expect(d.message()).toContain("…"); d.dismiss(); });
 */
function attachDialogHandling(page) {
  const queue = [];
  page.on("dialog", async dialog => {
    const next = queue.shift();
    try {
      if (next) await next(dialog);
      else await dialog.accept();
    } catch {
      /* dialog already resolved */
    }
  });
  page.onNextDialog = fn => queue.push(fn);
  return page;
}

function assertExtensionBuilt() {
  const manifest = path.join(EXTENSION_PATH, "manifest.json");
  if (!fs.existsSync(manifest)) {
    throw new Error(
      `Extension build not found at ${EXTENSION_PATH}.\n` +
      `Run "npm run build:chrome" (or "npm run package") before the E2E suite.`
    );
  }
}

const test = base.extend({
  /**
   * Persistent context with the unpacked extension loaded. Each test gets a
   * throwaway user-data-dir so chrome.storage never leaks between tests.
   */
  context: async ({ channel, headless }, use, testInfo) => {
    assertExtensionBuilt();

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-nexus-e2e-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      // `chromium` / `chrome` / `msedge` all run the *full* browser, which is
      // required for extension support (the headless shell cannot load them).
      channel: channel || "chromium",
      headless: headless !== false,
      viewport: { width: 1280, height: 900 },
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        "--no-first-run",
        "--no-default-browser-check",
        // DisableLoadExtensionCommandLineSwitch: stock Chrome 137+ ignores
        // --load-extension unless this feature is turned off.
        "--disable-features=DisableLoadExtensionCommandLineSwitch,DialMediaRouteProvider,OptimizationHints"
      ]
    });

    await use(context);

    await context.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* Windows sometimes holds a lock briefly; the temp dir is disposable. */
    }
  },

  /** The MV3 background service worker. */
  serviceWorker: async ({ context, channel }, use, testInfo) => {
    let [sw] = context.serviceWorkers();
    if (!sw) {
      try {
        sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
      } catch (err) {
        // Google removed the --load-extension / --disable-extensions-except
        // command-line switches from stable Chrome (137+), so a stock `chrome`
        // channel can no longer side-load an unpacked extension at all. Nothing
        // is testable there, and it is an upstream policy change rather than a
        // regression in this repo — so skip loudly instead of failing.
        testInfo.skip(
          channel === "chrome" || channel === "msedge",
          `${channel} refused to load the unpacked extension: recent stable Chrome ` +
          "builds dropped the --load-extension switch. Use the 'chromium' project " +
          "for extension coverage."
        );
        throw err;
      }
    }
    await use(sw);
  },

  /** The extension's runtime id, e.g. "abcdefgh...". */
  extensionId: async ({ serviceWorker }, use) => {
    // chrome-extension://<id>/background.js
    const id = new URL(serviceWorker.url()).host;
    await use(id);
  },

  /** Isolated HTTP stub standing in for a download service. */
  stub: async ({}, use) => {
    const stub = await startStubServer();
    await use(stub);
    await stub.stop();
  },

  /**
   * Extension-state helper. Talks to the background worker through the same
   * message API the UI uses, so seeding exercises the real code path.
   */
  ext: async ({ context, extensionId, stub }, use) => {
    // A dedicated extension page is the cheapest place to call chrome.* APIs from.
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}/options.html`);
    await driver.waitForLoadState("domcontentloaded");

    const sendMessage = (msg) => driver.evaluate(
      (m) => new Promise(resolve => chrome.runtime.sendMessage(m, resolve)),
      msg
    );

    const api = {
      extensionId,
      popupUrl: `chrome-extension://${extensionId}/popup.html`,
      optionsUrl: `chrome-extension://${extensionId}/options.html`,
      sendMessage,

      /** Build a service config that points at the local stub. */
      makeService(overrides = {}) {
        return {
          id: overrides.id || `svc-${Math.random().toString(36).slice(2, 9)}`,
          type: "qbittorrent",
          name: "Stub qBittorrent",
          host: stub.host,
          port: stub.port,
          https: false,
          username: "admin",
          password: "adminadmin",
          defaultPath: "",
          destination: "",
          ...overrides
        };
      },

      /** Replace the whole service list. */
      async setServices(list) {
        const resp = await sendMessage({ type: "SAVE_NAS_LIST", list });
        if (!resp || resp.ok === false) throw new Error(`SAVE_NAS_LIST failed: ${resp && resp.error}`);
        return list;
      },

      /** Seed exactly one stub-backed service and return it. */
      async seedService(overrides = {}) {
        const svc = api.makeService(overrides);
        await api.setServices([svc]);
        return svc;
      },

      /** Seed N stub-backed services with distinct names. */
      async seedServices(n, overrides = {}) {
        const list = Array.from({ length: n }, (_, i) => api.makeService({
          id: `svc-${i + 1}`,
          name: `Service ${i + 1}`,
          ...overrides
        }));
        await api.setServices(list);
        return list;
      },

      async getServices() {
        const resp = await sendMessage({ type: "GET_NAS_LIST" });
        return (resp && resp.list) || [];
      },

      async setWhitelist(list) { return sendMessage({ type: "SET_WHITELIST", list }); },
      async getWhitelist() {
        const resp = await sendMessage({ type: "GET_WHITELIST" });
        return (resp && resp.list) || [];
      },
      async setWhitelistMode(mode) { return sendMessage({ type: "SET_WHITELIST_MODE", mode }); },
      async getWhitelistMode() {
        const resp = await sendMessage({ type: "GET_WHITELIST_MODE" });
        return resp && resp.mode;
      },

      /** Read raw chrome.storage. area = "local" | "sync". */
      async readStorage(area, keys = null) {
        return driver.evaluate(
          ([a, k]) => new Promise(resolve => chrome.storage[a].get(k, resolve)),
          [area, keys]
        );
      },
      async writeStorage(area, items) {
        return driver.evaluate(
          ([a, i]) => new Promise(resolve => chrome.storage[a].set(i, resolve)),
          [area, items]
        );
      },

      /** Toggle which link protocols the content script decorates. */
      async setEnabledProtocols(protocols) {
        return api.writeStorage("local", { enabledProtocols: protocols });
      },

      /** The scratch extension page these helpers run on. */
      driver
    };

    await use(api);
    await driver.close().catch(() => {});
  },

  /** popup.html opened as a regular tab, with its first render settled. */
  popupPage: async ({ context, ext }, use) => {
    const page = attachDialogHandling(await context.newPage());
    await page.goto(ext.popupUrl);
    await page.waitForLoadState("domcontentloaded");
    await use(page);
    await page.close().catch(() => {});
  },

  /** options.html opened as a regular tab. */
  optionsPage: async ({ context, ext }, use) => {
    const page = attachDialogHandling(await context.newPage());
    await page.goto(ext.optionsUrl);
    await page.waitForLoadState("domcontentloaded");
    await use(page);
    await page.close().catch(() => {});
  }
});

module.exports = {
  test,
  expect,
  attachDialogHandling,
  EXTENSION_PATH,
  REPO_ROOT
};
