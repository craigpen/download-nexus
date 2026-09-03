# End-to-End Testing

Playwright drives the **built** extension in a real Chromium browser and exercises
the flows a user actually performs: configuring services, managing tasks in the
popup, decorating links on a page, and backing up / restoring configuration.

This complements the Jest suite (see [TESTING.md](TESTING.md)), which covers
adapters, parsers and DOM logic in isolation.

```
88 tests · 8 spec files · ~1 minute · no Docker, no real NAS required
```

---

## Quick start

```bash
npm run test:e2e          # builds Chrome + Firefox bundles, then runs everything
npm run test:e2e:chrome   # full suite, bundled Chromium only (fastest loop)
npm run test:e2e:headed   # same, with a visible browser window
npm run test:e2e:ui       # Playwright's interactive UI mode
npm run test:e2e:report   # open the HTML report from the last run
```

### Testing Against Your Existing Chrome Installation

If you have Chrome already running with the extension loaded, you can test against it directly:

```bash
# Terminal 1: Start Chrome with debugging port
google-chrome --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.config/google-chrome-test" &

# Terminal 2: Run tests against the running browser
npm run test:e2e:connect          # run full suite
npm run test:e2e:connect:headed   # same, with visible browser
```

Or on Windows:
```bash
# Terminal 1
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir="%TEMP%\chrome-test"

# Terminal 2
npm run test:e2e:connect
```

This bypasses the `--load-extension` limitation (Chrome 137+ removed that flag) and tests against your actual Chrome installation with your real extension loaded.

**First-time setup (once per machine):**

```bash
npm install
npx playwright install chromium
```

The `pretest:e2e*` hooks run the build for you, so `dist/chrome-mv3` is always
current. If you run `npx playwright test` directly, build first:

```bash
npm run build:chrome && npx playwright test
```

---

## What is covered

| Spec | Area | Tests |
|---|---|---|
| `01-extension-loading.spec.js` | Manifest, service worker, popup/options boot, DOM-id contract | 5 |
| `02-settings-management.spec.js` | Service CRUD, form validation, type defaults, connection tests | 17 |
| `03-popup-ui.spec.js` | Task list, status filters, per-task and bulk actions, error state | 15 |
| `04-options-page.spec.js` | Options navigation, capture settings, whitelist, Add Downloads | 14 |
| `05-backup-restore.spec.js` | Plain and encrypted export, restore, validation, wrong password | 9 |
| `06-content-script.spec.js` | Link decoration, service picker, context-menu construction | 13 |
| `07-cross-browser.spec.js` | Smoke suite per browser + Firefox artifact validation | 4 |
| `08-data-persistence.spec.js` | Storage round-trips, credential isolation, task cache | 6 |

### The `#tabBar` / DOM-id contract test

`01-extension-loading.spec.js` asserts that every element id `popup.js` and
`options.js` reach for actually exists in the HTML. Those scripts use
`document.getElementById(...)?.` liberally, so a renamed id fails silently at
runtime — this test turns that into a build failure instead.

---

## Architecture

### Loading the extension

Playwright can only load an unpacked extension through a **persistent context**:

```js
chromium.launchPersistentContext(userDataDir, {
  channel: "chromium",                       // full browser, not the headless shell
  args: [`--load-extension=${EXTENSION_PATH}`, ...]
});
```

Each test gets a fresh temporary `userDataDir`, so `chrome.storage` never leaks
between tests and the suite is safe to run in parallel (3 workers by default).

`popup.html` and `options.html` are opened as ordinary tabs. Extension pages get
the full `chrome.*` API there, so this exercises the same code the real popup
runs.

### Mocking download services

Playwright's request interception is unreliable against an MV3 service worker,
which is where all of the extension's `fetch()` calls originate. So instead of
mocking the network, `tests/e2e/stub-server.js` boots a **real HTTP server on a
random loopback port** and the seeded service config points at it.

The stub speaks enough of the qBittorrent v2 Web API, the Synology
DownloadStation WebAPI, the Transmission RPC and the JDownloader RemoteAPI for
the adapters to work against it, and it also serves the magnet/torrent fixture
page used by the content-script specs.

It exposes controls to tests:

```js
stub.setTorrents([...]);          // change what the service reports
stub.setFailMode("auth");         // "none" | "auth" | "server" | "timeout" | "garbage"
stub.requestsTo("/torrents/add"); // assert on what the extension actually sent
```

Assertions are made on the requests the stub *received*, so a test proves the
extension really dispatched the download rather than just updating its own UI.

### Fixtures (`tests/e2e/fixtures.js`)

| Fixture | Provides |
|---|---|
| `context` | Persistent context with the extension loaded, fresh profile |
| `serviceWorker` | The MV3 background worker, for white-box assertions |
| `extensionId` | The runtime id |
| `stub` | Isolated stub download service |
| `ext` | Seed/read extension state (`seedService`, `setWhitelist`, `readStorage`, …) |
| `popupPage` / `optionsPage` | The extension pages, loaded and ready |

