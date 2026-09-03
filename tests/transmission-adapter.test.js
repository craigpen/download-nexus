/**
 * Transmission Adapter Unit Tests
 *
 * IMPORTANT: These tests exercise the REAL `TransmissionAdapter` from
 * `src/background.js` (obtained via the exported `getAdapter` factory) with a
 * mocked `fetch`. This is deliberately different from `tests/adapters.test.js`,
 * which asserts against inline mock re-implementations and therefore cannot
 * catch regressions in the shipped adapter.
 */

const { installChromeStub } = require('./helpers/chromeStub');

installChromeStub();

const { getAdapter } = require('../src/background.js');

// ── fetch mocking helpers ───────────────────────────────────────────────────

const SESSION_ID = 'sess-XYZ';

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

/** A session-get handshake reply carrying the CSRF session header. */
const sessionRes = (id = SESSION_ID) =>
  res({ result: 'success', arguments: {} }, { headers: { 'X-Transmission-Session-Id': id } });

/** An RPC success envelope. */
const rpcOk = (args = {}) => res({ result: 'success', arguments: args });
/** An RPC failure envelope. */
const rpcErr = (result) => res({ result });

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
/** Parsed JSON bodies of every fetch call, in order. */
const bodies = () => fetchMock.mock.calls.map((c) => {
  try { return JSON.parse(c[1].body); } catch { return null; }
});
/** The first parsed body whose RPC method matches. */
const bodyFor = (method) => bodies().find((b) => b && b.method === method);
/** Every fetch call whose parsed body uses the given RPC method. */
const callsFor = (method) => fetchMock.mock.calls.filter((c) => {
  try { return JSON.parse(c[1].body).method === method; } catch { return false; }
});

/**
 * Drive the session-get handshake then the real RPC. `rpc` may be a
 * Response-like object, an Error, or an array consumed one entry per call.
 */
function route({ session = sessionRes(), rpc } = {}) {
  const queue = Array.isArray(rpc) ? [...rpc] : null;
  fetchMock.mockImplementation((url, opts) => {
    let method = null;
    try { method = JSON.parse(opts.body).method; } catch { /* ignore */ }
    if (method === 'session-get') {
      return session instanceof Error ? Promise.reject(session) : Promise.resolve(session);
    }
    let val = queue ? (queue.length > 1 ? queue.shift() : queue[0]) : rpc;
    if (val === undefined) val = rpcOk();
    return val instanceof Error ? Promise.reject(val) : Promise.resolve(val);
  });
}

/** Bencode a minimal but structurally valid .torrent file. */
function torrentBytes({ announce = null, name = 'test.bin' } = {}) {
  const ann = announce ? `${announce.length}:${announce}` : '';
  const s = `d${announce ? `8:announce${ann}` : ''}4:infod4:name${name.length}:${name}6:lengthi1024eee`;
  return new TextEncoder().encode(s);
}

const TR_CONFIG = {
  type: 'transmission',
  id: 'tr-1',
  name: 'Transmission Box',
  host: '10.0.0.5',
  port: 9091,
  https: false
};

const AUTH_CONFIG = { ...TR_CONFIG, username: 'tuser', password: 'tpass' };

const makeAdapter = (cfg = {}) => getAdapter('tr-1', { ...TR_CONFIG, ...cfg });

const torrent = (over = {}) => ({
  id: 42,
  name: 'ubuntu.iso',
  status: 4,
  percentDone: 0.25,
  downloadedEver: 250,
  uploadedEver: 10,
  totalSize: 1000,
  rateDownload: 2048,
  rateUpload: 64,
  eta: 600,
  ...over
});

