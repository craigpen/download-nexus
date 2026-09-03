/**
 * JDownloader 2 Integration Tests
 *
 * Exercises the real JDownloader 2 "deprecated" RemoteAPI over HTTP, verifying
 * the exact endpoints and response envelopes that `JDownloaderAdapter` in
 * `src/background.js` depends on.
 *
 * Requires a running JDownloader 2 desktop instance with:
 *   Settings → Advanced Settings → RemoteAPI.deprecatedapienabled = true
 *   Settings → Advanced Settings → RemoteAPI.port = 3128
 *
 * JDownloader is a desktop application and cannot be containerised for CI, so
 * these tests SKIP (rather than fail) when nothing answers on the API port.
 * Override the target with JD_HOST / JD_PORT.
 *
 * Run with: npm run test:jdownloader:integration
 */

const assert = require('assert');

const JD_HOST = process.env.JD_HOST || '127.0.0.1';
const JD_PORT = parseInt(process.env.JD_PORT || '3128', 10);
const BASE_URL = `http://${JD_HOST}:${JD_PORT}`;

// JDownloader is a direct-download manager: it parses http(s) links natively
// but not magnet URIs (which is why the popup blocks magnets for this service).
// A uniquely-named URL keeps the added link identifiable and easy to clean up.
const TEST_MARKER = `download-nexus-selftest-${Date.now()}`;
const TEST_LINK = `https://example.com/${TEST_MARKER}.zip`;
const TEST_MAGNET =
  'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bdc6d4d74119bb46ee7e63&dn=Big+Buck+Bunny';
const TEST_PACKAGE = 'DownloadNexusIntegrationTest';

/** Query params the adapter sends to downloadsV2/queryLinks. */
const DOWNLOAD_QUERY_PARAMS = {
  bytesLoaded: true,
  bytesTotal: true,
  speed: true,
  status: true,
  eta: true,
  finished: true,
  running: true,
  extractionStatus: true,
  skipped: true
};

/** Query params the adapter sends to linkcollector/queryLinks. */
const COLLECTOR_QUERY_PARAMS = {
  name: true,
  bytesTotal: true,
  status: true,
  packageUUID: true
};

let available = false;
let skipReason = '';

