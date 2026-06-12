# NAS Download Helper - Development Memory

**Last Updated:** 2026-06-12
**Project:** Browser extension for managing multiple NAS devices (Synology, etc.)

---

## Project Overview

**NAS Download Helper** is a Manifest V3 browser extension for Chrome/Edge that:
- **Multi-NAS support:** Configure and manage multiple NAS devices from one extension
- Detects magnet links and torrent files on web pages
- Injects "⬇ NAS" buttons to send them to configured NAS devices
- Provides a popup UI for task management with NAS tabs (view, pause, resume, delete)
- Maintains per-NAS persistent authentication sessions
- Supports global content script whitelisting for performance
- **Auto-theme:** Follows browser/OS light/dark theme preference
- **Export/Import config** with optional password protection

---

## Current Status (Session 4 - Complete)

### ✅ Completed Features (Session 4)
- **Multi-NAS architecture** - Full backend support for multiple NAS devices with per-NAS sessions
- **NAS Management UI** - Add/Edit/Delete NAS devices in options page with export/import
- **Popup tabs** - Tab per NAS device showing connection status and task list
- **Inline buttons** - Magnet/torrent buttons injected inline (no floating/overlapping)
- **NAS selector popup** - Click button → menu to select which NAS to send to
- **Whitelist filtering** - Global whitelist enforced (buttons only on whitelisted domains)
- **Export/Import config** - Backup settings with optional password protection
- **Task sorting** - DL tab by % complete (ascending), others by date added (newest first)
- **Connection status per NAS** - Shown in tabs or header depending on device count
- **"Open Web" button** - Opens current NAS web interface (host/port/https aware)
- **Light/Dark theme** - Auto-detects browser/OS theme preference via CSS media queries
- **Whitelist dropdown** - Quick add/remove current domain from popup header
- **Core features** - Magnet/torrent detection, task management, auth sessions, timeouts
- **Security** - CSRF protection, credentials validation, URL validation, error handling

### 📋 Next Steps (Future Sessions)
1. **Search feature** — Add magnet/torrent search tab in popup (1337x.to or API integration)
2. **Feature recommendations #7-14**:
   - #7: Task sorting (done - by % complete or date added)
   - #8: Pause/Resume all buttons
   - #9: Badge counter (download count in extension icon)
   - #10: Export logs as JSON
   - #11: Keyboard shortcuts
   - #12: Theme toggle (manual light/dark, currently auto)
   - #13: DOM error boundary in content.js
   - #14: Migration guide for version upgrades

---

## Architecture Overview

### Files Structure
```
manifest.json          - Extension config (V3)
background.js         - Service worker (API calls, session management)
popup.js              - Popup UI controller
popup.html            - Popup UI
options.js            - Settings controller
options.html          - Settings UI
content.js            - Content script (link detection)
icons/                - Extension icons
README.md             - User documentation
MEMORY.md             - This file
```

### Key Design Patterns

**Multi-NAS Storage:**
- `nasList`: Array in chrome.storage.sync, each with id, type, name, host, port, https, username, password, destination
- `getNasList()`, `getNasById(nasId)`, `addNas()`, `updateNas()`, `deleteNas()`
- Backward compatible: old single-NAS config auto-migrates to nasList format on first load

**Per-NAS Session Management:**
- `sids`: Object in chrome.storage.local keyed by NAS id: { "synology-main": sid, ... }
- `getSid(nasId, s, force=false)`: Returns cached SID for NAS, logs in fresh if needed
- `storeSid(nasId, sid)`: Caches SID per NAS id
- `removeSid(nasId)`: Clears session for specific NAS
- Automatic re-auth on error codes 105/106/119 (auth errors)

**Timeout Protection:**
- `synoFetch()`: All API calls use AbortController with 20s timeout
- Graceful error handling if NAS unresponsive

**URL Validation (Defense-in-Depth):**
- `isValidMagnetURI()`: Checks magnet:? prefix + has xt/dn/tr parameter
- `isValidTorrentURL()`: Checks http(s) + .torrent extension
- Validation in both content.js (prevent send) and background.js (secondary check)

**Whitelist Management:**
- Stored in `chrome.storage.sync` as array of domains
- `getWhitelist()`, `addToWhitelist()`, `removeFromWhitelist()`
- UI in options page with add/remove buttons
- **TODO**: Actual filtering not yet implemented in content script

