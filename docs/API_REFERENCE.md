# Download Services API Reference

Official API documentation for all supported download services.

## Synology DownloadStation

**API Documentation:** https://global.download.synology.com/download/Document/Software/DeveloperGuide/Package/DownloadStation/All/enu/DownloadStation_API_Guide.pdf

**Key Endpoints:**
- `GET /DownloadStation/info.cgi` - Get Download Station info
- `POST /DownloadStation/task.cgi` - Task management (list, create, delete, pause, resume)

**Protocol Support:**
- ✅ Magnet links
- ✅ Torrent files
- ✅ HTTP/HTTPS downloads
- ✅ FTP downloads

**Implementation:** [src/background.js - SynologyAdapter](src/background.js)

---

## qBittorrent WebUI API

**API Documentation:** https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-v2.8.3%2B)

**Base URL:** `http://HOST:PORT/api/v2/`

**Key Endpoints:**
- `POST /auth/login` - Authenticate
- `GET /torrents/info` - List torrents
- `POST /torrents/add` - Add torrent/magnet
- `POST /torrents/pause` - Pause torrents
- `POST /torrents/resume` - Resume torrents
- `POST /torrents/delete` - Delete torrents

**Protocol Support:**
- ✅ Magnet links
- ✅ Torrent files
- ❌ HTTP/HTTPS downloads
- ❌ FTP downloads

**Authentication:** Basic auth or API token (v2.8.3+)

**Implementation:** [src/background.js - QBittorrentAdapter](src/background.js)

---

## Transmission RPC API

**API Documentation:** https://github.com/transmission/transmission/blob/main/docs/rpc-spec.md

**Base URL:** `http://HOST:PORT/transmission/rpc`

**Key Endpoints:**
- `POST /transmission/rpc` - All operations via JSON-RPC 2.0
  - `torrent-add` - Add torrent/magnet
  - `torrent-get` - List torrents
  - `torrent-stop` - Stop (pause) torrents
  - `torrent-start` - Start torrents
  - `torrent-remove` - Remove torrents

**Protocol Support:**
- ✅ Magnet links
- ✅ Torrent files
- ❌ HTTP/HTTPS downloads
- ❌ FTP downloads

**Authentication:** Basic auth or session token (X-Transmission-Session-Id)

**Implementation:** [src/background.js - TransmissionAdapter](src/background.js)

---

## Deluge JSON-RPC API

**API Documentation:** https://deluge.readthedocs.io/en/latest/plugins/webui/api.html

**Base URL:** `http://HOST:PORT/json`

**Key Methods:**
- `auth.login(password)` - Authenticate
- `core.add_torrent_magnet(magnet, options)` - Add magnet link
- `core.add_torrent_file(filename, filedump, options)` - Add torrent file
- `core.get_torrents_status(filter_dict, keys)` - List torrents
- `core.pause_torrents(torrent_ids)` - Pause torrents
- `core.resume_torrents(torrent_ids)` - Resume torrents
- `core.remove_torrents(torrent_ids, filedump)` - Remove torrents

**Protocol Support:**
- ✅ Magnet links
- ✅ Torrent files
- ❌ HTTP/HTTPS downloads
- ❌ FTP downloads

**Authentication:** Password-only (no username)

**Implementation:** [src/background.js - DelugeAdapter](src/background.js)

---

## JDownloader 2

**Documentation:** https://jdownloader.org/knowledge/wiki/glossary/clientapi

**Base URL:** `http://HOST:PORT/jsonrpc` (Local API)

**Key Methods:**
- Get list of all downloads
- Add magnet links or torrent files
- Pause/resume downloads
- Remove downloads

**Protocol Support:**
- ✅ Magnet links
- ✅ Torrent files
- ✅ HTTP/HTTPS downloads
- ✅ FTP downloads

**Authentication:** No authentication required for local API

**Implementation:** [src/background.js - JDownloaderAdapter](src/background.js)

---

## Common Status Mappings

All adapters normalize status strings to a unified format:

