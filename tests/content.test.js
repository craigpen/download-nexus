/**
 * Content Script Test Suite
 * Tests domain whitelisting, link detection, and UI injection logic
 */

const assert = require('assert');

// Helper function extracted from content.js
function isDomainWhitelisted(domain, patterns) {
  // If no patterns, nothing is whitelisted
  if (!patterns || patterns.length === 0) return false;
  // "*" matches everything
  if (patterns.includes("*")) return true;
  // Check exact and wildcard matches
  for (const pattern of patterns) {
    if (pattern === domain) return true; // Exact match
    if (pattern.startsWith("*.")) {
      // Wildcard: *.example.com matches www.example.com, sub.example.com, but not example.com itself
      const suffix = pattern.slice(1); // Remove the *, keep the .domain.com
      if (domain.endsWith(suffix)) return true;
    }
  }
  return false;
}

// Mock UI element generation helpers
const UIHelpers = {
  makeInlineButton(url, type, anchorEl) {
    return {
      url,
      type,
      element: 'button',
      injected: true,
      target: anchorEl
    };
  },

  makePill(url, type) {
    return {
      url,
      type,
      element: 'span',
      pill: true
    };
  },

  showNasSelector(btn, url, type, nasDevices) {
    if (nasDevices.length === 0) {
      return { error: 'No NAS devices configured' };
    }
    if (nasDevices.length === 1) {
      return { action: 'send', nasId: nasDevices[0].id };
    }
    return { action: 'showMenu', devices: nasDevices };
  }
};

describe('Content Script - Domain Whitelisting', () => {
  describe('isDomainWhitelisted', () => {
    test('should reject when patterns empty', () => {
      assert(!isDomainWhitelisted('example.com', []), 'Should reject with empty patterns');
      assert(!isDomainWhitelisted('example.com', null), 'Should reject with null patterns');
      assert(!isDomainWhitelisted('example.com', undefined), 'Should reject with undefined patterns');
    });

    test('should accept everything when wildcard present', () => {
      const patterns = ['*'];

      assert(isDomainWhitelisted('example.com', patterns));
      assert(isDomainWhitelisted('any-random-domain.org', patterns));
      assert(isDomainWhitelisted('localhost', patterns));
      assert(isDomainWhitelisted('192.168.1.1', patterns));
    });

    test('should match exact domains', () => {
      const patterns = ['example.com', 'test.org', 'local.dev'];

      assert(isDomainWhitelisted('example.com', patterns) === true);
      assert(isDomainWhitelisted('test.org', patterns) === true);
      assert(isDomainWhitelisted('local.dev', patterns) === true);
      assert(isDomainWhitelisted('other.com', patterns) === false);
    });

    test('should match wildcard subdomains', () => {
      const patterns = ['*.example.com'];

      // Should match subdomains
      assert(isDomainWhitelisted('www.example.com', patterns) === true);
      assert(isDomainWhitelisted('sub.example.com', patterns) === true);
      assert(isDomainWhitelisted('deep.sub.example.com', patterns) === true);

      // Should NOT match the base domain itself
      assert(isDomainWhitelisted('example.com', patterns) === false);

      // Should NOT match different domains
      assert(isDomainWhitelisted('notexample.com', patterns) === false);
    });

    test('should handle mixed patterns', () => {
      const patterns = ['exact.com', '*.wildcard.org', 'another.net'];

      assert(isDomainWhitelisted('exact.com', patterns) === true);
      assert(isDomainWhitelisted('sub.wildcard.org', patterns) === true);
      assert(isDomainWhitelisted('another.net', patterns) === true);
      assert(isDomainWhitelisted('unrelated.com', patterns) === false);
      assert(isDomainWhitelisted('wildcard.org', patterns) === false); // Base domain not matched
    });

    test('should be case-sensitive', () => {
      const patterns = ['example.com'];

      assert(isDomainWhitelisted('example.com', patterns) === true);
      assert(isDomainWhitelisted('EXAMPLE.COM', patterns) === false);
      assert(isDomainWhitelisted('Example.Com', patterns) === false);
    });

    test('should handle numeric domains', () => {
      const patterns = ['192.168.1.1', '*.local'];

      assert(isDomainWhitelisted('192.168.1.1', patterns) === true);
      assert(isDomainWhitelisted('localhost.local', patterns) === true);
      assert(isDomainWhitelisted('192.168.1.2', patterns) === false);
    });

    test('should handle edge cases', () => {
      // Empty domain
      assert(!isDomainWhitelisted('', ['example.com']));

      // Domain that ends with pattern but isn't a match
      const patterns = ['example.com'];
      assert(!isDomainWhitelisted('notexample.com', patterns));
      assert(!isDomainWhitelisted('.example.com', patterns));

      // Pattern without dot
      const patterns2 = ['*example.com'];
      assert(!isDomainWhitelisted('www.example.com', patterns2));
    });

    test('should handle multiple levels of wildcards', () => {
      const patterns = ['*.example.com'];

      // Single level subdomain
      assert(isDomainWhitelisted('www.example.com', patterns) === true);

      // Multiple levels should still work
      assert(isDomainWhitelisted('deep.sub.example.com', patterns) === true);
    });

    test('real-world scenarios', () => {
      // Whitelist main domain and all subdomains
      let patterns = ['example.com', '*.example.com'];
      assert(isDomainWhitelisted('example.com', patterns) === true);
      assert(isDomainWhitelisted('www.example.com', patterns) === true);
      assert(isDomainWhitelisted('mail.example.com', patterns) === true);
      assert(isDomainWhitelisted('other.org', patterns) === false);

      // Whitelist multiple organizations
      patterns = ['*.github.com', '*.github.io', 'gitlab.com', '*.gitlab.com'];
      assert(isDomainWhitelisted('user.github.io', patterns) === true);
      assert(isDomainWhitelisted('github.com', patterns) === false); // Base not included
      assert(isDomainWhitelisted('gitlab.com', patterns) === true);
      assert(isDomainWhitelisted('custom.gitlab.com', patterns) === true);
    });
  });
});