`ext` seeds state through the same `chrome.runtime.sendMessage` API the UI uses,
so setup exercises the real storage code path rather than writing to
`chrome.storage` behind the app's back.

Pages get a dialog handler (the extension uses `window.confirm` for destructive
actions). Accept is the default; a test can override the next one:

```js
optionsPage.onNextDialog(d => {
  expect(d.message()).toContain("Service 1");
  return d.accept();
});
```

### Helpers (`tests/e2e/helpers.js`)

`addService`, `addServiceViaOptions`, `openOptionsTab`, `selectFilter`,
`taskByName`, `mockTorrentSite`, `writeTorrentFile` (emits a genuinely bencoded
`.torrent`), `makeEncryptedBackup` (uses the extension's own `src/crypto.js`, so
fixture and implementation cannot drift), and more.

Locators use the extension's **existing element ids and CSS classes** rather than
added `data-testid` attributes. The ids are already unique, already exercised by
the Jest suite, and are covered by the DOM-contract test above — a second
parallel selector vocabulary would just be another thing to keep in sync.

---

## Browser support

| Project | Browser | Scope | Status |
|---|---|---|---|
| `chromium` | Playwright's bundled Chromium | **Full suite** | ✅ |
| `edge` | Microsoft Edge (`msedge`) | Cross-browser smoke | ✅ |
| `chrome` | Stable Google Chrome | Cross-browser smoke | ⚠️ auto-skips (see below) |
| — | Firefox | Artifact validation only | ⚠️ not launchable |

**Stable Chrome (137+) removed the `--load-extension` and
`--disable-extensions-except` command-line switches.** There is no supported way
to side-load an unpacked extension into it any more, so those three tests skip
themselves with an explanatory message instead of failing. Edge still honours the
switches, and bundled Chromium — the same engine Chrome ships — runs the whole
suite, so Chromium-family coverage is intact.

**Playwright cannot install a WebExtension into Firefox at all.** Rather than
pretend otherwise, `07-cross-browser.spec.js` validates the Firefox MV2 artifact
structurally: manifest downgraded to v2, `browser_action` instead of `action`,
`<all_urls>` moved into `permissions`, every file the manifest references present
in the bundle, and the version matching `package.json`. For real Firefox
behaviour, load `dist/firefox-mv3` manually via `about:debugging`.

---

## Known gaps encoded in the suite

`06-content-script.spec.js` contains one test marked `test.fail()`:

> **restricted routing mode is not yet honoured by the content script**

The routing-mode dropdowns in `options.html` and `popup.html` offer
`whitelist` / `blacklist`, but `content.js` only treats the literal value
`"restricted"` as "restrict injection" (`whitelistEnabled = resp?.mode === "restricted"`).
Choosing *Only Active on Whitelisted Domains* therefore has no effect — buttons
are still injected on every site.

`test.fail()` means the test **runs and is expected to fail**. When the mode
values are reconciled, Playwright will report the annotation as stale, which is
the signal to delete `test.fail()` and let the test guard the fixed behaviour.

---

## Debugging a failure

Screenshots and traces are captured automatically on failure:

```bash
npm run test:e2e:report                                    # HTML report
npx playwright show-trace test-results/<test-dir>/trace.zip # step-by-step trace
```

Useful flags:

```bash
npx playwright test --project=chromium -g "bulk delete"    # single test by name
npx playwright test --project=chromium --headed --debug    # step through it
npx playwright test tests/e2e/03-popup-ui.spec.js          # one spec file
```

Retries are set to **0** on purpose. A flaky extension test usually means a real
race in the extension, and retries would hide it.

To watch what the extension is sending, `console.log(stub.requests())` in the
test — every request the stub received, with method, path, headers and body.

---

## CI

The suite needs no Docker, no network and no real download service. A GitHub
Actions job looks like:

```yaml
- run: npm ci
- run: npx playwright install --with-deps chromium
- run: npm run test:e2e:chrome
- uses: actions/upload-artifact@v4
  if: failure()
  with:
    name: playwright-report
    path: playwright-report/
```

Use `test:e2e:chrome` (the `chromium` project) in CI: it runs the full suite and
avoids depending on stock Chrome or Edge being installed on the runner.

---

## Adding a test

```js
const { test, expect } = require("./fixtures");
const { waitForTasks } = require("./helpers");

test("my new behaviour", async ({ ext, popupPage, stub }) => {
  await ext.seedService({ id: "svc", name: "My Service" });
  await popupPage.reload();          // seed first, then load the UI
  await waitForTasks(popupPage);

  await popupPage.click("#someButton");

  // Assert on what actually left the extension, not just on the UI.
  await expect.poll(() => stub.requestsTo("/torrents/add").length).toBe(1);
});
```

Two rules that keep the suite honest:

1. **Seed before you load.** The popup and options pages read their state on
   `DOMContentLoaded`; seed via `ext.*` and then `reload()`.
2. **Assert on the stub, not only on the DOM.** A green UI that never sent the
   request is exactly the bug worth catching.
