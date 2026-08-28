/**
 * Link Detector Test Suite
 * Tests protocol detection and link type classification
 */

const assert = require('assert');

// Mock LinkDetector implementation for testing
const LinkDetector = {
  detectLinkType(url) {
    if (!url || typeof url !== 'string') return null;

    // Magnet links
    if (url.startsWith('magnet:')) {
      const m = url.match(/[?&]xt=urn:btih:([a-zA-Z0-9]+)/);
      return m ? 'magnet' : null;
    }

    // Torrent files (check before splitting by fragment)
    if (/\.torrent(\?|#|$)/i.test(url)) {
      return 'torrent';
    }

    // HTTP/HTTPS downloads
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return 'http';
    }

    // FTP downloads
    if (url.startsWith('ftp://')) {
      return 'ftp';
    }

    return null;
  },

  getLinkTypeLabel(type) {
    const labels = {
      'magnet': 'Magnet Link',
      'torrent': 'Torrent File',
      'http': 'HTTP Download',
      'https': 'HTTPS Download',
      'ftp': 'FTP Download'
    };
    return labels[type] || 'Unknown';
  },

  isValidMagnet(url) {
    if (!url.startsWith('magnet:')) return false;
    return /[?&]xt=urn:btih:[a-zA-Z0-9]+/i.test(url);
  },

  isValidTorrentUrl(url) {
    return /\.torrent(\?|#|$)/i.test(url);
  }
};

describe('Link Detector', () => {
  describe('detectLinkType', () => {
    test('should detect magnet links', () => {
      const magnetUrl = 'magnet:?xt=urn:btih:abc123def456&dn=example';
      assert(LinkDetector.detectLinkType(magnetUrl) === 'magnet', 'Should detect magnet link');
    });

    test('should reject invalid magnet links (no btih)', () => {
      const invalidMagnet = 'magnet:?dn=example';
      assert(LinkDetector.detectLinkType(invalidMagnet) === null, 'Should reject magnet without btih');
    });

    test('should detect torrent URLs', () => {
      const torrentUrls = [
        'http://example.com/file.torrent',
        'https://example.com/file.torrent?key=value',
        'http://example.com/path/to/file.TORRENT'
      ];

      torrentUrls.forEach(url => {
        assert(LinkDetector.detectLinkType(url) === 'torrent', `Should detect ${url}`);
      });
    });

    test('should distinguish between torrent and HTTP downloads', () => {
      const torrent = 'http://example.com/file.torrent';
      const http = 'http://example.com/file.zip';

      assert(LinkDetector.detectLinkType(torrent) === 'torrent', 'Should detect torrent');
      assert(LinkDetector.detectLinkType(http) === 'http', 'Should detect HTTP (not torrent)');
    });

    test('should detect HTTP downloads', () => {
      const httpUrl = 'http://example.com/file.zip';
      assert(LinkDetector.detectLinkType(httpUrl) === 'http', 'Should detect HTTP');
    });

    test('should detect HTTPS downloads', () => {
      const httpsUrl = 'https://example.com/file.iso';
      assert(LinkDetector.detectLinkType(httpsUrl) === 'http', 'Should detect HTTPS as http type');
    });

    test('should detect FTP downloads', () => {
      const ftpUrl = 'ftp://ftp.example.com/file.zip';
      assert(LinkDetector.detectLinkType(ftpUrl) === 'ftp', 'Should detect FTP');
    });

    test('should return null for unsupported protocols', () => {
      const unsupported = [
        'mailto:test@example.com',
        'javascript:alert("xss")',
        'data:text/html,<script>alert("xss")</script>',
        'file:///etc/passwd',
        'telnet://example.com'
      ];

      unsupported.forEach(url => {
        assert(LinkDetector.detectLinkType(url) === null, `Should reject ${url.split(':')[0]}:`);
      });
    });

    test('should return null for null/undefined/empty input', () => {
      assert(LinkDetector.detectLinkType(null) === null, 'Should return null for null');
      assert(LinkDetector.detectLinkType(undefined) === null, 'Should return null for undefined');
      assert(LinkDetector.detectLinkType('') === null, 'Should return null for empty string');
    });

    test('should return null for non-string input', () => {
      assert(LinkDetector.detectLinkType(123) === null, 'Should return null for number');
      assert(LinkDetector.detectLinkType({}) === null, 'Should return null for object');
      assert(LinkDetector.detectLinkType([]) === null, 'Should return null for array');
    });
  });

  describe('getLinkTypeLabel', () => {
    test('should return proper labels for all types', () => {
      const labels = {
        'magnet': 'Magnet Link',
        'torrent': 'Torrent File',
        'http': 'HTTP Download',
        'https': 'HTTPS Download',
        'ftp': 'FTP Download'
      };

      Object.entries(labels).forEach(([type, label]) => {
        assert(LinkDetector.getLinkTypeLabel(type) === label, `Label for ${type} should be "${label}"`);
      });
    });

    test('should return "Unknown" for unrecognized types', () => {
      assert(LinkDetector.getLinkTypeLabel('unknown') === 'Unknown', 'Should return Unknown');
      assert(LinkDetector.getLinkTypeLabel('xyz') === 'Unknown', 'Should return Unknown');
      assert(LinkDetector.getLinkTypeLabel(null) === 'Unknown', 'Should return Unknown for null');
    });
  });

  describe('Magnet Link Validation', () => {
    test('should validate correct magnet links', () => {
      const validMagnets = [
        'magnet:?xt=urn:btih:abc123def456',
        'magnet:?xt=urn:btih:abc123def456&dn=example',
        'magnet:?xt=urn:btih:ABC123DEF456&tr=http://tracker.example.com'
      ];

      validMagnets.forEach(url => {
        assert(LinkDetector.isValidMagnet(url), `Should validate ${url}`);
      });
    });

    test('should reject magnet links without btih', () => {
      const invalidMagnets = [
        'magnet:',
        'magnet:?dn=example',
        'magnet:?xt=urn:ed2k:hash123',
        'magnet:?tr=http://tracker.example.com'
      ];

      invalidMagnets.forEach(url => {
        assert(!LinkDetector.isValidMagnet(url), `Should reject ${url}`);
      });
    });

    test('should reject non-magnet URLs', () => {
      assert(!LinkDetector.isValidMagnet('http://example.com'), 'Should reject HTTP URL');
      assert(!LinkDetector.isValidMagnet('http://example.com/file.torrent'), 'Should reject torrent URL');
      assert(!LinkDetector.isValidMagnet('ftp://example.com/file.iso'), 'Should reject FTP URL');
    });
  });

  describe('Torrent URL Validation', () => {
    test('should validate correct torrent URLs', () => {
      const validUrls = [
        'http://example.com/file.torrent',
        'https://example.com/file.torrent',
        'http://example.com/path/to/file.torrent?key=value',
        'https://example.com/file.TORRENT',
        'http://example.com/file.torrent#section'
      ];

      validUrls.forEach(url => {
        assert(LinkDetector.isValidTorrentUrl(url), `Should validate ${url}`);
      });
    });

    test('should reject non-torrent URLs', () => {
      const invalidUrls = [
        'http://example.com/file.zip',
        'http://example.com/file.tar.gz',
        'http://example.com/file.iso',
        'http://example.com/file.torrent.backup'
      ];

      invalidUrls.forEach(url => {
        assert(!LinkDetector.isValidTorrentUrl(url), `Should reject ${url}`);
      });
    });
  });

  describe('Edge Cases', () => {
    test('should handle URLs with query parameters', () => {
      assert(LinkDetector.detectLinkType('http://example.com/file.zip?token=abc123&foo=bar') === 'http');
      assert(LinkDetector.detectLinkType('http://example.com/file.torrent?token=abc123') === 'torrent');
    });

    test('should handle URLs with fragments', () => {
      assert(LinkDetector.detectLinkType('http://example.com/file.zip#section') === 'http');
      assert(LinkDetector.detectLinkType('http://example.com/file.torrent#section') === 'torrent');
    });

    test('should handle case-insensitive file extensions', () => {
      assert(LinkDetector.detectLinkType('http://example.com/file.TORRENT') === 'torrent');
      assert(LinkDetector.detectLinkType('http://example.com/file.Torrent') === 'torrent');
    });

    test('should handle URLs with special characters', () => {
      const url = 'http://example.com/file%20name.torrent';
      assert(LinkDetector.detectLinkType(url) === 'torrent', 'Should handle URL-encoded filenames');
    });

    test('should handle very long URLs', () => {
      const longParams = 'a'.repeat(1000);
      const url = `magnet:?xt=urn:btih:abc123def456&${longParams}`;
      assert(LinkDetector.detectLinkType(url) === 'magnet', 'Should handle long URLs');
    });
  });
});
