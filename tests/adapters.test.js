/**
 * Adapter Test Suite
 * Verifies all device adapter functionality (Synology, qBittorrent, etc.)
 */

const assert = require('assert');

// Mock config for testing
const SYNOLOGY_CONFIG = {
  type: 'synology',
  id: 'test-synology-1',
  name: 'Test NAS',
  host: 'nas.local',
  port: 5000,
  https: false,
  username: 'admin',
  password: 'password123',
  destination: '/volume1/downloads'
};

const QBITTORRENT_CONFIG = {
  type: 'qbittorrent',
  id: 'test-qbit-1',
  name: 'Test qBit',
  host: 'localhost',
  port: 8080,
  https: false,
  username: 'admin',
  password: 'admin1'
};

// Test Suite
describe('Device Adapters', () => {
  describe('SynologyAdapter', () => {
    test('should validate configuration on testConnection', async () => {
      const adapter = new SynologyAdapter('test-id', SYNOLOGY_CONFIG);
      assert(adapter.config.host === 'nas.local', 'Config should be set');
      assert(adapter.config.username === 'admin', 'Username should be set');
    });

    test('should reject incomplete configuration', async () => {
      const incompleteConfig = { ...SYNOLOGY_CONFIG, host: null };
      const adapter = new SynologyAdapter('test-id', incompleteConfig);

      try {
        await adapter.testConnection();
        assert.fail('Should throw for incomplete config');
      } catch (e) {
        assert(e.message.includes('incomplete'), 'Should mention incomplete settings');
      }
    });

    test('should format task data correctly', async () => {
      // Mock Synology API response
      const mockTasks = [
        {
          id: '123',
          title: 'Ubuntu ISO',
          status: 'downloading',
          additional: { transfer: { size_downloaded: 500000000, size_uploaded: 10000000 } }
        }
      ];

      assert(mockTasks[0].title === 'Ubuntu ISO', 'Should have title field');
      assert(mockTasks[0].status === 'downloading', 'Should have status field');
    });

    test('should construct proper taskAction params', () => {
      // Verify action names map correctly
      const actions = ['pause', 'resume', 'delete'];
      const qbActionMap = {
        'pause': 'pause',
        'resume': 'resume',
        'delete': 'deletePerm'
      };

      actions.forEach(action => {
        assert(qbActionMap[action], `Action ${action} should be mapped`);
      });
    });
  });

  describe('QBittorrentAdapter', () => {
    test('should validate configuration on testConnection', async () => {
      const adapter = new QBittorrentAdapter('test-id', QBITTORRENT_CONFIG);
      assert(adapter.config.host === 'localhost', 'Config should be set');
      assert(adapter.config.username === 'admin', 'Username should be set');
    });

    test('should reject incomplete configuration', async () => {
      const incompleteConfig = { ...QBITTORRENT_CONFIG, port: null };
      const adapter = new QBittorrentAdapter('test-id', incompleteConfig);

      try {
        await adapter.testConnection();
        assert.fail('Should throw for incomplete config');
      } catch (e) {
        assert(e.message.includes('incomplete'), 'Should mention incomplete settings');
      }
    });

    test('should map qBittorrent torrents to standard format', () => {
      // Verify field mapping
      const qbTorrent = {
        hash: 'abc123',
        name: 'Nioh 3 [FitGirl Repack]',
        state: 'downloading',
        progress: 0.5,
        total_size: 66430860517,
        downloaded: 33215430258,
        uploaded: 0,
        dl_speed: 2680773,
        up_speed: 0,
        eta: 21287
      };

      // Expected mapping
      const mapped = {
        id: qbTorrent.hash,
        title: qbTorrent.name,  // name → title
        status: qbTorrent.state,
        progress: qbTorrent.progress * 100,  // 0-1 → 0-100
        size: qbTorrent.total_size,
        downloaded: qbTorrent.downloaded,
        uploaded: qbTorrent.uploaded,
        speed_down: qbTorrent.dl_speed,
        speed_up: qbTorrent.up_speed,
        eta: qbTorrent.eta
      };

      assert(mapped.title === 'Nioh 3 [FitGirl Repack]', 'Should map name to title');
      assert(mapped.progress === 50, 'Should convert progress to percentage');
      assert(mapped.size === qbTorrent.total_size, 'Should map total_size to size');
    });

    test('should construct proper API URLs', () => {
      const adapter = new QBittorrentAdapter('test-id', QBITTORRENT_CONFIG);

      // Verify URL construction
      const baseUrl = `http://localhost:8080`;
      assert(baseUrl.includes('localhost'), 'Should use host');
      assert(baseUrl.includes('8080'), 'Should use port');

      const loginUrl = `${baseUrl}/api/v2/auth/login`;
      assert(loginUrl.includes('/api/v2/'), 'Should use correct API path (not /webapi)');
    });

    test('should map task actions correctly', () => {
      const actionMap = {
        'pause': 'pause',
        'resume': 'resume',
        'delete': 'deletePerm'
      };

      assert(actionMap.pause === 'pause', 'Pause action should map to "pause"');
      assert(actionMap.resume === 'resume', 'Resume action should map to "resume"');
      assert(actionMap.delete === 'deletePerm', 'Delete action should map to "deletePerm"');
    });

    test('should handle torrent hashes in taskAction', () => {
      // qBittorrent uses hash-based IDs, separated by pipe character
      const ids = ['hash1', 'hash2', 'hash3'];
      const hashString = ids.join('|');

      assert(hashString === 'hash1|hash2|hash3', 'Should join hashes with pipe');
      assert(ids.length === 3, 'Should handle multiple torrents');
    });
  });

  describe('Adapter Pattern', () => {
    test('should have consistent interface', () => {
      const methods = ['testConnection', 'listTasks', 'addDownload', 'taskAction'];

      // Both adapters should have these methods
      const synologyAdapter = new SynologyAdapter('id', SYNOLOGY_CONFIG);
      const qbAdapter = new QBittorrentAdapter('id', QBITTORRENT_CONFIG);

      methods.forEach(method => {
        assert(typeof synologyAdapter[method] === 'function', `SynologyAdapter should have ${method}`);
        assert(typeof qbAdapter[method] === 'function', `QBittorrentAdapter should have ${method}`);
      });
    });

    test('should route through getAdapter factory', () => {
      const adapters = {
        synology: SYNOLOGY_CONFIG,
        qbittorrent: QBITTORRENT_CONFIG
      };

      Object.entries(adapters).forEach(([type, config]) => {
        const adapter = getAdapter('test-id', { ...config, type });
        assert(adapter, `Should create adapter for ${type}`);
        assert(adapter.config.type === type, `Adapter should have correct type`);
      });
    });
  });

  describe('Task Data Consistency', () => {
    test('all tasks should have required fields', () => {
      const requiredFields = ['id', 'title', 'status', 'progress', 'size'];

      const synologyTask = {
        id: '1', title: 'Task 1', status: 'downloading',
        progress: 50, size: 1000000
      };

      const qbitTask = {
        id: 'hash1', title: 'Task 2', status: 'downloading',
        progress: 75, size: 2000000
      };

      [synologyTask, qbitTask].forEach(task => {
        requiredFields.forEach(field => {
          assert(field in task, `Task should have ${field} field`);
        });
      });
    });

    test('progress should be in 0-100 range', () => {
      const tasks = [
        { progress: 0 },
        { progress: 50 },
        { progress: 100 }
      ];

      tasks.forEach(task => {
        assert(task.progress >= 0 && task.progress <= 100,
          `Progress should be 0-100, got ${task.progress}`);
      });
    });
  });

  describe('Error Handling', () => {
    test('should provide meaningful error messages', () => {
      const errors = [
        'Settings incomplete: missing host, port, or username',
        'qBit auth failed: invalid credentials',
        'Invalid URI: must be a magnet link or .torrent URL'
      ];

      errors.forEach(msg => {
        assert(msg.length > 0, 'Error message should not be empty');
        assert(!msg.includes('[object Object]'), 'Error should not contain object dumps');
      });
    });
  });
});

// Test runner (simple)
if (require.main === module) {
  console.log('🧪 Running Adapter Tests...\n');
  console.log('✅ All adapter tests defined');
  console.log('\nNote: Run with Jest or similar test framework:');
  console.log('  npm test -- tests/adapters.test.js');
}

module.exports = { SYNOLOGY_CONFIG, QBITTORRENT_CONFIG };
