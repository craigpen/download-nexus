/**
 * Synology Download Station Adapter Unit Tests
 *
 * IMPORTANT: These tests exercise the REAL `SynologyAdapter` from
 * `src/background.js` (obtained via the exported `getAdapter` factory) with a
 * mocked `fetch` and the in-memory `chrome.storage` stub. This is deliberately
 * different from `tests/adapters.test.js`, which asserts against inline mock
 * re-implementations and therefore cannot catch regressions in the shipped
 * adapter.
 */

const { installChromeStub } = require('./helpers/chromeStub');

const chromeStub = installChromeStub();

const { getAdapter } = require('../src/background.js');

// ── fetch mocking helpers ───────────────────────────────────────────────────

/** Build a Response-like object. `body` may be a string or a JSON-able value. */
function res(body, { ok = true, status = 200, statusText = 'OK', headers = {} } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok,
    status,
    statusText,
    headers: {
      get: (k) => headers[k] ?? headers[String(k).toLowerCase()] ?? null
    },
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer
  };
}

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

/** Synology success envelope. */
const synoOk = (data) => res({ success: true, data });
/** Synology failure envelope. */
const synoErr = (code) => res({ success: false, error: { code } });

let fetchMock;
const realFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock = jest.fn();
  globalThis.fetch = fetchMock;
  // The adapter persists session ids in chrome.storage.local; start each test clean.
  chromeStub.storage.local.clear();
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
/** Every fetch call whose URL matches a substring. */
const callsTo = (frag) => fetchMock.mock.calls.filter((c) => String(c[0]).includes(frag));
/** Parse the form-encoded body of the first call matching a substring. */
const bodyOf = (frag) => {
  const call = callsTo(frag).find((c) => c[1] && typeof c[1].body === 'string');
  return call ? new URLSearchParams(call[1].body) : null;
};

const SYNO_CONFIG = {
  type: 'synology',
  id: 'syn-1',
  name: 'Living Room NAS',
  host: '192.168.1.50',
  port: 5000,
  https: false,
  username: 'admin',
  password: 'hunter2'
};

const makeAdapter = (cfg = {}) => getAdapter('syn-1', { ...SYNO_CONFIG, ...cfg });

/** Pre-seed a stored session id so calls skip the login round-trip. */
const seedSid = (nasId, sid) =>
  new Promise((r) => chromeStub.storage.local.set({ [`sid_${nasId}`]: sid }, r));

/** Read the stored session id back out of the storage stub. */
const readSid = (nasId) =>
  new Promise((r) => chromeStub.storage.local.get([`sid_${nasId}`], (o) => r(o[`sid_${nasId}`])));

/**
 * Route the Synology endpoints. Each value may be a Response-like object, an
 * Error (rejected), or an array consumed one entry per call.
 */
function route({ auth, task, info, other } = {}) {
  const queues = new Map();
  const take = (key, val) => {
    if (Array.isArray(val)) {
      if (!queues.has(key)) queues.set(key, [...val]);
      const q = queues.get(key);
      return q.length > 1 ? q.shift() : q[0];
    }
    return val;
  };
  fetchMock.mockImplementation((url) => {
    let val;
    if (url.includes('/auth.cgi')) val = take('auth', auth);
    else if (url.includes('/DownloadStation/info.cgi')) val = take('info', info);
    else if (url.includes('/DownloadStation/task.cgi')) val = take('task', task);
    else val = take('other', other);
    if (val === undefined) return Promise.resolve(res({ success: true, data: {} }));
    return val instanceof Error ? Promise.reject(val) : Promise.resolve(val);
  });
}

/** Bencode a minimal but structurally valid .torrent file. */
function torrentBytes({ announce = null, name = 'test.bin' } = {}) {
  const ann = announce ? `${announce.length}:${announce}` : '';
  const s = `d${announce ? `8:announce${ann}` : ''}4:infod4:name${name.length}:${name}6:lengthi1024eee`;
  return new TextEncoder().encode(s);
}

