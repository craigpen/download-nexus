# Download Nexus

A browser extension that intercepts magnet links and torrent files on web pages and routes them to your download services

## Features

- **Multi-service support**: Configure and manage multiple download services
  - **Supported services**: Synology NAS, qBittorrent, Transmission, and Deluge
  - Add/edit/delete devices from the settings view in the popup (gear icon)
  - Each device has independent session and settings
  - Export/import config with option to exclude plaintext passwords
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
- **Instant popup load**: Last known task list is cached and painted immediately on open, then refreshed live

## Security

- **CSRF Protection**: Validates magnet URI format and torrent URLs before sending
- **Credentials Validation**: Warns if password is empty; Test Connection button disabled without password
- **URL Validation**: Defense-in-depth with validation in both content script and background service worker
- **Secure Session Management**: Reuses authentication session to avoid repeated credential exposure

## Privacy Policy

This extension stores NAS device credentials (hostname, port, username, password) locally in your browser's encrypted storage and does not collect, track, or transmit any personal data. All communication is directly between your browser and your NAS device only. The extension is open-source and does not use analytics, telemetry, export user data, or integrate with third-party services.

## Configuration

### Adding Download Services

1. Open the extension popup and click the gear icon to switch to Settings
2. Click **"+ Add Device"**
3. Select device type from the dropdown:
   - **Synology**: Synology NAS DownloadStation
   - **qBittorrent**: qBittorrent Web UI
   - **Transmission**: Transmission daemon
   - **Deluge**: Deluge Web UI
4. Enter device details:
   - **Device Name**: e.g., "Home NAS", "My qBit" (displayed in popup tabs)
   - **Host/IP**: Your service IP or hostname
   - **Port**: Service-specific default (Synology: 5000, qBittorrent: 8080, Transmission: 9091, Deluge: 8112)
   - **HTTPS**: Toggle if your service uses HTTPS
   - **Username & Password**: Service credentials
   - **Download Destination**: Optional path (service-specific format)
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
7. Click the extension icon, then the gear icon to open Settings
8. Click **"+ Add NAS Device"** and configure your NAS
9. Test the connection to verify settings
10. Click back — your NAS task queue should load

### Building for Different Browsers

- **Chrome/Edge**: `npm run build:chrome` → `dist/chrome-mv3/`
- **Firefox**: `npm run build:firefox` → `dist/firefox-mv3/`
- **All targets**: `npm run build:all`

Each build is ready to submit to the respective app store.

### Testing with Download Clients

The extension supports multiple download services. Quick setup for each:

**qBittorrent**
- Docker: `docker run -d -p 8080:8080 qbittorrent/qbittorrent:latest`
- Default credentials: admin/adminadmin
- Web UI port: 8080

**Transmission**
- Docker: `docker run -d -p 9091:9091 transmissionbt/transmission:latest`
- Default credentials: transmission/transmission
- Web UI port: 9091

**Deluge**
- Docker: `docker run -d -p 8112:8112 deluge/deluge:latest`
- Default credentials: (typically no auth required initially)
- Web UI port: 8112

**Testing Steps:**
1. Load the extension in developer mode (see Development section above)
2. Click gear icon → "+ Add Device"
3. Select the service type you want to test
4. Enter connection details:
   - Device Name: e.g., "My qBit", "Transmission Server"
   - Host: `localhost` (or your service server IP)
   - Port: Service default (qBittorrent: 8080, Transmission: 9091, Deluge: 8112)
   - Username/Password: Service credentials
5. Click "Test Connection" to verify
6. Go back to main view
7. Visit a torrent site and click a magnet link
8. Confirm the download appears in your configured service

## Support Development

If you find this extension helpful, consider supporting its ongoing development:

- **☕ Ko-fi**: https://ko-fi.com/craigpen
- **☕ Buy Me a Coffee**: https://www.buymeacoffee.com/craigpen

Your support helps fund continued improvements and feature development.

## Architecture

### Multi-NAS Design
- **nasList** (chrome.storage.sync): Array of NAS device configs, each with id, type, name, host, port, https, username, password, destination
- **Per-NAS sessions** (chrome.storage.local): SID cached separately for each NAS device to maintain independent sessions
- **Type extensibility**: Device type ("synology", "qbittorrent", etc.) allows adding new NAS types in the future
- **Generic codebase**: Function names use "NAS" prefix (nasFetch, nasCall, nasLogin) to be agnostic of device type

### File Structure
- **background.js**: Service worker handling API calls, session management, and NAS CRUD operations
- **popup.html/popup.js**: Popup UI — task manager view plus an in-popup Settings view (gear icon) for adding/editing/deleting NAS devices, managing the whitelist, and backup/restore
- **content.js**: Injects UI buttons next to magnet/torrent links on web pages
- **manifest.json**: Extension configuration and permissions