describe('TransmissionAdapter (real implementation)', () => {
  describe('getAdapter factory', () => {
    test('returns a Transmission adapter for type "transmission"', () => {
      const adapter = makeAdapter();
      expect(adapter.constructor.name).toBe('TransmissionAdapter');
      expect(typeof adapter.testConnection).toBe('function');
      expect(typeof adapter.listTasks).toBe('function');
      expect(typeof adapter.addDownload).toBe('function');
      expect(typeof adapter.taskAction).toBe('function');
    });

    test('throws for an unknown service type', () => {
      expect(() => getAdapter('x', { type: 'transmision' }))
        .toThrow(/Unknown NAS type: transmision/);
    });

    test('preserves nasId and config on the instance', () => {
      const adapter = makeAdapter();
      expect(adapter.nasId).toBe('tr-1');
      expect(adapter.config.port).toBe(9091);
    });
  });

  describe('_baseUrl()', () => {
    test('builds an http URL from host and port', () => {
      expect(makeAdapter()._baseUrl()).toBe('http://10.0.0.5:9091');
    });

    test('uses https when the https flag is set', () => {
      expect(makeAdapter({ https: true })._baseUrl()).toBe('https://10.0.0.5:9091');
    });

    test('supports a hostname rather than an IP', () => {
      expect(makeAdapter({ host: 'tr.lan', port: 9092 })._baseUrl()).toBe('http://tr.lan:9092');
    });
  });

  describe('_statusString()', () => {
    const status = (n) => makeAdapter()._statusString(n);

    test.each([
      [0, 'paused'],
      [1, 'checking'],
      [2, 'checking'],
      [3, 'stalled'],
      [4, 'downloading'],
      [5, 'stalled'],
      [6, 'seeding']
    ])('maps Transmission status %i to %s', (raw, expected) => {
      expect(status(raw)).toBe(expected);
    });

    test('maps download-pending (3) to stalled rather than downloading (P0-4)', () => {
      // A queued torrent is not transferring, so it must not read as active.
      expect(status(3)).toBe('stalled');
    });

    test('maps seed-pending (5) to stalled rather than seeding (P0-4)', () => {
      expect(status(5)).toBe('stalled');
    });

    test('falls back to paused for an out-of-range status code', () => {
      expect(status(7)).toBe('paused');
      expect(status(99)).toBe('paused');
      expect(status(-1)).toBe('paused');
    });

    test('falls back to paused for a non-numeric status', () => {
      expect(status(undefined)).toBe('paused');
      expect(status(null)).toBe('paused');
    });

    test('accepts the numeric key as a string because object keys coerce', () => {
      expect(status('4')).toBe('downloading');
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
      await expect(getAdapter('tr-empty', { type: 'transmission' }).testConnection())
        .rejects.toThrow(/Settings incomplete/);
    });

    test('probes the RPC endpoint and reports success', async () => {
      fetchMock.mockResolvedValue(sessionRes());
      await expect(makeAdapter().testConnection())
        .resolves.toEqual({ ok: true, version: 'Transmission', type: 'Transmission' });
    });

    test('probes /rpc rather than /transmission/rpc', async () => {
      // KNOWN QUIRK: testConnection() uses the short /rpc path while every
      // other call uses /transmission/rpc. Pinned so the inconsistency is
      // visible if someone changes one without the other.
      fetchMock.mockResolvedValue(sessionRes());
      await makeAdapter().testConnection();
      expect(calledUrls()[0]).toBe('http://10.0.0.5:9091/rpc');
    });

    test('sends a session-get probe as JSON', async () => {
      fetchMock.mockResolvedValue(sessionRes());
      await makeAdapter().testConnection();

      const [, opts] = fetchMock.mock.calls[0];
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(opts.body)).toEqual({ method: 'session-get', arguments: {} });
    });

    test('sends a placeholder CSRF session id on the probe', async () => {
      fetchMock.mockResolvedValue(sessionRes());
      await makeAdapter().testConnection();
      expect(fetchMock.mock.calls[0][1].headers['X-Transmission-Session-Id'])
        .toBe('test-session');
    });

    test('reports the HTTP status when the probe is rejected', async () => {
      fetchMock.mockResolvedValue(res('', { ok: false, status: 401 }));
      await expect(makeAdapter().testConnection())
        .rejects.toThrow(/Transmission connection failed: HTTP 401/);
    });

    test('treats the 409 CSRF challenge as a connection failure', async () => {
      // Transmission answers an unknown session id with 409; testConnection
      // does not retry with the returned id.
      fetchMock.mockResolvedValue(res('', { ok: false, status: 409 }));
      await expect(makeAdapter().testConnection())
        .rejects.toThrow(/Transmission connection failed: HTTP 409/);
    });

    test('propagates a network rejection', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(makeAdapter().testConnection()).rejects.toThrow(/ECONNREFUSED/);
    });

    test('uses the https base URL when configured', async () => {
      fetchMock.mockResolvedValue(sessionRes());
      await makeAdapter({ https: true }).testConnection();
      expect(calledUrls()[0]).toBe('https://10.0.0.5:9091/rpc');
    });

    test('sends no Authorization header on the probe even when credentials exist', async () => {
      // testConnection() skips the basic-auth header the other calls attach.
      fetchMock.mockResolvedValue(sessionRes());
      await getAdapter('tr-1', AUTH_CONFIG).testConnection();
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    });
  });

  describe('_getSessionId()', () => {
    test('reads the CSRF id from the session-get response header', async () => {
      route({ rpc: rpcOk({ torrents: [] }) });
      await makeAdapter().listTasks();
      expect(callsFor('torrent-get')[0][1].headers['X-Transmission-Session-Id'])
        .toBe(SESSION_ID);
    });

    test('throws when the response carries no session header', async () => {
      route({ session: res({ result: 'success' }) });
      await expect(makeAdapter().listTasks())
        .rejects.toThrow(/Failed to get Transmission session ID/);
    });

    test('posts the handshake to /transmission/rpc', async () => {
      route({ rpc: rpcOk({ torrents: [] }) });
      await makeAdapter().listTasks();
      expect(calledUrls()[0]).toBe('http://10.0.0.5:9091/transmission/rpc');
    });

    test('attaches basic auth when credentials are configured', async () => {
      route({ rpc: rpcOk({ torrents: [] }) });
      await getAdapter('tr-1', AUTH_CONFIG).listTasks();
      expect(fetchMock.mock.calls[0][1].headers.Authorization)
        .toBe(`Basic ${Buffer.from('tuser:tpass').toString('base64')}`);
    });

    test('omits the Authorization header when no username is configured', async () => {
      route({ rpc: rpcOk({ torrents: [] }) });
      await makeAdapter().listTasks();
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    });

    test('propagates a network rejection from the handshake', async () => {
      route({ session: new Error('handshake refused') });
      await expect(makeAdapter().listTasks()).rejects.toThrow(/handshake refused/);
    });
  });

  describe('listTasks()', () => {
    test('normalises a torrent into the common task shape', async () => {
      route({ rpc: rpcOk({ torrents: [torrent()] }) });

      const tasks = await makeAdapter().listTasks();

      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toEqual({
        id: '42',
        title: 'ubuntu.iso',
        status: 'downloading',
        rawStatus: 4,
        progress: 25,
        downloaded: 250,
        uploaded: 10,
        size: 1000,
        speed_down: 2048,
        speed_up: 64,
        eta: 600
      });
    });

    test('stringifies the numeric torrent id', async () => {
      route({ rpc: rpcOk({ torrents: [torrent({ id: 7 })] }) });
      const [task] = await makeAdapter().listTasks();
      expect(task.id).toBe('7');
      expect(typeof task.id).toBe('string');
    });

    test('scales the 0-1 percentDone fraction to a percentage', async () => {
      route({ rpc: rpcOk({ torrents: [torrent({ percentDone: 0.755 })] }) });
      expect((await makeAdapter().listTasks())[0].progress).toBeCloseTo(75.5, 5);
    });

    test('reports 100% for a completed torrent', async () => {
      route({ rpc: rpcOk({ torrents: [torrent({ percentDone: 1, status: 6 })] }) });
      const [task] = await makeAdapter().listTasks();
      expect(task.progress).toBe(100);
      expect(task.status).toBe('seeding');
    });

    test('retains the raw numeric status alongside the mapped one', async () => {
      route({ rpc: rpcOk({ torrents: [torrent({ status: 0 })] }) });
      const [task] = await makeAdapter().listTasks();
      expect(task.status).toBe('paused');
      expect(task.rawStatus).toBe(0);
    });

    test('normalises a negative eta (unknown) to zero', async () => {
      route({ rpc: rpcOk({ torrents: [torrent({ eta: -1 })] }) });
      expect((await makeAdapter().listTasks())[0].eta).toBe(0);
    });

    test('normalises a zero eta to zero', async () => {
      route({ rpc: rpcOk({ torrents: [torrent({ eta: 0 })] }) });
      expect((await makeAdapter().listTasks())[0].eta).toBe(0);
    });

    test('preserves a positive eta', async () => {
      route({ rpc: rpcOk({ torrents: [torrent({ eta: 1234 })] }) });
      expect((await makeAdapter().listTasks())[0].eta).toBe(1234);
    });

    test('requests exactly the fields the UI consumes', async () => {
      route({ rpc: rpcOk({ torrents: [] }) });
      await makeAdapter().listTasks();

      expect(bodyFor('torrent-get').arguments.fields).toEqual([
        'id', 'name', 'status', 'percentDone', 'downloadedEver', 'uploadedEver',
        'totalSize', 'rateDownload', 'rateUpload', 'eta'
      ]);
    });

    test('maps every torrent in a multi-torrent response', async () => {
      route({
        rpc: rpcOk({
          torrents: [
            torrent({ id: 1, status: 4 }),
            torrent({ id: 2, status: 0 }),
            torrent({ id: 3, status: 6 })
          ]
        })
      });
      const tasks = await makeAdapter().listTasks();
      expect(tasks.map((t) => t.id)).toEqual(['1', '2', '3']);
      expect(tasks.map((t) => t.status)).toEqual(['downloading', 'paused', 'seeding']);
    });

    test('returns an empty array when there are no torrents', async () => {
      route({ rpc: rpcOk({ torrents: [] }) });
      await expect(makeAdapter().listTasks()).resolves.toEqual([]);
    });

    test('treats a missing torrents key as an empty list', async () => {
      route({ rpc: rpcOk({}) });
      await expect(makeAdapter().listTasks()).resolves.toEqual([]);
    });

    test('treats a missing arguments object as an empty list', async () => {
      route({ rpc: res({ result: 'success' }) });
      await expect(makeAdapter().listTasks()).resolves.toEqual([]);
    });

    test('throws when the RPC result is not "success"', async () => {
      route({ rpc: rpcErr('invalid argument') });
      await expect(makeAdapter().listTasks())
        .rejects.toThrow(/Transmission get torrents failed: invalid argument/);
    });

    test('throws when the RPC result field is missing entirely', async () => {
      route({ rpc: res({ arguments: { torrents: [] } }) });
      await expect(makeAdapter().listTasks())
        .rejects.toThrow(/Transmission get torrents failed/);
    });

    test('retries after a 409 CSRF challenge and succeeds on the second attempt', async () => {
      route({ rpc: [res('', { ok: false, status: 409 }), rpcOk({ torrents: [torrent()] })] });

      const tasks = await makeAdapter().listTasks();

      expect(tasks).toHaveLength(1);
      expect(callsFor('torrent-get')).toHaveLength(2);
    });

    test('re-handshakes for a fresh session id on each 409 retry', async () => {
      route({ rpc: [res('', { ok: false, status: 409 }), rpcOk({ torrents: [] })] });
      await makeAdapter().listTasks();
      expect(callsFor('session-get')).toHaveLength(2);
    });

    test('gives up after 3 session refreshes', async () => {
      route({ rpc: res('', { ok: false, status: 409 }) });
      await expect(makeAdapter().listTasks())
        .rejects.toThrow(/Transmission session refresh failed after 3 retries/);
    });

    test('makes exactly four torrent-get attempts before giving up on 409s', async () => {
      route({ rpc: res('', { ok: false, status: 409 }) });
      await expect(makeAdapter().listTasks()).rejects.toThrow();
      // retryCount 0,1,2 recurse; the 4th (retryCount 3) throws.
      expect(callsFor('torrent-get')).toHaveLength(4);
    });

    test('does not retry a non-409 HTTP error', async () => {
      // A non-OK, non-409 response falls through to resp.json().
      route({ rpc: res({ result: 'forbidden' }, { ok: false, status: 403 }) });
      await expect(makeAdapter().listTasks())
        .rejects.toThrow(/Transmission get torrents failed: forbidden/);
      expect(callsFor('torrent-get')).toHaveLength(1);
    });

    test('propagates a network rejection', async () => {
      route({ rpc: new Error('socket hang up') });
      await expect(makeAdapter().listTasks()).rejects.toThrow(/socket hang up/);
    });

    test('attaches basic auth to the torrent-get call', async () => {
      route({ rpc: rpcOk({ torrents: [] }) });
      await getAdapter('tr-1', AUTH_CONFIG).listTasks();
      expect(callsFor('torrent-get')[0][1].headers.Authorization)
        .toBe(`Basic ${Buffer.from('tuser:tpass').toString('base64')}`);
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
      await expect(makeAdapter().addDownload('nonsense')).rejects.toThrow(/Invalid URI/);
    });

    test('submits a magnet link in the filename argument', async () => {
      route({ rpc: rpcOk() });

      await expect(makeAdapter().addDownload('magnet:?xt=urn:btih:abc123'))
        .resolves.toBeUndefined();

      const body = bodyFor('torrent-add');
      expect(body.arguments.filename).toBe('magnet:?xt=urn:btih:abc123');
      expect(body.arguments.metainfo).toBeUndefined();
    });

    test('includes download-dir when a destination is supplied', async () => {
      route({ rpc: rpcOk() });
      await makeAdapter().addDownload('magnet:?xt=urn:btih:abc', '/data/movies');
      expect(bodyFor('torrent-add').arguments['download-dir']).toBe('/data/movies');
    });

    test('omits download-dir when no destination is supplied', async () => {
      route({ rpc: rpcOk() });
      await makeAdapter().addDownload('magnet:?xt=urn:btih:abc');
      expect(bodyFor('torrent-add').arguments).not.toHaveProperty('download-dir');
    });

    test('preserves a destination containing spaces', async () => {
      route({ rpc: rpcOk() });
      await makeAdapter().addDownload('magnet:?xt=urn:btih:abc', '/My Data/TV Shows');
      expect(bodyFor('torrent-add').arguments['download-dir']).toBe('/My Data/TV Shows');
    });

    test('uploads a .torrent file as base64 metainfo, not as a URL', async () => {
      const bytes = torrentBytes();
      fetchMock.mockImplementation((url, opts) => {
        if (String(url).includes('.torrent')) return Promise.resolve(binRes(bytes));
        let method = null;
        try { method = JSON.parse(opts.body).method; } catch { /* ignore */ }
        if (method === 'session-get') return Promise.resolve(sessionRes());
        return Promise.resolve(rpcOk());
      });

      await makeAdapter().addDownload('https://example.com/a.torrent');

      const args = bodyFor('torrent-add').arguments;
      expect(args.filename).toBeUndefined();
      expect(Buffer.from(args.metainfo, 'base64').toString()).toBe(new TextDecoder().decode(bytes));
    });

    test('accepts a .torrent URL carrying a query string', async () => {
      fetchMock.mockImplementation((url, opts) => {
        if (String(url).includes('.torrent')) return Promise.resolve(binRes(torrentBytes()));
        let method = null;
        try { method = JSON.parse(opts.body).method; } catch { /* ignore */ }
        if (method === 'session-get') return Promise.resolve(sessionRes());
        return Promise.resolve(rpcOk());
      });

      await expect(makeAdapter().addDownload('https://example.com/a.torrent?token=x'))
        .resolves.toBeUndefined();
    });

    test('propagates a failed .torrent download', async () => {
      fetchMock.mockImplementation((url, opts) => {
        if (String(url).includes('.torrent')) {
          return Promise.resolve(binRes(new Uint8Array(), { ok: false, status: 404 }));
        }
        let method = null;
        try { method = JSON.parse(opts.body).method; } catch { /* ignore */ }
        if (method === 'session-get') return Promise.resolve(sessionRes());
        return Promise.resolve(rpcOk());
      });

      await expect(makeAdapter().addDownload('https://example.com/a.torrent'))
        .rejects.toThrow(/Failed to download torrent: HTTP 404/);
      expect(callsFor('torrent-add')).toHaveLength(0);
    });

    test('does not parse the .torrent file, so a malformed body still uploads', async () => {
      // Unlike Synology/qBittorrent, Transmission receives the raw bytes and
      // validates them server-side.
      fetchMock.mockImplementation((url, opts) => {
        if (String(url).includes('.torrent')) {
          return Promise.resolve(binRes(new TextEncoder().encode('not-bencode')));
        }
        let method = null;
        try { method = JSON.parse(opts.body).method; } catch { /* ignore */ }
        if (method === 'session-get') return Promise.resolve(sessionRes());
        return Promise.resolve(rpcOk());
      });

      await expect(makeAdapter().addDownload('https://example.com/a.torrent'))
        .resolves.toBeUndefined();
      expect(Buffer.from(bodyFor('torrent-add').arguments.metainfo, 'base64').toString())
        .toBe('not-bencode');
    });

    test('throws when the RPC result is not "success"', async () => {
      route({ rpc: rpcErr('duplicate torrent') });
      await expect(makeAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .rejects.toThrow(/Transmission add torrent failed: duplicate torrent/);
    });

    test('reports a torrent-duplicate result as a failure', async () => {
      route({ rpc: rpcErr('torrent-duplicate') });
      await expect(makeAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .rejects.toThrow(/Transmission add torrent failed: torrent-duplicate/);
    });

    test('performs the session handshake before adding', async () => {
      route({ rpc: rpcOk() });
      await makeAdapter().addDownload('magnet:?xt=urn:btih:abc');
      expect(callsFor('session-get')).toHaveLength(1);
      expect(callsFor('torrent-add')[0][1].headers['X-Transmission-Session-Id'])
        .toBe(SESSION_ID);
    });

    test('attaches basic auth to the add call', async () => {
      route({ rpc: rpcOk() });
      await getAdapter('tr-1', AUTH_CONFIG).addDownload('magnet:?xt=urn:btih:abc');
      expect(callsFor('torrent-add')[0][1].headers.Authorization)
        .toBe(`Basic ${Buffer.from('tuser:tpass').toString('base64')}`);
    });

    test('posts the add to /transmission/rpc', async () => {
      route({ rpc: rpcOk() });
      await makeAdapter().addDownload('magnet:?xt=urn:btih:abc');
      expect(urlContaining('/transmission/rpc'))
        .toBe('http://10.0.0.5:9091/transmission/rpc');
    });

    test('propagates a network rejection', async () => {
      route({ rpc: new Error('ECONNRESET') });
      await expect(makeAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .rejects.toThrow(/ECONNRESET/);
    });
  });

  describe('taskAction()', () => {
    test('pause maps to torrent-stop', async () => {
      route({ rpc: rpcOk() });
      await expect(makeAdapter().taskAction('pause', ['1'])).resolves.toBeUndefined();
      expect(bodyFor('torrent-stop')).toBeDefined();
    });

    test('resume maps to torrent-start', async () => {
      route({ rpc: rpcOk() });
      await makeAdapter().taskAction('resume', ['1']);
      expect(bodyFor('torrent-start')).toBeDefined();
    });

    test('delete maps to torrent-remove', async () => {
      route({ rpc: rpcOk() });
      await makeAdapter().taskAction('delete', ['1']);
      expect(bodyFor('torrent-remove')).toBeDefined();
    });

    test('coerces string ids to the integers the RPC expects', async () => {
      route({ rpc: rpcOk() });
      await makeAdapter().taskAction('pause', ['1', '2', '3']);
      expect(bodyFor('torrent-stop').arguments.ids).toEqual([1, 2, 3]);
    });

    test('parses a numeric prefix out of a non-numeric id', async () => {
      route({ rpc: rpcOk() });
      await makeAdapter().taskAction('pause', ['12abc']);
      expect(bodyFor('torrent-stop').arguments.ids).toEqual([12]);
    });

    test('produces null for an entirely non-numeric id', async () => {
      // parseInt("abc") is NaN, which JSON.stringify serialises as null.
      route({ rpc: rpcOk() });
      await makeAdapter().taskAction('pause', ['abc']);
      expect(bodyFor('torrent-stop').arguments.ids).toEqual([null]);
    });

    test('delete requests a non-destructive removal', async () => {
      route({ rpc: rpcOk() });
      await makeAdapter().taskAction('delete', ['1']);
      expect(bodyFor('torrent-remove').arguments['delete-local-data']).toBe(false);
    });

    test('pause and resume omit delete-local-data', async () => {
      route({ rpc: rpcOk() });
      await makeAdapter().taskAction('pause', ['1']);
      expect(bodyFor('torrent-stop').arguments).not.toHaveProperty('delete-local-data');
    });

    test('sends an empty id list for an empty selection', async () => {
      route({ rpc: rpcOk() });
      await makeAdapter().taskAction('pause', []);
      expect(bodyFor('torrent-stop').arguments.ids).toEqual([]);
    });

    test('rejects an unknown action without touching the network', async () => {
      await expect(makeAdapter().taskAction('explode', ['1']))
        .rejects.toThrow(/Unknown action: explode/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('rejects an undefined action', async () => {
      await expect(makeAdapter().taskAction(undefined, ['1']))
        .rejects.toThrow(/Unknown action/);
    });

    test('throws when the RPC result is not "success"', async () => {
      route({ rpc: rpcErr('no such torrent') });
      await expect(makeAdapter().taskAction('pause', ['1']))
        .rejects.toThrow(/Transmission action failed: no such torrent/);
    });

    test('performs the session handshake before acting', async () => {
      route({ rpc: rpcOk() });
      await makeAdapter().taskAction('pause', ['1']);
      expect(callsFor('session-get')).toHaveLength(1);
      expect(callsFor('torrent-stop')[0][1].headers['X-Transmission-Session-Id'])
        .toBe(SESSION_ID);
    });

    test('attaches basic auth to the action call', async () => {
      route({ rpc: rpcOk() });
      await getAdapter('tr-1', AUTH_CONFIG).taskAction('pause', ['1']);
      expect(callsFor('torrent-stop')[0][1].headers.Authorization)
        .toBe(`Basic ${Buffer.from('tuser:tpass').toString('base64')}`);
    });

    test('does not retry a 409 on actions, unlike listTasks', async () => {
      route({ rpc: res({ result: 'conflict' }, { ok: false, status: 409 }) });
      await expect(makeAdapter().taskAction('pause', ['1']))
        .rejects.toThrow(/Transmission action failed: conflict/);
      expect(callsFor('torrent-stop')).toHaveLength(1);
    });

    test('propagates a network rejection', async () => {
      route({ rpc: new Error('connection reset') });
      await expect(makeAdapter().taskAction('pause', ['1']))
        .rejects.toThrow(/connection reset/);
    });

    test('issues the action against the configured base URL', async () => {
      route({ rpc: rpcOk() });
      await makeAdapter({ host: 'tr.lan', port: 9092, https: true }).taskAction('resume', ['1']);
      expect(urlContaining('/transmission/rpc'))
        .toBe('https://tr.lan:9092/transmission/rpc');
    });

    test('a non-array id argument throws rather than silently no-opping', async () => {
      route({ rpc: rpcOk() });
      await expect(makeAdapter().taskAction('pause', undefined)).rejects.toThrow(TypeError);
    });
  });

  describe('documented behavioural contracts', () => {
    test('addDownload resolves undefined rather than an {ok:true} envelope', async () => {
      route({ rpc: rpcOk() });
      await expect(makeAdapter().addDownload('magnet:?xt=urn:btih:abc'))
        .resolves.toBeUndefined();
    });

    test('taskAction resolves undefined rather than an {ok:true} envelope', async () => {
      route({ rpc: rpcOk() });
      await expect(makeAdapter().taskAction('pause', ['1'])).resolves.toBeUndefined();
    });

    test('listTasks performs no client-side config validation', async () => {
      // Only testConnection guards on host/port.
      route({ rpc: rpcOk({ torrents: [] }) });
      await expect(getAdapter('tr-x', { type: 'transmission' }).listTasks())
        .resolves.toEqual([]);
      expect(calledUrls()[0]).toBe('http://undefined:undefined/transmission/rpc');
    });

    test('a password is never echoed into a thrown error message', async () => {
      route({ rpc: rpcErr('nope') });
      await expect(getAdapter('tr-1', AUTH_CONFIG).listTasks())
        .rejects.not.toThrow(/tpass/);
    });

    test('every non-probe call goes through the session handshake', async () => {
      route({ rpc: rpcOk({ torrents: [] }) });
      await makeAdapter().listTasks();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(bodies()[0].method).toBe('session-get');
      expect(bodies()[1].method).toBe('torrent-get');
    });
  });
});
