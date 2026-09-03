/**
 * Background Script Test Suite
 * Tests message handlers, context menu, and download logic
 */

const assert = require('assert');

// Mock implementations for testing
const MessageHandlers = {
  // Simulate handling TEST_CONNECTION message
  handleTestConnection(settings) {
    if (!settings?.host || !settings?.port) {
      return { ok: false, error: 'Settings incomplete' };
    }
    return { ok: true, version: 'mock-version' };
  },

  // Simulate handling LIST_TASKS message
  handleListTasks(nasId, services) {
    const service = services?.find(s => s.id === nasId);
    if (!service) {
      return { ok: false, error: 'Download service not found' };
    }
    return { ok: true, tasks: [] };
  },

  // Simulate handling TASK_ACTION message
  handleTaskAction(nasId, services, action, ids) {
    const service = services?.find(s => s.id === nasId);
    if (!service) {
      return { ok: false, error: 'Download service not found' };
    }
    if (!['pause', 'resume', 'delete'].includes(action)) {
      return { ok: false, error: 'Invalid action' };
    }
    return { ok: true };
  },

  // Simulate handling ADD_WHITELIST message
  handleAddWhitelist(domain, whitelist) {
    if (!domain || typeof domain !== 'string') {
      return { ok: false, error: 'Invalid domain' };
    }
    const normalized = domain.toLowerCase().trim();
    if (whitelist && whitelist.includes(normalized)) {
      return { ok: false, error: 'Domain is already in whitelist' };
    }
    return { ok: true, domain: normalized };
  }
};

const ContextMenuManager = {
  create(options) {
    if (!options.title || !options.id) {
      throw new Error('Missing required menu properties');
    }
    return { id: options.id, title: options.title, created: true };
  },

  remove(id) {
    return { id, removed: true };
  },

  buildServiceMenuItems(services) {
    if (!services || !Array.isArray(services)) {
      return [];
    }
    return services.map((service, index) => ({
      id: `service_${service.id}`,
      parentId: 'download-nexus',
      title: service.name,
      order: index,
      contexts: ['link']
    }));
  }
};

