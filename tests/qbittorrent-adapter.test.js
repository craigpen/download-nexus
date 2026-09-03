/**
 * qBittorrent Adapter Unit Tests
 *
 * IMPORTANT: These tests exercise the REAL `QBittorrentAdapter` from
 * `src/background.js` (obtained via the exported `getAdapter` factory) with a
 * mocked `fetch`. This is deliberately different from `tests/adapters.test.js`,
 * which asserts against inline mock re-implementations and therefore cannot
 * catch regressions in the shipped adapter.
 */

const { installChromeStub } = require('./helpers/chromeStub');

installChromeStub();

const { getAdapter } = require('../src/background.js');

// ── fetch mocking helpers ───────────────────────────────────────────────────

/** Build a Response-like object. `body` may be a string or a JSON-able value. */
function res(body, { ok = true, status = 200, statusText = 'OK' } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok,
    status,
    statusText,
    headers: { get: () => null },
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer
  };
}

/** A non-OK Response-like object (qBittorrent replies with bare status codes). */
const httpErr = (status) => res('', { ok: false, status, statusText: `HTTP ${status}` });

/** Build a Response-like object whose body is raw bytes. */
function binRes(bytes, { ok = true, status = 200 } = {}) {
  const u8 = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(String(bytes));
  return {
    ok,
    status,
    statusText: 'OK',
    headers: { get: () => null },
    json: async () => { throw new Error('not json'); },
    text: async () => new TextDecoder().decode(u8),
    arrayBuffer: async () => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
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

const calledUrls = () => fetchMock.mock.calls.map((c) => String(c[0]));
const urlContaining = (frag) => calledUrls().find((u) => u.includes(frag));
const callsTo = (frag) => fetchMock.mock.calls.filter((c) => String(c[0]).includes(frag));
/** Headers of the first call matching a substring. */
const headersOf = (frag) => (callsTo(frag)[0] || [])[1]?.headers;
/** Body of the first call matching a substring. */
const rawBodyOf = (frag) => (callsTo(frag)[0] || [])[1]?.body;

/**
 * Route qBittorrent endpoints by path fragment. Values may be a Response-like
 * object, an Error (rejected), or an array consumed one entry per call.
 */
function route(map) {
  const queues = new Map();
  fetchMock.mockImplementation((url) => {
    const key = Object.keys(map).find((k) => String(url).includes(k));
    if (key === undefined) return Promise.resolve(res('Ok'));
    let val = map[key];
    if (Array.isArray(val)) {
      if (!queues.has(key)) queues.set(key, [...val]);
      const q = queues.get(key);
      val = q.length > 1 ? q.shift() : q[0];
    }
    return val instanceof Error ? Promise.reject(val) : Promise.resolve(val);
  });
}

/** Bencode a minimal but structurally valid .torrent file. */
function torrentBytes({ announce = null, name = 'test.bin' } = {}) {
  const ann = announce ? `${announce.length}:${announce}` : '';
  const s = `d${announce ? `8:announce${ann}` : ''}4:infod4:name${name.length}:${name}6:lengthi1024eee`;
  return new TextEncoder().encode(s);
}

const QB_CONFIG = {
  type: 'qbittorrent',
  id: 'qb-1',
  name: 'Seedbox',
  host: '10.0.0.9',
  port: 8080,
  https: false,
  username: 'admin',
  password: 'adminadmin'
};

const TOKEN_CONFIG = { ...QB_CONFIG, apiToken: 'tok-123', username: '', password: '' };

const makeAdapter = (cfg = {}) => getAdapter('qb-1', { ...QB_CONFIG, ...cfg });
const makeTokenAdapter = (cfg = {}) => getAdapter('qb-1', { ...TOKEN_CONFIG, ...cfg });

const torrent = (over = {}) => ({
  hash: 'aabbcc',
  name: 'ubuntu.iso',
  state: 'downloading',
  progress: 0.5,
  downloaded: 500,
  uploaded: 20,
  total_size: 1000,
  dlspeed: 4096,
  upspeed: 128,
  eta: 300,
  ...over
});

describe('QBittorrentAdapter (real implementation)', () => {
  describe('getAdapter factory', () => {
    test('returns a qBittorrent adapter for type "qbittorrent"', () => {
      const adapter = makeAdapter();
      expect(adapter.constructor.name).toBe('QBittorrentAdapter');
      expect(typeof adapter.testConnection).toBe('function');
      expect(typeof adapter.listTasks).toBe('function');
      expect(typeof adapter.addDownload).toBe('function');
      expect(typeof adapter.taskAction).toBe('function');
    });

    test('throws for an unknown service type', () => {
      expect(() => getAdapter('x', { type: 'qbittorent' }))
        .toThrow(/Unknown NAS type: qbittorent/);
    });

    test('preserves nasId and config on the instance', () => {
      const adapter = makeAdapter();
      expect(adapter.nasId).toBe('qb-1');
      expect(adapter.config.port).toBe(8080);
    });
  });

  describe('_baseUrl()', () => {
    test('builds an http URL from host and port', () => {
      expect(makeAdapter()._baseUrl()).toBe('http://10.0.0.9:8080');
    });

    test('uses https when the https flag is set', () => {
      expect(makeAdapter({ https: true })._baseUrl()).toBe('https://10.0.0.9:8080');
    });

    test('supports a hostname rather than an IP', () => {
      expect(makeAdapter({ host: 'qb.lan', port: 9091 })._baseUrl()).toBe('http://qb.lan:9091');
    });

    test('all API calls are namespaced under /api/v2', async () => {
      route({ '/torrents/info': res([]) });
      await makeAdapter().listTasks();
      expect(urlContaining('/torrents/info')).toBe('http://10.0.0.9:8080/api/v2/torrents/info');
    });
  });

  describe('API-token detection', () => {
    test('a non-empty apiToken selects token auth', () => {
      expect(makeTokenAdapter()._isTokenAuth).toBe(true);
    });

    test('an absent apiToken selects password auth', () => {
      expect(makeAdapter()._isTokenAuth).toBe(false);
    });

    test('an empty-string apiToken selects password auth', () => {
      expect(makeAdapter({ apiToken: '' })._isTokenAuth).toBe(false);
    });

    test('a whitespace-only apiToken selects password auth', () => {
      expect(makeAdapter({ apiToken: '   ' })._isTokenAuth).toBe(false);
    });

    test('a padded but non-empty apiToken selects token auth', () => {
      expect(makeAdapter({ apiToken: ' tok ' })._isTokenAuth).toBe(true);
    });
  });

  describe('testConnection()', () => {
    test('rejects a config with no host', async () => {
      await expect(makeAdapter({ host: '' }).testConnection())
        .rejects.toThrow(/Settings incomplete: missing host or port/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('rejects a config with no port', async () => {
      await expect(makeAdapter({ port: undefined }).testConnection())
        .rejects.toThrow(/Settings incomplete: missing host or port/);
    });

    test('rejects password auth with no username', async () => {
      await expect(makeAdapter({ username: '' }).testConnection())
        .rejects.toThrow(/missing username \(or provide API token\)/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('token auth does not require a username', async () => {
      route({ '/app/webapiVersion': res('2.9.3') });
      await expect(makeTokenAdapter().testConnection())
        .resolves.toEqual({ ok: true, version: 'qBittorrent', type: 'qBittorrent' });
    });

    test('password auth verifies by logging in', async () => {
      route({ '/auth/login': res('Ok.', { status: 200 }) });

      const result = await makeAdapter().testConnection();

      expect(result).toEqual({ ok: true, version: 'qBittorrent', type: 'qBittorrent' });
      expect(urlContaining('/api/v2/auth/login'))
        .toBe('http://10.0.0.9:8080/api/v2/auth/login');
      expect(callsTo('/app/webapiVersion')).toHaveLength(0);
    });

    test('token auth probes the webapiVersion endpoint instead of logging in', async () => {
      route({ '/app/webapiVersion': res('2.9.3') });
      await makeTokenAdapter().testConnection();
      expect(urlContaining('/app/webapiVersion')).toBeDefined();
      expect(callsTo('/auth/login')).toHaveLength(0);
    });

    test('accepts the 204 No Content login reply qBittorrent can return', async () => {
      route({ '/auth/login': res('', { ok: false, status: 204 }) });
      await expect(makeAdapter().testConnection()).resolves.toMatchObject({ ok: true });
    });

    test('posts the credentials as form data on login', async () => {
      route({ '/auth/login': res('Ok.') });
      await makeAdapter().testConnection();

      const body = rawBodyOf('/auth/login');
      expect(body.get('username')).toBe('admin');
      expect(body.get('password')).toBe('adminadmin');
    });

    test('sends the CSRF Referer/Origin headers qBittorrent requires on login', async () => {
      route({ '/auth/login': res('Ok.') });
      await makeAdapter().testConnection();

      const headers = headersOf('/auth/login');
      expect(headers.Referer).toBe('http://10.0.0.9:8080');
      expect(headers.Origin).toBe('http://10.0.0.9:8080');
      expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    });

    test('reports a friendly message when the credentials are rejected', async () => {
      route({ '/auth/login': res('Fails.', { ok: false, status: 403 }) });
      await expect(makeAdapter().testConnection())
        .rejects.toThrow(/qBittorrent auth failed: invalid credentials or API token/);
    });

    test('reports a friendly message when an API token is rejected', async () => {
      route({ '/app/webapiVersion': httpErr(403) });
      await expect(makeTokenAdapter().testConnection())
        .rejects.toThrow(/qBittorrent auth failed: invalid credentials or API token/);
    });

    test('treats a 401 on the token probe as an auth failure', async () => {
      route({ '/app/webapiVersion': httpErr(401) });
      await expect(makeTokenAdapter().testConnection())
        .rejects.toThrow(/qBittorrent auth failed/);
    });

    test('a non-auth HTTP error is surfaced verbatim, not as an auth failure', async () => {
      route({ '/app/webapiVersion': httpErr(500) });
      await expect(makeTokenAdapter().testConnection())
        .rejects.toThrow(/qBit API error: 500/);
    });

    test('a network rejection during login is reported as an auth failure', async () => {
      // _login() wraps every failure as "qBit auth failed: …", which the
      // testConnection handler then rewrites.
      route({ '/auth/login': new Error('ECONNREFUSED') });
      await expect(makeAdapter().testConnection())
        .rejects.toThrow(/qBittorrent auth failed/);
    });

    test('does not leak the password into the error message', async () => {
      route({ '/auth/login': res('Fails.', { ok: false, status: 403 }) });
      await expect(makeAdapter().testConnection()).rejects.not.toThrow(/adminadmin/);
    });

    test('sends the API token header on the token probe', async () => {
      route({ '/app/webapiVersion': res('2.9.3') });
      await makeTokenAdapter().testConnection();
      expect(headersOf('/app/webapiVersion')['X-API-Token']).toBe('tok-123');
    });
  });

  describe('_displayStatus()', () => {
    const status = (raw) => makeAdapter()._displayStatus(raw);

    test.each([
      ['downloading', 'downloading'],
      ['forcedDL', 'downloading'],
      ['metaDL', 'downloading']
    ])('maps active download state %s to %s', (raw, expected) => {
      expect(status(raw)).toBe(expected);
    });

    test.each([
      ['uploading', 'seeding'],
      ['forcedUP', 'seeding']
    ])('maps seeding state %s to %s', (raw, expected) => {
      expect(status(raw)).toBe(expected);
    });

    test.each([
      ['stoppedDL', 'paused'],
      ['stoppedUP', 'paused']
    ])('maps stopped state %s to paused', (raw, expected) => {
      expect(status(raw)).toBe(expected);
    });

    test.each([
      ['stalledDL', 'stalled'],
      ['stalledUP', 'stalled']
    ])('maps stalled state %s to stalled', (raw, expected) => {
      expect(status(raw)).toBe(expected);
    });

    test.each([
      ['checkingUP', 'checking'],
      ['checkingDL', 'checking'],
      ['queuedForChecking', 'checking']
    ])('maps checking state %s to checking', (raw, expected) => {
      expect(status(raw)).toBe(expected);
    });

    test('maps allocating to its own state', () => {
      expect(status('allocating')).toBe('allocating');
    });

    test.each([
      ['error', 'error'],
      ['missingFiles', 'error']
    ])('maps failure state %s to error', (raw, expected) => {
      expect(status(raw)).toBe(expected);
    });

    test('passes an unmapped state through unchanged', () => {
      expect(status('moving')).toBe('moving');
      expect(status('checkingResumeData')).toBe('checkingResumeData');
    });

    test('does not map the legacy pausedDL/pausedUP names', () => {
      // qBittorrent 5.x renamed these to stoppedDL/stoppedUP; older names fall
      // through the map unchanged, which is the shipped behaviour.
      expect(status('pausedDL')).toBe('pausedDL');
      expect(status('pausedUP')).toBe('pausedUP');
    });

    test('tolerates undefined and empty input', () => {
      expect(status(undefined)).toBeUndefined();
      expect(status('')).toBe('');
    });
  });

  describe('listTasks()', () => {
    test('normalises a torrent into the common task shape', async () => {
      route({ '/torrents/info': res([torrent()]) });

      const tasks = await makeAdapter().listTasks();

      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toEqual({
        id: 'aabbcc',
        title: 'ubuntu.iso',
        status: 'downloading',
        rawStatus: 'downloading',
        progress: 50,
        downloaded: 500,
        uploaded: 20,
        size: 1000,
        speed_down: 4096,
        speed_up: 128,
        eta: 300
      });
    });

    test('uses the torrent hash as the task id', async () => {
      route({ '/torrents/info': res([torrent({ hash: 'deadbeef' })]) });
      expect((await makeAdapter().listTasks())[0].id).toBe('deadbeef');
    });

    test('scales the 0-1 progress fraction to a percentage', async () => {
      route({ '/torrents/info': res([torrent({ progress: 0.3333 })]) });
      expect((await makeAdapter().listTasks())[0].progress).toBeCloseTo(33.33, 2);
    });

    test('reports 0% for a freshly added torrent', async () => {
      route({ '/torrents/info': res([torrent({ progress: 0 })]) });
      expect((await makeAdapter().listTasks())[0].progress).toBe(0);
    });

    test('reports 100% for a completed torrent', async () => {
      route({ '/torrents/info': res([torrent({ progress: 1, state: 'uploading' })]) });
      const [task] = await makeAdapter().listTasks();
      expect(task.progress).toBe(100);
      expect(task.status).toBe('seeding');
    });

    test('retains the raw state alongside the mapped status', async () => {
      route({ '/torrents/info': res([torrent({ state: 'stalledDL' })]) });
      const [task] = await makeAdapter().listTasks();
      expect(task.status).toBe('stalled');
      expect(task.rawStatus).toBe('stalledDL');
    });

    test('returns every torrent in the response', async () => {
      route({
        '/torrents/info': res([
          torrent({ hash: 'a', state: 'downloading' }),
          torrent({ hash: 'b', state: 'stoppedUP' }),
          torrent({ hash: 'c', state: 'error' })
        ])
      });
      const tasks = await makeAdapter().listTasks();
      expect(tasks.map((t) => t.id)).toEqual(['a', 'b', 'c']);
      expect(tasks.map((t) => t.status)).toEqual(['downloading', 'paused', 'error']);
    });

    test('returns an empty array when there are no torrents', async () => {
      route({ '/torrents/info': res([]) });
      await expect(makeAdapter().listTasks()).resolves.toEqual([]);
    });

    test('returns an empty array when the payload is not an array', async () => {
      route({ '/torrents/info': res({ error: 'unexpected' }) });
      await expect(makeAdapter().listTasks()).resolves.toEqual([]);
    });

    test('propagates a 403 as an auth failure', async () => {
      route({ '/torrents/info': httpErr(403) });
      await expect(makeAdapter().listTasks()).rejects.toThrow(/qBit auth failed/);
    });

    test('propagates a 500 as an API error', async () => {
      route({ '/torrents/info': httpErr(500) });
      await expect(makeAdapter().listTasks()).rejects.toThrow(/qBit API error: 500/);
    });

    test('throws when the response body is not JSON', async () => {
      route({ '/torrents/info': res('Forbidden') });
      await expect(makeAdapter().listTasks()).rejects.toThrow(SyntaxError);
    });

    test('propagates a network rejection', async () => {
      route({ '/torrents/info': new Error('socket hang up') });
      await expect(makeAdapter().listTasks()).rejects.toThrow(/socket hang up/);
    });

    test('does not auto-login before listing (relies on the session cookie)', async () => {
      route({ '/torrents/info': res([]) });
      await makeAdapter().listTasks();
      expect(callsTo('/auth/login')).toHaveLength(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('sends the API token header when token auth is configured', async () => {
      route({ '/torrents/info': res([]) });
      await makeTokenAdapter().listTasks();
      expect(headersOf('/torrents/info')['X-API-Token']).toBe('tok-123');
    });

    test('omits the API token header for password auth', async () => {
      route({ '/torrents/info': res([]) });
      await makeAdapter().listTasks();
      expect(headersOf('/torrents/info')['X-API-Token']).toBeUndefined();
    });

    test('sends the browser-like CSRF headers on every API call', async () => {
      route({ '/torrents/info': res([]) });
      await makeAdapter().listTasks();

      const headers = headersOf('/torrents/info');
      expect(headers.Referer).toBe('http://10.0.0.9:8080');
      expect(headers.Origin).toBe('http://10.0.0.9:8080');
      expect(headers['User-Agent']).toMatch(/Mozilla\/5\.0/);
    });

    test('passes a zero eta through unchanged', async () => {
      route({ '/torrents/info': res([torrent({ eta: 0 })]) });
      expect((await makeAdapter().listTasks())[0].eta).toBe(0);
    });

    test('passes the qBittorrent 8640000 "infinite" eta sentinel through', async () => {
      route({ '/torrents/info': res([torrent({ eta: 8640000 })]) });
      expect((await makeAdapter().listTasks())[0].eta).toBe(8640000);
    });
  });

  describe('addDownload()', () => {
    test('rejects a URI that is neither a magnet nor a .torrent URL', async () => {
      await expect(makeAdapter().addDownload('https://example.com/file.zip'))
        .rejects.toThrow(/Invalid URI: must be a magnet link or \.torrent URL/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('rejects a non-http(s) .torrent scheme', async () => {
      await expect(makeAdapter().addDownload('ftp://example.com/a.torrent'))
        .rejects.toThrow(/Invalid URI/);
    });

    test('submits a magnet link as multipart form data', async () => {
      route({ '/auth/login': res('Ok.'), '/torrents/add': res('Ok') });

      await expect(makeAdapter().addDownload('magnet:?xt=urn:btih:abc123'))
        .resolves.toBeUndefined();

      const body = rawBodyOf('/torrents/add');
      expect(body).toBeInstanceOf(FormData);
      expect(body.get('urls')).toBe('magnet:?xt=urn:btih:abc123');
    });

    test('logs in before adding when using password auth', async () => {
      route({ '/auth/login': res('Ok.'), '/torrents/add': res('Ok') });
      await makeAdapter().addDownload('magnet:?xt=urn:btih:abc');
      expect(callsTo('/auth/login')).toHaveLength(1);
      expect(calledUrls()[0]).toContain('/auth/login');
    });

    test('skips the login round-trip when using token auth', async () => {
      route({ '/torrents/add': res('Ok') });
      await makeTokenAdapter().addDownload('magnet:?xt=urn:btih:abc');
      expect(callsTo('/auth/login')).toHaveLength(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('includes savepath when a destination is supplied', async () => {
      route({ '/torrents/add': res('Ok') });
      await makeTokenAdapter().addDownload('magnet:?xt=urn:btih:abc', '/data/movies');
      expect(rawBodyOf('/torrents/add').get('savepath')).toBe('/data/movies');
    });

    test('omits savepath when no destination is supplied', async () => {
      route({ '/torrents/add': res('Ok') });
      await makeTokenAdapter().addDownload('magnet:?xt=urn:btih:abc');
      expect(rawBodyOf('/torrents/add').get('savepath')).toBeNull();
    });

    test('preserves a destination containing spaces', async () => {
      route({ '/torrents/add': res('Ok') });
      await makeTokenAdapter().addDownload('magnet:?xt=urn:btih:abc', '/My Data/TV Shows');
      expect(rawBodyOf('/torrents/add').get('savepath')).toBe('/My Data/TV Shows');
    });

    test('lets FormData set its own Content-Type boundary', async () => {
      route({ '/torrents/add': res('Ok') });
      await makeTokenAdapter().addDownload('magnet:?xt=urn:btih:abc');
      expect(headersOf('/torrents/add')['Content-Type']).toBeUndefined();
    });

    test('accepts a lower-case "ok" reply', async () => {
      route({ '/torrents/add': res('ok') });
      await expect(makeTokenAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .resolves.toBeUndefined();
    });

    test('accepts a JSON reply body', async () => {
      route({ '/torrents/add': res('{"added":1}') });
      await expect(makeTokenAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .resolves.toBeUndefined();
    });

    test('accepts qBittorrent\'s real "Ok." success reply', async () => {
      route({ '/torrents/add': res('Ok.') });
      await expect(makeTokenAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .resolves.toBeUndefined();
    });

    test('accepts an "Ok." reply padded with whitespace', async () => {
      route({ '/torrents/add': res('  Ok.\n') });
      await expect(makeTokenAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .resolves.toBeUndefined();
    });

    test('accepts a bare "Ok" reply with no trailing punctuation', async () => {
      route({ '/torrents/add': res('Ok') });
      await expect(makeTokenAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .resolves.toBeUndefined();
    });

    test('throws with the server text when the add is refused', async () => {
      route({ '/torrents/add': res('Fails.') });
      await expect(makeTokenAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .rejects.toThrow(/qBit add torrent failed: Fails\./);
    });

    test('an empty 200 body is treated as a refusal', async () => {
      route({ '/torrents/add': res('') });
      await expect(makeTokenAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .rejects.toThrow(/qBit add torrent failed/);
    });

    test('a 409 duplicate is treated as a successful add', async () => {
      route({ '/torrents/add': httpErr(409) });
      await expect(makeTokenAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .resolves.toBeUndefined();
    });

    test('a non-409 HTTP error during add is still surfaced', async () => {
      route({ '/torrents/add': httpErr(500) });
      await expect(makeTokenAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .rejects.toThrow(/qBit API error: 500/);
    });

    test('a 403 during add is reported as an auth failure', async () => {
      route({ '/torrents/add': httpErr(403) });
      await expect(makeTokenAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .rejects.toThrow(/qBit auth failed/);
    });

    test('a failed login aborts the add before any torrent is submitted', async () => {
      route({ '/auth/login': httpErr(403), '/torrents/add': res('Ok') });
      await expect(makeAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .rejects.toThrow(/qBit auth failed/);
      expect(callsTo('/torrents/add')).toHaveLength(0);
    });

    test('converts a .torrent URL to a magnet link before submitting', async () => {
      fetchMock.mockImplementation((url) => {
        if (String(url).includes('.torrent')) {
          return Promise.resolve(binRes(torrentBytes({ announce: 'http://tr.example' })));
        }
        return Promise.resolve(res('Ok'));
      });

      await makeTokenAdapter().addDownload('https://example.com/a.torrent');

      const urls = rawBodyOf('/torrents/add').get('urls');
      expect(urls).toMatch(/^magnet:\?xt=urn:btih:[0-9a-f]{40}&dn=test\.bin/);
    });

    test('propagates a failed .torrent download', async () => {
      fetchMock.mockImplementation((url) => {
        if (String(url).includes('.torrent')) {
          return Promise.resolve(binRes(new Uint8Array(), { ok: false, status: 404 }));
        }
        return Promise.resolve(res('Ok'));
      });

      await expect(makeTokenAdapter().addDownload('https://example.com/a.torrent'))
        .rejects.toThrow(/Failed to download torrent: HTTP 404/);
      expect(callsTo('/torrents/add')).toHaveLength(0);
    });

    test('propagates an unparseable .torrent body', async () => {
      fetchMock.mockImplementation((url) => {
        if (String(url).includes('.torrent')) {
          return Promise.resolve(binRes(new TextEncoder().encode('d4:junki1ee')));
        }
        return Promise.resolve(res('Ok'));
      });

      await expect(makeTokenAdapter().addDownload('https://example.com/a.torrent'))
        .rejects.toThrow(/Invalid torrent/);
    });
  });

  describe('taskAction()', () => {
    test('pause maps to the /torrents/stop endpoint', async () => {
      route({ '/torrents/stop': res('') });
      await makeAdapter().taskAction('pause', ['h1']);
      expect(urlContaining('/torrents/stop'))
        .toBe('http://10.0.0.9:8080/api/v2/torrents/stop');
    });

    test('resume maps to the /torrents/start endpoint', async () => {
      route({ '/torrents/start': res('') });
      await makeAdapter().taskAction('resume', ['h1']);
      expect(urlContaining('/torrents/start')).toBeDefined();
    });

    test('delete maps to the /torrents/delete endpoint', async () => {
      route({ '/torrents/delete': res('') });
      await makeAdapter().taskAction('delete', ['h1']);
      expect(urlContaining('/torrents/delete')).toBeDefined();
    });

    test('does not use the legacy /pause and /resume endpoint names', async () => {
      route({ '/torrents/stop': res('') });
      await makeAdapter().taskAction('pause', ['h1']);
      expect(urlContaining('/torrents/pause')).toBeUndefined();
    });

    test('joins multiple hashes with a pipe', async () => {
      route({ '/torrents/stop': res('') });
      await makeAdapter().taskAction('pause', ['h1', 'h2', 'h3']);
      expect(rawBodyOf('/torrents/stop').get('hashes')).toBe('h1|h2|h3');
    });

    test('sends a single hash without a separator', async () => {
      route({ '/torrents/stop': res('') });
      await makeAdapter().taskAction('pause', ['only']);
      expect(rawBodyOf('/torrents/stop').get('hashes')).toBe('only');
    });

    test('delete requests a non-destructive removal (deleteFiles=false)', async () => {
      route({ '/torrents/delete': res('') });
      await makeAdapter().taskAction('delete', ['h1']);
      expect(rawBodyOf('/torrents/delete').get('deleteFiles')).toBe('false');
    });

    test('pause and resume do not send deleteFiles', async () => {
      route({ '/torrents/stop': res('') });
      await makeAdapter().taskAction('pause', ['h1']);
      expect(rawBodyOf('/torrents/stop').get('deleteFiles')).toBeNull();
    });

    test('posts the hashes as url-encoded form data', async () => {
      route({ '/torrents/stop': res('') });
      await makeAdapter().taskAction('pause', ['h1']);

      const call = callsTo('/torrents/stop')[0];
      expect(call[1].method).toBe('POST');
      expect(call[1].body).toBeInstanceOf(URLSearchParams);
      expect(call[1].headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    });

    test('rejects an unknown action without touching the network', async () => {
      await expect(makeAdapter().taskAction('explode', ['h1']))
        .rejects.toThrow(/Unknown action: explode/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('rejects an undefined action', async () => {
      await expect(makeAdapter().taskAction(undefined, ['h1']))
        .rejects.toThrow(/Unknown action/);
    });

    test('re-logs in and retries once after an auth failure (password auth)', async () => {
      route({
        '/torrents/stop': [httpErr(403), res('')],
        '/auth/login': res('Ok.')
      });

      await expect(makeAdapter().taskAction('pause', ['h1'])).resolves.toBeUndefined();

      expect(callsTo('/torrents/stop')).toHaveLength(2);
      expect(callsTo('/auth/login')).toHaveLength(1);
    });

    test('does not retry after an auth failure when using token auth', async () => {
      route({ '/torrents/stop': httpErr(403), '/auth/login': res('Ok.') });

      await expect(makeTokenAdapter().taskAction('pause', ['h1']))
        .rejects.toThrow(/qBit auth failed/);

      expect(callsTo('/torrents/stop')).toHaveLength(1);
      expect(callsTo('/auth/login')).toHaveLength(0);
    });

    test('does not retry a non-auth API error', async () => {
      route({ '/torrents/stop': httpErr(500), '/auth/login': res('Ok.') });
      await expect(makeAdapter().taskAction('pause', ['h1']))
        .rejects.toThrow(/qBit API error: 500/);
      expect(callsTo('/torrents/stop')).toHaveLength(1);
    });

    test('surfaces a second auth failure after the retry login', async () => {
      route({ '/torrents/stop': httpErr(403), '/auth/login': res('Ok.') });
      await expect(makeAdapter().taskAction('pause', ['h1']))
        .rejects.toThrow(/qBit auth failed/);
      expect(callsTo('/torrents/stop')).toHaveLength(2);
    });

    test('propagates a network rejection', async () => {
      route({ '/torrents/stop': new Error('ECONNRESET') });
      await expect(makeAdapter().taskAction('pause', ['h1']))
        .rejects.toThrow(/ECONNRESET/);
    });

    test('issues the action against the configured base URL', async () => {
      route({ '/torrents/start': res('') });
      await makeAdapter({ host: 'qb.lan', port: 9091, https: true })
        .taskAction('resume', ['h1']);
      expect(urlContaining('/torrents/start'))
        .toBe('https://qb.lan:9091/api/v2/torrents/start');
    });

    test('an empty id list still issues the request', async () => {
      route({ '/torrents/stop': res('') });
      await makeAdapter().taskAction('pause', []);
      expect(rawBodyOf('/torrents/stop').get('hashes')).toBe('');
    });

    test('a non-array id argument throws rather than silently no-opping', async () => {
      route({ '/torrents/stop': res('') });
      await expect(makeAdapter().taskAction('pause', undefined)).rejects.toThrow(TypeError);
    });
  });

  describe('documented behavioural contracts', () => {
    test('listTasks performs no client-side config validation', async () => {
      // Only testConnection guards on host/port/username; listTasks goes
      // straight to the network with whatever config it was handed, even if
      // that produces a nonsense URL.
      route({ '/torrents/info': res([]) });
      await expect(getAdapter('qb-x', { type: 'qbittorrent' }).listTasks())
        .resolves.toEqual([]);
      expect(urlContaining('/torrents/info'))
        .toBe('http://undefined:undefined/api/v2/torrents/info');
    });

    test('addDownload resolves undefined rather than an {ok:true} envelope', async () => {
      route({ '/torrents/add': res('Ok') });
      await expect(makeTokenAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .resolves.toBeUndefined();
    });

    test('taskAction resolves undefined rather than an {ok:true} envelope', async () => {
      route({ '/torrents/stop': res('') });
      await expect(makeAdapter().taskAction('pause', ['h1'])).resolves.toBeUndefined();
    });

    test('a magnet link is accepted without any tracker or name parameters', async () => {
      route({ '/torrents/add': res('Ok') });
      await expect(makeTokenAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .resolves.toBeUndefined();
    });

    test('the adapter never sends the API token to the login endpoint', async () => {
      route({ '/auth/login': res('Ok.') });
      await makeAdapter().testConnection();
      expect(headersOf('/auth/login')['X-API-Token']).toBeUndefined();
    });
  });
});
