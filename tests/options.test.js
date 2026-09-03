/**
 * @jest-environment jsdom
 */

/**
 * Options Page Unit Tests
 *
 * These tests load the REAL `src/options.html` markup into jsdom and then the
 * REAL `src/options.js`, so that any drift between the DOM ids the script
 * reaches for and the ids the page actually ships is caught here (this is how
 * the missing `#portHint` element was found).
 */

const fs = require('fs');
const path = require('path');

// jsdom ships neither TextEncoder/TextDecoder nor crypto.subtle, both of which
// src/crypto.js needs. Node provides them; expose them before requiring it.
const { TextEncoder, TextDecoder } = require('util');
const { webcrypto } = require('crypto');
if (typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder;
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = TextDecoder;
if (!global.crypto?.subtle) {
  Object.defineProperty(global, 'crypto', { value: webcrypto, configurable: true });
}

const { installChromeStub } = require('./helpers/chromeStub');
const { encryptCredentials } = require('../src/crypto');

const OPTIONS_HTML = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'options.html'),
  'utf8'
);

const BODY_HTML = (() => {
  const match = OPTIONS_HTML.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  // Strip <script> tags: options.js is required directly instead.
  return match[1].replace(/<script[\s\S]*?<\/script>/gi, '');
})();

let chromeStub;
let options;
let sentMessages;
let messageResponder;

/** Reset the DOM and re-require options.js against a clean module registry. */
function loadOptionsPage({ respond } = {}) {
  document.body.innerHTML = BODY_HTML;

  sentMessages = [];
  messageResponder = respond || (() => ({ ok: true }));

  chromeStub = installChromeStub();
  chromeStub.runtime.sendMessage = (msg, cb) => {
    sentMessages.push(msg);
    const reply = messageResponder(msg);
    if (reply instanceof Error) {
      chromeStub.runtime.lastError = { message: reply.message };
      if (cb) cb(undefined);
      chromeStub.runtime.lastError = null;
      return;
    }
    if (cb) cb(reply);
  };

  // options.html loads crypto.js as a sibling global script.
  global.encryptCredentials = require('../src/crypto').encryptCredentials;
  global.decryptCredentials = require('../src/crypto').decryptCredentials;

  global.confirm = jest.fn(() => true);
  global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
  global.URL.revokeObjectURL = jest.fn();

  jest.resetModules();
  options = require('../src/options.js');
  return options;
}

/** The message objects of a given type that were sent to the background. */
const messagesOfType = (type) => sentMessages.filter((m) => m.type === type);
const lastMessageOfType = (type) => messagesOfType(type).slice(-1)[0];

