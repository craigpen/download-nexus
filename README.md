# NAS Download helper

A browser extension for Edge/Chrome that intercepts magnet links and torrent files on web pages and sends them to Synology Download Station.

## Features

- **Magnet link & torrent support**: Detects and handles both magnet links and `.torrent` files
- **Task management popup**: View, pause, resume, and delete tasks with real-time status and speed monitoring
- **Persistent session**: Maintains login session to avoid displacing browser sessions
- **Connection validation**: Validates NAS connectivity with status indicator
- **Error handling**: Graceful error messages with retry functionality
- **Debug logging**: Built-in debug log for troubleshooting (hidden by default)
- **Content script whitelist**: Manage which domains the extension actively scans (performance optimization)

## Configuration

1. Open extension options
2. Enter your NAS IP/hostname and port
3. Provide DSM username and password
4. Optionally set a default download destination
5. Test the connection to verify settings

### Whitelist Management

The content script can be optimized by whitelisting specific domains where you frequently use magnet/torrent links. This reduces memory usage and improves browser performance while the extension still functions everywhere.

## Getting Started

1. Clone or load the folder in VS Code
2. Go to `edge://extensions` or `chrome://extensions`
3. Enable Developer Mode
4. Click "Load unpacked" and select the project folder
5. Configure extension options with your NAS details
6. Test the connection

## Architecture

- **background.js**: Service worker handling API calls and task management
- **popup.html/popup.js**: Popup UI for viewing and managing download tasks
- **options.html/options.js**: Settings page for configuration and whitelist management
- **content.js**: Injects UI buttons next to magnet/torrent links on web pages
- **manifest.json**: Extension configuration and permissions
