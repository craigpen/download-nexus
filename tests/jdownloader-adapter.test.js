/**
 * JDownloader 2 Adapter Unit Tests
 *
 * IMPORTANT: These tests exercise the REAL `JDownloaderAdapter` from
 * `src/background.js` (obtained via the exported `getAdapter` factory) with a
 * mocked `fetch`. This is deliberately different from `tests/adapters.test.js`,
 * which asserts against inline mock re-implementations and therefore cannot
 * catch regressions in the shipped adapter.
 */

const { installChromeStub } = require('./helpers/chromeStub');

installChromeStub();

const { getAdapter } = require('../src/background.js');

// ── fetch mocking helpers ───────────────────────────────────────────────────

/** Build a Response-like object. */
function res(body, { ok = true, status = 200, statusText = 'OK' } = {}) {
  return {
    ok,
    status,
    statusText,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

let fetchMock;
const realFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock = jest.fn();
  globalThis.fetch = fetchMock;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = realFetch;
  jest.restoreAllMocks();
});

/** All URLs passed to fetch, in call order. */
const calledUrls = () => fetchMock.mock.calls.map((c) => c[0]);
/** First fetched URL matching a substring. */
const urlContaining = (frag) => calledUrls().find((u) => u.includes(frag));

const JD_CONFIG = {
  type: 'jdownloader',
  id: 'jd-1',
  name: 'Local JDownloader',
  host: '127.0.0.1',
  port: 3128,
  https: false
};

const makeAdapter = (cfg = {}) => getAdapter('jd-1', { ...JD_CONFIG, ...cfg });