const $ = (id) => document.getElementById(id);
/** Let queued promise callbacks settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

// jsdom implements no layout, so scrollIntoView is absent.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

beforeEach(() => {
  jest.useRealTimers();
  loadOptionsPage();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── esc() ───────────────────────────────────────────────────────────────────

describe('esc()', () => {
  test('escapes every HTML-significant character', () => {
    expect(options.esc('<script>alert("x")</script>'))
      .toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });

  test('escapes ampersands first so entities are not double-broken', () => {
    expect(options.esc('&lt;')).toBe('&amp;lt;');
  });

  test('escapes single quotes', () => {
    expect(options.esc("it's")).toBe('it&#39;s');
  });

  test('leaves safe text untouched', () => {
    expect(options.esc('My NAS 2 - Living Room')).toBe('My NAS 2 - Living Room');
  });

  test('coerces non-string input', () => {
    expect(options.esc(5000)).toBe('5000');
    expect(options.esc(null)).toBe('null');
    expect(options.esc(undefined)).toBe('undefined');
  });

  test('handles an empty string', () => {
    expect(options.esc('')).toBe('');
  });
});

// ── SERVICE_DEFAULTS ────────────────────────────────────────────────────────

describe('SERVICE_DEFAULTS', () => {
  test('covers all five supported service types', () => {
    expect(Object.keys(options.SERVICE_DEFAULTS).sort())
      .toEqual(['deluge', 'jdownloader', 'qbittorrent', 'synology', 'transmission']);
  });

  test.each([
    ['synology', 5000, 5001],
    ['qbittorrent', 8080, 8080],
    ['transmission', 9091, 9091],
    ['deluge', 8112, 8112],
    ['jdownloader', 3128, 3128]
  ])('%s defaults to port %i (https %i)', (type, port, httpsPort) => {
    expect(options.SERVICE_DEFAULTS[type].port).toBe(port);
    expect(options.SERVICE_DEFAULTS[type].httpsPort).toBe(httpsPort);
  });

  test('every entry supplies name, username and portHint', () => {
    Object.entries(options.SERVICE_DEFAULTS).forEach(([type, d]) => {
      expect(typeof d.name).toBe('string');
      expect(d.name.length).toBeGreaterThan(0);
      expect(typeof d.username).toBe('string');
      expect(typeof d.portHint).toBe('string');
      expect(d.portHint.length).toBeGreaterThan(0);
    });
  });

  test('transmission and jdownloader default to no username', () => {
    expect(options.SERVICE_DEFAULTS.transmission.username).toBe('');
    expect(options.SERVICE_DEFAULTS.jdownloader.username).toBe('');
  });

  test('jdownloader is named "JDownloader 2"', () => {
    expect(options.SERVICE_DEFAULTS.jdownloader.name).toBe('JDownloader 2');
  });
});

// ── getServiceWebUrl() ──────────────────────────────────────────────────────

describe('getServiceWebUrl()', () => {
  const svc = (over) => ({ type: 'qbittorrent', host: 'h', port: 1, ...over });

  test('returns null when the service is missing or has no host', () => {
    expect(options.getServiceWebUrl(null)).toBeNull();
    expect(options.getServiceWebUrl(undefined)).toBeNull();
    expect(options.getServiceWebUrl({ type: 'qbittorrent' })).toBeNull();
    expect(options.getServiceWebUrl(svc({ host: '' }))).toBeNull();
  });

  test('returns null for JDownloader, which has no browser UI', () => {
    expect(options.getServiceWebUrl(svc({ type: 'jdownloader', host: '127.0.0.1', port: 3128 })))
      .toBeNull();
  });

  test('builds the Transmission web path', () => {
    expect(options.getServiceWebUrl(svc({ type: 'transmission', host: 'nas', port: 9091 })))
      .toBe('http://nas:9091/transmission/web/');
  });

  test('builds a bare Synology URL with no trailing slash', () => {
    expect(options.getServiceWebUrl(svc({ type: 'synology', host: 'nas', port: 5000 })))
      .toBe('http://nas:5000');
  });

  test('builds a trailing-slash URL for qBittorrent and Deluge', () => {
    expect(options.getServiceWebUrl(svc({ type: 'qbittorrent', host: 'h', port: 8080 })))
      .toBe('http://h:8080/');
    expect(options.getServiceWebUrl(svc({ type: 'deluge', host: 'h', port: 8112 })))
      .toBe('http://h:8112/');
  });

  test('uses the https scheme when the flag is set', () => {
    expect(options.getServiceWebUrl(svc({ type: 'synology', host: 'nas', port: 5001, https: true })))
      .toBe('https://nas:5001');
    expect(options.getServiceWebUrl(svc({ type: 'transmission', host: 'n', port: 9091, https: true })))
      .toBe('https://n:9091/transmission/web/');
  });

  test('falls back to the generic form for an unknown type', () => {
    expect(options.getServiceWebUrl(svc({ type: 'mystery', host: 'h', port: 1234 })))
      .toBe('http://h:1234/');
  });
});

// ── applyServiceTypeDefaults() ──────────────────────────────────────────────

describe('applyServiceTypeDefaults()', () => {
  test('the #portHint element the function writes to exists in options.html', () => {
    // Regression guard: this element was dropped from the markup while the
    // script still dereferenced it, making the whole function throw.
    expect($('portHint')).not.toBeNull();
  });

  test('does not throw for any supported service type', () => {
    Object.keys(options.SERVICE_DEFAULTS).forEach((type) => {
      expect(() => options.applyServiceTypeDefaults(type)).not.toThrow();
    });
  });

  test('populates port, name, username and the port hint', () => {
    options.applyServiceTypeDefaults('qbittorrent');

    expect($('servicePort').value).toBe('8080');
    expect($('serviceName').value).toBe('qBittorrent');
    expect($('serviceUsername').value).toBe('admin');
    expect($('portHint').textContent).toBe('8080 (default Web UI)');
  });

  test('uses the https port when the https checkbox is ticked', () => {
    $('serviceHttps').checked = true;
    options.applyServiceTypeDefaults('synology');
    expect($('servicePort').value).toBe('5001');
  });

  test('uses the plain port when https is unticked', () => {
    $('serviceHttps').checked = false;
    options.applyServiceTypeDefaults('synology');
    expect($('servicePort').value).toBe('5000');
  });

  test('falls back to the synology defaults for an unknown type', () => {
    options.applyServiceTypeDefaults('nope');
    expect($('servicePort').value).toBe('5000');
    expect($('serviceName').value).toBe('Synology NAS');
  });

  test('rewrites an empty host to loopback for JDownloader', () => {
    $('serviceHost').value = '';
    options.applyServiceTypeDefaults('jdownloader');
    expect($('serviceHost').value).toBe('127.0.0.1');
  });

  test('rewrites the placeholder LAN host to loopback for JDownloader', () => {
    $('serviceHost').value = '192.168.0.1';
    options.applyServiceTypeDefaults('jdownloader');
    expect($('serviceHost').value).toBe('127.0.0.1');
  });

  test('preserves a deliberately-entered host for JDownloader', () => {
    $('serviceHost').value = 'jd.lan';
    options.applyServiceTypeDefaults('jdownloader');
    expect($('serviceHost').value).toBe('jd.lan');
  });

  test('does not touch the host for non-JDownloader types', () => {
    $('serviceHost').value = '';
    options.applyServiceTypeDefaults('synology');
    expect($('serviceHost').value).toBe('');
  });

  test('sets the JDownloader port hint mentioning both ports', () => {
    options.applyServiceTypeDefaults('jdownloader');
    expect($('portHint').textContent).toContain('3128');
    expect($('portHint').textContent).toContain('9666');
  });
});

// ── updateWhitelistModeVisibility() ─────────────────────────────────────────

describe('updateWhitelistModeVisibility()', () => {
  test('hides the domain textarea in "all" mode', () => {
    $('whitelistMode').value = 'all';
    options.updateWhitelistModeVisibility();
    expect($('whitelistDomainsGroup').classList.contains('d-none')).toBe(true);
  });

  test('shows the textarea and a whitelist label in restricted mode', () => {
    $('whitelistMode').value = 'restricted';
    options.updateWhitelistModeVisibility();

    expect($('whitelistDomainsGroup').classList.contains('d-none')).toBe(false);
    expect($('whitelistDomainsLabel').textContent).toBe('Whitelisted Domains (One per line)');
  });

  test('toggling back to "all" re-hides the textarea', () => {
    $('whitelistMode').value = 'restricted';
    options.updateWhitelistModeVisibility();
    $('whitelistMode').value = 'all';
    options.updateWhitelistModeVisibility();
    expect($('whitelistDomainsGroup').classList.contains('d-none')).toBe(true);
  });
});

// ── Service editor ──────────────────────────────────────────────────────────

describe('openServiceEditor() / closeServiceEditor()', () => {
  const SERVICES = [{
    id: 'svc-1',
    type: 'deluge',
    name: 'Living Room Deluge',
    host: 'deluge.lan',
    port: 8112,
    https: true,
    username: 'admin',
    password: 'secret',
    defaultPath: '/downloads'
  }];

  test('reveals the editor card', () => {
    options.openServiceEditor();
    expect($('serviceEditorCard').classList.contains('d-none')).toBe(false);
  });

  test('add mode applies the synology defaults and clears the id', () => {
    options.openServiceEditor();

    expect($('editorTitle').textContent).toBe('Add New Download Service');
    expect($('serviceId').value).toBe('');
    expect($('serviceType').value).toBe('synology');
    expect($('servicePort').value).toBe('5000');
  });

  test('edit mode populates every field from the stored service', () => {
    options.__setServices(SERVICES);
    options.openServiceEditor('svc-1');

    expect($('editorTitle').textContent).toBe('Edit Service: Living Room Deluge');
    expect($('serviceId').value).toBe('svc-1');
    expect($('serviceType').value).toBe('deluge');
    expect($('serviceName').value).toBe('Living Room Deluge');
    expect($('serviceHost').value).toBe('deluge.lan');
    expect($('servicePort').value).toBe('8112');
    expect($('serviceHttps').checked).toBe(true);
    expect($('serviceUsername').value).toBe('admin');
    expect($('servicePassword').value).toBe('secret');
    expect($('serviceDefaultPath').value).toBe('/downloads');
  });

  test('edit mode does not overwrite the stored port with a type default', () => {
    options.__setServices([{ ...SERVICES[0], port: 12345 }]);
    options.openServiceEditor('svc-1');
    expect($('servicePort').value).toBe('12345');
  });

  test('editing an unknown id leaves the form alone', () => {
    options.__setServices(SERVICES);
    options.openServiceEditor('does-not-exist');
    expect($('serviceId').value).toBe('');
  });

  test('records the id being edited and clears it on close', () => {
    options.__setServices(SERVICES);
    options.openServiceEditor('svc-1');
    expect(options.__getState().editingServiceId).toBe('svc-1');

    options.closeServiceEditor();
    expect(options.__getState().editingServiceId).toBeNull();
    expect($('serviceEditorCard').classList.contains('d-none')).toBe(true);
  });

  test('missing optional fields become empty strings, not "undefined"', () => {
    options.__setServices([{ id: 's', type: 'synology', name: 'N', host: 'h', port: 1 }]);
    options.openServiceEditor('s');

    expect($('serviceUsername').value).toBe('');
    expect($('servicePassword').value).toBe('');
    expect($('serviceDefaultPath').value).toBe('');
  });
});

// ── renderServiceList() ─────────────────────────────────────────────────────

describe('renderServiceList()', () => {
  test('renders an empty state with a working add button', () => {
    options.__setServices([]);
    options.renderServiceList();

    expect($('serviceListContainer').querySelector('.empty-state')).not.toBeNull();
    expect($('emptyAddBtn')).not.toBeNull();

    $('emptyAddBtn').click();
    expect($('serviceEditorCard').classList.contains('d-none')).toBe(false);
  });

  test('renders one card per configured service', () => {
    options.__setServices([
      { id: 'a', type: 'synology', name: 'A', host: 'a.lan', port: 5000 },
      { id: 'b', type: 'deluge', name: 'B', host: 'b.lan', port: 8112 }
    ]);
    options.renderServiceList();

    expect($('serviceListContainer').querySelectorAll('.device-card')).toHaveLength(2);
  });

  test('shows a Web UI launch link for services that have one', () => {
    options.__setServices([{ id: 'a', type: 'deluge', name: 'A', host: 'a.lan', port: 8112 }]);
    options.renderServiceList();

    const link = $('serviceListContainer').querySelector('.btn-web-launch');
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('http://a.lan:8112/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  test('marks JDownloader as a desktop app with no Web UI link', () => {
    options.__setServices([
      { id: 'jd', type: 'jdownloader', name: 'JD', host: '127.0.0.1', port: 3128 }
    ]);
    options.renderServiceList();

    const container = $('serviceListContainer');
    expect(container.querySelector('.btn-web-launch')).toBeNull();
    expect(container.querySelector('.device-badge-desktop')).not.toBeNull();
    expect(container.textContent).toContain('(Desktop App)');
  });

  test('escapes a service name containing HTML', () => {
    options.__setServices([
      { id: 'x', type: 'synology', name: '<img src=x onerror=alert(1)>', host: 'h', port: 1 }
    ]);
    options.renderServiceList();

    const container = $('serviceListContainer');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  test('escapes a malicious host so no attribute break-out occurs', () => {
    options.__setServices([
      { id: 'x', type: 'deluge', name: 'N', host: '"><img src=x>', port: 1 }
    ]);
    options.renderServiceList();
    expect($('serviceListContainer').querySelector('img')).toBeNull();
  });

  test('falls back to placeholder text for a nameless service', () => {
    options.__setServices([{ id: 'x', type: 'synology', host: 'h', port: 1 }]);
    options.renderServiceList();
    expect($('serviceListContainer').textContent).toContain('Download Service');
  });

  test('clears previously-rendered cards on re-render', () => {
    options.__setServices([{ id: 'a', type: 'synology', name: 'A', host: 'h', port: 1 }]);
    options.renderServiceList();
    options.__setServices([]);
    options.renderServiceList();

    expect($('serviceListContainer').querySelectorAll('.device-card')).toHaveLength(0);
  });

  test('the edit button on a card opens that service in the editor', () => {
    options.__setServices([
      { id: 'a', type: 'deluge', name: 'Alpha', host: 'a.lan', port: 8112 }
    ]);
    options.renderServiceList();

    $('serviceListContainer').querySelector('.edit-btn').click();
    expect($('editorTitle').textContent).toBe('Edit Service: Alpha');
  });
});

// ── saveServiceForm() ───────────────────────────────────────────────────────

describe('saveServiceForm()', () => {
  const submit = () => {
    const e = { preventDefault: jest.fn() };
    return { promise: options.saveServiceForm(e), e };
  };

  function fillForm({ https, ...values } = {}) {
    const v = {
      serviceId: '',
      serviceType: 'qbittorrent',
      serviceName: 'My qBit',
      serviceHost: 'qbit.lan',
      servicePort: '8080',
      serviceUsername: 'admin',
      servicePassword: 'pw',
      serviceDefaultPath: '/dl',
      ...values
    };
    Object.entries(v).forEach(([id, val]) => { $(id).value = val; });
    $('serviceHttps').checked = !!https;
  }

  test('prevents the native form submission', async () => {
    fillForm();
    const { promise, e } = submit();
    await promise;
    expect(e.preventDefault).toHaveBeenCalled();
  });

  test('sends SAVE_NAS_LIST with the new service appended', async () => {
    options.__setServices([]);
    fillForm();
    await submit().promise;

    const msg = lastMessageOfType('SAVE_NAS_LIST');
    expect(msg.list).toHaveLength(1);
    expect(msg.list[0]).toMatchObject({
      type: 'qbittorrent',
      name: 'My qBit',
      host: 'qbit.lan',
      port: 8080,
      https: false,
      username: 'admin',
      password: 'pw',
      defaultPath: '/dl'
    });
  });

  test('generates an id when none is present', async () => {
    options.__setServices([]);
    fillForm({ serviceId: '' });
    await submit().promise;

    expect(lastMessageOfType('SAVE_NAS_LIST').list[0].id).toMatch(/^nas-\d+$/);
  });

  test('parses the port to a number', async () => {
    options.__setServices([]);
    fillForm({ servicePort: '9091' });
    await submit().promise;
    expect(lastMessageOfType('SAVE_NAS_LIST').list[0].port).toBe(9091);
  });

  test('falls back to port 5000 when the port is unparseable', async () => {
    options.__setServices([]);
    fillForm({ servicePort: '' });
    await submit().promise;
    expect(lastMessageOfType('SAVE_NAS_LIST').list[0].port).toBe(5000);
  });

  test('trims whitespace from text fields', async () => {
    options.__setServices([]);
    fillForm({ serviceName: '  Spaced  ', serviceHost: '  h.lan  ', serviceUsername: '  u  ' });
    await submit().promise;

    expect(lastMessageOfType('SAVE_NAS_LIST').list[0]).toMatchObject({
      name: 'Spaced', host: 'h.lan', username: 'u'
    });
  });

  test('does not trim the password, which may contain edge whitespace', async () => {
    options.__setServices([]);
    fillForm({ servicePassword: ' pw ' });
    await submit().promise;
    expect(lastMessageOfType('SAVE_NAS_LIST').list[0].password).toBe(' pw ');
  });

  test('defaults a blank name to "Download Service"', async () => {
    options.__setServices([]);
    fillForm({ serviceName: '   ' });
    await submit().promise;
    expect(lastMessageOfType('SAVE_NAS_LIST').list[0].name).toBe('Download Service');
  });

  test('updates an existing service in place rather than appending', async () => {
    options.__setServices([
      { id: 'keep', type: 'synology', name: 'Keep', host: 'k', port: 5000 },
      { id: 'svc-1', type: 'synology', name: 'Old', host: 'o', port: 5000 }
    ]);
    fillForm({ serviceId: 'svc-1', serviceName: 'New Name' });
    await submit().promise;

    const list = lastMessageOfType('SAVE_NAS_LIST').list;
    expect(list).toHaveLength(2);
    expect(list.find((s) => s.id === 'svc-1').name).toBe('New Name');
    expect(list.find((s) => s.id === 'keep').name).toBe('Keep');
  });

  test('preserves the order of existing services on update', async () => {
    options.__setServices([
      { id: 'a', type: 'synology', name: 'A', host: 'h', port: 1 },
      { id: 'b', type: 'synology', name: 'B', host: 'h', port: 1 },
      { id: 'c', type: 'synology', name: 'C', host: 'h', port: 1 }
    ]);
    fillForm({ serviceId: 'b', serviceName: 'B2' });
    await submit().promise;

    expect(lastMessageOfType('SAVE_NAS_LIST').list.map((s) => s.id))
      .toEqual(['a', 'b', 'c']);
  });

  test('persists the https flag', async () => {
    options.__setServices([]);
    fillForm({ https: true });
    await submit().promise;
    expect(lastMessageOfType('SAVE_NAS_LIST').list[0].https).toBe(true);
  });

  test('closes the editor and shows a success toast', async () => {
    options.__setServices([]);
    // Open first: openServiceEditor() calls form.reset(), which would clear
    // anything filled in beforehand.
    options.openServiceEditor();
    fillForm({ serviceName: 'Saved One' });
    await submit().promise;

    expect($('serviceEditorCard').classList.contains('d-none')).toBe(true);
    expect($('toast').textContent).toContain('Saved One');
    expect($('toast').className).toContain('show');
  });

  test('reports an error toast and keeps state when the save fails', async () => {
    loadOptionsPage({ respond: () => new Error('storage quota exceeded') });
    options.__setServices([]);
    fillForm();
    await submit().promise;

    expect($('toast').textContent).toContain('storage quota exceeded');
    expect($('toast').className).toContain('error');
    expect(options.__getState().currentServices).toEqual([]);
  });
});

// ── deleteService() ─────────────────────────────────────────────────────────

describe('deleteService()', () => {
  const SERVICES = [
    { id: 'a', type: 'synology', name: 'Alpha', host: 'h', port: 1 },
    { id: 'b', type: 'deluge', name: 'Beta', host: 'h', port: 2 }
  ];

  test('asks for confirmation naming the service', async () => {
    options.__setServices(SERVICES);
    await options.deleteService('a');
    expect(global.confirm).toHaveBeenCalledWith(expect.stringContaining('Alpha'));
  });

  test('removes only the targeted service', async () => {
    options.__setServices(SERVICES);
    await options.deleteService('a');

    expect(lastMessageOfType('SAVE_NAS_LIST').list.map((s) => s.id)).toEqual(['b']);
    expect(options.__getState().currentServices.map((s) => s.id)).toEqual(['b']);
  });

  test('does nothing when the confirmation is declined', async () => {
    options.__setServices(SERVICES);
    global.confirm = jest.fn(() => false);

    await options.deleteService('a');

    expect(messagesOfType('SAVE_NAS_LIST')).toHaveLength(0);
    expect(options.__getState().currentServices).toHaveLength(2);
  });

  test('shows a confirmation toast after deleting', async () => {
    options.__setServices(SERVICES);
    await options.deleteService('b');
    expect($('toast').textContent).toContain('Beta');
  });

  test('re-renders the list so the card disappears', async () => {
    options.__setServices(SERVICES);
    options.renderServiceList();
    await options.deleteService('a');

    expect($('serviceListContainer').querySelectorAll('.device-card')).toHaveLength(1);
  });

  test('reports an error toast when the save fails', async () => {
    loadOptionsPage({ respond: () => new Error('write failed') });
    options.__setServices(SERVICES);
    await options.deleteService('a');

    expect($('toast').textContent).toContain('write failed');
    expect($('toast').className).toContain('error');
  });

  test('uses generic wording for an unknown id', async () => {
    options.__setServices(SERVICES);
    await options.deleteService('missing');
    expect(global.confirm).toHaveBeenCalledWith(expect.stringContaining('this service'));
  });
});

// ── Connection testing ──────────────────────────────────────────────────────

describe('testSpecificService()', () => {
  const SERVICES = [{ id: 'a', type: 'deluge', name: 'Alpha', host: 'h', port: 8112 }];

  test('sends TEST_CONNECTION with the stored settings', async () => {
    loadOptionsPage({ respond: () => ({ ok: true, version: '2.1.1' }) });
    options.__setServices(SERVICES);
    await options.testSpecificService('a');

    const msg = lastMessageOfType('TEST_CONNECTION');
    expect(msg.nasId).toBe('a');
    expect(msg.settings).toMatchObject({ host: 'h', port: 8112 });
  });

  test('reports the version on success', async () => {
    loadOptionsPage({ respond: () => ({ ok: true, version: '2.1.1' }) });
    options.__setServices(SERVICES);
    await options.testSpecificService('a');

    expect($('toast').textContent).toContain('2.1.1');
    expect($('toast').className).not.toContain('error');
  });

  test('reports the failure reason on an unsuccessful response', async () => {
    loadOptionsPage({ respond: () => ({ ok: false, error: 'auth rejected' }) });
    options.__setServices(SERVICES);
    await options.testSpecificService('a');

    expect($('toast').textContent).toContain('auth rejected');
    expect($('toast').className).toContain('error');
  });

  test('reports a transport error', async () => {
    loadOptionsPage({ respond: () => new Error('port closed') });
    options.__setServices(SERVICES);
    await options.testSpecificService('a');

    expect($('toast').textContent).toContain('port closed');
    expect($('toast').className).toContain('error');
  });

  test('does nothing for an unknown service id', async () => {
    options.__setServices(SERVICES);
    await options.testSpecificService('nope');
    expect(messagesOfType('TEST_CONNECTION')).toHaveLength(0);
  });
});

describe('testFormConnection()', () => {
  function fillForm({ https, ...values } = {}) {
    const v = {
      serviceType: 'transmission',
      serviceName: 'T',
      serviceHost: 't.lan',
      servicePort: '9091',
      serviceUsername: '',
      servicePassword: '',
      ...values
    };
    Object.entries(v).forEach(([id, val]) => { $(id).value = val; });
    $('serviceHttps').checked = !!https;
  }

  test('sends the unsaved form values as settings', async () => {
    loadOptionsPage({ respond: () => ({ ok: true, version: '4.0' }) });
    fillForm();
    await options.testFormConnection();

    expect(lastMessageOfType('TEST_CONNECTION').settings).toMatchObject({
      type: 'transmission', host: 't.lan', port: 9091
    });
  });

  test('refuses to test with an empty host', async () => {
    fillForm({ serviceHost: '   ' });
    await options.testFormConnection();

    expect(messagesOfType('TEST_CONNECTION')).toHaveLength(0);
    expect($('toast').textContent).toContain('host and port');
    expect($('toast').className).toContain('error');
  });

  test('reports success with the version', async () => {
    loadOptionsPage({ respond: () => ({ ok: true, version: '4.0' }) });
    fillForm();
    await options.testFormConnection();
    expect($('toast').textContent).toContain('4.0');
  });

  test('reports the error from a failed response', async () => {
    loadOptionsPage({ respond: () => ({ ok: false, error: 'refused' }) });
    fillForm();
    await options.testFormConnection();
    expect($('toast').textContent).toContain('refused');
  });

  test('does not include the persisted service id', async () => {
    loadOptionsPage({ respond: () => ({ ok: true }) });
    fillForm();
    await options.testFormConnection();
    expect(lastMessageOfType('TEST_CONNECTION').nasId).toBeUndefined();
  });
});

// ── Capture settings ────────────────────────────────────────────────────────

describe('capture settings', () => {
  test('loads defaults with magnet and torrent enabled', async () => {
    await options.loadCaptureSettings();
    await flush();

    expect($('captureMagnet').checked).toBe(true);
    expect($('captureTorrent').checked).toBe(true);
    expect($('captureOther').checked).toBe(false);
  });

  test('hides the file-types section when "other" is off', async () => {
    await options.loadCaptureSettings();
    await flush();
    expect($('fileTypesSection').classList.contains('d-none')).toBe(true);
  });

  test('shows the file-types section when "other" is stored as on', async () => {
    chromeStub.storage.local._store.enabledProtocols =
      { magnet: true, torrent: true, otherFileTypes: true };

    await options.loadCaptureSettings();
    await flush();

    expect($('captureOther').checked).toBe(true);
    expect($('fileTypesSection').classList.contains('d-none')).toBe(false);
  });

  test('populates the extension textarea with the defaults', async () => {
    await options.loadCaptureSettings();
    await flush();
    expect($('customExtensions').value).toBe(options.DEFAULT_FILE_EXTENSIONS);
  });

  test('restores a stored extension list', async () => {
    chromeStub.storage.sync._store.downloadExtensions = 'zip\niso';
    await options.loadCaptureSettings();
    await flush();
    expect($('customExtensions').value).toBe('zip\niso');
  });

  test('toggling the "other" checkbox reveals the section', async () => {
    await options.loadCaptureSettings();
    await flush();

    $('captureOther').checked = true;
    $('captureOther').dispatchEvent(new Event('change'));

    expect($('fileTypesSection').classList.contains('d-none')).toBe(false);
  });

  test('saves the three protocol toggles to local storage', async () => {
    $('captureMagnet').checked = true;
    $('captureTorrent').checked = false;
    $('captureOther').checked = true;
    $('customExtensions').value = 'zip';

    await options.saveCaptureSettings();

    expect(chromeStub.storage.local._store.enabledProtocols)
      .toEqual({ magnet: true, torrent: false, otherFileTypes: true });
  });

  test('normalises the extension list, stripping dots and blank lines', async () => {
    $('customExtensions').value = '.zip\n  RAR  \n\n.7z\n   \niso';
    await options.saveCaptureSettings();

    expect(chromeStub.storage.sync._store.downloadExtensions)
      .toBe('zip\nRAR\n7z\niso');
  });

  test('strips only a single leading dot', async () => {
    $('customExtensions').value = '..tar';
    await options.saveCaptureSettings();
    expect(chromeStub.storage.sync._store.downloadExtensions).toBe('.tar');
  });

  test('an all-blank list saves as empty', async () => {
    $('customExtensions').value = '\n  \n\n';
    await options.saveCaptureSettings();
    expect(chromeStub.storage.sync._store.downloadExtensions).toBe('');
  });

  test('shows a success toast', async () => {
    $('customExtensions').value = 'zip';
    await options.saveCaptureSettings();
    expect($('toast').textContent).toContain('saved');
  });

  test('the default extension list contains common archive types', () => {
    const list = options.DEFAULT_FILE_EXTENSIONS.split('\n');
    expect(list).toContain('zip');
    expect(list).toContain('iso');
    expect(list).toContain('mkv');
    expect(list.every((e) => !e.startsWith('.'))).toBe(true);
  });
});

// ── Whitelist settings ──────────────────────────────────────────────────────

describe('whitelist settings', () => {
  test('loads the mode and domain list from the background', async () => {
    loadOptionsPage({
      respond: (m) => {
        if (m.type === 'GET_WHITELIST_MODE') return { mode: 'restricted' };
        if (m.type === 'GET_WHITELIST') return { list: ['a.com', 'b.org'] };
        return { ok: true };
      }
    });

    await options.loadWhitelistSettings();

    expect($('whitelistMode').value).toBe('restricted');
    expect($('whitelistDomains').value).toBe('a.com\nb.org');
    expect($('whitelistDomainsGroup').classList.contains('d-none')).toBe(false);
  });

  test('defaults to "all" mode and hides the textarea', async () => {
    loadOptionsPage({ respond: () => ({}) });
    await options.loadWhitelistSettings();

    expect($('whitelistMode').value).toBe('all');
    expect($('whitelistDomainsGroup').classList.contains('d-none')).toBe(true);
  });

  test('renders an empty list as an empty textarea', async () => {
    loadOptionsPage({
      respond: (m) => (m.type === 'GET_WHITELIST' ? { list: [] } : { mode: 'all' })
    });
    await options.loadWhitelistSettings();
    expect($('whitelistDomains').value).toBe('');
  });

  test('saves the mode and the normalised domain list', async () => {
    $('whitelistMode').value = 'restricted';
    $('whitelistDomains').value = '  Example.COM  \n\nbad.org\n   \nMiXeD.Net';

    await options.saveWhitelistSettings();

    expect(lastMessageOfType('SET_WHITELIST_MODE').mode).toBe('restricted');
    expect(lastMessageOfType('SET_WHITELIST').list)
      .toEqual(['example.com', 'bad.org', 'mixed.net']);
  });

  test('saves an empty list when the textarea is blank', async () => {
    $('whitelistDomains').value = '   \n\n';
    await options.saveWhitelistSettings();
    expect(lastMessageOfType('SET_WHITELIST').list).toEqual([]);
  });

  test('shows a success toast', async () => {
    $('whitelistDomains').value = 'a.com';
    await options.saveWhitelistSettings();
    expect($('toast').textContent).toContain('saved');
  });

  test('reports a failure toast', async () => {
    loadOptionsPage({ respond: () => new Error('sync off') });
    $('whitelistDomains').value = 'a.com';
    await options.saveWhitelistSettings();

    expect($('toast').textContent).toContain('sync off');
    expect($('toast').className).toContain('error');
  });
});

// ── Backup export ───────────────────────────────────────────────────────────

describe('exportConfig()', () => {
  const SERVICES = [
    { id: 'a', type: 'synology', name: 'A', host: 'h', port: 5000, password: 'p1', apiToken: '' },
    { id: 'b', type: 'qbittorrent', name: 'B', host: 'h', port: 8080, password: '', apiToken: 't2' }
  ];

  /** Capture the JSON handed to the Blob constructor. */
  function captureBackup() {
    const captured = {};
    const RealBlob = global.Blob;
    jest.spyOn(global, 'Blob').mockImplementation((parts, opts) => {
      captured.json = JSON.parse(parts[0]);
      captured.type = opts?.type;
      return new RealBlob(parts, opts);
    });
    return captured;
  }

  function loadWithServices(services = SERVICES) {
    loadOptionsPage({
      respond: (m) => {
        if (m.type === 'GET_NAS_LIST') return { list: services };
        if (m.type === 'GET_WHITELIST') return { list: ['x.com'] };
        if (m.type === 'GET_WHITELIST_MODE') return { mode: 'restricted' };
        return { ok: true };
      }
    });
  }

  test('exports services, whitelist and mode', async () => {
    loadWithServices();
    const cap = captureBackup();
    await options.exportConfig();

    expect(cap.json.services).toHaveLength(2);
    expect(cap.json.whitelist).toEqual(['x.com']);
    expect(cap.json.whitelistMode).toBe('restricted');
    expect(cap.json.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(cap.type).toBe('application/json');
  });

  test('blanks passwords and tokens when credentials are not included', async () => {
    loadWithServices();
    const cap = captureBackup();
    await options.exportConfig();

    cap.json.services.forEach((s) => {
      expect(s.password).toBe('');
      expect(s.apiToken).toBe('');
    });
    expect(cap.json.encryptedCredentials).toBeUndefined();
    expect(JSON.stringify(cap.json)).not.toContain('p1');
    expect(JSON.stringify(cap.json)).not.toContain('t2');
  });

  test('triggers a download with a dated filename', async () => {
    loadWithServices();
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    captureBackup();

    await options.exportConfig();

    expect(clickSpy).toHaveBeenCalled();
    expect(global.URL.createObjectURL).toHaveBeenCalled();
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  test('refuses to export when credentials are requested with no password', async () => {
    loadWithServices();
    $('backupIncludeCreds').checked = true;
    $('backupPasswordInput').value = '   ';
    const cap = captureBackup();

    await options.exportConfig();

    expect(cap.json).toBeUndefined();
    expect($('toast').textContent).toContain('encryption password');
    expect($('toast').className).toContain('error');
  });

  test('attaches an encrypted credentials envelope when requested', async () => {
    loadWithServices();
    $('backupIncludeCreds').checked = true;
    $('backupPasswordInput').value = 'backup-pass';
    const cap = captureBackup();

    await options.exportConfig();

    const env = cap.json.encryptedCredentials;
    expect(env).toBeDefined();
    expect(env.algorithm).toBe('AES-GCM-256');
    expect(env.kdf).toBe('PBKDF2-SHA256');

    // The readable part of the file must carry no plaintext secrets. (The
    // base64 ciphertext is excluded: short secrets can appear in it by pure
    // coincidence, so asserting over it would be flaky.)
    const { encryptedCredentials, ...readable } = cap.json;
    expect(JSON.stringify(readable)).not.toContain('p1');
    expect(JSON.stringify(readable)).not.toContain('t2');
    readable.services.forEach((s) => {
      expect(s.password).toBe('');
      expect(s.apiToken).toBe('');
    });
  });

  test('the encrypted envelope decrypts back to the real credentials', async () => {
    loadWithServices();
    $('backupIncludeCreds').checked = true;
    $('backupPasswordInput').value = 'backup-pass';
    const cap = captureBackup();

    await options.exportConfig();
    const creds = await require('../src/crypto')
      .decryptCredentials(cap.json.encryptedCredentials, 'backup-pass');

    expect(creds.a).toEqual({ password: 'p1', apiToken: '' });
    expect(creds.b).toEqual({ password: '', apiToken: 't2' });
  });

  test('trims the encryption password before use', async () => {
    loadWithServices();
    $('backupIncludeCreds').checked = true;
    $('backupPasswordInput').value = '  padded  ';
    const cap = captureBackup();

    await options.exportConfig();
    await expect(require('../src/crypto')
      .decryptCredentials(cap.json.encryptedCredentials, 'padded')).resolves.toBeDefined();
  });

  test('shows an error toast when the export fails', async () => {
    loadOptionsPage({ respond: () => new Error('background asleep') });
    await options.exportConfig();

    expect($('toast').textContent).toContain('background asleep');
    expect($('toast').className).toContain('error');
  });

  test('exports an empty service list without error', async () => {
    loadWithServices([]);
    const cap = captureBackup();
    await options.exportConfig();
    expect(cap.json.services).toEqual([]);
  });
});

// ── Restore ─────────────────────────────────────────────────────────────────

describe('handleFileImport()', () => {
  /** Build a fake file-input change event. */
  const fileEvent = (content, name = 'backup.json') => ({
    target: {
      files: [{ name, text: async () => content }],
      value: 'C:\\fakepath\\backup.json'
    }
  });

  test('opens the restore modal and summarises the file', async () => {
    const backup = { services: [{ id: 'a' }, { id: 'b' }], whitelist: ['x.com'] };
    await options.handleFileImport(fileEvent(JSON.stringify(backup)));

    expect($('restoreModal').classList.contains('d-none')).toBe(false);
    expect($('restoreSummaryText').textContent)
      .toBe('Found 2 services and 1 whitelist rule in "backup.json".');
  });

  test('pluralises the summary correctly for a single service', async () => {
    const backup = { services: [{ id: 'a' }], whitelist: ['x', 'y'] };
    await options.handleFileImport(fileEvent(JSON.stringify(backup)));
    expect($('restoreSummaryText').textContent)
      .toBe('Found 1 service and 2 whitelist rules in "backup.json".');
  });

  test('handles a backup with no whitelist key', async () => {
    await options.handleFileImport(fileEvent(JSON.stringify({ services: [] })));
    expect($('restoreSummaryText').textContent).toContain('0 whitelist rules');
  });

  test('shows the plain prompt for an unencrypted backup', async () => {
    await options.handleFileImport(fileEvent(JSON.stringify({ services: [] })));

    expect($('restorePlainPrompt').classList.contains('d-none')).toBe(false);
    expect($('restoreEncryptedPrompt').classList.contains('d-none')).toBe(true);
    expect($('restoreSettingsOnlyBtn').classList.contains('d-none')).toBe(true);
    expect($('confirmRestoreBtn').textContent).toBe('Restore All');
  });

  test('shows the unlock prompt for an encrypted backup', async () => {
    const backup = {
      services: [],
      encryptedCredentials: { ciphertext: 'c', salt: 's', iv: 'i' }
    };
    await options.handleFileImport(fileEvent(JSON.stringify(backup)));

    expect($('restoreEncryptedPrompt').classList.contains('d-none')).toBe(false);
    expect($('restorePlainPrompt').classList.contains('d-none')).toBe(true);
    expect($('restoreSettingsOnlyBtn').classList.contains('d-none')).toBe(false);
    expect($('confirmRestoreBtn').textContent).toBe('Unlock & Restore All');
  });

  test('stashes the parsed backup as pending', async () => {
    await options.handleFileImport(fileEvent(JSON.stringify({ services: [{ id: 'a' }] })));
    expect(options.__getState().pendingRestoreData.services).toHaveLength(1);
  });

  test('rejects a file with no services array', async () => {
    await options.handleFileImport(fileEvent(JSON.stringify({ nope: true })));

    expect($('toast').textContent).toContain('Invalid backup file format');
    expect($('toast').className).toContain('error');
    expect($('restoreModal').classList.contains('d-none')).toBe(true);
  });

  test('rejects a services value that is not an array', async () => {
    await options.handleFileImport(fileEvent(JSON.stringify({ services: 'nope' })));
    expect($('toast').textContent).toContain('Invalid backup file format');
  });

  test('rejects malformed JSON with an error toast', async () => {
    await options.handleFileImport(fileEvent('{not json'));

    expect($('toast').className).toContain('error');
    expect($('restoreModal').classList.contains('d-none')).toBe(true);
  });

  test('clears the file input so the same file can be re-picked', async () => {
    const e = fileEvent(JSON.stringify({ services: [] }));
    await options.handleFileImport(e);
    expect(e.target.value).toBe('');
  });

  test('clears the input even when parsing fails', async () => {
    const e = fileEvent('{bad');
    await options.handleFileImport(e);
    expect(e.target.value).toBe('');
  });

  test('does nothing when no file was selected', async () => {
    await options.handleFileImport({ target: { files: [] } });
    expect($('restoreModal').classList.contains('d-none')).toBe(true);
    expect(options.__getState().pendingRestoreData).toBeNull();
  });
});

describe('executeRestore()', () => {
  const SERVICES = [
    { id: 'a', type: 'synology', name: 'A', host: 'h', port: 5000, password: '', apiToken: '' },
    { id: 'b', type: 'qbittorrent', name: 'B', host: 'h', port: 8080, password: '', apiToken: '' }
  ];

  test('does nothing when there is no pending backup', async () => {
    await options.executeRestore(true);
    expect(messagesOfType('SAVE_NAS_LIST')).toHaveLength(0);
  });

  test('restores services, whitelist and mode from a plain backup', async () => {
    options.__setPendingRestore({
      services: SERVICES, whitelist: ['a.com'], whitelistMode: 'restricted'
    });

    await options.executeRestore(false);

    expect(lastMessageOfType('SAVE_NAS_LIST').list).toHaveLength(2);
    expect(lastMessageOfType('SET_WHITELIST').list).toEqual(['a.com']);
    expect(lastMessageOfType('SET_WHITELIST_MODE').mode).toBe('restricted');
    expect($('toast').textContent).toContain('restored');
  });

  test('skips the whitelist messages when the backup omits them', async () => {
    options.__setPendingRestore({ services: SERVICES });
    await options.executeRestore(false);

    expect(messagesOfType('SET_WHITELIST')).toHaveLength(0);
    expect(messagesOfType('SET_WHITELIST_MODE')).toHaveLength(0);
  });

  test('closes the modal and clears pending state on success', async () => {
    options.__setPendingRestore({ services: SERVICES });
    await options.executeRestore(false);

    expect($('restoreModal').classList.contains('d-none')).toBe(true);
    expect(options.__getState().pendingRestoreData).toBeNull();
  });

  test('merges decrypted credentials into the restored services', async () => {
    const envelope = await encryptCredentials(
      { a: { password: 'secretA', apiToken: '' }, b: { password: '', apiToken: 'tokB' } },
      'unlock-me'
    );
    options.__setPendingRestore({ services: SERVICES, encryptedCredentials: envelope });
    $('restorePasswordInput').value = 'unlock-me';

    await options.executeRestore(true);

    const list = lastMessageOfType('SAVE_NAS_LIST').list;
    expect(list.find((s) => s.id === 'a').password).toBe('secretA');
    expect(list.find((s) => s.id === 'b').apiToken).toBe('tokB');
    expect($('toast').textContent).toContain('credentials restored');
  });

  test('leaves a service untouched when the envelope has no entry for it', async () => {
    const envelope = await encryptCredentials({ a: { password: 'onlyA' } }, 'pw');
    options.__setPendingRestore({ services: SERVICES, encryptedCredentials: envelope });
    $('restorePasswordInput').value = 'pw';

    await options.executeRestore(true);

    const list = lastMessageOfType('SAVE_NAS_LIST').list;
    expect(list.find((s) => s.id === 'a').password).toBe('onlyA');
    expect(list.find((s) => s.id === 'b').password).toBe('');
  });

  test('demands a password before decrypting', async () => {
    options.__setPendingRestore({
      services: SERVICES,
      encryptedCredentials: { ciphertext: 'c', salt: 's', iv: 'i' }
    });
    $('restorePasswordInput').value = '';

    await options.executeRestore(true);

    expect(messagesOfType('SAVE_NAS_LIST')).toHaveLength(0);
    expect($('toast').textContent).toContain('decryption password');
    expect($('toast').className).toContain('error');
  });

  test('aborts the restore when the password is wrong', async () => {
    const envelope = await encryptCredentials({ a: { password: 'x' } }, 'right-pw');
    options.__setPendingRestore({ services: SERVICES, encryptedCredentials: envelope });
    $('restorePasswordInput').value = 'wrong-pw';

    await options.executeRestore(true);

    expect(messagesOfType('SAVE_NAS_LIST')).toHaveLength(0);
    expect($('toast').textContent).toContain('Incorrect password');
    expect($('restoreModal').classList.contains('d-none')).toBe(true);
  });

  test('the pending backup survives a wrong password so the user can retry', async () => {
    const envelope = await encryptCredentials({ a: { password: 'x' } }, 'right-pw');
    options.__setPendingRestore({ services: SERVICES, encryptedCredentials: envelope });
    $('restorePasswordInput').value = 'wrong-pw';

    await options.executeRestore(true);
    expect(options.__getState().pendingRestoreData).not.toBeNull();
  });

  test('settings-only restore skips decryption entirely', async () => {
    const envelope = await encryptCredentials({ a: { password: 'secretA' } }, 'pw');
    options.__setPendingRestore({ services: SERVICES, encryptedCredentials: envelope });
    $('restorePasswordInput').value = '';

    await options.executeRestore(false);

    const list = lastMessageOfType('SAVE_NAS_LIST').list;
    expect(list.find((s) => s.id === 'a').password).toBe('');
    expect($('toast').textContent).toContain('credentials skipped');
  });

  test('reports an error toast when saving the restore fails', async () => {
    loadOptionsPage({
      respond: (m) => (m.type === 'SAVE_NAS_LIST' ? new Error('disk full') : { ok: true })
    });
    options.__setPendingRestore({ services: SERVICES });

    await options.executeRestore(false);

    expect($('toast').textContent).toContain('disk full');
    expect($('toast').className).toContain('error');
  });
});

describe('closeRestoreModal()', () => {
  test('hides the modal, clears pending state and wipes the password field', async () => {
    options.__setPendingRestore({ services: [] });
    $('restoreModal').classList.remove('d-none');
    $('restorePasswordInput').value = 'typed-secret';

    options.closeRestoreModal();

    expect($('restoreModal').classList.contains('d-none')).toBe(true);
    expect(options.__getState().pendingRestoreData).toBeNull();
    expect($('restorePasswordInput').value).toBe('');
  });
});

// ── Toast ───────────────────────────────────────────────────────────────────

describe('showToast()', () => {
  test('sets the message and a success class by default', () => {
    options.showToast('Done');
    expect($('toast').textContent).toBe('Done');
    expect($('toast').className).toBe('show success');
  });

  test('applies the requested type', () => {
    options.showToast('Oops', 'error');
    expect($('toast').className).toBe('show error');
  });

  test('clears itself after the display window', () => {
    jest.useFakeTimers();
    options.showToast('Bye');
    expect($('toast').className).toContain('show');

    jest.advanceTimersByTime(2800);
    expect($('toast').className).toBe('');
  });

  test('does not throw when the toast element is absent', () => {
    $('toast').remove();
    expect(() => options.showToast('x')).not.toThrow();
  });
});

// ── Tab navigation ──────────────────────────────────────────────────────────

describe('initTabs()', () => {
  test('every nav tab has a matching content pane', () => {
    document.querySelectorAll('.nav-tab').forEach((tab) => {
      expect($(`pane-${tab.dataset.tab}`)).not.toBeNull();
    });
  });

  test('clicking a tab activates it and its pane exclusively', () => {
    options.initTabs();
    const tabs = [...document.querySelectorAll('.nav-tab')];
    const target = tabs.find((t) => t.dataset.tab === 'backup');

    target.click();

    expect(target.classList.contains('active')).toBe(true);
    expect(tabs.filter((t) => t.classList.contains('active'))).toHaveLength(1);
    expect($('pane-backup').classList.contains('active')).toBe(true);

    const activePanes = [...document.querySelectorAll('.content-pane.active')];
    expect(activePanes).toHaveLength(1);
  });

  test('switching tabs deactivates the previous pane', () => {
    options.initTabs();
    const tabs = [...document.querySelectorAll('.nav-tab')];

    tabs.find((t) => t.dataset.tab === 'backup').click();
    tabs.find((t) => t.dataset.tab === 'services').click();

    expect($('pane-backup').classList.contains('active')).toBe(false);
    expect($('pane-services').classList.contains('active')).toBe(true);
  });
});

// ── loadServices() ─────────────────────────────────────────────────────────

describe('loadServices()', () => {
  test('stores and renders the fetched list', async () => {
    loadOptionsPage({
      respond: (m) => (m.type === 'GET_NAS_LIST'
        ? { list: [{ id: 'a', type: 'deluge', name: 'A', host: 'h', port: 8112 }] }
        : { ok: true })
    });

    await options.loadServices();

    expect(options.__getState().currentServices).toHaveLength(1);
    expect($('serviceListContainer').querySelectorAll('.device-card')).toHaveLength(1);
  });

  test('treats a missing list as empty and renders the empty state', async () => {
    loadOptionsPage({ respond: () => ({}) });
    await options.loadServices();

    expect(options.__getState().currentServices).toEqual([]);
    expect($('serviceListContainer').querySelector('.empty-state')).not.toBeNull();
  });

  test('shows an error toast when the fetch fails', async () => {
    loadOptionsPage({ respond: () => new Error('no background') });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await options.loadServices();

    expect($('toast').textContent).toContain('no background');
    expect($('toast').className).toContain('error');
  });
});

// ── DOM contract ────────────────────────────────────────────────────────────

describe('options.html / options.js DOM contract', () => {
  test('every id referenced by options.js exists in options.html', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'options.js'), 'utf8'
    );
    const referenced = [...src.matchAll(/getElementById\(\s*["'`]([^"'`]+)["'`]\s*\)/g)]
      .map((m) => m[1]);

    // Ids created dynamically by renderServiceList rather than shipped markup.
    const dynamic = new Set(['emptyAddBtn']);

    const missing = [...new Set(referenced)]
      .filter((id) => !dynamic.has(id))
      .filter((id) => $(id) === null);

    expect(missing).toEqual([]);
  });

  test('the form ids the save path reads are all present', () => {
    ['serviceId', 'serviceType', 'serviceName', 'serviceHost', 'servicePort',
      'serviceHttps', 'serviceUsername', 'servicePassword', 'serviceDefaultPath']
      .forEach((id) => expect($(id)).not.toBeNull());
  });
});
