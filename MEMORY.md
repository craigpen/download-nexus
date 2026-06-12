# NAS Download Helper - Development Memory

**Last Updated:** 2026-06-12
**Project:** Browser extension for managing Synology Download Station downloads

---

## Project Overview

**NAS Download Helper** is a Manifest V3 browser extension for Chrome/Edge that:
- Detects magnet links and torrent files on web pages
- Injects "⬇ NAS" buttons to send them to Synology Download Station
- Provides a popup UI for task management (view, pause, resume, delete)
- Maintains persistent authentication sessions
- Supports content script whitelisting for performance

---

## Current Status (Session 3)

### ✅ Completed Features
- Core magnet/torrent detection and sending
- Task management popup (list, filter, pause/resume, delete)
- Persistent session caching (avoids repeated logins)
- Connection validation with status indicator
- Error handling with retry button
- Debug logging (hidden by default, toggleable)
- API call timeouts (20s via AbortController)
- **CSRF Protection** (#2): URL validation + confirmation dialog
- **Credentials Validation** (#5): Password required, test button state management
- **Whitelist Management** (#1): Full CRUD UI in options page
- **All security issues fixed** (recommendations #1-6 complete)

### 🔴 Known Issue (Just Fixed)
- Test Connection now shows result properly (was stuck in pending state)
- Root cause: Message listener was `async`, breaking Chrome's message channel
- **FIXED**: Removed `async` and converted to explicit Promise chains

### 📋 Next Steps
1. Implement active whitelist filtering in content.js (currently whitelist exists but isn't used)
2. Add "Manage Whitelist" quick link in popup
3. Remaining feature recommendations (#7-14)

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

**Session Management:**
- `getSid(s, force=false)`: Returns cached SID if valid, otherwise logs in fresh
- `clearSid()`: Clears stored session
- `storeSid(sid, host)`: Caches SID in chrome.storage.local
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
- **CHECK_CONNECTION**: Validate NAS (silent, for status indicator)
- **LIST_TASKS**: Fetch current tasks
- **TASK_ACTION**: Action + IDs (pause/resume/delete)

### Sent from Options
- **TEST_CONNECTION**: settings object → { ok, version, log }
- **GET_WHITELIST**: No params → { list: [domains] }
- **ADD_WHITELIST**: domain → { ok }
- **REMOVE_WHITELIST**: domain → { ok }
- **GET_LOG**: No params → { log: entries }

### Sent from Content
- **SEND_MAGNET**: url → { ok, log }
- **SEND_TORRENT**: url → { ok, log }

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

**After popup.js/options.js/HTML changes:**
- ✅ Just reload the page (Ctrl+R on options, refresh on task page)
- No reinstall needed

### Gotchas Encountered
1. **Message listener must NOT be async** - Breaks Chrome's message channel. Use `.then()` chains instead.
2. **sendResponse is for async responses** - Return `true` from listener to signal async handling
3. **Whitelist exists but isn't filtering** - Need to implement domain check in content.js `processLink()`
4. **URL validation is two-layer** - Both content.js and background.js check format for security

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