describe('Background Message Handlers', () => {
  describe('TEST_CONNECTION', () => {
    test('should accept valid settings', () => {
      const settings = {
        host: 'localhost',
        port: 5000,
        type: 'synology'
      };

      const result = MessageHandlers.handleTestConnection(settings);

      assert(result.ok === true, 'Should succeed with valid settings');
      assert(result.version === 'mock-version', 'Should return version');
    });

    test('should reject incomplete settings (missing host)', () => {
      const settings = {
        port: 5000,
        type: 'synology'
      };

      const result = MessageHandlers.handleTestConnection(settings);

      assert(result.ok === false, 'Should fail without host');
      assert(result.error.includes('incomplete'), 'Should indicate incomplete settings');
    });

    test('should reject incomplete settings (missing port)', () => {
      const settings = {
        host: 'localhost',
        type: 'synology'
      };

      const result = MessageHandlers.handleTestConnection(settings);

      assert(result.ok === false, 'Should fail without port');
      assert(result.error.includes('incomplete'), 'Should indicate incomplete settings');
    });
  });

  describe('LIST_TASKS', () => {
    test('should return tasks for valid service', () => {
      const services = [
        { id: 'service-1', type: 'qbittorrent', name: 'qBit' }
      ];

      const result = MessageHandlers.handleListTasks('service-1', services);

      assert(result.ok === true, 'Should succeed');
      assert(Array.isArray(result.tasks), 'Should return tasks array');
    });

    test('should reject unknown service', () => {
      const services = [
        { id: 'service-1', type: 'qbittorrent', name: 'qBit' }
      ];

      const result = MessageHandlers.handleListTasks('unknown-id', services);

      assert(result.ok === false, 'Should fail for unknown service');
      assert(result.error.includes('not found'), 'Should indicate service not found');
    });

    test('should handle empty service list', () => {
      const result = MessageHandlers.handleListTasks('any-id', []);

      assert(result.ok === false, 'Should fail when no services configured');
    });
  });

  describe('TASK_ACTION', () => {
    test('should accept valid actions', () => {
      const services = [
        { id: 'service-1', type: 'qbittorrent', name: 'qBit' }
      ];

      ['pause', 'resume', 'delete'].forEach(action => {
        const result = MessageHandlers.handleTaskAction('service-1', services, action, ['id1']);

        assert(result.ok === true, `Should accept ${action} action`);
      });
    });

    test('should reject invalid actions', () => {
      const services = [
        { id: 'service-1', type: 'qbittorrent', name: 'qBit' }
      ];

      const result = MessageHandlers.handleTaskAction('service-1', services, 'invalid', ['id1']);

      assert(result.ok === false, 'Should reject invalid action');
      assert(result.error.includes('Invalid action'), 'Should indicate invalid action');
    });

    test('should reject unknown service', () => {
      const services = [
        { id: 'service-1', type: 'qbittorrent', name: 'qBit' }
      ];

      const result = MessageHandlers.handleTaskAction('unknown-id', services, 'pause', ['id1']);

      assert(result.ok === false, 'Should fail for unknown service');
      assert(result.error.includes('not found'), 'Should indicate service not found');
    });
  });

  describe('ADD_WHITELIST', () => {
    test('should add new domain to whitelist', () => {
      const whitelist = [];

      const result = MessageHandlers.handleAddWhitelist('example.com', whitelist);

      assert(result.ok === true, 'Should succeed');
      assert(result.domain === 'example.com', 'Should return normalized domain');
    });

    test('should normalize domain case', () => {
      const whitelist = [];

      const result = MessageHandlers.handleAddWhitelist('EXAMPLE.COM', whitelist);

      assert(result.ok === true, 'Should succeed');
      assert(result.domain === 'example.com', 'Should normalize to lowercase');
    });

    test('should detect duplicate domains', () => {
      const whitelist = ['example.com'];

      const result = MessageHandlers.handleAddWhitelist('example.com', whitelist);

      assert(result.ok === false, 'Should reject duplicate');
      assert(result.error.toLowerCase().includes('already') && result.error.toLowerCase().includes('whitelist'), 'Should indicate duplicate');
    });

    test('should reject invalid domains', () => {
      const whitelist = [];

      [null, undefined, '', 123].forEach(invalid => {
        const result = MessageHandlers.handleAddWhitelist(invalid, whitelist);

        assert(result.ok === false, `Should reject ${invalid}`);
        assert(result.error.includes('Invalid domain'), 'Should indicate invalid input');
      });
    });
  });
});

describe('Context Menu Management', () => {
  describe('create', () => {
    test('should create menu item with required properties', () => {
      const options = {
        id: 'download-nexus',
        title: 'Download Nexus',
        contexts: ['link']
      };

      const result = ContextMenuManager.create(options);

      assert(result.created === true, 'Menu item should be created');
      assert(result.id === 'download-nexus', 'Should preserve ID');
    });

    test('should reject menu without ID', () => {
      const options = {
        title: 'Download Nexus',
        contexts: ['link']
      };

      assert.throws(() => {
        ContextMenuManager.create(options);
      }, /Missing required menu properties/, 'Should throw for missing ID');
    });

    test('should reject menu without title', () => {
      const options = {
        id: 'download-nexus',
        contexts: ['link']
      };

      assert.throws(() => {
        ContextMenuManager.create(options);
      }, /Missing required menu properties/, 'Should throw for missing title');
    });
  });

  describe('buildServiceMenuItems', () => {
    test('should create submenu items for each service', () => {
      const services = [
        { id: 'service-1', name: 'qBittorrent' },
        { id: 'service-2', name: 'Transmission' },
        { id: 'service-3', name: 'Synology' }
      ];

      const items = ContextMenuManager.buildServiceMenuItems(services);

      assert(items.length === 3, 'Should create item for each service');
      assert(items[0].id === 'service_service-1', 'Should generate proper ID');
      assert(items[0].title === 'qBittorrent', 'Should use service name');
      assert(items[0].parentId === 'download-nexus', 'Should link to parent menu');
    });

    test('should handle empty service list', () => {
      const items = ContextMenuManager.buildServiceMenuItems([]);

      assert(items.length === 0, 'Should return empty array for no services');
    });

    test('should handle invalid input', () => {
      assert.deepStrictEqual(ContextMenuManager.buildServiceMenuItems(null), []);
      assert.deepStrictEqual(ContextMenuManager.buildServiceMenuItems(undefined), []);
      assert.deepStrictEqual(ContextMenuManager.buildServiceMenuItems('not-array'), []);
    });

    test('should maintain service order', () => {
      const services = [
        { id: 'first', name: 'First' },
        { id: 'second', name: 'Second' },
        { id: 'third', name: 'Third' }
      ];

      const items = ContextMenuManager.buildServiceMenuItems(services);

      assert(items[0].order === 0, 'First should be order 0');
      assert(items[1].order === 1, 'Second should be order 1');
      assert(items[2].order === 2, 'Third should be order 2');
    });
  });
});

