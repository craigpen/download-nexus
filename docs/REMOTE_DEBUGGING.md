# Browser Remote Debugging & CDP Automation Guide

This guide explains how to use the Chrome DevTools Protocol (CDP) debugging port to inspect, test, and retrieve logs from the Download Nexus extension directly—eliminating the need to manually copy and paste console logs, errors, or storage state into AI agent sessions (such as Claude Code).

---

## 1. Overview & Architecture

When running extension tests or interactive development:
1. An isolated Chromium/Edge test browser is launched with `--remote-debugging-port=9222` and `--remote-allow-origins=*`.
2. The browser automatically loads the unpacked extension (`dist/chrome-mv3`).
3. An isolated user data directory (`%LOCALAPPDATA%\.download-nexus-test-profile`) is used so **your daily personal browser never needs to be closed**.
4. The CDP bridge (`scripts/inspect-browser.js`) connects to `http://127.0.0.1:9222` over WebSockets to inspect service worker state, query storage, stream console messages, and evaluate code.

```
┌───────────────────────────┐         HTTP/CDP (JSON)         ┌────────────────────────────────┐
│                           │  ─────────────────────────────► │                                │
│   Claude Code / Agent /   │                                 │   Chromium / Edge Instance     │
│   Developer Terminal      │         WebSocket (CDP)         │   (Port 9222, Isolated)        │
│                           │  ─────────────────────────────► │   • Service Worker             │
└───────────────────────────┘                                 │   • Extension Storage & Logs   │
                                                              └────────────────────────────────┘
```

---

## 2. Starting the Test Browser

You can start the test browser in any of the following ways:

### Method A: Double-Click the Batch File (Fastest)
Double-click `launch-test-browser.bat` in the project root.

### Method B: Via NPM Script
```bash
npm run dev:browser
```

### Method C: Custom Options via CLI
```bash
# Launch with custom debug port
node scripts/launch-browser.js --port 9223

# Specify browser (edge, chrome, brave)
node scripts/launch-browser.js --browser chrome

# Specify initial start URL
node scripts/launch-browser.js --url "https://webtorrent.io/free-torrents"
```

---

## 3. CDP Inspection Commands

Once the browser is running, use the following commands from any terminal or agent session:

### View Active Browser Targets
Lists all open pages, popup views, and the background service worker target:
```bash
npm run debug:inspect
# or
node scripts/inspect-browser.js --targets
```

### Fetch Extension Diagnostics & Info
```bash
npm run debug:logs
# or
node scripts/inspect-browser.js --logs
```

### Dump Extension Storage (`chrome.storage.local` & `chrome.storage.sync`)
Inspects saved download client configurations (Synology, Deluge, Transmission, qBittorrent, Aria2), options, and intercept preferences:
```bash
npm run debug:storage
# or
node scripts/inspect-browser.js --storage
```

### Stream Live Console Logs & Exceptions
Continuously streams real-time `console.log`, `console.warn`, `console.error`, network intercepts, and uncaught exceptions directly to your terminal:
```bash
npm run debug:listen
# or
node scripts/inspect-browser.js --listen
```

### Hot-Reload the Extension
Re-reads files from `dist/chrome-mv3` and triggers `chrome.runtime.reload()` over CDP without needing to restart the browser or open `chrome://extensions`:
```bash
npm run debug:reload
# or
node scripts/inspect-browser.js --reload
```

### Evaluate JavaScript in Background Service Worker
Run arbitrary JavaScript inside the extension's execution context:
```bash
# Check manifest details
node scripts/inspect-browser.js --eval "chrome.runtime.getManifest()"

# Check configured download services in memory
node scripts/inspect-browser.js --eval "new Promise(r => chrome.storage.sync.get('services', r))"

# Check active tabs
node scripts/inspect-browser.js --eval "chrome.tabs.query({}, tabs => console.log(tabs.map(t => t.url)))"
```

---

## 4. Instructing Claude Code to Leverage the Debug Port

When working with Claude Code, tell it to query the running browser directly rather than asking you for logs.

### Recommended Prompt for Claude Code:
> *"The test browser is running on debug port 9222. When testing changes or diagnosing issues, do NOT ask me to copy-paste logs or storage. Instead, run `npm run debug:logs`, `npm run debug:storage`, or `node scripts/inspect-browser.js --eval '<expr>'` to inspect state directly, and run `npm run debug:reload` after rebuilding."*

### Typical Claude Code Automated Flow:
1. Claude edits code in `src/`.
2. Claude builds: `npm run build:chrome`.
3. Claude reloads the extension: `npm run debug:reload`.
4. Claude verifies storage / logs: `npm run debug:storage` or `npm run debug:logs`.

---

## 5. Troubleshooting

| Issue | Cause | Resolution |
|---|---|---|
| `Cannot connect to browser on port 9222` | Browser is not running or debug port is occupied. | Run `launch-test-browser.bat` or check if port 9222 is used by another app. Pass `--port 9223` if needed. |
| Browser opens personal profile instead of test profile | Browser shortcut clicked instead of test launcher. | Always launch via `launch-test-browser.bat` or `npm run dev:browser`. |
| Changes in `src/` not showing up in browser | Extension has not been rebuilt or reloaded. | Run `npm run build:chrome` followed by `npm run debug:reload`. |
| `ws` module not found | Missing dev dependencies. | Run `npm install` to ensure `ws` is installed. |