describe('JDownloaderAdapter (real implementation)', () => {
  describe('getAdapter factory', () => {
    test('returns a JDownloader adapter for type "jdownloader"', () => {
      const adapter = makeAdapter();
      expect(adapter).toBeDefined();
      expect(adapter.constructor.name).toBe('JDownloaderAdapter');
      expect(typeof adapter.testConnection).toBe('function');
      expect(typeof adapter.listTasks).toBe('function');
      expect(typeof adapter.addDownload).toBe('function');
      expect(typeof adapter.taskAction).toBe('function');
    });

    test('throws for an unknown service type', () => {
      expect(() => getAdapter('x', { type: 'not-a-real-service' }))
        .toThrow(/Unknown NAS type: not-a-real-service/);
    });

    test('preserves nasId and config on the instance', () => {
      const adapter = makeAdapter();
      expect(adapter.nasId).toBe('jd-1');
      expect(adapter.config.port).toBe(3128);
    });
  });

  describe('_getBaseUrl()', () => {
    test('builds an http URL from host and port', () => {
      expect(makeAdapter()._getBaseUrl()).toBe('http://127.0.0.1:3128');
    });

    test('uses https when the https flag is set', () => {
      expect(makeAdapter({ https: true })._getBaseUrl()).toBe('https://127.0.0.1:3128');
    });

    test('falls back to 127.0.0.1:3128 when host and port are absent', () => {
      const adapter = getAdapter('jd', { type: 'jdownloader' });
      expect(adapter._getBaseUrl()).toBe('http://127.0.0.1:3128');
    });

    test('honours the Click\'n\'Load port 9666', () => {
      expect(makeAdapter({ port: 9666 })._getBaseUrl()).toBe('http://127.0.0.1:9666');
    });

    test('supports a non-loopback host', () => {
      expect(makeAdapter({ host: 'jd.lan', port: 3128 })._getBaseUrl())
        .toBe('http://jd.lan:3128');
    });
  });

  describe('_displayStatus()', () => {
    const status = (item, isLinkCollector = false) =>
      makeAdapter()._displayStatus(item, isLinkCollector);

    test('link-collector items are always reported as stalled', () => {
      expect(status({ running: true, speed: 9999 }, true)).toBe('stalled');
      expect(status({ finished: true }, true)).toBe('stalled');
      expect(status({}, true)).toBe('stalled');
    });

    test('finished takes precedence over every other signal', () => {
      expect(status({ finished: true })).toBe('finished');
      expect(status({ finished: true, status: 'Plugin Defect' })).toBe('finished');
      expect(status({ finished: true, skipped: true })).toBe('finished');
    });

    test('skipped items are reported as paused', () => {
      expect(status({ skipped: true })).toBe('paused');
      expect(status({ skipped: true, status: 'Downloading' })).toBe('paused');
    });

    test.each([
      ['Download failed', 'error'],
      ['Plugin Defect', 'error'],
      ['File missing', 'error'],
      ['CRC check failed', 'error'],
      ['ERROR: fatal', 'error']
    ])('maps error-ish status %s to %s', (raw, expected) => {
      expect(status({ status: raw })).toBe(expected);
    });

    test('extraction errors are reported as error', () => {
      expect(status({ extractionStatus: 'ERROR' })).toBe('error');
      expect(status({ extractionStatus: 'Extraction Error' })).toBe('error');
    });

    test('error detection wins over an otherwise-active item', () => {
      expect(status({ running: true, speed: 1024, status: 'Download failed' })).toBe('error');
    });

    test.each([
      ['Paused', 'paused'],
      ['paused by user', 'paused'],
      ['Stopped', 'paused']
    ])('maps paused-ish status %s to %s', (raw, expected) => {
      expect(status({ status: raw })).toBe(expected);
    });

    test.each([
      ['Waiting for slot', 'stalled'],
      ['Queued', 'stalled'],
      ['Waiting for captcha', 'stalled'],
      ['Reconnect required', 'stalled'],
      ['IP limit reached', 'stalled']
    ])('maps waiting-ish status %s to %s', (raw, expected) => {
      expect(status({ status: raw })).toBe(expected);
    });

    test('paused check precedes the stalled check', () => {
      // "stop" matches the paused branch even though "queue" is also present
      expect(status({ status: 'Stopped in queue' })).toBe('paused');
    });

    test.each([
      [{ running: true }, 'downloading'],
      [{ speed: 1024 }, 'downloading'],
      [{ status: 'Downloading' }, 'downloading'],
      [{ status: 'Starting' }, 'downloading'],
      [{ status: 'Connecting' }, 'downloading'],
      [{ extractionStatus: 'RUNNING' }, 'downloading']
    ])('maps active item %j to %s', (item, expected) => {
      expect(status(item)).toBe(expected);
    });

    test('defaults to downloading for an unrecognised status', () => {
      expect(status({})).toBe('downloading');
      expect(status({ status: 'Something Novel' })).toBe('downloading');
    });

    test('a zero speed alone does not imply downloading, but still defaults to it', () => {
      expect(status({ speed: 0 })).toBe('downloading');
    });

    test('tolerates null/undefined status fields without throwing', () => {
      expect(() => status({ status: null, extractionStatus: undefined })).not.toThrow();
      expect(status({ status: null })).toBe('downloading');
    });
  });

  describe('testConnection()', () => {
    test('queries /jd/version and reports the build number', async () => {
      fetchMock.mockResolvedValue(res({ data: '48213' }));

      const result = await makeAdapter().testConnection();

      expect(result).toEqual({ ok: true, version: 'JDownloader 2 (Build 48213)' });
      expect(urlContaining('/jd/version')).toBe('http://127.0.0.1:3128/jd/version');
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET' });
    });

    test('passes an AbortSignal so the probe cannot hang', async () => {
      fetchMock.mockResolvedValue(res({ data: '1' }));
      await makeAdapter().testConnection();
      expect(fetchMock.mock.calls[0][1].signal).toBeDefined();
    });

    test('falls back to "Active" when the payload has no data field', async () => {
      fetchMock.mockResolvedValue(res({}));
      const result = await makeAdapter().testConnection();
      expect(result.version).toBe('JDownloader 2 (Build Active)');
    });

    test('throws the RemoteAPI setup hint on a non-OK response', async () => {
      fetchMock.mockResolvedValue(res('', { ok: false, status: 404, statusText: 'Not Found' }));

      await expect(makeAdapter().testConnection())
        .rejects.toThrow(/Cannot connect to JDownloader 2 on http:\/\/127\.0\.0\.1:3128/);
      await expect(makeAdapter().testConnection())
        .rejects.toThrow(/RemoteAPI\.deprecatedapienabled/);
    });

    test('throws the same hint when the network call rejects', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(makeAdapter().testConnection())
        .rejects.toThrow(/Make sure JDownloader is running/);
    });

    test('surfaces the configured base URL in the error message', async () => {
      fetchMock.mockRejectedValue(new Error('boom'));
      await expect(makeAdapter({ host: 'jd.lan', port: 9666 }).testConnection())
        .rejects.toThrow(/http:\/\/jd\.lan:9666/);
    });

    test('does not leak the underlying error text into the user-facing message', async () => {
      fetchMock.mockRejectedValue(new Error('super-secret-internal-detail'));
      await expect(makeAdapter().testConnection())
        .rejects.not.toThrow(/super-secret-internal-detail/);
    });
  });

  describe('listTasks()', () => {
    /** Route the two queryLinks endpoints to given payloads. */
    function routeQueries({ downloads, collector }) {
      fetchMock.mockImplementation((url) => {
        if (url.includes('/downloadsV2/queryLinks')) {
          return downloads instanceof Error
            ? Promise.reject(downloads)
            : Promise.resolve(res({ data: downloads }));
        }
        if (url.includes('/linkcollector/queryLinks')) {
          return collector instanceof Error
            ? Promise.reject(collector)
            : Promise.resolve(res({ data: collector }));
        }
        return Promise.resolve(res({}));
      });
    }

    test('queries both the download list and the link collector', async () => {
      routeQueries({ downloads: [], collector: [] });
      await makeAdapter().listTasks();

      expect(urlContaining('/downloadsV2/queryLinks')).toBeDefined();
      expect(urlContaining('/linkcollector/queryLinks')).toBeDefined();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test('normalises an active download into the common task shape', async () => {
      routeQueries({
        downloads: [{
          uuid: 1234,
          name: 'ubuntu.iso',
          bytesTotal: 1000,
          bytesLoaded: 250,
          speed: 5120,
          running: true,
          status: 'Downloading'
        }],
        collector: []
      });

      const tasks = await makeAdapter().listTasks();

      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toEqual({
        id: '1234',
        title: 'ubuntu.iso',
        status: 'downloading',
        progress: 25,
        downloaded: 250,
        size: 1000,
        speed_down: 5120,
        speed_up: 0
      });
    });

    test('ids are stringified for consistency with other adapters', async () => {
      routeQueries({ downloads: [{ uuid: 99, name: 'a' }], collector: [] });
      const tasks = await makeAdapter().listTasks();
      expect(typeof tasks[0].id).toBe('string');
      expect(tasks[0].id).toBe('99');
    });

    test('falls back from uuid to id to name for the task id', async () => {
      routeQueries({
        downloads: [
          { id: 7, name: 'by-id' },
          { name: 'by-name' }
        ],
        collector: []
      });
      const tasks = await makeAdapter().listTasks();
      expect(tasks[0].id).toBe('7');
      expect(tasks[1].id).toBe('by-name');
    });

    test('reports 100% for a finished item with no known total size', async () => {
      routeQueries({
        downloads: [{ uuid: 1, name: 'done', bytesTotal: 0, finished: true }],
        collector: []
      });
      const tasks = await makeAdapter().listTasks();
      expect(tasks[0].progress).toBe(100);
      expect(tasks[0].status).toBe('finished');
    });

    test('reports 0% for an unstarted item with no known total size', async () => {
      routeQueries({
        downloads: [{ uuid: 1, name: 'pending', bytesTotal: 0, finished: false }],
        collector: []
      });
      expect((await makeAdapter().listTasks())[0].progress).toBe(0);
    });

    test('clamps progress into the 0-100 range when the API over-reports', async () => {
      routeQueries({
        downloads: [{ uuid: 1, name: 'over', bytesTotal: 100, bytesLoaded: 500 }],
        collector: []
      });
      expect((await makeAdapter().listTasks())[0].progress).toBe(100);
    });

    test('defaults a missing name to "Download"', async () => {
      routeQueries({ downloads: [{ uuid: 5 }], collector: [] });
      expect((await makeAdapter().listTasks())[0].title).toBe('Download');
    });

    test('link-collector entries are appended as stalled, zero-progress tasks', async () => {
      routeQueries({
        downloads: [],
        collector: [{ uuid: 42, name: 'queued.rar', bytesTotal: 8000 }]
      });

      const tasks = await makeAdapter().listTasks();

      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toEqual({
        id: '42',
        title: 'queued.rar',
        status: 'stalled',
        progress: 0,
        downloaded: 0,
        size: 8000,
        speed_down: 0,
        speed_up: 0
      });
    });

    test('defaults a missing link-collector name to "Queued Link"', async () => {
      routeQueries({ downloads: [], collector: [{ uuid: 1 }] });
      expect((await makeAdapter().listTasks())[0].title).toBe('Queued Link');
    });

    test('falls back to uniqueID for link-collector ids', async () => {
      routeQueries({ downloads: [], collector: [{ uniqueID: 'abc', name: 'x' }] });
      expect((await makeAdapter().listTasks())[0].id).toBe('abc');
    });

    test('returns downloads first, then link-collector items', async () => {
      routeQueries({
        downloads: [{ uuid: 1, name: 'active' }],
        collector: [{ uuid: 2, name: 'queued' }]
      });
      const tasks = await makeAdapter().listTasks();
      expect(tasks.map((t) => t.title)).toEqual(['active', 'queued']);
    });

    test('still returns download tasks when the link collector fails', async () => {
      routeQueries({
        downloads: [{ uuid: 1, name: 'active' }],
        collector: new Error('collector offline')
      });
      const tasks = await makeAdapter().listTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('active');
    });

    test('still returns collector tasks when the download query fails', async () => {
      routeQueries({
        downloads: new Error('downloads offline'),
        collector: [{ uuid: 2, name: 'queued' }]
      });
      const tasks = await makeAdapter().listTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('queued');
    });

    test('resolves to an empty array when both endpoints fail', async () => {
      routeQueries({
        downloads: new Error('down'),
        collector: new Error('down')
      });
      await expect(makeAdapter().listTasks()).resolves.toEqual([]);
    });

    test('tolerates a non-OK response without throwing', async () => {
      fetchMock.mockResolvedValue(res('', { ok: false, status: 500 }));
      await expect(makeAdapter().listTasks()).resolves.toEqual([]);
    });

    test('tolerates a payload with a missing data array', async () => {
      fetchMock.mockResolvedValue(res({}));
      await expect(makeAdapter().listTasks()).resolves.toEqual([]);
    });
  });

  describe('addDownload()', () => {
    test('posts the link to the link collector and starts the queue', async () => {
      fetchMock.mockResolvedValue(res({ data: true }));

      const result = await makeAdapter().addDownload('https://example.com/file.zip');

      expect(result).toEqual({ ok: true });
      const addUrl = urlContaining('/linkcollector/addLinks');
      expect(addUrl).toContain(encodeURIComponent('https://example.com/file.zip'));
      expect(addUrl).toContain('packageName=DownloadNexus');
      expect(urlContaining('/toolbar/startDownloads')).toBeDefined();
    });

    test('URL-encodes a magnet link, preserving it through the query string', async () => {
      fetchMock.mockResolvedValue(res({}));
      const magnet = 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bdc6d4d74119bb46ee7e63&dn=Big+Buck+Bunny';

      await makeAdapter().addDownload(magnet);

      const addUrl = urlContaining('/linkcollector/addLinks');
      const links = new URL(addUrl).searchParams.get('links');
      expect(links).toBe(magnet);
    });

    test('includes destinationFolder when a destination is supplied', async () => {
      fetchMock.mockResolvedValue(res({}));
      await makeAdapter().addDownload('https://example.com/a.zip', '/downloads/movies');

      const addUrl = urlContaining('/linkcollector/addLinks');
      expect(new URL(addUrl).searchParams.get('destinationFolder')).toBe('/downloads/movies');
    });

    test('omits destinationFolder when no destination is supplied', async () => {
      fetchMock.mockResolvedValue(res({}));
      await makeAdapter().addDownload('https://example.com/a.zip');
      expect(urlContaining('/linkcollector/addLinks')).not.toContain('destinationFolder');
    });

    test('encodes a destination containing spaces', async () => {
      fetchMock.mockResolvedValue(res({}));
      await makeAdapter().addDownload('https://example.com/a.zip', '/My Downloads/TV Shows');

      const addUrl = urlContaining('/linkcollector/addLinks');
      expect(addUrl).not.toMatch(/destinationFolder=[^&]*\s/);
      expect(new URL(addUrl).searchParams.get('destinationFolder')).toBe('/My Downloads/TV Shows');
    });

    test('throws a setup hint when the add call returns a non-OK status', async () => {
      fetchMock.mockResolvedValue(res('', { ok: false, status: 500 }));

      await expect(makeAdapter().addDownload('https://example.com/a.zip'))
        .rejects.toThrow(/Failed to send to JDownloader 2 on http:\/\/127\.0\.0\.1:3128/);
      await expect(makeAdapter().addDownload('https://example.com/a.zip'))
        .rejects.toThrow(/HTTP 500/);
    });

    test('throws a setup hint when the network call rejects', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(makeAdapter().addDownload('https://example.com/a.zip'))
        .rejects.toThrow(/RemoteAPI enabled on port 3128/);
    });

    test('does not start the queue when the add call failed', async () => {
      fetchMock.mockResolvedValue(res('', { ok: false, status: 500 }));
      await expect(makeAdapter().addDownload('https://example.com/a.zip')).rejects.toThrow();
      expect(urlContaining('/toolbar/startDownloads')).toBeUndefined();
    });

    test('a failure of the fire-and-forget start call does not fail the add', async () => {
      fetchMock.mockImplementation((url) => {
        if (url.includes('/toolbar/startDownloads')) return Promise.reject(new Error('nope'));
        return Promise.resolve(res({}));
      });
      await expect(makeAdapter().addDownload('https://example.com/a.zip'))
        .resolves.toEqual({ ok: true });
    });

    test('handles a very long URL without truncating the submitted link', async () => {
      fetchMock.mockResolvedValue(res({}));
      const longUrl = `https://example.com/${'a'.repeat(500)}.zip`;

      await makeAdapter().addDownload(longUrl);

      const addUrl = urlContaining('/linkcollector/addLinks');
      expect(new URL(addUrl).searchParams.get('links')).toBe(longUrl);
    });
  });

  describe('taskAction()', () => {
    beforeEach(() => fetchMock.mockResolvedValue(res({})));

    test('pause toggles the global pause endpoint', async () => {
      const result = await makeAdapter().taskAction('pause', ['1']);
      expect(result).toEqual({ ok: true });
      expect(urlContaining('/toolbar/togglePauseDownloads')).toBeDefined();
    });

    test('resume hits the start-downloads endpoint', async () => {
      const result = await makeAdapter().taskAction('resume', ['1']);
      expect(result).toEqual({ ok: true });
      expect(urlContaining('/toolbar/startDownloads')).toBeDefined();
    });

    test('delete removes links from both the download list and the collector', async () => {
      const result = await makeAdapter().taskAction('delete', ['1', '2']);

      expect(result).toEqual({ ok: true });
      expect(urlContaining('/downloadsV2/removeLinks')).toBeDefined();
      expect(urlContaining('/linkcollector/removeLinks')).toBeDefined();
    });

    test('delete coerces numeric string ids to numbers for the RemoteAPI', async () => {
      await makeAdapter().taskAction('delete', ['10', '20']);

      const url = urlContaining('/downloadsV2/removeLinks');
      expect(JSON.parse(new URL(url).searchParams.get('linkIds'))).toEqual([10, 20]);
    });

    test('delete preserves non-numeric ids as strings', async () => {
      await makeAdapter().taskAction('delete', ['abc', '30']);

      const url = urlContaining('/downloadsV2/removeLinks');
      expect(JSON.parse(new URL(url).searchParams.get('linkIds'))).toEqual(['abc', 30]);
    });

    test('delete sends an empty packageIds array', async () => {
      await makeAdapter().taskAction('delete', ['1']);
      const url = urlContaining('/downloadsV2/removeLinks');
      expect(JSON.parse(new URL(url).searchParams.get('packageIds'))).toEqual([]);
    });

    test('delete with a non-array ids argument sends an empty link list', async () => {
      await makeAdapter().taskAction('delete', undefined);
      const url = urlContaining('/downloadsV2/removeLinks');
      expect(JSON.parse(new URL(url).searchParams.get('linkIds'))).toEqual([]);
    });

    test('an unknown action is a no-op that still reports success', async () => {
      const result = await makeAdapter().taskAction('explode', ['1']);
      expect(result).toEqual({ ok: true });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('returns ok:false with the error message instead of throwing', async () => {
      fetchMock.mockRejectedValue(new Error('connection reset'));
      const result = await makeAdapter().taskAction('pause', ['1']);
      expect(result).toEqual({ ok: false, error: 'connection reset' });
    });

    test('a delete failure is reported rather than thrown', async () => {
      fetchMock.mockRejectedValue(new Error('gone'));
      await expect(makeAdapter().taskAction('delete', ['1'])).resolves
        .toEqual({ ok: false, error: 'gone' });
    });

    test('actions are issued against the configured base URL', async () => {
      await makeAdapter({ host: 'jd.lan', port: 9666 }).taskAction('resume', []);
      expect(urlContaining('/toolbar/startDownloads'))
        .toBe('http://jd.lan:9666/toolbar/startDownloads');
    });
  });

  describe('documented behavioural contracts', () => {
    test('testConnection performs no client-side host/port validation', async () => {
      // NOTE: tests/adapters.test.js asserts a "Settings incomplete" error here,
      // but the real adapter defaults the host/port and probes the network
      // instead. This test pins the actual shipped behaviour.
      fetchMock.mockResolvedValue(res({ data: '1' }));
      await expect(getAdapter('jd', { type: 'jdownloader' }).testConnection())
        .resolves.toMatchObject({ ok: true });
      expect(urlContaining('/jd/version')).toBe('http://127.0.0.1:3128/jd/version');
    });

    test('JDownloader accepts magnet links via addDownload', async () => {
      // The popup blocks magnets for JDownloader at the UI layer; the adapter
      // itself has no such restriction.
      fetchMock.mockResolvedValue(res({}));
      await expect(makeAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .resolves.toEqual({ ok: true });
    });
  });
});
