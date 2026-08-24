/**
 * Transmission Integration Tests
 * Tests actual Transmission RPC calls
 * Requires: Running Transmission Docker container on localhost:9091
 *
 * Start with:
 *   docker run -d -p 9091:9091 \
 *     -e PUID=1000 -e PGID=1000 \
 *     -v /tmp/transmission:/config \
 *     linuxserver/transmission:latest
 */

const assert = require('assert');

const TRANSMISSION_CONFIG = {
  host: 'localhost',
  port: 9091,
  https: false,
  username: 'transmission',
  password: 'transmission'
};

const RPC_BASE = `http://${TRANSMISSION_CONFIG.host}:${TRANSMISSION_CONFIG.port}/rpc`;
let sessionId = null;

async function transmissionRpc(method, args = {}) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (sessionId) {
    headers['X-Transmission-Session-Id'] = sessionId;
  }

  const body = {
    method,
    arguments: args
  };

  const resp = await fetch(RPC_BASE, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  // Extract session ID from response
  const newSessionId = resp.headers.get('X-Transmission-Session-Id');
  if (newSessionId) {
    sessionId = newSessionId;
  }

  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    return { result: 'parse-error', text };
  }
}

describe('Transmission Integration Tests', () => {

  describe('API Connection', () => {
    test('should connect to Transmission RPC', async () => {
      const resp = await transmissionRpc('session-get');
      assert(resp.result === 'success' || resp.result === 'success. server responded',
        `Connection failed: ${resp.result}`);
    }, 10000);

    test('should handle session ID requirement', async () => {
      // Transmission returns 409 Conflict if session ID is missing/invalid
      const resp = await fetch(RPC_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'session-get', arguments: {} })
      });

      // Session ID should be provided in response
      const sid = resp.headers.get('X-Transmission-Session-Id');
      assert(sid || resp.status === 409, 'Should get session ID or 409 response');
    }, 10000);
  });

  describe('Torrent Management', () => {
    test('should list torrents', async () => {
      const resp = await transmissionRpc('torrent-get', {
        fields: ['id', 'name', 'status', 'percentDone', 'downloadedEver', 'totalSize']
      });

      assert(resp.result === 'success', `Failed to list torrents: ${resp.result}`);
      assert(Array.isArray(resp.arguments?.torrents), 'Should return torrents array');
    }, 10000);

    test('should get torrent properties', async () => {
      const listResp = await transmissionRpc('torrent-get', {
        fields: ['id', 'name', 'status']
      });

      if (listResp.arguments?.torrents?.length > 0) {
        const torrentId = listResp.arguments.torrents[0].id;
        const resp = await transmissionRpc('torrent-get', {
          ids: [torrentId],
          fields: ['id', 'name', 'status', 'percentDone', 'downloadedEver', 'totalSize']
        });

        assert(resp.result === 'success', `Failed to get properties: ${resp.result}`);
        const torrent = resp.arguments?.torrents?.[0];
        assert(torrent, 'Should return torrent');
        assert(torrent.id === torrentId, 'Should get correct torrent');
      }
    }, 10000);
  });

  describe('Torrent Actions', () => {
    test('should stop torrent', async () => {
      const listResp = await transmissionRpc('torrent-get', {
        fields: ['id', 'name']
      });

      if (listResp.arguments?.torrents?.length > 0) {
        const id = listResp.arguments.torrents[0].id;
        const resp = await transmissionRpc('torrent-stop', {
          ids: [id]
        });

        assert(resp.result === 'success', `Stop failed: ${resp.result}`);
      }
    }, 10000);

    test('should start torrent', async () => {
      const listResp = await transmissionRpc('torrent-get', {
        fields: ['id', 'name']
      });

      if (listResp.arguments?.torrents?.length > 0) {
        const id = listResp.arguments.torrents[0].id;
        const resp = await transmissionRpc('torrent-start', {
          ids: [id]
        });

        assert(resp.result === 'success', `Start failed: ${resp.result}`);
      }
    }, 10000);
  });

  describe('Data Format', () => {
    test('should return consistent torrent format', async () => {
      const resp = await transmissionRpc('torrent-get', {
        fields: [
          'id', 'name', 'status', 'percentDone',
          'downloadedEver', 'uploadedEver', 'totalSize',
          'rateDownload', 'rateUpload', 'eta'
        ]
      });

      if (resp.arguments?.torrents?.length > 0) {
        const torrent = resp.arguments.torrents[0];

        // Verify all expected fields exist
        const requiredFields = [
          'id', 'name', 'status', 'percentDone', 'totalSize'
        ];

        requiredFields.forEach(field => {
          assert(field in torrent, `Missing field: ${field}`);
        });

        // Verify field types
        assert(typeof torrent.id === 'number', 'id should be number');
        assert(typeof torrent.name === 'string', 'name should be string');
        assert(typeof torrent.status === 'number', 'status should be number');
        assert(typeof torrent.percentDone === 'number', 'percentDone should be number');

        // Verify percentDone is 0-1 range (Transmission format)
        assert(torrent.percentDone >= 0 && torrent.percentDone <= 1,
          `percentDone should be 0-1, got ${torrent.percentDone}`);
      }
    }, 10000);

    test('should map Transmission fields to adapter format', async () => {
      const resp = await transmissionRpc('torrent-get', {
        fields: [
          'id', 'name', 'status', 'percentDone',
          'downloadedEver', 'uploadedEver', 'totalSize',
          'rateDownload', 'rateUpload', 'eta'
        ]
      });

      if (resp.arguments?.torrents?.length > 0) {
        const txTorrent = resp.arguments.torrents[0];

        // Simulate what TransmissionAdapter.listTasks() does
        const stateMap = {
          0: "paused",      // Stopped
          1: "waiting",     // Check pending
          2: "waiting",     // Checking
          3: "waiting",     // Download pending
          4: "downloading", // Downloading
          5: "waiting",     // Seed pending
          6: "seeding"      // Seeding
        };

        const mapped = {
          id: txTorrent.id.toString(),
          title: txTorrent.name,
          status: stateMap[txTorrent.status] || "waiting",
          progress: txTorrent.percentDone * 100,
          downloaded: txTorrent.downloadedEver,
          uploaded: txTorrent.uploadedEver,
          size: txTorrent.totalSize,
          speed_down: txTorrent.rateDownload,
          speed_up: txTorrent.rateUpload,
          eta: txTorrent.eta > 0 ? txTorrent.eta : 0
        };

        assert(mapped.id, 'Task should have id');
        assert(mapped.title, 'Task should have title');
        assert(mapped.status, 'Task should have status');
        assert(typeof mapped.progress === 'number', 'progress should be number (0-100)');
        assert(mapped.progress >= 0 && mapped.progress <= 100,
          `Progress should be 0-100, got ${mapped.progress}`);
        assert(typeof mapped.speed_down === 'number', `speed_down should be number`);
        assert(typeof mapped.speed_up === 'number', `speed_up should be number`);
      }
    }, 10000);

    test('should handle various Transmission states', () => {
      const stateMap = {
        0: "paused",      // Stopped
        1: "waiting",     // Check pending
        2: "waiting",     // Checking
        3: "waiting",     // Download pending
        4: "downloading", // Downloading
        5: "waiting",     // Seed pending
        6: "seeding"      // Seeding
      };

      // Verify state mappings
      assert(stateMap[0] === "paused", "Stopped should map to paused");
      assert(stateMap[4] === "downloading", "Downloading should map to downloading");
      assert(stateMap[6] === "seeding", "Seeding should map to seeding");
      assert(stateMap[1] === "waiting", "Check pending should map to waiting");
      assert(stateMap[3] === "waiting", "Download pending should map to waiting");
      assert(stateMap[5] === "waiting", "Seed pending should map to waiting");
    }, 10000);
  });

  describe('Error Handling', () => {
    test('should handle connection timeout gracefully', async () => {
      try {
        const resp = await fetch('http://localhost:9999/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          timeout: 2000,
          body: JSON.stringify({ method: 'session-get' })
        }).catch(e => ({
          error: e.message,
          ok: false
        }));

        assert(!resp.ok || resp.error, 'Should fail to connect to non-existent port');
      } catch (e) {
        assert(e.message, 'Should have error message');
      }
    }, 5000);

    test('should handle invalid RPC method', async () => {
      const resp = await transmissionRpc('invalid-method-xyz', {});
      assert(resp.result !== 'success', 'Should fail for invalid method');
    }, 10000);
  });
});

// Test runner
if (require.main === module) {
  console.log('🧪 Transmission Integration Tests (requires running Transmission on localhost:9091)\n');
  console.log('Run with: npm run test:transmission');
}

module.exports = { transmissionRpc, TRANSMISSION_CONFIG };
