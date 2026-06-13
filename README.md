# NAS Download Helper

A browser extension for Edge/Chrome that intercepts magnet links and torrent files on web pages and sends them to your NAS device(s).

## Features

- **Multi-NAS support**: Configure and manage multiple NAS devices (currently Synology; extensible for others)
  - Add/edit/delete devices in options page
  - Each device has independent session and settings
  - Export/import config with optional password protection
- **Magnet link & torrent support**: Detects and handles both magnet links and `.torrent` files
  - Inline buttons next to links (no floating/overlapping)
  - NAS selector popup when multiple devices configured
- **Task management popup**: View, pause, resume, and delete tasks
  - **NAS tabs**: Switch between devices (shown when 2+ configured)
  - **Smart sorting**: DL tab by % complete, others by date added (newest first)
  - **Per-NAS connection status**: Shows which NAS is connected in tabs/header
  - **Open Web**: Quick link to current NAS web interface
- **Persistent per-NAS sessions**: Maintains independent login sessions for each device
- **Global content script whitelist**: Filter which domains show buttons (applies to all NAS)
  - Quick add/remove from popup header
  - Only scans whitelisted domains for performance
- **Light/Dark theme**: Auto-detects browser/OS preference
- **Error handling**: Graceful error messages with retry functionality
- **Debug logging**: Built-in debug log for troubleshooting (hidden by default)

## Security

- **CSRF Protection**: Validates magnet URI format and torrent URLs before sending; user confirmation required
- **Credentials Validation**: Warns if password is empty; Test Connection button disabled without password
- **URL Validation**: Defense-in-depth with validation in both content script and background service worker
- **Secure Session Management**: Reuses authentication session to avoid repeated credential exposure

## Configuration

### Adding NAS Devices

1. Open extension options (gear icon)
2. Click **"+ Add NAS Device"**
3. Select device type (currently **Synology** available)
4. Enter device details:
   - **Device Name**: e.g., "Home NAS", "Backup NAS" (displayed in popup tabs)
   - **Host/IP**: Your NAS IP or hostname
   - **Port**: Default 5000 (or 5001 for HTTPS)
   - **HTTPS**: Toggle if your NAS uses HTTPS
   - **Username & Password**: DSM credentials
   - **Download Destination**: Optional path (e.g., `/volume1/downloads`)
5. Click **"Test Connection"** to verify settings
6. Save the device
7. **Add more devices** by repeating the above (tabs will appear in popup)

### Multiple NAS Devices

- When 2+ NAS devices are configured, tabs appear in the popup header
- Click a tab to switch between devices and view their respective task queues
- Each device maintains its own session and settings independently

### Whitelist Management

The content script can be optimized by whitelisting specific domains where you frequently use magnet/torrent links. This reduces memory usage and improves browser performance while the extension still functions everywhere.

**Whitelist is global** across all configured NAS devices.

## Getting Started

### Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Build the extension: `npm run build` (creates `dist/chrome-mv3/`)
4. Go to `edge://extensions` or `chrome://extensions`
5. Enable Developer Mode
6. Click "Load unpacked" and select `dist/chrome-mv3/`
7. Click the extension icon and go to options (gear icon)
8. Click **"+ Add NAS Device"** and configure your NAS
9. Test the connection to verify settings
10. Back in the popup, your NAS task queue should load

### Building for Different Browsers

- **Chrome/Edge**: `npm run build:chrome` → `dist/chrome-mv3/`
- **Firefox**: `npm run build:firefox` → `dist/firefox-mv3/`
- **All targets**: `npm run build:all`

Each build is ready to submit to the respective app store.

## Architecture

### Multi-NAS Design
- **nasList** (chrome.storage.sync): Array of NAS device configs, each with id, type, name, host, port, https, username, password, destination
- **Per-NAS sessions** (chrome.storage.local): SID cached separately for each NAS device to maintain independent sessions
- **Type extensibility**: Device type ("synology", "qbittorrent", etc.) allows adding new NAS types in the future
- **Generic codebase**: Function names use "NAS" prefix (nasFetch, nasCall, nasLogin) to be agnostic of device type

### File Structure
- **background.js**: Service worker handling API calls, session management, and NAS CRUD operations
- **popup.html/popup.js**: Popup UI for viewing/managing tasks with tabs per NAS device
- **options.html/options.js**: Settings page for adding/editing/deleting NAS devices and managing whitelist
- **content.js**: Injects UI buttons next to magnet/torrent links on web pages
- **manifest.json**: Extension configuration and permissions
