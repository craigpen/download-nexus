# Testing Guide

This document describes the testing infrastructure for Download Nexus.

## Adapter Tests

The adapter test suite verifies that all device adapters (Synology, qBittorrent, etc.) implement the correct interface and handle data consistently.

### Running Tests

```bash
# Run all tests
npm test

# Run only adapter tests
npm run test:adapters

# Watch mode (re-run on file changes)
npm run test:watch
```

### Test Coverage

**tests/adapters.test.js** verifies:

#### Adapter Interface
- Both `SynologyAdapter` and `QBittorrentAdapter` have required methods:
  - `testConnection()` - Validates credentials and connection
  - `listTasks()` - Fetches task list from device
  - `addDownload(uri)` - Adds magnet/torrent to device
  - `taskAction(action, ids)` - Pauses, resumes, or deletes tasks

#### Data Format Consistency
- Task objects have required fields: `id`, `title`, `status`, `progress`, `size`
- Progress is normalized to 0-100 range (not device-specific formats)
- Task titles display correctly in the UI

#### Configuration Validation
- Incomplete configurations are rejected with clear error messages
- Required fields checked before operations: host, port, username

#### Field Mapping
- qBittorrent `name` field → standardized `title` field
- qBittorrent progress 0-1 → 0-100 percentage
- qBittorrent total_size → standardized `size` field

#### Task Actions
- Actions map correctly: `pause`, `resume`, `delete`
- qBittorrent delete action uses `deletePerm` (deletes with files)
- Multiple task IDs handled properly (pipe-separated for qBittorrent)

#### Factory Pattern
- `getAdapter('id', config)` returns correct adapter type
- Adapter type determined by `config.type` field
- Supports extensibility for new device types

## Manual Testing

### Quick Test Checklist

#### Synology NAS
- [ ] Connection test succeeds with valid credentials
- [ ] Task list loads and displays correctly
- [ ] Torrent names display in task list
- [ ] Pause button pauses task
- [ ] Resume button resumes task
- [ ] Delete button removes task

#### qBittorrent
- [ ] Connection test succeeds with valid credentials
- [ ] Task list loads and displays correctly
- [ ] Torrent names display in task list
- [ ] Pause button pauses task
- [ ] Resume button resumes task
- [ ] Delete button removes task

#### Transmission
- [ ] Connection test succeeds with valid credentials
- [ ] Task list loads and displays correctly
- [ ] Torrent names display in task list
- [ ] Stop button stops task
- [ ] Start button starts task
- [ ] Delete button removes task

#### Multi-Device
- [ ] Can add both Synology and qBittorrent devices
- [ ] Tabs show both devices
- [ ] Switching tabs shows correct task lists
- [ ] Each device operates independently

### Integration Testing

Integration tests verify actual API calls against real device instances.

#### qBittorrent Integration Tests

Start a qBittorrent Docker container:

```bash
docker run -d -p 8080:8080 \
  -e WEBUI_PORT=8080 \
  linuxserver/qbittorrent:latest
```

Run tests:

```bash
npm run test:integration
```

This verifies:
- API connection and authentication
- Task list retrieval
- Task action endpoints (pause, resume, delete)
- Data format consistency
- State mapping to unified format

#### Transmission Integration Tests

Start a Transmission Docker container:

```bash
docker run -d -p 9091:9091 \
  -e TZ=UTC \
  linuxserver/transmission:latest
```

Run tests:

```bash
npm run test:transmission
```

This verifies:
- RPC connection and session ID handling
- Torrent list retrieval
- Torrent action endpoints (stop, start, remove)
- Data format consistency
- State mapping (0-6) to unified format

#### Docker Compose (All Services)

Run all services together:

```bash
docker-compose up
```

### End-to-End Testing

Run the E2E test script:

```bash
cd tests
node test-e2e-full.js
```

This verifies:
1. Extension loads
2. Settings open
3. Device can be added
4. Connection test succeeds
5. Device is saved
6. Task list displays

## Continuous Integration

Tests are configured to run on:
- Git push (via GitHub Actions if configured)
- Local development (via npm test)

### CI Configuration (Optional)

To set up GitHub Actions testing, create `.github/workflows/test.yml`:

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: 18
      - run: npm install
      - run: npm test
```

## Adding New Device Types

When adding a new device adapter (e.g., Transmission, Deluge):

### 1. Create Adapter Class

```javascript
class TransmissionAdapter extends NasAdapter {
  async testConnection() { /* ... */ }
  async listTasks() { /* ... */ }
  async addDownload(uri) { /* ... */ }
  async taskAction(action, ids) { /* ... */ }
  _normalizeStatus(deviceState) { /* ... */ }
}
```

### 2. Implement State Normalization

Map device-specific states to unified format:

```javascript
_normalizeStatus(deviceState) {
  const stateMap = {
    // Map device states to: downloading, seeding, paused, waiting, finished, error
  };
  return stateMap[deviceState] || "waiting";
}
```

Unified state set:
- `downloading` - actively downloading or queued to download
- `seeding` - actively seeding or queued to seed
- `paused` - explicitly stopped/paused by user
- `waiting` - queued, checking, verifying (not user-paused)
- `finished` - completed (100% downloaded)
- `error` - error state

### 3. Normalize Task Data

All adapters must return tasks with this format:

```javascript
{
  id: "unique-id",           // string: hash, ID, or name
  title: "Torrent Name",      // string: human-readable title
  status: "downloading",      // string: unified status
  progress: 50,               // number: 0-100 percentage
  downloaded: 536870912,      // number: bytes
  uploaded: 0,                // number: bytes
  size: 1073741824,           // number: bytes
  speed_down: 1048576,        // number: bytes/sec
  speed_up: 0,                // number: bytes/sec
  eta: 512                    // number: seconds
}
```

### 4. Register Adapter

Update `background.js` `getAdapter()` factory:

```javascript
case "transmission":
  return new TransmissionAdapter(nasId, config);
```

### 5. Add UI Support

Update `popup.html` device type selector:

```html
<option value="transmission">Transmission</option>
```

### 6. Add Tests

Create unit tests in `tests/adapters.test.js`:
- Configuration validation
- State mapping verification
- URL/API endpoint construction
- Action mapping

Create integration tests:
- Real API connection
- Task retrieval
- Task actions (pause, resume, delete)
- Data format verification

## Debugging

### Enable Console Logging

In `background.js`, the `dbg()` function logs debug messages. Check the service worker console:

```
DevTools → Sources → Service Workers → Extension → Console
```

### Check Message Handler Routing

Message handlers automatically route through adapters. To debug:

1. Open extension console
2. Send test command via popup
3. Check service worker logs for adapter method calls
4. Verify response format matches expectations

### Common Issues

**Task title not showing:**
- Check task data has `title` field (not `name`)
- Verify adapter's `listTasks()` maps to correct field

**Connection test failing:**
- Check credentials in config
- Verify host/port reachable
- Check device API is accessible from extension context

**Task action failing (pause/resume/delete):**
- Verify adapter implements `taskAction(action, ids)`
- Check action names match device API (e.g., `deletePerm` for qBittorrent)
- Verify task IDs are in correct format for device

## Future Testing

Recommended additions:
- [ ] Mock API responses for unit tests
- [ ] Integration tests against real devices
- [ ] E2E tests in multiple browsers (Chrome, Edge, Firefox)
- [ ] Performance tests (large task lists)
- [ ] Error recovery tests (connection failures, timeouts)
- [ ] Security tests (credential handling, XSS prevention)