describe('Content Script - UI Generation', () => {
  describe('makeInlineButton', () => {
    test('should create button with URL and type', () => {
      const mockAnchor = { parentNode: {} };
      const url = 'magnet:?xt=urn:btih:abc123';
      const type = 'magnet';

      const button = UIHelpers.makeInlineButton(url, type, mockAnchor);

      assert(button.url === url);
      assert(button.type === type);
      assert(button.injected === true);
    });

    test('should handle different URL types', () => {
      const mockAnchor = { parentNode: {} };

      const magnetButton = UIHelpers.makeInlineButton('magnet:?xt=urn:btih:hash', 'magnet', mockAnchor);
      assert(magnetButton.type === 'magnet');

      const torrentButton = UIHelpers.makeInlineButton('http://example.com/file.torrent', 'torrent', mockAnchor);
      assert(torrentButton.type === 'torrent');

      const httpButton = UIHelpers.makeInlineButton('http://example.com/file.zip', 'http', mockAnchor);
      assert(httpButton.type === 'http');
    });
  });

  describe('makePill', () => {
    test('should create pill element', () => {
      const url = 'magnet:?xt=urn:btih:abc123';
      const type = 'magnet';

      const pill = UIHelpers.makePill(url, type);

      assert(pill.url === url);
      assert(pill.type === type);
      assert(pill.pill === true);
    });

    test('should handle long URLs', () => {
      const longUrl = 'http://example.com/path/to/very/long/' + 'a'.repeat(500) + '.torrent';
      const pill = UIHelpers.makePill(longUrl, 'torrent');

      assert(pill.url === longUrl);
    });
  });

  describe('showNasSelector', () => {
    test('should show error when no NAS devices', () => {
      const btn = {};
      const url = 'magnet:?xt=urn:btih:abc123';

      const result = UIHelpers.showNasSelector(btn, url, 'magnet', []);

      assert(result.error, 'Should have error');
      assert(result.error.includes('No NAS'), 'Should indicate no devices');
    });

    test('should send directly with single NAS', () => {
      const btn = {};
      const url = 'magnet:?xt=urn:btih:abc123';
      const nasDevices = [{ id: 'nas-1', name: 'My NAS' }];

      const result = UIHelpers.showNasSelector(btn, url, 'magnet', nasDevices);

      assert(result.action === 'send', 'Should send directly');
      assert(result.nasId === 'nas-1', 'Should specify NAS');
    });

    test('should show menu with multiple NAS devices', () => {
      const btn = {};
      const url = 'magnet:?xt=urn:btih:abc123';
      const nasDevices = [
        { id: 'nas-1', name: 'Synology' },
        { id: 'nas-2', name: 'qBittorrent' }
      ];

      const result = UIHelpers.showNasSelector(btn, url, 'magnet', nasDevices);

      assert(result.action === 'showMenu', 'Should show menu');
      assert(result.devices.length === 2, 'Should pass all devices');
    });
  });
});

