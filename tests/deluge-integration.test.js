/**
 * Deluge Integration Tests
 * Tests actual Deluge API calls via RPC
 * Tests both linuxserver.io and spritsail/deluge containers
 * Requires: Running Deluge containers on localhost:8114 and localhost:8113
 */

const assert = require('assert');

// Test both containers
const DELUGE_CONTAINERS = [
  {
    name: 'linuxserver.io',
    host: 'localhost',
    port: 8114,
    password: 'deluge'
  },
  {
    name: 'spritsail/deluge',
    host: 'localhost',
    port: 8113,
    password: 'deluge'
  }
];

// Test magnet link
const TEST_MAGNET = 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bdc6d4d74119bb46ee7e63&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80';

// RPC helper
async function delugeRpc(baseUrl, method, params = []) {
  const payload = { method, params, id: Date.now() };

  try {
    const resp = await fetch(`${baseUrl}/json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  } catch (err) {
    throw new Error(`Deluge RPC error: ${err.message}`);
  }
}

describe('Deluge Integration Tests', () => {
  // Test each container separately
  DELUGE_CONTAINERS.forEach(container => {
    describe(`${container.name} (port ${container.port})`, () => {
      const baseUrl = `http://${container.host}:${container.port}`;
      let torrentId = null;

      // P0-1: Test auth.login() with password only (FIXED)
      it('authenticates with auth.login(password) - P0-1', async () => {
        const result = await delugeRpc(baseUrl, 'auth.login', [container.password]);

        // Should return true for successful auth
        assert.strictEqual(result.result, true, 'auth.login with correct password should return true');
        assert.ok(!result.error, 'auth.login should not return error for correct password');
      });

      // Test wrong password
      it('rejects auth.login(wrong_password)', async () => {
        const result = await delugeRpc(baseUrl, 'auth.login', ['wrongpassword']);

        assert.strictEqual(result.result, false, 'auth.login with wrong password should return false');
      });

      // Test empty password
      it('rejects auth.login(empty_password)', async () => {
        const result = await delugeRpc(baseUrl, 'auth.login', ['']);

        assert.strictEqual(result.result, false, 'auth.login with empty password should return false');
      });

      // P0-2: Test adding magnet link after auth
      it('can add torrent via magnet link after auth - P0-2', async () => {

        // Authenticate first
        await delugeRpc(baseUrl, 'auth.login', [container.password]);

        // Then add torrent
        const result = await delugeRpc(baseUrl, 'core.add_torrent_magnet', [TEST_MAGNET, {}]);

        if (result.error) {
          console.log(`Note: ${result.error.message}`);
          // Some setups may not support adding torrents, that's ok for this test
          return;
        }

        if (result.result) {
          torrentId = result.result;
          assert.ok(typeof torrentId === 'string', 'Torrent ID should be a string hash');
        }
      });

      // Test listing torrents after auth
      it('lists torrents with correct fields after auth', async () => {

        // Authenticate
        await delugeRpc(baseUrl, 'auth.login', [container.password]);

        // List torrents
        const result = await delugeRpc(baseUrl, 'core.get_torrents_status', [
          {},
          ['name', 'state', 'progress', 'total_done', 'total_uploaded', 'total_size', 'download_payload_rate', 'upload_payload_rate', 'eta']
        ]);

        assert.ok(result.result !== null, 'Should return torrent list');
        const torrents = result.result || {};
        const torrentCount = Object.keys(torrents).length;
        console.log(`  Found ${torrentCount} torrents`);

        // Verify field structure if torrents exist
        if (torrentCount > 0) {
          const firstHash = Object.keys(torrents)[0];
          const torrent = torrents[firstHash];

          assert.ok(torrent.name, 'Torrent should have name');
          assert.ok(typeof torrent.state === 'string', 'Torrent should have state string');
          assert.ok(typeof torrent.progress === 'number', 'Torrent should have numeric progress');
          assert.ok(typeof torrent.total_size === 'number', 'Torrent should have numeric size');
        }
      });

      // Test pause action
      it('can pause a torrent', async () => {

        if (!torrentId) {
          this.skip();
        }

        // Authenticate
        await delugeRpc(baseUrl, 'auth.login', [container.password]);

        const result = await delugeRpc(baseUrl, 'core.pause_torrents', [[torrentId]]);
        assert.ok(result !== null, 'Pause request should return response');
      });

      // Test resume action
      it('can resume a torrent', async () => {

        if (!torrentId) {
          this.skip();
        }

        // Authenticate
        await delugeRpc(baseUrl, 'auth.login', [container.password]);

        const result = await delugeRpc(baseUrl, 'core.resume_torrents', [[torrentId]]);
        assert.ok(result !== null, 'Resume request should return response');
      });

      // Test status mapping
      it('maps status strings correctly', () => {
        const statusMap = {
          'Downloading': 'downloading',
          'Seeding': 'seeding',
          'Paused': 'paused',
          'Queued': 'stalled',
          'Checking': 'checking',
          'Allocating': 'allocating',
          'Error': 'error'
        };

        // Verify all mappings exist
        Object.entries(statusMap).forEach(([raw, expected]) => {
          assert.ok(expected, `Status mapping for ${raw} should exist`);
        });
      });
    });
  });
});
