# Download Nexus

If you have qBittorrent, Transmission, Deluge, or a Synology NAS running, you can send magnet links and torrent files to them directly from your browser. Click a link, select which service if you have multiple configured, and it's sent to that service. Manage downloads from the extension popup — view status, pause, resume, or delete.

**Desktop browsers only** (Chrome, Firefox, Edge).

It's open source, stores everything locally (nothing leaves your browser), and supports Chrome, Firefox, Edge desktop browsers.

## Install

- [Chrome Web Store](https://chromewebstore.google.com/detail/download-nexus/flhoeeffbkghmdagepajoojinjddnnjl)
- [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/download-nexus/)

## What It Does

- **Detects magnet links and torrent files** — finds them on any page and adds buttons next to them. You keep your existing magnet handler; this just gives you an alternative.
- **Supports multiple download services** — Synology NAS, qBittorrent, Transmission, Deluge.
- **Task manager in the popup** — see what's downloading, pause/resume/delete from the browser. Quick access without leaving the page.
- **Per-service sessions** — each of your download services stays logged in independently
- **Whitelist domains (optional)** — by default, buttons appear on all sites. Whitelist mode restricts them to specific domains you choose (reduces memory overhead if you want it).
- **Light/dark theme** — auto-matches your browser/OS preference
- **Export/import config** — backup and restore your settings. Optionally encrypt the backup with a password.

## Support This Project

This is a donation-funded open source project. If it saves you time, consider supporting its development:

- **[Ko-fi](https://ko-fi.com/craigpen)** — one-time or recurring
- **[Buy Me a Coffee](https://www.buymeacoffee.com/craigpen)** — quick support

Your contribution helps keep this maintained and supported.

## Security & Privacy

**Privacy**: All your credentials and data stay on your computer. The extension doesn't send anything anywhere — all communication goes directly between your browser and your download service. No tracking, no analytics, no third-party services. Cookies may be stored and used to maintain sessions with your download services (Deluge, etc.), not for tracking. Use HTTPS when possible to secure communication with your download services.

**Security**: 
- Credentials are stored locally in your browser's storage
- Sessions are reused to avoid repeated credential exposure
- You can optionally encrypt backups with a password if you want to move config between machines

## Configuration

### Adding Download Services

1. Open the extension popup and click the gear icon to switch to Settings
2. Click **"+ Add Service"**
3. Select device type from the dropdown:
   - **Synology**: Synology NAS DownloadStation
   - **qBittorrent**: qBittorrent Web UI
   - **Transmission**: Transmission daemon
   - **Deluge**: Deluge Web UI
4. Enter device details:
   - **Device Name**: e.g., "Home NAS", "My qBit" (displayed in popup tabs)
   - **Host/IP**: Your service IP or hostname
   - **Port**: Your service's web UI port
   - **HTTPS**: Toggle if your service uses HTTPS
   - **Username & Password**: Service credentials
   - **Download Destination**: Optional path (service-specific format)
5. Click **"Test Connection"** to verify settings
6. Save the device
7. **Add more devices** by repeating the above (tabs will appear in popup)

### Multiple Download Services

- When 2+ download services are configured, tabs appear in the popup header
- Click a tab to switch between services and view their respective task queues
- Each service maintains its own session and settings independently

### Whitelist Management

By default, the extension shows buttons on all sites. If you prefer, switch to **whitelist mode** to restrict buttons to specific domains. The whitelist is global across all your download services.

## Getting Started

### Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Build the extension: `npm run build:all` (creates `dist/chrome-mv3/` and `dist/firefox-mv3/`)

**Chrome/Edge:**
1. Go to `chrome://extensions` or `edge://extensions`
2. Enable Developer Mode
3. Click "Load unpacked" and select `dist/chrome-mv3/`

**Firefox:**
1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on..."
3. Select any file in `dist/firefox-mv3/`

**Configure:**
1. Click the extension icon, then the gear icon to open Settings
2. Click **"+ Add Service"** and configure your download service
3. Test the connection to verify settings
4. Click back to view your task queue

### Building for Different Browsers

- **Chrome/Edge**: `npm run build:chrome` → `dist/chrome-mv3/`
- **Firefox**: `npm run build:firefox` → `dist/firefox-mv3/`
- **All targets**: `npm run build:all`

### Testing with Download Clients

The extension works with qBittorrent, Transmission, Deluge, and Synology NAS. To test:

1. Load the extension in developer mode (see Development section above)
2. Click gear icon → "+ Add Device"
3. Select the service type and enter connection details
4. Click "Test Connection" to verify the connection works
5. Visit a torrent or magnet link and click the button to send it to your service

## Architecture

### Multi-Service Design
- **Service list** (chrome.storage.sync): Array of service configs, each with id, type, name, host, port, https, username, password, destination
- **Per-service sessions** (chrome.storage.local): Session tokens cached separately for each service to maintain independent sessions
- **Type extensibility**: Service type ("synology", "qbittorrent", etc.) allows adding new services in the future
- **Generic codebase**: Internal functions use service-agnostic naming to support multiple service types

### File Structure
- **background.js**: Service worker handling API calls, session management, and service CRUD operations
- **popup.html/popup.js**: Popup UI — task manager view plus an in-popup Settings view (gear icon) for adding/editing/deleting services, managing the whitelist, and backup/restore
- **content.js**: Injects UI buttons next to magnet/torrent links on web pages
- **manifest.json**: Extension configuration and permissions