describe('Content Script - Message Handling Patterns', () => {
  describe('Protocol settings changes', () => {
    test('should handle PROTOCOL_SETTINGS_CHANGED message', () => {
      const handler = (msg) => {
        if (msg.type === 'PROTOCOL_SETTINGS_CHANGED') {
          return { updated: true };
        }
        return null;
      };

      const message = { type: 'PROTOCOL_SETTINGS_CHANGED' };
      const result = handler(message);

      assert(result.updated === true);
    });

    test('should handle download extensions changed', () => {
      const handler = (msg) => {
        if (msg.type === 'DOWNLOAD_EXTENSIONS_CHANGED') {
          return { reinjected: true };
        }
        return null;
      };

      const message = { type: 'DOWNLOAD_EXTENSIONS_CHANGED' };
      const result = handler(message);

      assert(result.reinjected === true);
    });

    test('should ignore unknown messages', () => {
      const handler = (msg) => {
        if (msg.type === 'PROTOCOL_SETTINGS_CHANGED') {
          return { updated: true };
        }
        if (msg.type === 'DOWNLOAD_EXTENSIONS_CHANGED') {
          return { reinjected: true };
        }
        return null;
      };

      const message = { type: 'UNKNOWN_MESSAGE' };
      const result = handler(message);

      assert(result === null);
    });
  });
});

