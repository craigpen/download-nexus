# Testing Guide

This document describes the testing infrastructure for NAS Download Helper.

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

#### Multi-Device
- [ ] Can add both Synology and qBittorrent devices
- [ ] Tabs show both devices
- [ ] Switching tabs shows correct task lists
- [ ] Each device operates independently

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

1. Create `class TransmissionAdapter extends DeviceAdapter`
2. Implement all required methods:
   - `async testConnection()`
   - `async listTasks()`
   - `async addDownload(uri)`
   - `async taskAction(action, ids)`
3. Ensure task data matches standard format (id, title, status, progress, size)
4. Update message handlers to use `getAdapter()` factory
5. Add tests to `tests/adapters.test.js` for new adapter
6. Update `getAdapter()` switch statement in background.js

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