**Message Routing:**
- Service worker receives messages from popup/options/content
- Returns responses via `sendResponse()` callback
- **Important**: Listener function should NOT be `async` (breaks Chrome's message channel)

---

## Technical Deep Dive

### background.js (Service Worker)
**Core Functions:**
- `synoFetch(label, url, options, timeoutMs=20000)`: Fetch wrapper with timeout via AbortController
- `synoLogin(s)`: SYNO.API.Auth login, returns SID
- `getSid(s, force=false)`: Session token getter with caching/refresh logic
- `synoCall(s, apiFn)`: Wrapper that handles auth errors and retries with fresh login
- `listTasks(s, sid)`: SYNO.DownloadStation.Task list API
- `taskAction(s, sid, action, ids)`: Pause/resume/delete tasks
- `synoAddMagnet(s, sid, magnetUrl)`: Create task from magnet (with secondary URL validation)
- `synoAddTorrent(s, sid, torrentFile)`: Create task from torrent file (multipart FormData)
- `testConnection(s)`: Test credentials and return DS version
- Message handlers for: SEND_MAGNET, SEND_TORRENT, TEST_CONNECTION, LIST_TASKS, TASK_ACTION, GET_WHITELIST, ADD_WHITELIST, REMOVE_WHITELIST, CHECK_CONNECTION, GET_LOG

**Debug Logging:**
- Circular buffer `debugLog[]` with max 200 entries
- `dbg(level, msg, detail)` function logs to both console and buffer
- Accessible via GET_LOG message handler

### popup.js (Popup Controller)
**Key Functions:**
- `checkConnection()`: Silently validates NAS, sets status indicator (Connected/Offline)
- `refresh()`: Fetches task list, renders tasks, shows error container if connection fails
- `getVisibleTasks()`: Returns filtered tasks based on current tab filter
- `updateFooterButtons()`: Shows pause/resume button counts, disables if none available
- `showError(title, detail)`: Shows error container with retry button
- `renderTasks()`: Efficient DOM rendering (updates in-place instead of recreating)
- Tab click handlers (DL/Seed/Paused/Done/Error/All): Set filter and re-render
- Initialization: `checkConnection()` → `refresh()` → `setInterval(refresh, 5000)`

**Message Types Sent:**
- CHECK_CONNECTION: Validate NAS on popup load
- LIST_TASKS: Fetch tasks
- TASK_ACTION: Pause/resume/delete with action + ids

### options.js (Settings Controller)
**Key Functions:**
- Load/save settings from chrome.storage.sync
- Password validation on submit (warns if empty)
- `updateTestButtonState()`: Enable/disable test button based on password
- Real-time button state updates (input/change listeners)
- `testConnection()`: Send TEST_CONNECTION message, handle response
- Whitelist rendering and CRUD operations
- Debug log display and refresh

**Button State Logic:**
- Test Connection button disabled when password is empty
- Visual feedback: opacity 0.6, cursor: not-allowed, title tooltip

### content.js (Content Script)
**Current Functions:**
- `isValidMagnetURI(url)`: Magnet format validation
- `isValidTorrentURL(url)`: Torrent URL validation
- `sendUrl(btn, url, type)`: Validates, shows confirmation dialog, sends to background
- Confirmation dialog shows decoded filename from magnet `dn=` parameter
- `makeFloatingButton()`: Creates positioned "⬇ NAS" button
- `processLink(a)`: Detects magnet/torrent in anchor href
- Text node processing: Detects plain text URLs (e.g., pastebin)

**TODO:**
- Implement whitelist filtering (only inject buttons on whitelisted domains)
- Currently scans ALL sites regardless of whitelist setting

### popup.html
- Connection status indicator (● Connected/● Offline)
- Tab bar: DL (default), Seed, Paused, Done, Error, All (at end)
- Error container (hidden by default)
- Task list rendering
- Pause/Resume footer buttons with counts

### options.html
- Host/Port/HTTPS/Username/Password/Destination fields
- Test Connection button (disabled when no password)
- Whitelist section: list display, add input, add button
- Debug toggle button
- Debug log display with Refresh/Clear buttons

---

## Security Improvements (Completed)

### #1: Whitelist Management ✅
- **Why:** Content script runs on all URLs; expensive and privacy-concerning
- **Solution:** Added whitelist UI in options page with add/remove buttons
- **Status:** Fully functional; needs filtering implementation in content.js
- **TODO:** Make content.js actually use whitelist (currently stored but ignored)

### #2: CSRF Protection ✅
- **Why:** Malformed or malicious URLs could be sent to NAS API
- **Solution:** 
  - Magnet URI validation (must have `magnet:?` prefix + xt/dn/tr parameter)
  - Torrent URL validation (must be http(s) + .torrent)
  - Confirmation dialog showing decoded filename
  - Defense-in-depth: validation in both content.js and background.js
- **Status:** Fully implemented and tested

### #3: API Timeouts ✅
- **Why:** NAS could be unresponsive, causing UI to hang indefinitely
- **Solution:** AbortController with 20s timeout on all `synoFetch()` calls
- **Status:** Fully implemented; handles timeout errors gracefully

### #4: Connection Validation ✅
- **Why:** No feedback if NAS offline when popup opens
- **Solution:** `checkConnection()` on popup load, status indicator (● Connected/● Offline)
- **Status:** Fully implemented; auto-runs on popup open

### #5: Credentials Validation ✅
- **Why:** Users could save settings without password, breaking all operations
- **Solution:**
  - Password required on settings submit (warns "⚠️ Password is required")
  - Test Connection button disabled when password empty
  - Real-time button state updates
- **Status:** Fully implemented; validates on every keystroke

### #6: Error Handling ✅
- **Why:** Connection failures resulted in infinite spinner
- **Solution:** Error container with specific error message + Retry button
- **Status:** Fully implemented; graceful fallback UI

---

## Message Handler Reference

### Sent from Popup
- **GET_NAS_LIST**: No params → { list: [NAS objects] }
- **CHECK_CONNECTION**: nasId → { ok, error? }
- **LIST_TASKS**: nasId → { ok, tasks: [...] }
- **TASK_ACTION**: nasId, action, ids → { ok, error? }

### Sent from Options
- **GET_NAS_LIST**: No params → { list: [NAS objects] }
- **ADD_NAS**: nas object → { ok }
- **UPDATE_NAS**: nasId, updates → { ok }
- **DELETE_NAS**: nasId → { ok }
- **TEST_CONNECTION**: nasId, settings → { ok, version, log }
- **GET_WHITELIST**: No params → { list: [domains] }
- **ADD_WHITELIST**: domain → { ok }
- **REMOVE_WHITELIST**: domain → { ok }
- **GET_LOG**: No params → { log: entries }

### Sent from Content
- **SEND_MAGNET**: url, nasId? (optional, defaults to first NAS) → { ok, log }
- **SEND_TORRENT**: url, nasId? (optional, defaults to first NAS) → { ok, log }

---

## Installation & Testing

### Install Steps
1. Clone repo: `git clone git@github.com:craigpen/nas-download-helper.git`
2. Open `edge://extensions` or `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" → select project folder
5. Visit options page to configure: host, port, HTTPS, username, password

### Testing Checklist
- [ ] Test Connection works and shows version
- [ ] Task management popup appears and lists tasks
- [ ] Pause/Resume buttons work
- [ ] Magnet link detection works on torrent sites
- [ ] Confirmation dialog shows filename before sending
- [ ] Settings save and persist
- [ ] Debug log displays and clears

---

## Pending Recommendations (#7-14)

**#7: Task Sorting**
- Allow sorting by name, date, size, speed in popup

**#8: Pause/Resume All**
- Add "Pause All" / "Resume All" buttons for bulk operations

**#9: Badge Counter**
- Show download count in extension badge (e.g., "↓ 3")

**#10: Export Logs**
- Add button to export debug logs as JSON for troubleshooting

**#11: Keyboard Shortcuts**
- Quick keyboard binding to pause/resume current filter

**#12: Theme Toggle**
- Light/Dark theme toggle in options

**#13: DOM Error Boundary**
- Wrap content.js injection in error handler to prevent site breakage

**#14: Migration Guide**
- Docs for updating from previous extension versions

---

## Important Notes for Future Sessions

### Extension Testing Notes
**After background.js changes:**
- ⚠️ MUST reinstall extension (service worker restart)
- Go to `edge://extensions`, remove extension, reload folder

**After content.js changes:**
- ⚠️ MUST reinstall extension (content script restart)

**After popup.js/popup.html changes:**
- ✅ Just close and reopen popup (auto-reload)
- No reinstall needed

**After options.js/options.html changes:**
- ✅ Just reload the page (Ctrl+R)
- No reinstall needed

### Gotchas Encountered
1. **Message listener must NOT be async** - Breaks Chrome's message channel. Use `.then()` chains instead.
2. **sendResponse is for async responses** - Return `true` from listener to signal async handling
3. **Whitelist exists but isn't filtering** - Need to implement domain check in content.js `processLink()`
4. **URL validation is two-layer** - Both content.js and background.js check format for security
5. **All popup/options messages now need nasId** - Pass nasId for NAS context (optional for content.js, defaults to first NAS)
6. **NAS migration is automatic** - Old single-NAS configs are auto-converted to nasList format on first load

### Development Workflow
1. Make changes to code
2. Test in extension (reinstall if needed)
3. Commit with descriptive message: `git add . && git commit -m "..."`
4. Push: `git push`
5. Update this memory file with progress

---

## Git History (Recent)

- `6eea602`: Fix: Remove async from message listener to fix Chrome message passing
- `08dd157`: Add response logging to diagnose message callback issues
- `a371ad4`: Add debug logging to message listener to diagnose routing issues
- `51b1330`: Improve error handling in testConnection for better diagnostics
- `5097e48`: Fix: Make message listener async to support await in handlers
- `2c11f1b`: Add security features documentation to README
- `1cf6447`: Add CSRF protection and credentials validation (#2, #5)
- [earlier commits: whitelist, connection validation, API timeouts, etc.]

---

## Current Working State

✅ All core features working:
- Extension loads and configures properly
- Test Connection validates and shows result
- Task management popup displays tasks and filters
- Pause/Resume buttons work
- Error handling shows proper messages
- Debug logging available
- Security validations active

🔄 Next Sprint:
1. Implement active whitelist filtering in content.js
2. Add whitelist quick-link to popup
3. Consider priority among #7-14 recommendations
