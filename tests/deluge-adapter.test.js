/**
 * Deluge Adapter Unit Tests
 *
 * IMPORTANT: These tests exercise the REAL `DelugeAdapter` from
 * `src/background.js` (obtained via the exported `getAdapter` factory) with a
 * mocked `fetch`. This is deliberately different from `tests/adapters.test.js`,
 * which asserts against inline mock re-implementations and therefore cannot
 * catch regressions in the shipped adapter.
 */

const { installChromeStub } = require('./helpers/chromeStub');

installChromeStub();

const { getAdapter } = require('../src/background.js');

// ── fetch mocking helpers ───────────────────────────────────────────────────

/** Build a Response-like object with an optional header bag. */
function res(body, { ok = true, status = 200, statusText = 'OK', headers = {} } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const lower = {};
  Object.keys(headers).forEach((k) => { lower[k.toLowerCase()] = headers[k]; });
  return {
    ok,
    status,
    statusText,
    headers: { get: (k) => lower[String(k).toLowerCase()] ?? null },
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

/** A Deluge JSON-RPC success envelope. */
const rpcOk = (result, opts) => res({ result, error: null, id: 1 }, opts);
/** A Deluge JSON-RPC error envelope. */
const rpcErr = (message, code = 1) => res({ result: null, error: { message, code }, id: 1 });

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
/** Parsed JSON-RPC payloads of every fetch call, in order. */
const payloads = () => fetchMock.mock.calls.map((c) => {
  try { return JSON.parse(c[1].body); } catch { return null; }
});
/** The RPC method names invoked, in order. */
const methods = () => payloads().map((p) => p && p.method);
/** The first payload for a given RPC method. */
const payloadFor = (method) => payloads().find((p) => p && p.method === method);
/** Every fetch call for a given RPC method. */
const callsFor = (method) => fetchMock.mock.calls.filter((c) => {
  try { return JSON.parse(c[1].body).method === method; } catch { return false; }
});

/**
 * Route Deluge RPC calls by method name. Values may be a Response-like object,
 * an Error (rejected), or an array consumed one entry per call. `login` and
 * `status` cover the two calls the auth handshake makes.
 */
function route({ login = rpcOk(true), status = rpcOk({}), other } = {}) {
  const queues = new Map();
  const take = (key, val) => {
    if (Array.isArray(val)) {
      if (!queues.has(key)) queues.set(key, [...val]);
      const q = queues.get(key);
      return q.length > 1 ? q.shift() : q[0];
    }
    return val;
  };
  fetchMock.mockImplementation((url, opts) => {
    let method = null;
    try { method = JSON.parse(opts.body).method; } catch { /* ignore */ }
    let val;
    if (method === 'auth.login') val = take('login', login);
    else if (method === 'core.get_torrents_status') val = take('status', status);
    else val = take('other', other);
    if (val === undefined) val = rpcOk(true);
    return val instanceof Error ? Promise.reject(val) : Promise.resolve(val);
  });
}

/** Bencode a minimal but structurally valid .torrent file. */
function torrentBytes({ announce = null, name = 'test.bin' } = {}) {
  const ann = announce ? `${announce.length}:${announce}` : '';
  const s = `d${announce ? `8:announce${ann}` : ''}4:infod4:name${name.length}:${name}6:lengthi1024eee`;
  return new TextEncoder().encode(s);
}

const DELUGE_CONFIG = {
  type: 'deluge',
  id: 'dl-1',
  name: 'Deluge Web',
  host: '10.0.0.7',
  port: 8112,
  https: false,
  password: 'deluge'
};

const makeAdapter = (cfg = {}) => getAdapter('dl-1', { ...DELUGE_CONFIG, ...cfg });

const torrentStatus = (over = {}) => ({
  name: 'ubuntu.iso',
  state: 'Downloading',
  progress: 50,
  total_done: 500,
  total_uploaded: 20,
  total_size: 1000,
  download_payload_rate: 4096,
  upload_payload_rate: 128,
  eta: 300,
  time_added: 1700000000,
  ...over
});

describe('DelugeAdapter (real implementation)', () => {
  describe('getAdapter factory', () => {
    test('returns a Deluge adapter for type "deluge"', () => {
      const adapter = makeAdapter();
      expect(adapter.constructor.name).toBe('DelugeAdapter');
      expect(typeof adapter.testConnection).toBe('function');
      expect(typeof adapter.listTasks).toBe('function');
      expect(typeof adapter.addDownload).toBe('function');
      expect(typeof adapter.taskAction).toBe('function');
    });

    test('throws for an unknown service type', () => {
      expect(() => getAdapter('x', { type: 'delugee' }))
        .toThrow(/Unknown NAS type: delugee/);
    });

    test('preserves nasId and config on the instance', () => {
      const adapter = makeAdapter();
      expect(adapter.nasId).toBe('dl-1');
      expect(adapter.config.port).toBe(8112);
    });

    test('starts unauthenticated with no session cookie', () => {
      const adapter = makeAdapter();
      expect(adapter._isAuthenticated).toBe(false);
      expect(adapter._sessionCookie).toBeNull();
    });
  });

  describe('_baseUrl()', () => {
    test('builds an http URL from host and port', () => {
      expect(makeAdapter()._baseUrl()).toBe('http://10.0.0.7:8112');
    });

    test('uses https when the https flag is set', () => {
      expect(makeAdapter({ https: true })._baseUrl()).toBe('https://10.0.0.7:8112');
    });

    test('supports a hostname rather than an IP', () => {
      expect(makeAdapter({ host: 'deluge.lan', port: 8113 })._baseUrl())
        .toBe('http://deluge.lan:8113');
    });

    test('all RPC calls target the /json endpoint', async () => {
      route({});
      await makeAdapter().listTasks();
      expect(calledUrls()[0]).toBe('http://10.0.0.7:8112/json');
      expect(new Set(calledUrls())).toEqual(new Set(['http://10.0.0.7:8112/json']));
    });
  });

  describe('_displayStatus()', () => {
    const status = (raw) => makeAdapter()._displayStatus(raw);

    test.each([
      ['Downloading', 'downloading'],
      ['Seeding', 'seeding'],
      ['Paused', 'paused'],
      ['Checking', 'checking'],
      ['Allocating', 'allocating'],
      ['Error', 'error']
    ])('maps Deluge state %s to %s', (raw, expected) => {
      expect(status(raw)).toBe(expected);
    });

    test('maps Queued to stalled rather than paused (a queued torrent is waiting)', () => {
      expect(status('Queued')).toBe('stalled');
    });

    test('is case-sensitive, so lower-case states pass through unchanged', () => {
      expect(status('downloading')).toBe('downloading');
      expect(status('paused')).toBe('paused');
      expect(status('queued')).toBe('queued');
    });

    test('passes an unmapped state through unchanged', () => {
      expect(status('Moving')).toBe('Moving');
      expect(status('Active')).toBe('Active');
    });

    test('tolerates undefined and empty input', () => {
      expect(status(undefined)).toBeUndefined();
      expect(status('')).toBe('');
    });
  });

  describe('_rpcRaw() transport', () => {
    test('posts a JSON-RPC payload with method, params and an id', async () => {
      route({});
      await makeAdapter().listTasks();

      const payload = payloadFor('auth.login');
      expect(payload.method).toBe('auth.login');
      expect(payload.params).toEqual(['deluge']);
      expect(typeof payload.id).toBe('number');
    });

    test('sends the XMLHttpRequest header the Deluge web UI expects', async () => {
      route({});
      await makeAdapter().listTasks();

      const [, opts] = fetchMock.mock.calls[0];
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');
      expect(opts.headers['X-Requested-With']).toBe('XMLHttpRequest');
      expect(opts.credentials).toBe('include');
    });

    test('sends no Cookie header on the very first call', async () => {
      route({});
      await makeAdapter().listTasks();
      expect(fetchMock.mock.calls[0][1].headers.Cookie).toBeUndefined();
    });

    test('captures a Set-Cookie session and replays it on later calls', async () => {
      route({
        login: rpcOk(true, { headers: { 'set-cookie': '_session_id=abc123; Path=/; HttpOnly' } })
      });

      const adapter = makeAdapter();
      await adapter.listTasks();

      expect(adapter._sessionCookie).toBe('_session_id=abc123');
      expect(fetchMock.mock.calls[1][1].headers.Cookie).toBe('_session_id=abc123');
    });

    test('trims whitespace around the captured cookie', async () => {
      route({
        login: rpcOk(true, { headers: { 'set-cookie': '  _session_id=xyz  ; Path=/' } })
      });
      const adapter = makeAdapter();
      await adapter.listTasks();
      expect(adapter._sessionCookie).toBe('_session_id=xyz');
    });

    test('keeps the previous cookie when a later response sets none', async () => {
      route({
        login: rpcOk(true, { headers: { 'set-cookie': '_session_id=first; Path=/' } }),
        status: rpcOk({})
      });
      const adapter = makeAdapter();
      await adapter.listTasks();
      expect(adapter._sessionCookie).toBe('_session_id=first');
    });

    test('wraps a non-OK HTTP status in a "Deluge RPC failed" error', async () => {
      route({ login: res({}, { ok: false, status: 502 }) });
      await expect(makeAdapter().listTasks())
        .rejects.toThrow(/Deluge RPC failed: HTTP 502/);
    });

    test('wraps a network rejection in a "Deluge RPC failed" error', async () => {
      route({ login: new Error('ECONNREFUSED') });
      await expect(makeAdapter().listTasks())
        .rejects.toThrow(/Deluge RPC failed: ECONNREFUSED/);
    });

    test('wraps an RPC error envelope in a "Deluge RPC failed" error', async () => {
      route({ login: rpcErr('Not authenticated') });
      await expect(makeAdapter().listTasks())
        .rejects.toThrow(/Deluge RPC failed: Not authenticated/);
    });

    test('falls back to a generic message for an error envelope with no message', async () => {
      route({ login: res({ error: { code: 5 } }) });
      await expect(makeAdapter().listTasks())
        .rejects.toThrow(/Deluge RPC failed: RPC error/);
    });

    test('wraps an unparseable JSON body', async () => {
      route({ login: res('<html>Deluge login page</html>') });
      await expect(makeAdapter().listTasks()).rejects.toThrow(/Deluge RPC failed/);
    });
  });

  describe('authentication', () => {
    test('throws when no password is configured', async () => {
      await expect(makeAdapter({ password: '' }).listTasks())
        .rejects.toThrow(/Deluge password not configured/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('throws when the password key is absent entirely', async () => {
      await expect(getAdapter('dl-x', { type: 'deluge', host: 'h', port: 1 }).listTasks())
        .rejects.toThrow(/Deluge password not configured/);
    });

    test('logs in with the configured password', async () => {
      route({});
      await makeAdapter().listTasks();
      expect(payloadFor('auth.login').params).toEqual(['deluge']);
    });

    test('verifies the session with a probe call after login', async () => {
      route({});
      await makeAdapter().listTasks();
      // auth.login, then the verification probe, then the real query.
      expect(methods()).toEqual([
        'auth.login',
        'core.get_torrents_status',
        'core.get_torrents_status'
      ]);
    });

    test('the verification probe requests no fields', async () => {
      route({});
      await makeAdapter().listTasks();
      expect(payloads()[1].params).toEqual([{}, []]);
    });

    test('rejects when the daemon returns result=false', async () => {
      route({ login: rpcOk(false) });
      await expect(makeAdapter().listTasks())
        .rejects.toThrow(/Deluge authentication failed: invalid password or daemon rejected login/);
    });

    test('rejects when the daemon returns a non-boolean result', async () => {
      route({ login: rpcOk('yes') });
      await expect(makeAdapter().listTasks())
        .rejects.toThrow(/Deluge authentication failed: invalid password or daemon rejected login/);
    });

    test('rejects when the daemon returns a null result', async () => {
      route({ login: rpcOk(null) });
      await expect(makeAdapter().listTasks())
        .rejects.toThrow(/Deluge authentication failed/);
    });

    test('reports the password-change prompt when the verification probe fails', async () => {
      route({ login: rpcOk(true), status: rpcErr('Not authenticated') });
      await expect(makeAdapter().listTasks())
        .rejects.toThrow(/Deluge password change required/);
    });

    test('the password-change message tells the user what to do', async () => {
      route({ login: rpcOk(true), status: rpcErr('Not authenticated') });
      await expect(makeAdapter().listTasks())
        .rejects.toThrow(/complete the password change prompt/);
    });

    test('reports a network failure on the probe as a connection error', async () => {
      route({ login: rpcOk(true), status: new Error('socket hang up') });
      await expect(makeAdapter().listTasks())
        .rejects.toThrow(/Deluge RPC failed: socket hang up/);
    });

    test('does not blame the password prompt for a dropped connection', async () => {
      route({ login: rpcOk(true), status: new Error('socket hang up') });
      await expect(makeAdapter().listTasks())
        .rejects.not.toThrow(/password change required/);
    });

    test('authenticates only once per adapter instance', async () => {
      route({});
      const adapter = makeAdapter();

      await adapter.listTasks();
      await adapter.listTasks();

      expect(callsFor('auth.login')).toHaveLength(1);
    });

    test('a second call reuses the cached session for the query only', async () => {
      route({});
      const adapter = makeAdapter();
      await adapter.listTasks();
      const firstRoundTrips = fetchMock.mock.calls.length;
      await adapter.listTasks();
      expect(fetchMock.mock.calls.length - firstRoundTrips).toBe(1);
    });

    test('does not mark itself authenticated after a failed login', async () => {
      route({ login: rpcOk(false) });
      const adapter = makeAdapter();
      await expect(adapter.listTasks()).rejects.toThrow();
      expect(adapter._isAuthenticated).toBe(false);
    });

    test('retries the login on a later call after an earlier failure', async () => {
      route({ login: [rpcOk(false), rpcOk(true)] });
      const adapter = makeAdapter();

      await expect(adapter.listTasks()).rejects.toThrow();
      await expect(adapter.listTasks()).resolves.toEqual([]);

      expect(callsFor('auth.login')).toHaveLength(2);
    });

    test('a fresh adapter instance does not inherit another instance\'s session', async () => {
      route({});
      await makeAdapter().listTasks();
      const calls = fetchMock.mock.calls.length;
      await makeAdapter().listTasks();
      expect(fetchMock.mock.calls.length - calls).toBe(3);
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

    test('rejects an entirely absent config without a TypeError', async () => {
      await expect(getAdapter('dl-empty', { type: 'deluge' }).testConnection())
        .rejects.toThrow(/Settings incomplete/);
    });

    test('authenticates and reports success', async () => {
      route({});
      await expect(makeAdapter().testConnection())
        .resolves.toEqual({ ok: true, version: 'Deluge' });
    });

    test('performs the login and verification handshake', async () => {
      route({});
      await makeAdapter().testConnection();
      expect(methods()).toEqual(['auth.login', 'core.get_torrents_status']);
    });

    test('wraps a missing password in the connection-failed prefix', async () => {
      await expect(makeAdapter({ password: '' }).testConnection())
        .rejects.toThrow(/Deluge connection failed: Deluge password not configured/);
    });

    test('wraps a rejected password in the connection-failed prefix', async () => {
      route({ login: rpcOk(false) });
      await expect(makeAdapter().testConnection())
        .rejects.toThrow(/Deluge connection failed: Deluge authentication failed/);
    });

    test('wraps a transport error in the connection-failed prefix', async () => {
      route({ login: new Error('ECONNREFUSED') });
      await expect(makeAdapter().testConnection())
        .rejects.toThrow(/Deluge connection failed: Deluge RPC failed: ECONNREFUSED/);
    });

    test('wraps a non-OK HTTP status in the connection-failed prefix', async () => {
      route({ login: res({}, { ok: false, status: 404 }) });
      await expect(makeAdapter().testConnection())
        .rejects.toThrow(/Deluge connection failed: Deluge RPC failed: HTTP 404/);
    });

    test('does not leak the password into the error message', async () => {
      route({ login: rpcOk(false) });
      await expect(makeAdapter().testConnection()).rejects.not.toThrow(/deluge'/);
    });

    test('probes the https base URL when configured', async () => {
      route({});
      await makeAdapter({ https: true }).testConnection();
      expect(calledUrls()[0]).toBe('https://10.0.0.7:8112/json');
    });

    test('reports the same success shape regardless of the daemon version', async () => {
      route({});
      const result = await makeAdapter().testConnection();
      expect(result.version).toBe('Deluge');
    });
  });

  describe('listTasks()', () => {
    test('normalises a torrent into the common task shape', async () => {
      route({ status: [rpcOk({}), rpcOk({ hash1: torrentStatus() })] });

      const tasks = await makeAdapter().listTasks();

      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toEqual({
        id: 'hash1',
        title: 'ubuntu.iso',
        status: 'downloading',
        rawStatus: 'Downloading',
        progress: 50,
        downloaded: 500,
        uploaded: 20,
        size: 1000,
        speed_down: 4096,
        speed_up: 128,
        eta: 300,
        additional: { time_added: 1700000000 }
      });
    });

    test('uses the torrent hash key as the task id', async () => {
      route({ status: [rpcOk({}), rpcOk({ deadbeef: torrentStatus() })] });
      expect((await makeAdapter().listTasks())[0].id).toBe('deadbeef');
    });

    test('requests the field list the UI needs', async () => {
      route({});
      await makeAdapter().listTasks();
      expect(payloads()[2].params[1]).toEqual([
        'name', 'state', 'progress', 'total_done', 'total_uploaded', 'total_size',
        'download_payload_rate', 'upload_payload_rate', 'eta', 'time_added'
      ]);
    });

    test('queries with an empty filter so every torrent is returned', async () => {
      route({});
      await makeAdapter().listTasks();
      expect(payloads()[2].params[0]).toEqual({});
    });

    test('passes Deluge\'s 0-100 progress through unscaled', async () => {
      route({ status: [rpcOk({}), rpcOk({ h: torrentStatus({ progress: 65.5 }) })] });
      expect((await makeAdapter().listTasks())[0].progress).toBeCloseTo(65.5, 5);
    });

    test('keeps a completed torrent at 100 rather than scaling past it', async () => {
      route({ status: [rpcOk({}), rpcOk({ h: torrentStatus({ progress: 100 }) })] });
      expect((await makeAdapter().listTasks())[0].progress).toBe(100);
    });

    test('defaults a missing progress to 0', async () => {
      route({ status: [rpcOk({}), rpcOk({ h: torrentStatus({ progress: undefined }) })] });
      expect((await makeAdapter().listTasks())[0].progress).toBe(0);
    });

    test('defaults missing byte counters to 0', async () => {
      route({
        status: [rpcOk({}), rpcOk({
          h: torrentStatus({
            total_done: undefined,
            total_uploaded: undefined,
            total_size: undefined
          })
        })]
      });
      const [task] = await makeAdapter().listTasks();
      expect(task.downloaded).toBe(0);
      expect(task.uploaded).toBe(0);
      expect(task.size).toBe(0);
    });

    test('defaults missing transfer rates to 0', async () => {
      route({
        status: [rpcOk({}), rpcOk({
          h: torrentStatus({ download_payload_rate: undefined, upload_payload_rate: undefined })
        })]
      });
      const [task] = await makeAdapter().listTasks();
      expect(task.speed_down).toBe(0);
      expect(task.speed_up).toBe(0);
    });

    test('normalises a negative eta to zero', async () => {
      route({ status: [rpcOk({}), rpcOk({ h: torrentStatus({ eta: -1 }) })] });
      expect((await makeAdapter().listTasks())[0].eta).toBe(0);
    });

    test('normalises a missing eta to zero', async () => {
      route({ status: [rpcOk({}), rpcOk({ h: torrentStatus({ eta: undefined }) })] });
      expect((await makeAdapter().listTasks())[0].eta).toBe(0);
    });

    test('preserves a positive eta', async () => {
      route({ status: [rpcOk({}), rpcOk({ h: torrentStatus({ eta: 90 }) })] });
      expect((await makeAdapter().listTasks())[0].eta).toBe(90);
    });

    test('defaults a missing time_added to 0', async () => {
      route({ status: [rpcOk({}), rpcOk({ h: torrentStatus({ time_added: undefined }) })] });
      expect((await makeAdapter().listTasks())[0].additional.time_added).toBe(0);
    });

    test('retains the raw state alongside the mapped status', async () => {
      route({ status: [rpcOk({}), rpcOk({ h: torrentStatus({ state: 'Queued' }) })] });
      const [task] = await makeAdapter().listTasks();
      expect(task.status).toBe('stalled');
      expect(task.rawStatus).toBe('Queued');
    });

    test('maps every torrent in a multi-torrent response', async () => {
      route({
        status: [rpcOk({}), rpcOk({
          a: torrentStatus({ state: 'Downloading' }),
          b: torrentStatus({ state: 'Paused' }),
          c: torrentStatus({ state: 'Error' })
        })]
      });
      const tasks = await makeAdapter().listTasks();
      expect(tasks.map((t) => t.id)).toEqual(['a', 'b', 'c']);
      expect(tasks.map((t) => t.status)).toEqual(['downloading', 'paused', 'error']);
    });

    test('returns an empty array when there are no torrents', async () => {
      route({ status: rpcOk({}) });
      await expect(makeAdapter().listTasks()).resolves.toEqual([]);
    });

    test('treats a null result as an empty list', async () => {
      route({ status: [rpcOk({}), rpcOk(null)] });
      await expect(makeAdapter().listTasks()).resolves.toEqual([]);
    });

    test('surfaces the transport wrapper, not the "Deluge list failed" message', async () => {
      // KNOWN BEHAVIOUR: _rpcRaw() throws on an error envelope before
      // listTasks() can inspect `resp.error`, so the friendlier
      // "Deluge list failed" branch is unreachable.
      route({ status: [rpcOk({}), rpcErr('Unknown method')] });
      const p = makeAdapter().listTasks();
      await expect(p).rejects.toThrow(/Deluge RPC failed: Unknown method/);
      await expect(makeAdapter().listTasks()).rejects.not.toThrow(/Deluge list failed/);
    });

    test('propagates a network rejection on the query', async () => {
      route({ status: [rpcOk({}), new Error('ECONNRESET')] });
      await expect(makeAdapter().listTasks()).rejects.toThrow(/Deluge RPC failed: ECONNRESET/);
    });
  });

  describe('addDownload()', () => {
    test('rejects a URI that is neither a magnet nor a .torrent URL', async () => {
      route({});
      await expect(makeAdapter().addDownload('https://example.com/file.zip'))
        .rejects.toThrow(/Invalid URI: must be a magnet link or \.torrent URL/);
    });

    test('authenticates before validating the URI', async () => {
      // KNOWN ORDERING: _ensureAuthenticated() runs first, so a bad URI on an
      // unreachable daemon surfaces as an auth error rather than a validation
      // error.
      route({ login: new Error('ECONNREFUSED') });
      await expect(makeAdapter().addDownload('not-a-uri'))
        .rejects.toThrow(/Deluge RPC failed: ECONNREFUSED/);
    });

    test('a missing password blocks an otherwise valid magnet', async () => {
      await expect(makeAdapter({ password: '' }).addDownload('magnet:?xt=urn:btih:abc'))
        .rejects.toThrow(/Deluge password not configured/);
    });

    test('adds a magnet link via core.add_torrent_magnet', async () => {
      route({});
      await expect(makeAdapter().addDownload('magnet:?xt=urn:btih:abc123'))
        .resolves.toBeUndefined();

      const payload = payloadFor('core.add_torrent_magnet');
      expect(payload.params[0]).toBe('magnet:?xt=urn:btih:abc123');
      expect(payload.params[1]).toEqual({});
    });

    test('passes the destination as download_location', async () => {
      route({});
      await makeAdapter().addDownload('magnet:?xt=urn:btih:abc', '/data/movies');
      expect(payloadFor('core.add_torrent_magnet').params[1])
        .toEqual({ download_location: '/data/movies' });
    });

    test('sends empty options when no destination is supplied', async () => {
      route({});
      await makeAdapter().addDownload('magnet:?xt=urn:btih:abc');
      expect(payloadFor('core.add_torrent_magnet').params[1]).toEqual({});
    });

    test('preserves a destination containing spaces', async () => {
      route({});
      await makeAdapter().addDownload('magnet:?xt=urn:btih:abc', '/My Data/TV Shows');
      expect(payloadFor('core.add_torrent_magnet').params[1].download_location)
        .toBe('/My Data/TV Shows');
    });

    test('uploads a .torrent file as base64 via core.add_torrent_file', async () => {
      const bytes = torrentBytes();
      fetchMock.mockImplementation((url, opts) => {
        if (String(url).includes('.torrent')) return Promise.resolve(binRes(bytes));
        let method = null;
        try { method = JSON.parse(opts.body).method; } catch { /* ignore */ }
        if (method === 'auth.login') return Promise.resolve(rpcOk(true));
        return Promise.resolve(rpcOk(true));
      });

      await makeAdapter().addDownload('https://example.com/a.torrent');

      const payload = payloadFor('core.add_torrent_file');
      expect(payload.params[0]).toBe('');
      expect(Buffer.from(payload.params[1], 'base64').toString())
        .toBe(new TextDecoder().decode(bytes));
      expect(payload.params[2]).toEqual({});
    });

    test('passes the destination through on a .torrent upload', async () => {
      fetchMock.mockImplementation((url) => {
        if (String(url).includes('.torrent')) return Promise.resolve(binRes(torrentBytes()));
        return Promise.resolve(rpcOk(true));
      });

      await makeAdapter().addDownload('https://example.com/a.torrent', '/data/tv');
      expect(payloadFor('core.add_torrent_file').params[2])
        .toEqual({ download_location: '/data/tv' });
    });

    test('does not parse the .torrent file, so a malformed body still uploads', async () => {
      fetchMock.mockImplementation((url) => {
        if (String(url).includes('.torrent')) {
          return Promise.resolve(binRes(new TextEncoder().encode('not-bencode')));
        }
        return Promise.resolve(rpcOk(true));
      });

      await expect(makeAdapter().addDownload('https://example.com/a.torrent'))
        .resolves.toBeUndefined();
      expect(Buffer.from(payloadFor('core.add_torrent_file').params[1], 'base64').toString())
        .toBe('not-bencode');
    });

    test('propagates a failed .torrent download', async () => {
      fetchMock.mockImplementation((url) => {
        if (String(url).includes('.torrent')) {
          return Promise.resolve(binRes(new Uint8Array(), { ok: false, status: 404 }));
        }
        return Promise.resolve(rpcOk(true));
      });

      await expect(makeAdapter().addDownload('https://example.com/a.torrent'))
        .rejects.toThrow(/Failed to download torrent: HTTP 404/);
      expect(callsFor('core.add_torrent_file')).toHaveLength(0);
    });

    test('surfaces the transport wrapper when the magnet add is refused', async () => {
      route({ other: rpcErr('Torrent already in session') });
      await expect(makeAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .rejects.toThrow(/Deluge RPC failed: Torrent already in session/);
    });

    test('does not reach the "Deluge add failed" branch', async () => {
      // As with listTasks, _rpcRaw() throws first.
      route({ other: rpcErr('nope') });
      await expect(makeAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .rejects.not.toThrow(/Deluge add failed/);
    });

    test('rejects a non-http(s) .torrent scheme', async () => {
      route({});
      await expect(makeAdapter().addDownload('ftp://example.com/a.torrent'))
        .rejects.toThrow(/Invalid URI/);
    });

    test('accepts a .torrent URL carrying a query string', async () => {
      fetchMock.mockImplementation((url) => {
        if (String(url).includes('.torrent')) return Promise.resolve(binRes(torrentBytes()));
        return Promise.resolve(rpcOk(true));
      });
      await expect(makeAdapter().addDownload('https://example.com/a.torrent?token=x'))
        .resolves.toBeUndefined();
    });

    test('propagates a network rejection on the add call', async () => {
      route({ other: new Error('ECONNRESET') });
      await expect(makeAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .rejects.toThrow(/Deluge RPC failed: ECONNRESET/);
    });
  });

  describe('taskAction()', () => {
    test('pause calls core.pause_torrents with the hash list', async () => {
      route({});
      await expect(makeAdapter().taskAction('pause', ['h1', 'h2'])).resolves.toBeUndefined();
      expect(payloadFor('core.pause_torrents').params).toEqual([['h1', 'h2']]);
    });

    test('resume calls core.resume_torrents with the hash list', async () => {
      route({});
      await makeAdapter().taskAction('resume', ['h1']);
      expect(payloadFor('core.resume_torrents').params).toEqual([['h1']]);
    });

    test('delete calls core.remove_torrents non-destructively', async () => {
      route({});
      await makeAdapter().taskAction('delete', ['h1']);
      expect(payloadFor('core.remove_torrents').params).toEqual([['h1'], false]);
    });

    test('passes hashes through as strings without coercion', async () => {
      route({});
      await makeAdapter().taskAction('pause', ['abc123', 'def456']);
      expect(payloadFor('core.pause_torrents').params[0]).toEqual(['abc123', 'def456']);
    });

    test('sends an empty list for an empty selection', async () => {
      route({});
      await makeAdapter().taskAction('pause', []);
      expect(payloadFor('core.pause_torrents').params).toEqual([[]]);
    });

    test('an unknown action is a silent no-op after authenticating', async () => {
      route({});
      await expect(makeAdapter().taskAction('explode', ['h1'])).resolves.toBeUndefined();
      expect(methods()).toEqual(['auth.login', 'core.get_torrents_status']);
    });

    test('an undefined action is also a silent no-op', async () => {
      route({});
      await expect(makeAdapter().taskAction(undefined, ['h1'])).resolves.toBeUndefined();
      expect(callsFor('core.pause_torrents')).toHaveLength(0);
    });

    test('authenticates before acting', async () => {
      route({});
      await makeAdapter().taskAction('pause', ['h1']);
      expect(methods()).toEqual([
        'auth.login',
        'core.get_torrents_status',
        'core.pause_torrents'
      ]);
    });

    test('a missing password blocks the action', async () => {
      await expect(makeAdapter({ password: '' }).taskAction('pause', ['h1']))
        .rejects.toThrow(/Deluge password not configured/);
    });

    test('surfaces the transport wrapper when the pause is refused', async () => {
      route({ other: rpcErr('Unknown torrent') });
      await expect(makeAdapter().taskAction('pause', ['h1']))
        .rejects.toThrow(/Deluge RPC failed: Unknown torrent/);
    });

    test('surfaces the transport wrapper when the delete is refused', async () => {
      route({ other: rpcErr('Unknown torrent') });
      await expect(makeAdapter().taskAction('delete', ['h1']))
        .rejects.toThrow(/Deluge RPC failed: Unknown torrent/);
    });

    test('does not reach the "Deluge pause failed" branch', async () => {
      route({ other: rpcErr('nope') });
      await expect(makeAdapter().taskAction('pause', ['h1']))
        .rejects.not.toThrow(/Deluge pause failed/);
    });

    test('propagates a network rejection', async () => {
      route({ other: new Error('connection reset') });
      await expect(makeAdapter().taskAction('resume', ['h1']))
        .rejects.toThrow(/Deluge RPC failed: connection reset/);
    });

    test('issues the action against the configured base URL', async () => {
      route({});
      await makeAdapter({ host: 'deluge.lan', port: 8113, https: true })
        .taskAction('pause', ['h1']);
      expect(new Set(calledUrls())).toEqual(new Set(['https://deluge.lan:8113/json']));
    });

    test('a non-array id argument is forwarded verbatim rather than throwing', async () => {
      route({});
      await expect(makeAdapter().taskAction('pause', undefined)).resolves.toBeUndefined();
      expect(payloadFor('core.pause_torrents').params).toEqual([null]);
    });

    test('replays the captured session cookie on the action call', async () => {
      route({
        login: rpcOk(true, { headers: { 'set-cookie': '_session_id=abc; Path=/' } })
      });
      await makeAdapter().taskAction('pause', ['h1']);
      expect(callsFor('core.pause_torrents')[0][1].headers.Cookie).toBe('_session_id=abc');
    });
  });

  describe('documented behavioural contracts', () => {
    test('addDownload resolves undefined rather than an {ok:true} envelope', async () => {
      route({});
      await expect(makeAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .resolves.toBeUndefined();
    });

    test('taskAction resolves undefined rather than an {ok:true} envelope', async () => {
      route({});
      await expect(makeAdapter().taskAction('pause', ['h1'])).resolves.toBeUndefined();
    });

    test('listTasks performs no host/port validation, unlike testConnection', async () => {
      route({});
      await expect(getAdapter('dl-y', { type: 'deluge', password: 'p' }).listTasks())
        .resolves.toEqual([]);
      expect(calledUrls()[0]).toBe('http://undefined:undefined/json');
    });

    test('every RPC id is a timestamp, so ids increase monotonically', async () => {
      route({});
      await makeAdapter().listTasks();
      const ids = payloads().map((p) => p.id);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
    });

    test('the password is only ever sent to auth.login', async () => {
      route({});
      await makeAdapter().listTasks();
      const nonLogin = payloads().filter((p) => p.method !== 'auth.login');
      nonLogin.forEach((p) => {
        expect(JSON.stringify(p)).not.toContain('deluge');
      });
    });
  });
});
