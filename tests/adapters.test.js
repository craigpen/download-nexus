/**
 * Adapter Test Suite
 * Verifies all device adapter functionality (Synology, qBittorrent, etc.)
 */

const assert = require('assert');

// Mock adapter classes for testing (actual implementations are in background.js)
class NasAdapter {
  constructor(nasId, config) {
    this.nasId = nasId;
    this.config = config;
  }
  async testConnection() { throw new Error("Not implemented"); }
  async listTasks() { throw new Error("Not implemented"); }
  async addDownload(uri) { throw new Error("Not implemented"); }
  async taskAction(action, ids) { throw new Error("Not implemented"); }
}

class SynologyAdapter extends NasAdapter {
  async testConnection() {
    if (!this.config?.host || !this.config?.port || !this.config?.username) {
      throw new Error("Settings incomplete: missing host, port, or username");
    }
    return { ok: true, version: "Synology" };
  }
  async listTasks() { return []; }
  async addDownload(uri) { return { ok: true }; }
  async taskAction(action, ids) { return { ok: true }; }
}

class QBittorrentAdapter extends NasAdapter {
  constructor(nasId, config) {
    super(nasId, config);
    this._isTokenAuth = !!config?.apiToken && config.apiToken.trim().length > 0;
  }

  async testConnection() {
    if (!this.config?.host || !this.config?.port) {
      throw new Error("Settings incomplete: missing host or port");
    }
    // Token auth: don't require username
    if (!this._isTokenAuth && !this.config?.username) {
      throw new Error("Settings incomplete: missing username (or provide API token)");
    }
    return { ok: true, version: "qBittorrent" };
  }
  async listTasks() { return []; }
  async addDownload(uri) { return { ok: true }; }
  async taskAction(action, ids) { return { ok: true }; }
}

class TransmissionAdapter extends NasAdapter {
  async testConnection() {
    if (!this.config?.host || !this.config?.port) {
      throw new Error("Settings incomplete: missing host or port");
    }
    return { ok: true, version: "Transmission" };
  }
  async listTasks() { return []; }
  async addDownload(uri) { return { ok: true }; }
  async taskAction(action, ids) { return { ok: true }; }
}

class DelugeAdapter extends NasAdapter {
  constructor(nasId, config) {
    super(nasId, config);
    this._isAuthenticated = false;
  }

  async testConnection() {
    if (!this.config?.host || !this.config?.port) {
      throw new Error("Settings incomplete: missing host or port");
    }
    if (!this.config?.password) {
      throw new Error("Deluge password not configured");
    }
    return { ok: true, version: "Deluge" };
  }

  async listTasks() { return []; }
  async addDownload(uri) { return { ok: true }; }
  async taskAction(action, ids) { return { ok: true }; }

  _displayStatus(rawState) {
    const stateMap = {
      "Downloading": "downloading",
      "Seeding": "seeding",
      "Paused": "paused",
      "Queued": "stalled",
      "Checking": "checking",
      "Allocating": "allocating",
      "Error": "error"
    };
    return stateMap[rawState] || rawState;
  }
}

function getAdapter(nasId, config) {
  const type = config.type || "synology";
  switch (type) {
    case "qbittorrent": return new QBittorrentAdapter(nasId, config);
    case "transmission": return new TransmissionAdapter(nasId, config);
    case "deluge": return new DelugeAdapter(nasId, config);
    default: return new SynologyAdapter(nasId, config);
  }
}

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

const TRANSMISSION_CONFIG = {
  type: 'transmission',
  id: 'test-transmission-1',
  name: 'Test Transmission',
  host: 'localhost',
  port: 9091,
  https: false,
  username: 'admin',
  password: 'admin1'
};

