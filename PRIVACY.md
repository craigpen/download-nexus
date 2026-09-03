# Privacy Policy for Download Nexus

**Last updated:** September 3, 2026

Download Nexus ("the Extension") is committed to protecting your privacy. This privacy policy explains how data is handled by the Extension.

---

## 1. Zero Data Collection & Storage
* **No Telemetry or Tracking:** Download Nexus does not collect, log, track, or transmit any personally identifiable information, browsing history, or analytics.
* **No Intermediary Servers:** The Extension does not operate or communicate with any cloud or middleman servers. All network requests are made strictly and directly from your browser to your own configured download services (e.g., Synology NAS, qBittorrent, Transmission, Deluge, JDownloader 2).

---

## 2. Local Data Storage
* **Credentials & Configuration:** Any service hostnames, IP addresses, port numbers, usernames, and passwords entered by the user are stored strictly on the user's local device using the browser's local encrypted storage API (`chrome.storage.local` / `chrome.storage.sync`).
* **Session Tokens:** Authentication session tokens for connected download services are cached locally to maintain connection sessions and are never transmitted to third parties.
* **Backup Encryption:** If you export your configuration, you have the option to encrypt the exported file with a user-defined password using local AES-GCM encryption.

---

## 3. Permissions Usage
* **`storage`**: Used solely to persist your configured download service endpoints and user preferences locally on your device.
* **`tabs` & `scripting`**: Used to detect magnet links, torrent files, and media URLs on web pages and display quick-action download buttons.
* **`contextMenus`**: Used to provide right-click options to send links directly to your download services.
* **`alarms`**: Used for periodic local polling to refresh task status in the popup.
* **`host_permissions` (`<all_urls>`)**: Required solely to make direct HTTP/HTTPS requests to your configured download clients (which may reside on local LAN IPs, custom domain names, or reverse proxies) and to detect links on web pages you visit.

---

## 4. Contact & Open Source
Download Nexus is open-source software licensed under the GNU General Public License v3.0. You can inspect the source code at:
https://github.com/craigpen/download-nexus

If you have questions regarding this privacy policy, please contact:
**Email:** craigpen001@gmail.com  
**GitHub Issues:** https://github.com/craigpen/download-nexus/issues