describe('Message Handler Integration', () => {
  test('should handle multiple message types', () => {
    const services = [
      { id: 's1', type: 'qbittorrent', name: 'qBit' }
    ];

    // Test different message types
    const testConnection = MessageHandlers.handleTestConnection({ host: 'localhost', port: 8080 });
    const listTasks = MessageHandlers.handleListTasks('s1', services);
    const taskAction = MessageHandlers.handleTaskAction('s1', services, 'pause', ['id1']);

    assert(testConnection.ok === true);
    assert(listTasks.ok === true);
    assert(taskAction.ok === true);
  });

  test('should preserve service configuration across operations', () => {
    const services = [
      { id: 's1', type: 'qbittorrent', name: 'Primary' },
      { id: 's2', type: 'transmission', name: 'Secondary' }
    ];

    // Operations should not modify original services
    MessageHandlers.handleListTasks('s1', services);
    MessageHandlers.handleTaskAction('s1', services, 'pause', ['id']);

    assert(services.length === 2, 'Service list should not change');
    assert(services[0].name === 'Primary', 'Service config should not change');
  });
});

describe('Error Handling', () => {
  test('should provide consistent error messages', () => {
    // All "not found" errors should mention service
    const result1 = MessageHandlers.handleListTasks('unknown', []);
    const result2 = MessageHandlers.handleTaskAction('unknown', [], 'pause', []);

    assert(result1.error.includes('not found'));
    assert(result2.error.includes('not found'));
    assert(result1.error === result2.error, 'Error messages should be consistent');
  });

  test('should not expose sensitive information in errors', () => {
    const settings = {
      // Incomplete config - missing port
      host: 'secret.internal.server',
      password: 'super-secret-password'
    };

    // Even though settings are incomplete, don't expose values in error
    const result = MessageHandlers.handleTestConnection(settings);

    assert(result.ok === false, 'Should fail');
    assert(result.error, 'Should have error message');
    assert(!result.error.includes('secret'), 'Should not expose hostnames');
    assert(!result.error.includes('super-secret'), 'Should not expose secrets');
  });
});

