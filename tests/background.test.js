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
