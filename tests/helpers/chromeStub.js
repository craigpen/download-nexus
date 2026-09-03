/**
 * Minimal chrome.* API stub so extension entry points (background.js, options.js)
 * can be `require`d inside Jest's Node/jsdom environments.
 *
 * Unlike the inline mock classes used elsewhere in this suite, this helper exists
 * so tests can exercise the REAL production source instead of a copy of it.
 */

function noop() {}

function listenerHub() {
  const listeners = [];
  return {
    addListener: (fn) => listeners.push(fn),
    removeListener: (fn) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    hasListener: (fn) => listeners.includes(fn),
    // Test helper: invoke every registered listener
    _emit: (...args) => listeners.map((fn) => fn(...args)),
    _listeners: listeners
  };
}

/**
 * Build a fresh chrome stub. Storage is backed by real in-memory objects so
 * callback-style get/set round-trips behave like the real API.
 */
function createChromeStub(overrides = {}) {
  const localStore = {};
  const syncStore = {};

  const makeStorageArea = (store) => ({
    get(keys, cb) {
      let result = {};
      if (keys === null || keys === undefined) {
        result = { ...store };
      } else if (typeof keys === "string") {
        result = { [keys]: store[keys] };
      } else if (Array.isArray(keys)) {
        keys.forEach((k) => { result[k] = store[k]; });
      } else if (typeof keys === "object") {
        // Object form supplies defaults
        Object.keys(keys).forEach((k) => {
          result[k] = Object.prototype.hasOwnProperty.call(store, k) ? store[k] : keys[k];
        });
      }
      if (cb) cb(result);
      return Promise.resolve(result);
    },
    set(items, cb) {
      Object.assign(store, items);
      if (cb) cb();
      return Promise.resolve();
    },
    remove(keys, cb) {
      (Array.isArray(keys) ? keys : [keys]).forEach((k) => { delete store[k]; });
      if (cb) cb();
      return Promise.resolve();
    },
    clear(cb) {
      Object.keys(store).forEach((k) => { delete store[k]; });
      if (cb) cb();
      return Promise.resolve();
    },
    _store: store
  });

  const chrome = {
    runtime: {
      lastError: null,
      id: "test-extension-id",
      getManifest: () => ({ version: "1.1.9", name: "Download Nexus" }),
      getURL: (p) => `chrome-extension://test-extension-id/${p}`,
      sendMessage: (msg, cb) => { if (cb) cb({ ok: true }); },
      onMessage: listenerHub(),
      onInstalled: listenerHub(),
      onStartup: listenerHub()
    },
    storage: {
      local: makeStorageArea(localStore),
      sync: makeStorageArea(syncStore),
      onChanged: listenerHub()
    },
    contextMenus: {
      create: noop,
      update: noop,
      remove: (id, cb) => { if (cb) cb(); },
      removeAll: (cb) => { if (cb) cb(); },
      onClicked: listenerHub()
    },
    action: {
      setIcon: (d, cb) => { if (cb) cb(); },
      setBadgeText: (d, cb) => { if (cb) cb(); },
      setBadgeBackgroundColor: (d, cb) => { if (cb) cb(); },
      setTitle: (d, cb) => { if (cb) cb(); }
    },
    alarms: {
      create: noop,
      clear: (n, cb) => { if (cb) cb(true); },
      onAlarm: listenerHub()
    },
    tabs: {
      query: (q, cb) => { if (cb) cb([]); return Promise.resolve([]); },
      sendMessage: (id, msg, cb) => { if (cb) cb(); },
      create: (o, cb) => { if (cb) cb({ id: 1, ...o }); }
    },
    notifications: {
      create: (id, opts, cb) => { if (cb) cb(id); },
      clear: (id, cb) => { if (cb) cb(true); },
      onClicked: listenerHub()
    },
    downloads: {
      download: (o, cb) => { if (cb) cb(1); }
    },
    scripting: {
      executeScript: () => Promise.resolve([]),
      registerContentScripts: () => Promise.resolve(),
      getRegisteredContentScripts: () => Promise.resolve([]),
      unregisterContentScripts: () => Promise.resolve()
    },
    permissions: {
      contains: (p, cb) => { if (cb) cb(true); },
      request: (p, cb) => { if (cb) cb(true); }
    }
  };

  return Object.assign(chrome, overrides);
}

/** Install the stub on globalThis and return it. */
function installChromeStub(overrides = {}) {
  const stub = createChromeStub(overrides);
  globalThis.chrome = stub;
  return stub;
}

module.exports = { createChromeStub, installChromeStub, listenerHub };