describe('Dynamic Toolbar Icon State Management', () => {
  // Test speed formatter
  function formatSpeed(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec <= 0) return "0 B/s";
    const units = ["B/s", "KB/s", "MB/s", "GB/s"];
    const i = Math.min(Math.floor(Math.log(bytesPerSec) / Math.log(1024)), units.length - 1);
    const val = (bytesPerSec / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0);
    return `${val} ${units[i]}`;
  }

  const ICON_STATES = {
    idle: { path: { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" } },
    active: { path: { "16": "icons/icon16-active.png", "48": "icons/icon48-active.png", "128": "icons/icon128-active.png" } },
    paused: { path: { "16": "icons/icon16-paused.png", "48": "icons/icon48-paused.png", "128": "icons/icon128-paused.png" } },
    error: { path: { "16": "icons/icon16-error.png", "48": "icons/icon48-error.png", "128": "icons/icon128-error.png" } },
    offline: { path: { "16": "icons/icon16-offline.png", "48": "icons/icon48-offline.png", "128": "icons/icon128-offline.png" } }
  };

  test('should format speeds cleanly', () => {
    assert.strictEqual(formatSpeed(0), '0 B/s');
    assert.strictEqual(formatSpeed(500), '500 B/s');
    assert.strictEqual(formatSpeed(1024), '1.0 KB/s');
    assert.strictEqual(formatSpeed(1048576 * 4.2), '4.2 MB/s');
    assert.strictEqual(formatSpeed(1073741824 * 1.5), '1.5 GB/s');
  });

  test('should provide valid icon paths for all states', () => {
    const states = ['idle', 'active', 'paused', 'error', 'offline'];
    for (const s of states) {
      assert(ICON_STATES[s], `State ${s} should exist`);
      assert(ICON_STATES[s].path['16'], `State ${s} should have 16px icon`);
      assert(ICON_STATES[s].path['48'], `State ${s} should have 48px icon`);
      assert(ICON_STATES[s].path['128'], `State ${s} should have 128px icon`);
    }
  });
});

describe('Credential Storage Hardening & Separation', () => {
  function sanitizeSyncPayload(list) {
    const localCreds = {};
    const sanitizedList = list.map(item => {
      if (item.password !== undefined || item.apiToken !== undefined) {
        localCreds[item.id] = {
          password: item.password || '',
          apiToken: item.apiToken || ''
        };
      }
      const sanitized = { ...item };
      delete sanitized.password;
      delete sanitized.apiToken;
      return sanitized;
    });
    return { sanitizedList, localCreds };
  }

  function mergeCredentials(syncList, localCreds) {
    return syncList.map(item => {
      const creds = localCreds[item.id] || {};
      return {
        ...item,
        password: creds.password || item.password || '',
        apiToken: creds.apiToken || item.apiToken || ''
      };
    });
  }

  test('should strip passwords from sync payload and isolate to local', () => {
    const rawServices = [
      { id: 'nas-1', name: 'Synology 1', host: '192.168.1.50', port: 5000, password: 'mySecretPassword123' },
      { id: 'nas-2', name: 'qBittorrent', host: '192.168.1.60', port: 8080, apiToken: 'tokenABC' }
    ];

    const { sanitizedList, localCreds } = sanitizeSyncPayload(rawServices);

    assert.strictEqual(sanitizedList[0].password, undefined);
    assert.strictEqual(sanitizedList[1].apiToken, undefined);
    assert.strictEqual(localCreds['nas-1'].password, 'mySecretPassword123');
    assert.strictEqual(localCreds['nas-2'].apiToken, 'tokenABC');
  });

  test('should transparently merge local credentials with sync metadata on read', () => {
    const syncList = [
      { id: 'nas-1', name: 'Synology 1', host: '192.168.1.50', port: 5000 },
      { id: 'nas-2', name: 'qBittorrent', host: '192.168.1.60', port: 8080 }
    ];
    const localCreds = {
      'nas-1': { password: 'mySecretPassword123', apiToken: '' },
      'nas-2': { password: '', apiToken: 'tokenABC' }
    };

    const merged = mergeCredentials(syncList, localCreds);

    assert.strictEqual(merged.length, 2);
    assert.strictEqual(merged[0].password, 'mySecretPassword123');
    assert.strictEqual(merged[1].apiToken, 'tokenABC');
  });
});

describe('Auto-Reconnect & Network Retry Logic', () => {
  async function withRetry(fn, { maxRetries = 2, delayMs = 10 } = {}) {
    let lastErr;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn(attempt);
      } catch (err) {
        lastErr = err;
        const isTransient = /Failed to fetch|NetworkError|ECONNRESET|ECONNREFUSED|timeout/i.test(err.message);
        if (attempt < maxRetries && isTransient) {
          await new Promise(r => setTimeout(r, delayMs));
        } else {
          throw err;
        }
      }
    }
    throw lastErr;
  }

  test('should succeed immediately on first attempt without retries', async () => {
    let attempts = 0;
    const result = await withRetry(async (attempt) => {
      attempts = attempt;
      return 'OK';
    });

    assert.strictEqual(result, 'OK');
    assert.strictEqual(attempts, 1);
  });

  test('should retry on transient network error and succeed on second attempt', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls === 1) {
        throw new Error('TypeError: Failed to fetch');
      }
      return 'RECOVERED';
    }, { maxRetries: 3, delayMs: 1 });

    assert.strictEqual(result, 'RECOVERED');
    assert.strictEqual(calls, 2);
  });

  test('should immediately reject non-transient fatal errors without retrying', async () => {
    let calls = 0;
    await assert.rejects(async () => {
      await withRetry(async () => {
        calls++;
        throw new Error('Invalid credentials');
      }, { maxRetries: 3, delayMs: 1 });
    }, /Invalid credentials/);

    assert.strictEqual(calls, 1);
  });
});