async function jdGet(pathAndQuery, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${BASE_URL}${pathAndQuery}`, {
      method: 'GET',
      signal: controller.signal
    });
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { ok: resp.ok, status: resp.status, text, json };
  } finally {
    clearTimeout(timer);
  }
}

/** Skip the body of a test when no JDownloader is reachable. */
function requireJd() {
  if (!available) {
    console.log(`  ⏭  skipped — ${skipReason}`);
    return false;
  }
  return true;
}

beforeAll(async () => {
  try {
    const res = await jdGet('/jd/version', 3000);
    if (res.ok) {
      available = true;
      console.log(`  ✓ JDownloader RemoteAPI reachable at ${BASE_URL}`);
    } else {
      skipReason = `RemoteAPI at ${BASE_URL} returned HTTP ${res.status} `
        + `(is RemoteAPI.deprecatedapienabled set to true?)`;
    }
  } catch (err) {
    skipReason = `no JDownloader RemoteAPI on ${BASE_URL} (${err.name === 'AbortError' ? 'timeout' : err.message})`;
  }

  if (!available) {
    console.log(`\n  ⚠  JDownloader integration tests skipped: ${skipReason}\n`);
  }
}, 15000);

describe('JDownloader 2 Integration Tests', () => {
  describe('Connectivity — /jd/version', () => {
    it('responds to the version probe the adapter uses', async () => {
      if (!requireJd()) return;

      const res = await jdGet('/jd/version');

      assert.ok(res.ok, `GET /jd/version should return 2xx, got ${res.status}`);
      assert.ok(res.json !== null, '/jd/version should return JSON');
    });

    it('wraps the build number in a "data" property', async () => {
      if (!requireJd()) return;

      const res = await jdGet('/jd/version');

      // The adapter reads `resJson.data` and falls back to "Active".
      assert.ok(
        Object.prototype.hasOwnProperty.call(res.json, 'data'),
        'Response should carry a "data" field holding the build number'
      );
      console.log(`  JDownloader build: ${res.json.data}`);
    });

    it('rejects an unknown endpoint rather than returning 200', async () => {
      if (!requireJd()) return;

      const res = await jdGet('/definitely/not/an/endpoint');
      assert.ok(!res.ok, 'An unknown endpoint should not return 2xx');
    });
  });

  describe('Download list — /downloadsV2/queryLinks', () => {
    it('accepts the adapter\'s URL-encoded params object', async () => {
      if (!requireJd()) return;

      const params = encodeURIComponent(JSON.stringify(DOWNLOAD_QUERY_PARAMS));
      const res = await jdGet(`/downloadsV2/queryLinks?params=${params}`);

      assert.ok(res.ok, `queryLinks should return 2xx, got ${res.status}`);
      assert.ok(res.json !== null, 'queryLinks should return JSON');
    });

    it('returns the link list under "data" as an array', async () => {
      if (!requireJd()) return;

      const params = encodeURIComponent(JSON.stringify(DOWNLOAD_QUERY_PARAMS));
      const res = await jdGet(`/downloadsV2/queryLinks?params=${params}`);

      // The adapter does `data?.data || []`, so a missing key is tolerable,
      // but when present it must be an array.
      if (res.json.data !== undefined) {
        assert.ok(Array.isArray(res.json.data), '"data" should be an array of links');
        console.log(`  ${res.json.data.length} link(s) in the download list`);
      }
    });

    it('link entries expose the fields the adapter maps', async () => {
      if (!requireJd()) return;

      const params = encodeURIComponent(JSON.stringify(DOWNLOAD_QUERY_PARAMS));
      const res = await jdGet(`/downloadsV2/queryLinks?params=${params}`);
      const links = res.json?.data || [];

      if (links.length === 0) {
        console.log('  (no links present — field shape not asserted)');
        return;
      }

      const item = links[0];
      // `uuid` is the id the adapter prefers; the rest drive progress/status.
      assert.ok(
        item.uuid !== undefined || item.id !== undefined || item.name !== undefined,
        'A link must expose uuid, id or name so the adapter can derive an id'
      );
      ['bytesTotal', 'bytesLoaded', 'speed'].forEach((field) => {
        if (item[field] !== undefined) {
          assert.strictEqual(typeof item[field], 'number', `${field} should be numeric`);
        }
      });
      if (item.finished !== undefined) {
        assert.strictEqual(typeof item.finished, 'boolean', 'finished should be boolean');
      }
    });
  });

  describe('Link collector — /linkcollector/queryLinks', () => {
    it('accepts the adapter\'s params and returns JSON', async () => {
      if (!requireJd()) return;

      const params = encodeURIComponent(JSON.stringify(COLLECTOR_QUERY_PARAMS));
      const res = await jdGet(`/linkcollector/queryLinks?params=${params}`);

      assert.ok(res.ok, `linkcollector/queryLinks should return 2xx, got ${res.status}`);
      assert.ok(res.json !== null, 'Should return JSON');
      if (res.json.data !== undefined) {
        assert.ok(Array.isArray(res.json.data), '"data" should be an array');
      }
    });
  });

  describe('Add / inspect / remove lifecycle', () => {
    let addedLinkIds = [];

    it('adds an http link via /linkcollector/addLinks', async () => {
      if (!requireJd()) return;

      // Exactly the query shape JDownloaderAdapter.addDownload builds.
      const query = `links=${encodeURIComponent(TEST_LINK)}`
        + `&packageName=${TEST_PACKAGE}`
        + '&extractPassword=&downloadPassword=';
      const res = await jdGet(`/linkcollector/addLinks?${query}`);

      assert.ok(res.ok, `addLinks should return 2xx, got ${res.status}`);
    }, 20000);

    it('accepts a magnet URI without erroring, even though JD cannot parse it', async () => {
      if (!requireJd()) return;

      const query = `links=${encodeURIComponent(TEST_MAGNET)}`
        + `&packageName=${TEST_PACKAGE}`
        + '&extractPassword=&downloadPassword=';
      const res = await jdGet(`/linkcollector/addLinks?${query}`);

      // The API accepts the call; whether a magnet yields a usable link is up
      // to JDownloader's plugins. The adapter therefore cannot rely on it,
      // which is why the popup blocks magnets for this service type.
      assert.ok(res.ok, `addLinks with a magnet should still return 2xx, got ${res.status}`);
    }, 20000);

    it('the added link becomes visible in the link collector', async () => {
      if (!requireJd()) return;

      const params = encodeURIComponent(JSON.stringify(COLLECTOR_QUERY_PARAMS));

      // JDownloader parses links asynchronously; poll until it surfaces.
      let found = [];
      for (let attempt = 0; attempt < 20 && found.length === 0; attempt++) {
        await new Promise((r) => setTimeout(r, 500));
        const res = await jdGet(`/linkcollector/queryLinks?params=${params}`);
        const links = res.json?.data || [];
        found = links.filter((l) => String(l.name || '').includes(TEST_MARKER));
      }

      assert.ok(
        found.length > 0,
        `Added link "${TEST_MARKER}" should appear in the link collector within 10s`
      );

      addedLinkIds = found
        .map((l) => l.uuid ?? l.uniqueID)
        .filter((id) => id !== undefined);

      assert.ok(addedLinkIds.length > 0, 'Added link should expose a uuid or uniqueID');
      // The adapter stringifies these ids, then coerces numeric ones back.
      addedLinkIds.forEach((id) => {
        assert.ok(['number', 'string'].includes(typeof id), 'id should be a number or string');
      });
    }, 30000);

    it('removes the test link via the adapter\'s removeLinks call', async () => {
      if (!requireJd()) return;
      if (addedLinkIds.length === 0) {
        console.log('  (nothing to clean up)');
        return;
      }

      const linkIds = encodeURIComponent(JSON.stringify(addedLinkIds));
      const res = await jdGet(
        `/linkcollector/removeLinks?linkIds=${linkIds}&packageIds=%5B%5D`
      );

      assert.ok(res.ok, `removeLinks should return 2xx, got ${res.status}`);
    }, 20000);

    it('the removed link no longer appears in the link collector', async () => {
      if (!requireJd()) return;
      if (addedLinkIds.length === 0) {
        console.log('  (nothing was added, so nothing to verify)');
        return;
      }

      const params = encodeURIComponent(JSON.stringify(COLLECTOR_QUERY_PARAMS));

      let still = [];
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((r) => setTimeout(r, 500));
        const res = await jdGet(`/linkcollector/queryLinks?params=${params}`);
        const links = res.json?.data || [];
        still = links.filter((l) => String(l.name || '').includes(TEST_MARKER));
        if (still.length === 0) break;
      }

      assert.strictEqual(still.length, 0, 'Removed link should be gone from the collector');
    }, 20000);

    afterAll(async () => {
      // Best-effort cleanup so repeated runs leave nothing behind — including
      // anything the magnet call may have created under the test package.
      if (!available) return;

      try {
        const params = encodeURIComponent(JSON.stringify(COLLECTOR_QUERY_PARAMS));
        const res = await jdGet(`/linkcollector/queryLinks?params=${params}`);
        const links = res.json?.data || [];

        const stale = links
          .filter((l) => {
            const name = String(l.name || '');
            return name.includes(TEST_MARKER) || name.includes('Big Buck Bunny');
          })
          .map((l) => l.uuid ?? l.uniqueID)
          .filter((id) => id !== undefined);

        const ids = [...new Set([...addedLinkIds, ...stale])];
        if (ids.length === 0) return;

        const linkIds = encodeURIComponent(JSON.stringify(ids));
        await jdGet(`/linkcollector/removeLinks?linkIds=${linkIds}&packageIds=%5B%5D`);
        await jdGet(`/downloadsV2/removeLinks?linkIds=${linkIds}&packageIds=%5B%5D`);
      } catch {
        // Cleanup is best-effort; never fail the suite on it.
      }
    }, 20000);
  });

  describe('Toolbar actions', () => {
    it('exposes /toolbar/startDownloads', async () => {
      if (!requireJd()) return;
      const res = await jdGet('/toolbar/startDownloads');
      assert.ok(res.ok, `startDownloads should return 2xx, got ${res.status}`);
    });

    it('exposes /toolbar/togglePauseDownloads and can be toggled back', async () => {
      if (!requireJd()) return;

      const first = await jdGet('/toolbar/togglePauseDownloads');
      assert.ok(first.ok, `togglePauseDownloads should return 2xx, got ${first.status}`);

      // Toggle again so the run leaves JDownloader in its original state.
      const second = await jdGet('/toolbar/togglePauseDownloads');
      assert.ok(second.ok, 'Toggling back should also succeed');
    });
  });

  describe('Adapter contract expectations', () => {
    it('all endpoints the adapter calls are reachable', async () => {
      if (!requireJd()) return;

      const endpoints = [
        '/jd/version',
        `/downloadsV2/queryLinks?params=${encodeURIComponent(JSON.stringify(DOWNLOAD_QUERY_PARAMS))}`,
        `/linkcollector/queryLinks?params=${encodeURIComponent(JSON.stringify(COLLECTOR_QUERY_PARAMS))}`,
        '/toolbar/startDownloads'
      ];

      const results = await Promise.all(endpoints.map(async (e) => {
        const res = await jdGet(e);
        return { endpoint: e.split('?')[0], ok: res.ok, status: res.status };
      }));

      const broken = results.filter((r) => !r.ok);
      assert.strictEqual(
        broken.length, 0,
        `Unreachable endpoints: ${broken.map((b) => `${b.endpoint} (${b.status})`).join(', ')}`
      );
    });

    it('responds on the default port the extension assumes (3128)', () => {
      if (!requireJd()) return;
      // Documents the coupling: src/options.js and src/popup.js both default
      // JDownloader to 3128, matching JDownloaderAdapter._getBaseUrl().
      assert.strictEqual(JD_PORT, 3128, 'Default integration target should be 3128');
    });
  });
});