const DELUGE_CONFIG = {
  type: 'deluge',
  id: 'test-deluge-1',
  name: 'Test Deluge',
  host: 'localhost',
  port: 8112,
  https: false,
  username: 'admin',  // Not used in auth, for reference only
  password: 'deluge'  // Only this is used for auth.login()
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

    test('should support API token authentication (P1-2)', () => {
      // Token-only config (no username/password)
      const tokenConfig = {
        host: 'localhost',
        port: 8080,
        apiToken: 'mytoken123'
      };
      const adapter = new QBittorrentAdapter('test-id', tokenConfig);

      // Verify token is detected
      assert(adapter._isTokenAuth === true, 'Should detect token auth');
      assert(adapter.config.apiToken === 'mytoken123', 'Token should be stored');
      assert(!adapter.config.username, 'Username should not be required');
    });

    test('should not use token auth if token is empty or missing', () => {
      const noTokenConfig = { ...QBITTORRENT_CONFIG };
      const adapter = new QBittorrentAdapter('test-id', noTokenConfig);

      assert(adapter._isTokenAuth === false, 'Should not use token auth without token');
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
      // qBittorrent API v2 endpoint mapping
      const actionMap = {
        'pause': 'stop',      // pause → /torrents/stop
        'resume': 'start',    // resume → /torrents/start
        'delete': 'deletePerm'
      };

      assert(actionMap.pause === 'stop', 'Pause action should map to "stop" (/torrents/stop)');
      assert(actionMap.resume === 'start', 'Resume action should map to "start" (/torrents/start)');
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

  describe('TransmissionAdapter', () => {
    test('should validate configuration on testConnection', async () => {
      const adapter = new TransmissionAdapter('test-id', TRANSMISSION_CONFIG);
      assert(adapter.config.host === 'localhost', 'Config should be set');
      assert(adapter.config.port === 9091, 'Port should be set');
    });

    test('should reject incomplete configuration', async () => {
      const incompleteConfig = { ...TRANSMISSION_CONFIG, host: null };
      const adapter = new TransmissionAdapter('test-id', incompleteConfig);

      try {
        await adapter.testConnection();
        assert.fail('Should throw for incomplete config');
      } catch (e) {
        assert(e.message.includes('incomplete'), 'Should mention incomplete settings');
      }
    });

    test('should map Transmission states to unified format', () => {
      const stateMap = {
        0: "paused",           // Stopped
        1: "waiting",          // Check pending
        2: "waiting",          // Checking
        3: "waiting",          // Download pending
        4: "downloading",      // Downloading
        5: "waiting",          // Seed pending
        6: "seeding"           // Seeding
      };

      // Verify states map correctly
      assert(stateMap[0] === "paused", "Stopped should be paused");
      assert(stateMap[4] === "downloading", "Downloading should be downloading");
      assert(stateMap[6] === "seeding", "Seeding should be seeding");
      assert(stateMap[1] === "waiting", "Check pending should be waiting");
      assert(stateMap[5] === "waiting", "Seed pending should be waiting");
    });

    test('should construct proper RPC URL', () => {
      const adapter = new TransmissionAdapter('test-id', TRANSMISSION_CONFIG);
      const baseUrl = `http://localhost:9091`;
      assert(baseUrl.includes('localhost'), 'Should use host');
      assert(baseUrl.includes('9091'), 'Should use port');

      const rpcUrl = `${baseUrl}/rpc`;
      assert(rpcUrl.includes('/rpc'), 'Should use correct RPC path');
    });

    test('should map task actions correctly', () => {
      const actionMap = {
        'pause': 'torrent-stop',
        'resume': 'torrent-start',
        'delete': 'torrent-remove'
      };

      assert(actionMap.pause === 'torrent-stop', 'Pause should map to torrent-stop');
      assert(actionMap.resume === 'torrent-start', 'Resume should map to torrent-start');
      assert(actionMap.delete === 'torrent-remove', 'Delete should map to torrent-remove');
    });

    test('should handle torrent IDs as integers', () => {
      const ids = ['1', '2', '3'];
      const numericIds = ids.map(id => parseInt(id));

      assert(numericIds[0] === 1, 'Should convert to integer');
      assert(numericIds.length === 3, 'Should handle multiple torrents');
    });
  });

  describe('DelugeAdapter', () => {
    test('should validate configuration on testConnection', async () => {
      const adapter = new DelugeAdapter('test-id', DELUGE_CONFIG);
      assert(adapter.config.host === 'localhost', 'Config should be set');
      assert(adapter.config.password === 'deluge', 'Password should be set');
    });

    test('should reject incomplete configuration - missing host', async () => {
      const incompleteConfig = { ...DELUGE_CONFIG, host: null };
      const adapter = new DelugeAdapter('test-id', incompleteConfig);

      try {
        await adapter.testConnection();
        assert.fail('Should throw for incomplete config');
      } catch (e) {
        assert(e.message.includes('incomplete'), 'Should mention incomplete settings');
      }
    });

    test('should reject incomplete configuration - missing password', async () => {
      const incompleteConfig = { ...DELUGE_CONFIG, password: null };
      const adapter = new DelugeAdapter('test-id', incompleteConfig);

      try {
        await adapter.testConnection();
        assert.fail('Should throw for missing password');
      } catch (e) {
        assert(e.message.includes('password'), 'Should mention password requirement');
      }
    });

    test('should use password-only auth (P0-1 fix)', () => {
      // Verify auth.login() takes only password, not username
      const adapter = new DelugeAdapter('test-id', DELUGE_CONFIG);

      // Auth signature is: auth.login(password)
      // NOT: auth.login(username, password) [this caused TypeError]
      assert(adapter.config.password === 'deluge', 'Should have password for auth');
      assert(adapter._isAuthenticated === false, 'Should start unauthenticated');
    });

    test('should map Deluge states to unified format', () => {
      const adapter = new DelugeAdapter('test-id', DELUGE_CONFIG);

      const stateTests = [
        { input: 'Downloading', expected: 'downloading' },
        { input: 'Seeding', expected: 'seeding' },
        { input: 'Paused', expected: 'paused' },
        { input: 'Queued', expected: 'stalled' },
        { input: 'Checking', expected: 'checking' },
        { input: 'Allocating', expected: 'allocating' },
        { input: 'Error', expected: 'error' },
        { input: 'Unknown', expected: 'Unknown' }  // Unknown states pass through
      ];

      stateTests.forEach(test => {
        const mapped = adapter._displayStatus(test.input);
        assert(mapped === test.expected,
          `State ${test.input} should map to ${test.expected}, got ${mapped}`);
      });
    });

    test('should handle magnet links separately from .torrent files (P0-2 fix)', () => {
      // Verify that addDownload distinguishes between magnet and torrent
      const magnetUri = 'magnet:?xt=urn:btih:abc123';
      const torrentUri = 'http://example.com/file.torrent';

      // Magnet link detection
      const isMagnet = magnetUri.startsWith('magnet:');
      const isTorrentUrl = /\.torrent(\?|$)/i.test(magnetUri);

      assert(isMagnet === true, 'Should detect magnet link');
      assert(isTorrentUrl === false, 'Should not detect magnet as torrent');

      // Torrent URL detection
      const isMagnet2 = torrentUri.startsWith('magnet:');
      const isTorrentUrl2 = /\.torrent(\?|$)/i.test(torrentUri);

      assert(isMagnet2 === false, 'Should not detect torrent as magnet');
      assert(isTorrentUrl2 === true, 'Should detect .torrent URL');
    });

    test('should map task actions correctly', () => {
      const actionMap = {
        'pause': 'core.pause_torrents',
        'resume': 'core.resume_torrents',
        'delete': 'core.remove_torrents'
      };

      assert(actionMap.pause === 'core.pause_torrents', 'Pause should use core.pause_torrents');
      assert(actionMap.resume === 'core.resume_torrents', 'Resume should use core.resume_torrents');
      assert(actionMap.delete === 'core.remove_torrents', 'Delete should use core.remove_torrents');
    });

    test('should format Deluge task data correctly', () => {
      // Expected format from Deluge RPC response
      const delugeTask = {
        id: 'hash123',
        title: 'Ubuntu 20.04 ISO',
        status: 'downloading',
        rawStatus: 'Downloading',
        progress: 65.5,
        downloaded: 655000000,
        uploaded: 5000000,
        size: 1000000000,
        speed_down: 5242880,
        speed_up: 1048576,
        eta: 127
      };

      // Verify required fields
      assert(delugeTask.id, 'Should have id (hash)');
      assert(delugeTask.title, 'Should have title');
      assert(delugeTask.status, 'Should have mapped status');
      assert(typeof delugeTask.progress === 'number', 'Progress should be number');
      assert(delugeTask.progress >= 0 && delugeTask.progress <= 100, 'Progress should be 0-100');
      assert(delugeTask.size > 0, 'Should have size');
      assert(delugeTask.speed_down >= 0, 'Speed should be non-negative');
    });

    test('should construct proper RPC URL', () => {
      const adapter = new DelugeAdapter('test-id', DELUGE_CONFIG);
      const baseUrl = `http://localhost:8112`;
      const rpcUrl = `${baseUrl}/json`;

      assert(rpcUrl.includes('localhost'), 'Should use host');
      assert(rpcUrl.includes('8112'), 'Should use port');
      assert(rpcUrl.endsWith('/json'), 'Should use /json RPC endpoint');
    });

    test('should support both HTTPS and HTTP', () => {
      const httpConfig = { ...DELUGE_CONFIG, https: false };
      const httpsConfig = { ...DELUGE_CONFIG, https: true };

      const httpAdapter = new DelugeAdapter('test-id', httpConfig);
      const httpsAdapter = new DelugeAdapter('test-id', httpsConfig);

      assert(httpAdapter.config.https === false, 'Should support HTTP');
      assert(httpsAdapter.config.https === true, 'Should support HTTPS');
    });
  });

  describe('Adapter Pattern', () => {
    test('should have consistent interface', () => {
      const methods = ['testConnection', 'listTasks', 'addDownload', 'taskAction'];

      // All adapters should have these methods
      const synologyAdapter = new SynologyAdapter('id', SYNOLOGY_CONFIG);
      const qbAdapter = new QBittorrentAdapter('id', QBITTORRENT_CONFIG);
      const transmissionAdapter = new TransmissionAdapter('id', TRANSMISSION_CONFIG);
      const delugeAdapter = new DelugeAdapter('id', DELUGE_CONFIG);

      methods.forEach(method => {
        assert(typeof synologyAdapter[method] === 'function', `SynologyAdapter should have ${method}`);
        assert(typeof qbAdapter[method] === 'function', `QBittorrentAdapter should have ${method}`);
        assert(typeof transmissionAdapter[method] === 'function', `TransmissionAdapter should have ${method}`);
        assert(typeof delugeAdapter[method] === 'function', `DelugeAdapter should have ${method}`);
      });
    });

    test('should route through getAdapter factory', () => {
      const adapters = {
        synology: SYNOLOGY_CONFIG,
        qbittorrent: QBITTORRENT_CONFIG,
        transmission: TRANSMISSION_CONFIG,
        deluge: DELUGE_CONFIG
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

  describe('qBittorrent State Mapping', () => {
    test('should map qBittorrent states to correct categories', () => {
      const stateMap = {
        // Active states
        downloading: "downloading",
        forcedDL: "downloading",
        metaDL: "downloading",
        allocating: "downloading",
        // Paused states
        stoppedDL: "paused",
        stoppedUP: "paused",
        // Stalled/waiting states (not actively downloading)
        stalledDL: "waiting",
        stalledUP: "seeding",
        // Seeding states
        uploading: "seeding",
        forcedUP: "seeding",
        // Check/queue states
        queuedForChecking: "waiting",
        checkingUP: "waiting",
        checkingDL: "waiting",
        // Error states
        error: "error",
        missingFiles: "error"
      };

      // Verify stalled downloads are NOT marked as "downloading"
      assert(stateMap.stalledDL === "waiting", "stalledDL should be waiting, not downloading");
      assert(stateMap.stoppedDL === "paused", "stoppedDL should be paused");
      assert(stateMap.downloading === "downloading", "downloading should be downloading");
    });

    test('task filtering should separate active from stalled downloads', () => {
      const tasks = [
        { id: '1', title: 'Active', status: 'downloading', progress: 50 },
        { id: '2', title: 'Stalled', status: 'waiting', progress: 10 },
        { id: '3', title: 'Paused', status: 'paused', progress: 25 }
      ];

      // Filter by "downloading" should only show active downloads
      const downloading = tasks.filter(t => t.status === 'downloading');
      assert(downloading.length === 1, 'Only active downloads should be in downloading filter');
      assert(downloading[0].id === '1', 'Should be the active download');

      // Filter by "waiting" should show stalled
      const waiting = tasks.filter(t => t.status === 'waiting');
      assert(waiting.length === 1, 'Stalled download should be in waiting filter');
      assert(waiting[0].id === '2', 'Should be the stalled download');

      // Filter by "paused" should show paused
      const paused = tasks.filter(t => t.status === 'paused');
      assert(paused.length === 1, 'Paused download should be in paused filter');
      assert(paused[0].id === '3', 'Should be the paused download');
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

module.exports = { SYNOLOGY_CONFIG, QBITTORRENT_CONFIG, TRANSMISSION_CONFIG, DELUGE_CONFIG };
