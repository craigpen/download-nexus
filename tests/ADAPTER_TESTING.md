# Adapter Testing Guide

When adding a new device adapter (Transmission, Deluge, etc.), follow this guide to ensure it's testable.

## Unit Tests (Mandatory)

Add tests to `tests/adapters.test.js`:

```javascript
describe('TransmissionAdapter', () => {
  const config = {
    type: 'transmission',
    host: 'localhost',
    port: 6969,
    https: false,
    username: 'admin',
    password: 'password'
  };

  test('should validate configuration', async () => {
    const adapter = new TransmissionAdapter('test-id', config);
    assert(adapter.config.host === 'localhost');
    // Verify required fields
  });

  test('should reject incomplete configuration', async () => {
    const bad = { ...config, host: null };
    const adapter = new TransmissionAdapter('test-id', bad);
    try {
      await adapter.testConnection();
      assert.fail('Should throw for incomplete config');
    } catch (e) {
      assert(e.message.includes('incomplete'));
    }
  });

  test('should map data to standard format', () => {
    // Verify transmission torrent → standard task format
    // Fields must be: id, title, status, progress, size, etc.
  });

  test('should map task actions', () => {
    // Verify actions: pause, resume, delete map correctly
  });
});
```

Run with: `npm run test:adapters`

## Integration Tests (Mandatory)

Add tests to `tests/integration.test.js`:

```javascript
describe('Transmission Integration Tests', () => {
  const TRANSMISSION_CONFIG = {
    host: 'localhost',
    port: 6969,
    username: 'admin',
    password: 'password'
  };

  const API_BASE = `http://${TRANSMISSION_CONFIG.host}:${TRANSMISSION_CONFIG.port}/api/v2`;

  describe('API Connection', () => {
    test('should connect to Transmission', async () => {
      const resp = await transmissionApi('POST', '/rpc', {/* auth */});
      assert(resp.ok);
    });

    test('should reject invalid credentials', async () => {
      const resp = await transmissionApi('POST', '/rpc', {
        username: 'admin',
        password: 'wrong'
      });
      assert(resp.status === 401);
    });
  });

  describe('Task Management', () => {
    test('should list torrents', async () => {
      const resp = await transmissionApi('GET', '/rpc?method=torrent-get');
      assert(Array.isArray(resp.json));
    });

    test('should pause/resume/delete torrents', async () => {
      // Test each action
    });
  });

  describe('Data Format', () => {
    test('should return consistent task format', async () => {
      // Verify: id, title, status, progress, size
      // Progress must be 0-100 (normalized)
    });
  });
});
```

Run with: `npm run test:integration`

## Requirements

### Adapter Implementation

Your adapter class must:

```javascript
class TransmissionAdapter extends DeviceAdapter {
  async testConnection() {
    // Return: { ok: true, version: "Transmission" }
    // Throw: clear error message on failure
  }

  async listTasks() {
    // Return: array of tasks with standard format
    // Fields: id, title, status, progress, size, downloaded, uploaded, speed_down, speed_up, eta
    // Progress must be 0-100 range
  }

  async addDownload(uri) {
    // Accept: magnet link or .torrent URL
    // Return: { ok: true }
    // Throw: clear error on failure
  }

  async taskAction(action, ids) {
    // Accept: action in ['pause', 'resume', 'delete'], ids array
    // Return: { ok: true }
    // Throw: clear error on failure
  }
}
```

### Test Environment

For integration tests, the device must be:
- Running on a known host/port
- Configured with test credentials
- Accessible from the test environment
- Have one or more torrents for testing pause/resume

Docker is recommended:

```bash
# Example: Transmission
docker run -d \
  --name transmission \
  -p 6969:6969 \
  -e TRANSMISSION_ENABLED=1 \
  transmission:latest
```

### Data Format Consistency

All adapters must normalize data to this format:

```javascript
{
  id: string,           // unique identifier (hash, ID, etc.)
  title: string,        // display name
  status: string,       // "downloading", "uploading", "paused", etc.
  progress: number,     // 0-100 (percentage)
  size: number,         // total bytes
  downloaded: number,   // bytes downloaded
  uploaded: number,     // bytes uploaded
  speed_down: number,   // bytes/sec
  speed_up: number,     // bytes/sec
  eta: number           // seconds remaining
}
```

## Test Commands

```bash
# All tests
npm test

# Just unit tests
npm run test:adapters

# Just integration tests (requires running device)
npm run test:integration

# Watch mode
npm run test:watch
```

## Before Submitting

Checklist:
- [ ] Unit tests all passing (`npm run test:adapters`)
- [ ] Integration tests all passing (`npm run test:integration`)
- [ ] Adapter implements all 4 required methods
- [ ] Data is normalized to standard format
- [ ] Error messages are clear and helpful
- [ ] Configuration is validated on `testConnection()`
- [ ] Factory function updated (`getAdapter()` switch statement)
- [ ] Message handlers updated if needed

## Example: Adding Transmission Support

1. **Create the adapter class** in `background.js`:
   ```javascript
   class TransmissionAdapter extends DeviceAdapter { ... }
   ```

2. **Add unit tests** in `tests/adapters.test.js`

3. **Add integration tests** in `tests/integration.test.js`

4. **Update factory** in `background.js`:
   ```javascript
   function getAdapter(nasId, config) {
     switch (config.type) {
       case 'transmission': return new TransmissionAdapter(nasId, config);
       // ...
     }
   }
   ```

5. **Update settings UI** in `popup.html`:
   ```html
   <option value="transmission">Transmission</option>
   ```

6. **Verify all tests pass**: `npm test`

7. **E2E test**: Add device in settings, test connection, send download

That's it! The adapter is now fully integrated and testable.