| Unified Status | Synology | qBittorrent | Transmission | Deluge | JDownloader 2 |
|---|---|---|---|---|---|
| downloading | downloading | downloading, forcedDL, metaDL, allocating | downloading | Downloading | downloading |
| seeding | seeding | uploading, seeding, forcedUP | seeding, uploading | Seeding | (N/A) |
| paused | paused | stoppedDL, stoppedUP | stopped | Paused | paused |
| stalled | waiting | stalledDL, stalledUP | stalled | Queued | waiting |
| finished | finished | completedDL, completedUP | finished | Complete | finished |
| error | error | error, missingFiles | error | Error | error |

---

## Task Data Format

All adapters return tasks in this standard format:

```javascript
{
  id: string,              // unique identifier (hash, GID, etc)
  title: string,           // display name
  status: string,          // unified status (see table above)
  progress: number,        // 0-100 percentage
  size: number,            // total bytes
  downloaded: number,      // bytes downloaded
  uploaded: number,        // bytes uploaded
  speed_down: number,      // bytes/sec download speed
  speed_up: number,        // bytes/sec upload speed
  eta: number              // seconds remaining
}
```

---

## Implementation Patterns

### Adding a New Service

1. **Create Adapter Class** - Extend `NasAdapter` in [src/background.js](src/background.js)
   - Implement `testConnection()`
   - Implement `listTasks()`
   - Implement `addDownload(uri)`
   - Implement `taskAction(action, ids)`

2. **Add Unit Tests** - Update [tests/adapters.test.js](tests/adapters.test.js)
   - Configuration validation
   - State mapping
   - Error handling

3. **Add Integration Tests** - Create `tests/{service}-integration.test.js`
   - API connection
   - Task management (add, list, pause, resume, delete)
   - Data format consistency

4. **Update Factory** - Add case to `getAdapter()` in [src/background.js](src/background.js)

5. **Update UI** - Add option to `<select>` in [src/popup.html](src/popup.html)

6. **Update Configuration** - Add SERVICE_DEFAULTS and ADAPTER_FEATURES in [src/popup.js](src/popup.js)

See [TESTING.md](TESTING.md) for detailed testing requirements.

---

## Related Files

- **Adapters:** [src/background.js](src/background.js) - All adapter implementations
- **Tests:** [tests/adapters.test.js](tests/adapters.test.js) - Unit tests
- **Integration Tests:** [tests/*-integration.test.js](tests/) - API integration tests
- **UI Configuration:** [src/popup.js](src/popup.js) - SERVICE_DEFAULTS and ADAPTER_FEATURES
- **Protocol Support:** [src/utils/protocols.js](src/utils/protocols.js) - Protocol matrix
- **Testing Guide:** [TESTING.md](TESTING.md) - Comprehensive testing documentation

---

## Development Tips

### Testing with Docker

Each service has a Docker image for local testing:

```bash
# qBittorrent
docker run -d -p 8080:8080 linuxserver/qbittorrent:latest

# Transmission
docker run -d -p 9091:9091 linuxserver/transmission:latest

# Deluge
docker run -d -p 8112:8112 linuxserver/deluge:latest

# JDownloader 2 runs locally on desktop (no Docker image)
```

Or use the included docker-compose:
```bash
docker-compose up -d
```

### Adding Debug Logging

Use the `dbg()` function (defined in background.js):

```javascript
dbg("INFO", "Operation name", "details here");
dbg("ERROR", "Operation name", error.message);
```

Logs are collected and returned in test responses for debugging.

### Protocol Support Matrix

Reference [src/utils/protocols.js](src/utils/protocols.js) for which protocols each service supports:

```javascript
const protocolMatrix = {
  synology: { magnet: true, torrent: true, http: true, https: true, ftp: true },
  qbittorrent: { magnet: true, torrent: true, http: false, https: false, ftp: false },
  transmission: { magnet: true, torrent: true, http: false, https: false, ftp: false },
  deluge: { magnet: true, torrent: true, http: false, https: false, ftp: false },
  jdownloader: { magnet: true, torrent: true, http: true, https: true, ftp: true }
};
```

---

## References

- [Download Nexus GitHub](https://github.com/craigpen/download-nexus)
- [Testing Guide](TESTING.md)
- [Extension Structure](src/)
- [Adapter Implementations](src/background.js)