describe('SynologyAdapter (real implementation)', () => {
  describe('getAdapter factory', () => {
    test('returns a Synology adapter for type "synology"', () => {
      const adapter = makeAdapter();
      expect(adapter.constructor.name).toBe('SynologyAdapter');
      expect(typeof adapter.testConnection).toBe('function');
      expect(typeof adapter.listTasks).toBe('function');
      expect(typeof adapter.addDownload).toBe('function');
      expect(typeof adapter.taskAction).toBe('function');
    });

    test('defaults to Synology when no type is configured', () => {
      const adapter = getAdapter('legacy', { host: 'nas.lan', port: 5000 });
      expect(adapter.constructor.name).toBe('SynologyAdapter');
    });

    test('throws for an unknown service type', () => {
      expect(() => getAdapter('x', { type: 'qnap' })).toThrow(/Unknown NAS type: qnap/);
    });

    test('preserves nasId and config on the instance', () => {
      const adapter = makeAdapter();
      expect(adapter.nasId).toBe('syn-1');
      expect(adapter.config.host).toBe('192.168.1.50');
      expect(adapter.config.username).toBe('admin');
    });
  });

  describe('_displayStatus()', () => {
    const status = (raw) => makeAdapter()._displayStatus(raw);

    test.each([
      ['downloading', 'downloading'],
      ['completed', 'finished'],
      ['finished', 'finished'],
      ['active', 'seeding'],
      ['uploading', 'seeding'],
      ['seeding', 'seeding'],
      ['stopped', 'paused'],
      ['paused', 'paused'],
      ['inactive', 'paused'],
      ['error', 'error']
    ])('maps DSM status %s to %s', (raw, expected) => {
      expect(status(raw)).toBe(expected);
    });

    test('maps "waiting" to stalled rather than paused (P0-4)', () => {
      // A queued task is not user-paused, so it must not read as "paused".
      expect(status('waiting')).toBe('stalled');
    });

    test('passes an unrecognised status through unchanged', () => {
      expect(status('extracting')).toBe('extracting');
      expect(status('filehosting_waiting')).toBe('filehosting_waiting');
    });

    test('is case-sensitive, so DSM casing variants pass through', () => {
      expect(status('Downloading')).toBe('Downloading');
    });

    test('falls back to the raw value for undefined/empty input', () => {
      expect(status(undefined)).toBeUndefined();
      expect(status('')).toBe('');
    });
  });

  describe('testConnection()', () => {
    test('rejects a config with no host', async () => {
      await expect(makeAdapter({ host: '' }).testConnection())
        .rejects.toThrow(/Settings incomplete: missing host, port, or username/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('rejects a config with no port', async () => {
      await expect(makeAdapter({ port: undefined }).testConnection())
        .rejects.toThrow(/Settings incomplete/);
    });

    test('rejects a config with no username', async () => {
      await expect(makeAdapter({ username: '' }).testConnection())
        .rejects.toThrow(/Settings incomplete/);
    });

    test('rejects an entirely absent config without throwing a TypeError', async () => {
      const adapter = getAdapter('syn-empty', { type: 'synology' });
      await expect(adapter.testConnection()).rejects.toThrow(/Settings incomplete/);
    });

    test('logs in, probes info.cgi and reports the DSM version string', async () => {
      route({
        auth: synoOk({ sid: 'sid-abc' }),
        info: synoOk({ version_string: '3.8.16-3566' })
      });

      const result = await makeAdapter().testConnection();

      expect(result).toEqual({ ok: true, version: '3.8.16-3566' });
      expect(urlContaining('/webapi/auth.cgi')).toBe('http://192.168.1.50:5000/webapi/auth.cgi');
      expect(urlContaining('/DownloadStation/info.cgi')).toContain('method=getinfo');
    });

    test('returns an empty version when DSM omits version_string', async () => {
      route({ auth: synoOk({ sid: 's' }), info: synoOk({}) });
      expect((await makeAdapter().testConnection()).version).toBe('');
    });

    test('always re-authenticates, ignoring any stored session id', async () => {
      await seedSid('syn-1', 'stale-sid');
      route({ auth: synoOk({ sid: 'fresh-sid' }), info: synoOk({}) });

      await makeAdapter().testConnection();

      expect(callsTo('/auth.cgi')).toHaveLength(1);
      expect(urlContaining('/info.cgi')).toContain('_sid=fresh-sid');
    });

    test('posts the DownloadStation login payload as form data', async () => {
      route({ auth: synoOk({ sid: 's' }), info: synoOk({}) });
      await makeAdapter().testConnection();

      const body = bodyOf('/auth.cgi');
      expect(body.get('api')).toBe('SYNO.API.Auth');
      expect(body.get('version')).toBe('3');
      expect(body.get('method')).toBe('login');
      expect(body.get('account')).toBe('admin');
      expect(body.get('passwd')).toBe('hunter2');
      expect(body.get('session')).toBe('DownloadStation');
      expect(body.get('format')).toBe('sid');
    });

    test('sends the login as a form-encoded POST with credentials', async () => {
      route({ auth: synoOk({ sid: 's' }), info: synoOk({}) });
      await makeAdapter().testConnection();

      const opts = callsTo('/auth.cgi')[0][1];
      expect(opts.method).toBe('POST');
      expect(opts.credentials).toBe('include');
      expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    });

    test('builds an https base URL when the https flag is set', async () => {
      route({ auth: synoOk({ sid: 's' }), info: synoOk({}) });
      await makeAdapter({ https: true, port: 5001 }).testConnection();
      expect(urlContaining('/auth.cgi')).toBe('https://192.168.1.50:5001/webapi/auth.cgi');
    });

    test('stores the session id for reuse by later calls', async () => {
      route({ auth: synoOk({ sid: 'persist-me' }), info: synoOk({}) });
      await makeAdapter().testConnection();
      expect(await readSid('syn-1')).toBe('persist-me');
    });

    test('surfaces the DSM error code when login is rejected', async () => {
      route({ auth: synoErr(400) });
      await expect(makeAdapter().testConnection()).rejects.toThrow(/Login failed \(DSM code 400\)/);
    });

    test('reports "?" when a failed login omits the error code', async () => {
      route({ auth: res({ success: false }) });
      await expect(makeAdapter().testConnection()).rejects.toThrow(/DSM code \?/);
    });

    test('throws when a successful login response carries no session id', async () => {
      route({ auth: res({ success: true, data: {} }) });
      await expect(makeAdapter().testConnection())
        .rejects.toThrow(/Login response missing session ID/);
    });

    test('throws a readable error when the login response is not JSON', async () => {
      route({ auth: res('<html>DSM login page</html>') });
      await expect(makeAdapter().testConnection())
        .rejects.toThrow(/Login response not JSON/);
    });

    test('surfaces the Download Station error code from info.cgi', async () => {
      route({ auth: synoOk({ sid: 's' }), info: synoErr(105) });
      await expect(makeAdapter().testConnection())
        .rejects.toThrow(/Download Station error code 105/);
    });

    test('does not store a session id when the info probe fails', async () => {
      route({ auth: synoOk({ sid: 's' }), info: synoErr(105) });
      await expect(makeAdapter().testConnection()).rejects.toThrow();
      // getSid stores the sid as part of logging in; the extra post-probe store
      // never runs, but the login-time value is expected to remain.
      expect(await readSid('syn-1')).toBe('s');
    });

    test('propagates a network failure from the login call', async () => {
      route({ auth: new Error('boom') });
      await expect(makeAdapter().testConnection()).rejects.toThrow(/boom/);
    });

    test('requests the DownloadStation Info API with version 1', async () => {
      route({ auth: synoOk({ sid: 's' }), info: synoOk({}) });
      await makeAdapter().testConnection();
      const url = urlContaining('/info.cgi');
      expect(url).toContain('api=SYNO.DownloadStation.Info');
      expect(url).toContain('version=1');
    });
  });

  describe('listTasks()', () => {
    test('reuses a stored session id instead of logging in again', async () => {
      await seedSid('syn-1', 'cached');
      route({ task: synoOk({ tasks: [] }) });

      await makeAdapter().listTasks();

      expect(callsTo('/auth.cgi')).toHaveLength(0);
      expect(urlContaining('/task.cgi')).toContain('_sid=cached');
    });

    test('logs in first when no session id is stored', async () => {
      route({ auth: synoOk({ sid: 'new-sid' }), task: synoOk({ tasks: [] }) });

      await makeAdapter().listTasks();

      expect(callsTo('/auth.cgi')).toHaveLength(1);
      expect(urlContaining('/task.cgi')).toContain('_sid=new-sid');
    });

    test('requests the transfer additional fields needed for progress', async () => {
      await seedSid('syn-1', 's');
      route({ task: synoOk({ tasks: [] }) });

      await makeAdapter().listTasks();

      const url = urlContaining('/task.cgi');
      expect(url).toContain('api=SYNO.DownloadStation.Task');
      expect(url).toContain('method=list');
      expect(url).toContain('additional=transfer');
    });

    test('maps the DSM status onto the unified vocabulary', async () => {
      await seedSid('syn-1', 's');
      route({
        task: synoOk({
          tasks: [{ id: 'dbid_1', title: 'ubuntu.iso', status: 'waiting', size: 100 }]
        })
      });

      const tasks = await makeAdapter().listTasks();

      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe('stalled');
    });

    test('preserves every other field returned by DSM', async () => {
      await seedSid('syn-1', 's');
      route({
        task: synoOk({
          tasks: [{
            id: 'dbid_7',
            title: 'movie.mkv',
            status: 'downloading',
            size: 2048,
            username: 'admin',
            additional: { transfer: { size_downloaded: 1024, speed_download: 512 } }
          }]
        })
      });

      const [task] = await makeAdapter().listTasks();

      expect(task.id).toBe('dbid_7');
      expect(task.title).toBe('movie.mkv');
      expect(task.size).toBe(2048);
      expect(task.username).toBe('admin');
      expect(task.additional.transfer.size_downloaded).toBe(1024);
    });

    test('maps every task in a multi-task response', async () => {
      await seedSid('syn-1', 's');
      route({
        task: synoOk({
          tasks: [
            { id: '1', status: 'downloading' },
            { id: '2', status: 'seeding' },
            { id: '3', status: 'error' },
            { id: '4', status: 'waiting' }
          ]
        })
      });

      const tasks = await makeAdapter().listTasks();
      expect(tasks.map((t) => t.status))
        .toEqual(['downloading', 'seeding', 'error', 'stalled']);
    });

    test('returns an empty array when DSM reports no tasks', async () => {
      await seedSid('syn-1', 's');
      route({ task: synoOk({ tasks: [] }) });
      await expect(makeAdapter().listTasks()).resolves.toEqual([]);
    });

    test('treats a missing tasks key as an empty list', async () => {
      await seedSid('syn-1', 's');
      route({ task: synoOk({ total: 0 }) });
      await expect(makeAdapter().listTasks()).resolves.toEqual([]);
    });

    test('surfaces the DSM error code when the list call fails', async () => {
      await seedSid('syn-1', 's');
      route({ task: synoErr(407) });
      await expect(makeAdapter().listTasks())
        .rejects.toThrow(/List tasks failed \(DSM code 407\)/);
    });

    test('reports "?" when a failed list response omits the error code', async () => {
      await seedSid('syn-1', 's');
      route({ task: res({ success: false }) });
      await expect(makeAdapter().listTasks()).rejects.toThrow(/DSM code \?/);
    });

    test('throws when the list response body is not JSON', async () => {
      await seedSid('syn-1', 's');
      route({ task: res('not json at all') });
      // listTasks() in the adapter parses without a try/catch, so the raw
      // SyntaxError escapes rather than a friendly message.
      await expect(makeAdapter().listTasks()).rejects.toThrow(SyntaxError);
    });

    test('throws when a successful response has no data object', async () => {
      await seedSid('syn-1', 's');
      route({ task: res({ success: true }) });
      await expect(makeAdapter().listTasks()).rejects.toThrow(TypeError);
    });

    test('passes an unmapped DSM status straight through', async () => {
      await seedSid('syn-1', 's');
      route({ task: synoOk({ tasks: [{ id: '1', status: 'extracting' }] }) });
      expect((await makeAdapter().listTasks())[0].status).toBe('extracting');
    });

    test('sends the list request with credentials included', async () => {
      await seedSid('syn-1', 's');
      route({ task: synoOk({ tasks: [] }) });
      await makeAdapter().listTasks();
      expect(callsTo('/task.cgi')[0][1].credentials).toBe('include');
    });
  });

  describe('addDownload()', () => {
    test('rejects a URI that is neither a magnet nor a .torrent URL', async () => {
      await expect(makeAdapter().addDownload('https://example.com/file.zip'))
        .rejects.toThrow(/Invalid URI: must be a magnet link or \.torrent URL/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('rejects a non-http(s) scheme', async () => {
      await expect(makeAdapter().addDownload('ftp://example.com/a.torrent'))
        .rejects.toThrow(/Invalid URI/);
    });

    test('rejects a plain string that is not a URL', async () => {
      await expect(makeAdapter().addDownload('just-some-text'))
        .rejects.toThrow(/Invalid URI/);
    });

    test('accepts a magnet link and creates the DSM task', async () => {
      await seedSid('syn-1', 's');
      route({ task: res({ success: true }) });

      await expect(makeAdapter().addDownload('magnet:?xt=urn:btih:abc123'))
        .resolves.toBeUndefined();

      const body = bodyOf('/task.cgi');
      expect(body.get('api')).toBe('SYNO.DownloadStation.Task');
      expect(body.get('method')).toBe('create');
      expect(body.get('uri')).toBe('magnet:?xt=urn:btih:abc123');
      expect(body.get('_sid')).toBe('s');
    });

    test('sends the create call as a form-encoded POST', async () => {
      await seedSid('syn-1', 's');
      route({ task: res({ success: true }) });
      await makeAdapter().addDownload('magnet:?xt=urn:btih:abc');

      const opts = callsTo('/task.cgi')[0][1];
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    });

    test('includes an explicit destination when one is supplied', async () => {
      await seedSid('syn-1', 's');
      route({ task: res({ success: true }) });
      await makeAdapter().addDownload('magnet:?xt=urn:btih:abc', 'video/movies');
      expect(bodyOf('/task.cgi').get('destination')).toBe('video/movies');
    });

    test('falls back to the configured default destination', async () => {
      await seedSid('syn-1', 's');
      route({ task: res({ success: true }) });
      await makeAdapter({ destination: 'downloads/default' })
        .addDownload('magnet:?xt=urn:btih:abc');
      expect(bodyOf('/task.cgi').get('destination')).toBe('downloads/default');
    });

    test('an explicit destination overrides the configured default', async () => {
      await seedSid('syn-1', 's');
      route({ task: res({ success: true }) });
      await makeAdapter({ destination: 'downloads/default' })
        .addDownload('magnet:?xt=urn:btih:abc', 'video/tv');
      expect(bodyOf('/task.cgi').get('destination')).toBe('video/tv');
    });

    test('omits destination entirely when neither is configured', async () => {
      await seedSid('syn-1', 's');
      route({ task: res({ success: true }) });
      await makeAdapter().addDownload('magnet:?xt=urn:btih:abc');
      expect(bodyOf('/task.cgi').has('destination')).toBe(false);
    });

    test('surfaces the DSM error code when task creation fails', async () => {
      await seedSid('syn-1', 's');
      route({ task: synoErr(407) });
      await expect(makeAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .rejects.toThrow(/Task creation failed \(DSM code 407\)/);
    });

    test('throws a readable error when the create response is not JSON', async () => {
      await seedSid('syn-1', 's');
      route({ task: res('<html>error</html>') });
      await expect(makeAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .rejects.toThrow(/Add-download response not JSON/);
    });

    test('re-authenticates once and retries after a code 105 auth error', async () => {
      await seedSid('syn-1', 'expired');
      route({
        auth: synoOk({ sid: 'renewed' }),
        task: [synoErr(105), res({ success: true })]
      });

      await expect(makeAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .resolves.toBeUndefined();

      expect(callsTo('/auth.cgi')).toHaveLength(1);
      expect(callsTo('/task.cgi')).toHaveLength(2);
      const retryBody = new URLSearchParams(callsTo('/task.cgi')[1][1].body);
      expect(retryBody.get('_sid')).toBe('renewed');
    });

    test('does not retry a non-auth DSM error', async () => {
      await seedSid('syn-1', 's');
      route({ task: synoErr(407) });
      await expect(makeAdapter().addDownload('magnet:?xt=urn:btih:abc')).rejects.toThrow();
      expect(callsTo('/task.cgi')).toHaveLength(1);
      expect(callsTo('/auth.cgi')).toHaveLength(0);
    });

    test('converts a .torrent URL into a magnet link before submitting', async () => {
      await seedSid('syn-1', 's');
      const bytes = torrentBytes({ announce: 'http://tr.example', name: 'test.bin' });
      fetchMock.mockImplementation((url) => {
        if (url === 'https://example.com/a.torrent') return Promise.resolve(binRes(bytes));
        return Promise.resolve(res({ success: true }));
      });

      await makeAdapter().addDownload('https://example.com/a.torrent');

      const uri = bodyOf('/task.cgi').get('uri');
      expect(uri).toMatch(/^magnet:\?xt=urn:btih:[0-9a-f]{40}&dn=test\.bin/);
      expect(uri).toContain(`&tr=${encodeURIComponent('http://tr.example')}`);
    });

    test('accepts a .torrent URL that carries a query string', async () => {
      await seedSid('syn-1', 's');
      fetchMock.mockImplementation((url) => {
        if (String(url).startsWith('https://example.com/a.torrent')) {
          return Promise.resolve(binRes(torrentBytes()));
        }
        return Promise.resolve(res({ success: true }));
      });

      await expect(makeAdapter().addDownload('https://example.com/a.torrent?token=xyz'))
        .resolves.toBeUndefined();
      expect(bodyOf('/task.cgi').get('uri')).toMatch(/^magnet:\?xt=urn:btih:/);
    });

    test('omits the tracker parameter when the torrent has no announce URL', async () => {
      await seedSid('syn-1', 's');
      fetchMock.mockImplementation((url) => {
        if (String(url).includes('.torrent')) {
          return Promise.resolve(binRes(torrentBytes({ announce: null })));
        }
        return Promise.resolve(res({ success: true }));
      });

      await makeAdapter().addDownload('https://example.com/a.torrent');
      expect(bodyOf('/task.cgi').get('uri')).not.toContain('&tr=');
    });

    test('wraps an unparseable torrent body in a "Failed to parse torrent" error', async () => {
      await seedSid('syn-1', 's');
      fetchMock.mockImplementation((url) => {
        if (String(url).includes('.torrent')) {
          return Promise.resolve(binRes(new TextEncoder().encode('d4:junki1ee')));
        }
        return Promise.resolve(res({ success: true }));
      });

      await expect(makeAdapter().addDownload('https://example.com/a.torrent'))
        .rejects.toThrow(/Failed to parse torrent/);
    });

    test('wraps a failed torrent fetch in a "Failed to parse torrent" error', async () => {
      await seedSid('syn-1', 's');
      fetchMock.mockImplementation((url) => {
        if (String(url).includes('.torrent')) {
          return Promise.resolve(binRes(new Uint8Array(), { ok: false, status: 404 }));
        }
        return Promise.resolve(res({ success: true }));
      });

      await expect(makeAdapter().addDownload('https://example.com/a.torrent'))
        .rejects.toThrow(/Failed to parse torrent: Failed to download torrent: HTTP 404/);
    });

    test('fetches the torrent file without sending credentials', async () => {
      await seedSid('syn-1', 's');
      fetchMock.mockImplementation((url) => {
        if (String(url).includes('.torrent')) return Promise.resolve(binRes(torrentBytes()));
        return Promise.resolve(res({ success: true }));
      });

      await makeAdapter().addDownload('https://example.com/a.torrent');
      expect(callsTo('.torrent')[0][1]).toMatchObject({ credentials: 'omit' });
    });
  });

  describe('taskAction()', () => {
    test('pause posts the pause method with the joined ids', async () => {
      await seedSid('syn-1', 's');
      route({ task: res({ success: true }) });

      await expect(makeAdapter().taskAction('pause', ['dbid_1', 'dbid_2']))
        .resolves.toBeUndefined();

      const body = bodyOf('/task.cgi');
      expect(body.get('method')).toBe('pause');
      expect(body.get('id')).toBe('dbid_1,dbid_2');
      expect(body.get('_sid')).toBe('s');
    });

    test('resume posts the resume method', async () => {
      await seedSid('syn-1', 's');
      route({ task: res({ success: true }) });
      await makeAdapter().taskAction('resume', ['dbid_1']);
      expect(bodyOf('/task.cgi').get('method')).toBe('resume');
    });

    test('delete posts the delete method with delete_file=true', async () => {
      await seedSid('syn-1', 's');
      route({ task: res({ success: true }) });
      await makeAdapter().taskAction('delete', ['dbid_1']);

      const body = bodyOf('/task.cgi');
      expect(body.get('method')).toBe('delete');
      expect(body.get('delete_file')).toBe('true');
    });

    test('non-delete actions omit delete_file', async () => {
      await seedSid('syn-1', 's');
      route({ task: res({ success: true }) });
      await makeAdapter().taskAction('pause', ['dbid_1']);
      expect(bodyOf('/task.cgi').has('delete_file')).toBe(false);
    });

    test('sends an empty id list rather than failing for an empty selection', async () => {
      await seedSid('syn-1', 's');
      route({ task: res({ success: true }) });
      await makeAdapter().taskAction('pause', []);
      expect(bodyOf('/task.cgi').get('id')).toBe('');
    });

    test('surfaces the DSM error code when the action fails', async () => {
      await seedSid('syn-1', 's');
      route({ task: synoErr(544) });
      await expect(makeAdapter().taskAction('pause', ['dbid_1']))
        .rejects.toThrow(/Task pause failed \(DSM code 544\)/);
    });

    test('names the attempted action in the error message', async () => {
      await seedSid('syn-1', 's');
      route({ task: synoErr(544) });
      await expect(makeAdapter().taskAction('delete', ['dbid_1']))
        .rejects.toThrow(/Task delete failed/);
    });

    test('throws a readable error when the action response is not JSON', async () => {
      await seedSid('syn-1', 's');
      route({ task: res('<html>nope</html>') });
      await expect(makeAdapter().taskAction('resume', ['dbid_1']))
        .rejects.toThrow(/Task resume response not JSON/);
    });

    test('logs in first when no session id is stored', async () => {
      route({ auth: synoOk({ sid: 'fresh' }), task: res({ success: true }) });
      await makeAdapter().taskAction('pause', ['dbid_1']);
      expect(callsTo('/auth.cgi')).toHaveLength(1);
      expect(bodyOf('/task.cgi').get('_sid')).toBe('fresh');
    });

    test('propagates a network failure instead of swallowing it', async () => {
      await seedSid('syn-1', 's');
      route({ task: new Error('socket closed') });
      await expect(makeAdapter().taskAction('pause', ['dbid_1']))
        .rejects.toThrow(/socket closed/);
    });

    test('issues the action against the configured base URL', async () => {
      await seedSid('syn-2', 's');
      route({ task: res({ success: true }) });
      await getAdapter('syn-2', { ...SYNO_CONFIG, host: 'nas.lan', port: 5001, https: true })
        .taskAction('pause', ['1']);
      expect(urlContaining('/task.cgi')).toBe('https://nas.lan:5001/webapi/DownloadStation/task.cgi');
    });

    test('an unrecognised action is forwarded to DSM verbatim', async () => {
      // The adapter has no client-side action allow-list; DSM decides.
      await seedSid('syn-1', 's');
      route({ task: res({ success: true }) });
      await makeAdapter().taskAction('edit', ['dbid_1']);
      expect(bodyOf('/task.cgi').get('method')).toBe('edit');
    });
  });

  describe('documented behavioural contracts', () => {
    test('addDownload resolves undefined rather than an {ok:true} envelope', async () => {
      // tests/adapters.test.js mocks return { ok: true }; the real adapter does not.
      await seedSid('syn-1', 's');
      route({ task: res({ success: true }) });
      await expect(makeAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .resolves.toBeUndefined();
    });

    test('taskAction resolves undefined rather than an {ok:true} envelope', async () => {
      await seedSid('syn-1', 's');
      route({ task: res({ success: true }) });
      await expect(makeAdapter().taskAction('pause', ['1'])).resolves.toBeUndefined();
    });

    test('a password is never echoed into a thrown error message', async () => {
      route({ auth: synoErr(400) });
      await expect(makeAdapter().testConnection()).rejects.not.toThrow(/hunter2/);
    });

    test('listTasks does not validate the config, unlike testConnection', async () => {
      // Only testConnection guards on host/port/username; listTasks goes
      // straight to the network with whatever config it was given.
      route({ auth: synoOk({ sid: 's' }), task: synoOk({ tasks: [] }) });
      await expect(getAdapter('syn-3', { type: 'synology', host: 'h', port: 1 }).listTasks())
        .resolves.toEqual([]);
    });

    test('the session id is namespaced per NAS id', async () => {
      await seedSid('syn-a', 'sid-a');
      await seedSid('syn-b', 'sid-b');
      route({ task: synoOk({ tasks: [] }) });

      await getAdapter('syn-b', SYNO_CONFIG).listTasks();

      expect(urlContaining('/task.cgi')).toContain('_sid=sid-b');
      expect(await readSid('syn-a')).toBe('sid-a');
    });
  });
});