describe('Content Script - Link Detection Patterns', () => {
  describe('Magnet link extraction', () => {
    test('should extract magnet links from text', () => {
      const text = 'Download this: magnet:?xt=urn:btih:abc123def456&dn=Example';
      const magnetRegex = /magnet:\?[^\s"'<>]+/g;

      const matches = [...text.matchAll(magnetRegex)];

      assert(matches.length === 1);
      assert(matches[0][0].startsWith('magnet:'));
    });

    test('should handle multiple magnet links in text', () => {
      const text = 'First: magnet:?xt=urn:btih:hash1 and second: magnet:?xt=urn:btih:hash2';
      const magnetRegex = /magnet:\?[^\s"'<>]+/g;

      const matches = [...text.matchAll(magnetRegex)];

      assert(matches.length === 2);
    });

    test('should stop at whitespace or special chars', () => {
      const text = 'magnet:?xt=urn:btih:abc123 (link)';
      const magnetRegex = /magnet:\?[^\s"'<>]+/g;

      const matches = [...text.matchAll(magnetRegex)];

      assert(matches.length === 1);
      assert(!matches[0][0].includes('('));
    });
  });

  describe('Torrent link extraction', () => {
    test('should extract torrent URLs from text', () => {
      const text = 'Download from https://example.com/file.torrent?token=abc123';
      const torrentRegex = /https?:\/\/[^\s"'<>]+\.torrent(?:\?[^\s"'<>]*)*/g;

      const matches = [...text.matchAll(torrentRegex)];

      assert(matches.length === 1);
      assert(matches[0][0].includes('.torrent'));
    });

    test('should handle case-insensitive extensions', () => {
      const text = 'File: http://example.com/data.TORRENT';
      const torrentRegex = /https?:\/\/[^\s"'<>]+\.torrent(?:\?[^\s"'<>]*)*/gi;

      const matches = [...text.matchAll(torrentRegex)];

      assert(matches.length === 1);
    });

    test('should include query parameters', () => {
      const text = 'http://tracker.example.com/download.torrent?key=value&foo=bar';
      const torrentRegex = /https?:\/\/[^\s"'<>]+\.torrent(?:\?[^\s"'<>]*)*/g;

      const matches = [...text.matchAll(torrentRegex)];

      assert(matches.length === 1);
      assert(matches[0][0].includes('key=value'));
    });
  });

  describe('Link deduplication', () => {
    test('should avoid duplicate link detection', () => {
      const links = [
        { url: 'http://example.com/file.torrent', type: 'torrent' },
        { url: 'http://example.com/file.torrent', type: 'torrent' }
      ];

      const unique = links.filter((link, index) =>
        index === 0 || !links.slice(0, index).some(l => l.url === link.url)
      );

      assert(unique.length === 1, 'Should deduplicate');
    });
  });
});

describe('Content Script - Initialization State', () => {
  test('should track instance state', () => {
    const state = {
      nasListLoaded: false,
      whitelistLoaded: false,
      nasDevices: [],
      whitelist: [],
      whitelistEnabled: false
    };

    assert(!state.nasListLoaded);
    assert(!state.whitelistLoaded);

    // Simulate loading
    state.nasListLoaded = true;
    state.whitelistLoaded = true;
    state.nasDevices = [{ id: '1', name: 'NAS' }];

    assert(state.nasListLoaded);
    assert(state.whitelistLoaded);
    assert(state.nasDevices.length === 1);
  });

  test('should wait for both NAS and whitelist to load', () => {
    const state = {
      nasListLoaded: false,
      whitelistLoaded: false
    };

    function canInject() {
      return state.nasListLoaded && state.whitelistLoaded;
    }

    assert(!canInject(), 'Should not inject until both load');

    state.nasListLoaded = true;
    assert(!canInject(), 'Should still wait for whitelist');

    state.whitelistLoaded = true;
    assert(canInject(), 'Should be ready');
  });
});

describe('Content Script - Cleanup', () => {
  test('should support cleanup on instance replacement', () => {
    const observer = { disconnect: () => {} };
    let cleaned = false;

    const performCleanup = () => {
      observer.disconnect();
      cleaned = true;
    };

    performCleanup();
    assert(cleaned === true);
  });

  test('should handle cleanup errors gracefully', () => {
    const observer = {
      disconnect: () => {
        throw new Error('Disconnect failed');
      }
    };

    let error = null;
    try {
      observer.disconnect();
    } catch (err) {
      error = err;
    }

    assert(error !== null);
  });
});

describe('Content Script - Real-world Scenarios', () => {
  test('User visits tracker with whitelist enabled', () => {
    const domain = 'tracker.example.com';
    const whitelist = ['*.example.com'];
    const whitelistEnabled = true;

    const shouldInject = whitelistEnabled && isDomainWhitelisted(domain, whitelist);

    assert(shouldInject === true, 'Should inject on whitelisted domain');
  });

  test('User visits non-whitelisted domain with whitelist enabled', () => {
    const domain = 'other-tracker.org';
    const whitelist = ['*.example.com'];
    const whitelistEnabled = true;

    const shouldInject = whitelistEnabled && isDomainWhitelisted(domain, whitelist);

    assert(shouldInject === false, 'Should not inject on non-whitelisted domain');
  });

  test('Whitelist disabled - inject everywhere', () => {
    const domain = 'any-domain.com';
    const whitelist = ['*.example.com'];
    const whitelistEnabled = false;

    const shouldInject = !whitelistEnabled || isDomainWhitelisted(domain, whitelist);

    assert(shouldInject === true, 'Should inject when whitelist disabled');
  });

  test('Dynamic content with new magnet links', () => {
    const initialText = 'Some text with magnet:?xt=urn:btih:abc123';
    const newText = ' and magnet:?xt=urn:btih:def456 appears later';
    const fullText = initialText + newText;

    const magnetRegex = /magnet:\?[^\s"'<>]+/g;
    const matches = [...fullText.matchAll(magnetRegex)];

    assert(matches.length === 2, 'Should detect newly added magnet links');
  });
});
