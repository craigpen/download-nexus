/**
 * Protocols Test Suite
 * Tests protocol support matrix and download extension configuration
 */

const assert = require('assert');

// Mock implementation of Protocols
const Protocols = {
  PROTOCOL_SUPPORT: {
    synology: {
      name: "Synology",
      protocols: ["magnet", "torrent", "http", "https", "ftp"],
      description: "Synology Download Station"
    },
    qbittorrent: {
      name: "qBittorrent",
      protocols: ["magnet", "torrent"],
      description: "qBittorrent"
    },
    transmission: {
      name: "Transmission",
      protocols: ["magnet", "torrent"],
      description: "Transmission"
    },
    deluge: {
      name: "Deluge",
      protocols: ["magnet", "torrent"],
      description: "Deluge"
    },
    aria2: {
      name: "Aria2",
      protocols: ["magnet", "torrent", "http", "https", "ftp"],
      description: "Aria2 Download Manager"
    }
  },

  DEFAULT_DOWNLOAD_EXTENSIONS: [
    "zip", "rar", "7z", "tar", "gz", "bz2", "xz",
    "iso", "img", "dmg",
    "exe", "msi", "pkg", "deb", "rpm",
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "mp4", "mkv", "avi", "mov", "flv", "wmv", "webm", "m4v",
    "mp3", "m4a", "flac", "wav", "aac", "ogg",
    "apk", "jar", "bin", "dat"
  ],

  customDownloadExtensions: null,

  get DOWNLOAD_EXTENSIONS() {
    return this.customDownloadExtensions || this.DEFAULT_DOWNLOAD_EXTENSIONS;
  },

  getServiceProtocols(serviceType) {
    const info = this.PROTOCOL_SUPPORT[serviceType];
    return info ? info.protocols : [];
  },

  supportsProtocol(serviceType, protocol) {
    const protocols = this.getServiceProtocols(serviceType);
    return protocols.includes(protocol);
  },

  getServicesForProtocol(protocol, serviceList) {
    if (!serviceList || !Array.isArray(serviceList)) return [];
    return serviceList.filter(service =>
      this.supportsProtocol(service.type, protocol)
    );
  },

  setCustomDownloadExtensions(extensions) {
    if (Array.isArray(extensions) && extensions.length > 0) {
      this.customDownloadExtensions = extensions.map(e => e.toLowerCase());
    }
  },

  reset() {
    this.customDownloadExtensions = null;
  }
};

describe('Protocols', () => {
  beforeEach(() => {
    Protocols.reset();
  });

  describe('PROTOCOL_SUPPORT', () => {
    test('should define all service types', () => {
      const services = ['synology', 'qbittorrent', 'transmission', 'deluge', 'aria2'];

      services.forEach(service => {
        assert(Protocols.PROTOCOL_SUPPORT[service], `Should define ${service}`);
        assert(Protocols.PROTOCOL_SUPPORT[service].name, `Should have name for ${service}`);
        assert(Protocols.PROTOCOL_SUPPORT[service].protocols, `Should have protocols for ${service}`);
        assert(Protocols.PROTOCOL_SUPPORT[service].description, `Should have description for ${service}`);
      });
    });

    test('should define all protocols as arrays', () => {
      Object.values(Protocols.PROTOCOL_SUPPORT).forEach(service => {
        assert(Array.isArray(service.protocols), `${service.name} protocols should be array`);
      });
    });
  });

  describe('getServiceProtocols', () => {
    test('should return protocols for valid service', () => {
      const synologyProtocols = Protocols.getServiceProtocols('synology');

      assert(Array.isArray(synologyProtocols), 'Should return array');
      assert(synologyProtocols.includes('magnet'), 'Synology should support magnet');
      assert(synologyProtocols.includes('http'), 'Synology should support http');
      assert(synologyProtocols.includes('https'), 'Synology should support https');
      assert(synologyProtocols.includes('ftp'), 'Synology should support ftp');
    });

    test('should return only torrent-specific protocols for torrent services', () => {
      const qbitProtocols = Protocols.getServiceProtocols('qbittorrent');

      assert(qbitProtocols.length === 2, 'qBittorrent should have 2 protocols');
      assert(qbitProtocols.includes('magnet'), 'Should support magnet');
      assert(qbitProtocols.includes('torrent'), 'Should support torrent');
      assert(!qbitProtocols.includes('http'), 'Should NOT support http');
      assert(!qbitProtocols.includes('https'), 'Should NOT support https');
      assert(!qbitProtocols.includes('ftp'), 'Should NOT support ftp');
    });

    test('should return empty array for unknown service', () => {
      const protocols = Protocols.getServiceProtocols('unknown-service');

      assert(Array.isArray(protocols), 'Should return array');
      assert(protocols.length === 0, 'Should return empty array');
    });

    test('should return empty array for null/undefined service', () => {
      assert.deepStrictEqual(Protocols.getServiceProtocols(null), []);
      assert.deepStrictEqual(Protocols.getServiceProtocols(undefined), []);
    });
  });

  describe('supportsProtocol', () => {
    test('should confirm protocol support for supported protocols', () => {
      assert(Protocols.supportsProtocol('synology', 'magnet') === true);
      assert(Protocols.supportsProtocol('synology', 'torrent') === true);
      assert(Protocols.supportsProtocol('synology', 'http') === true);
      assert(Protocols.supportsProtocol('synology', 'https') === true);
      assert(Protocols.supportsProtocol('synology', 'ftp') === true);
    });

    test('should reject unsupported protocols', () => {
      assert(Protocols.supportsProtocol('qbittorrent', 'http') === false);
      assert(Protocols.supportsProtocol('qbittorrent', 'https') === false);
      assert(Protocols.supportsProtocol('qbittorrent', 'ftp') === false);
    });

    test('should handle unknown service', () => {
      assert(Protocols.supportsProtocol('unknown', 'magnet') === false);
      assert(Protocols.supportsProtocol('unknown', 'http') === false);
    });

    test('should handle unknown protocol', () => {
      assert(Protocols.supportsProtocol('synology', 'unknown') === false);
    });

    test('should handle null/undefined inputs', () => {
      assert(Protocols.supportsProtocol(null, 'magnet') === false);
      assert(Protocols.supportsProtocol('synology', null) === false);
      assert(Protocols.supportsProtocol(null, null) === false);
    });

    test('should be case-sensitive', () => {
      assert(Protocols.supportsProtocol('synology', 'magnet') === true);
      assert(Protocols.supportsProtocol('synology', 'MAGNET') === false);
      assert(Protocols.supportsProtocol('SYNOLOGY', 'magnet') === false);
    });
  });

  describe('getServicesForProtocol', () => {
    test('should filter services by protocol support', () => {
      const allServices = [
        { id: '1', type: 'synology', name: 'Synology' },
        { id: '2', type: 'qbittorrent', name: 'qBittorrent' },
        { id: '3', type: 'aria2', name: 'Aria2' }
      ];

      const httpSupported = Protocols.getServicesForProtocol('http', allServices);

      assert(httpSupported.length === 2, 'Should find 2 services supporting HTTP');
      assert(httpSupported.some(s => s.type === 'synology'));
      assert(httpSupported.some(s => s.type === 'aria2'));
      assert(!httpSupported.some(s => s.type === 'qbittorrent'));
    });

    test('should return all services for universal protocols', () => {
      const allServices = [
        { id: '1', type: 'synology' },
        { id: '2', type: 'qbittorrent' },
        { id: '3', type: 'transmission' },
        { id: '4', type: 'deluge' },
        { id: '5', type: 'aria2' }
      ];

      const magnetServices = Protocols.getServicesForProtocol('magnet', allServices);

      assert(magnetServices.length === 5, 'All services should support magnet');
    });

    test('should return empty array when no services support protocol', () => {
      const torrentOnlyServices = [
        { id: '1', type: 'qbittorrent' },
        { id: '2', type: 'transmission' }
      ];

      const ftpServices = Protocols.getServicesForProtocol('ftp', torrentOnlyServices);

      assert(ftpServices.length === 0, 'Should return empty when no support');
    });

    test('should return empty array for invalid input', () => {
      assert.deepStrictEqual(Protocols.getServicesForProtocol('magnet', null), []);
      assert.deepStrictEqual(Protocols.getServicesForProtocol('magnet', undefined), []);
      assert.deepStrictEqual(Protocols.getServicesForProtocol('magnet', []), []);
      assert.deepStrictEqual(Protocols.getServicesForProtocol('magnet', 'not-array'), []);
    });

    test('should preserve service data in filtered result', () => {
      const services = [
        { id: 'svc-1', type: 'synology', name: 'My NAS', host: '192.168.1.1' }
      ];

      const result = Protocols.getServicesForProtocol('http', services);

      assert(result[0].id === 'svc-1', 'Should preserve ID');
      assert(result[0].name === 'My NAS', 'Should preserve name');
      assert(result[0].host === '192.168.1.1', 'Should preserve custom properties');
    });
  });

  describe('DOWNLOAD_EXTENSIONS', () => {
    test('should have reasonable default extensions', () => {
      const exts = Protocols.DOWNLOAD_EXTENSIONS;

      assert(Array.isArray(exts), 'Should be array');
      assert(exts.length > 0, 'Should have default extensions');

      // Common archive formats
      assert(exts.includes('zip'), 'Should include zip');
      assert(exts.includes('rar'), 'Should include rar');
      assert(exts.includes('7z'), 'Should include 7z');

      // ISO images
      assert(exts.includes('iso'), 'Should include iso');

      // Videos
      assert(exts.includes('mp4'), 'Should include mp4');

      // Audio
      assert(exts.includes('mp3'), 'Should include mp3');
    });

    test('should return default extensions by default', () => {
      assert.deepStrictEqual(
        Protocols.DOWNLOAD_EXTENSIONS,
        Protocols.DEFAULT_DOWNLOAD_EXTENSIONS
      );
    });
  });

  describe('setCustomDownloadExtensions', () => {
    test('should set custom extensions', () => {
      const custom = ['exe', 'msi', 'zip'];
      Protocols.setCustomDownloadExtensions(custom);

      const exts = Protocols.DOWNLOAD_EXTENSIONS;
      assert(Array.isArray(exts), 'Should be array');
      assert(exts.length === 3, 'Should have 3 extensions');
      assert(exts.includes('exe'), 'Should include exe');
      assert(exts.includes('msi'), 'Should include msi');
      assert(exts.includes('zip'), 'Should include zip');
    });

    test('should normalize extensions to lowercase', () => {
      const custom = ['EXE', 'MSI', 'Zip'];
      Protocols.setCustomDownloadExtensions(custom);

      const exts = Protocols.DOWNLOAD_EXTENSIONS;
      assert(exts.includes('exe'), 'Should normalize to lowercase');
      assert(exts.includes('msi'), 'Should normalize to lowercase');
      assert(exts.includes('zip'), 'Should normalize to lowercase');
      assert(!exts.includes('EXE'), 'Should not have uppercase');
    });

    test('should ignore empty extension array', () => {
      Protocols.setCustomDownloadExtensions([]);
      const exts = Protocols.DOWNLOAD_EXTENSIONS;

      assert.deepStrictEqual(
        exts,
        Protocols.DEFAULT_DOWNLOAD_EXTENSIONS,
        'Should keep defaults for empty array'
      );
    });

    test('should ignore null/undefined', () => {
      Protocols.setCustomDownloadExtensions(null);
      assert.deepStrictEqual(
        Protocols.DOWNLOAD_EXTENSIONS,
        Protocols.DEFAULT_DOWNLOAD_EXTENSIONS
      );

      Protocols.setCustomDownloadExtensions(undefined);
      assert.deepStrictEqual(
        Protocols.DOWNLOAD_EXTENSIONS,
        Protocols.DEFAULT_DOWNLOAD_EXTENSIONS
      );
    });

    test('should ignore non-array input', () => {
      Protocols.setCustomDownloadExtensions('not-array');
      assert.deepStrictEqual(
        Protocols.DOWNLOAD_EXTENSIONS,
        Protocols.DEFAULT_DOWNLOAD_EXTENSIONS
      );

      Protocols.setCustomDownloadExtensions({ extensions: ['zip'] });
      assert.deepStrictEqual(
        Protocols.DOWNLOAD_EXTENSIONS,
        Protocols.DEFAULT_DOWNLOAD_EXTENSIONS
      );
    });

    test('should handle single-item array', () => {
      Protocols.setCustomDownloadExtensions(['zip']);
      const exts = Protocols.DOWNLOAD_EXTENSIONS;

      assert(exts.length === 1, 'Should accept single extension');
      assert(exts.includes('zip'), 'Should contain the extension');
    });

    test('should handle large extension list', () => {
      const custom = Array.from({ length: 100 }, (_, i) => `ext${i}`);
      Protocols.setCustomDownloadExtensions(custom);

      const exts = Protocols.DOWNLOAD_EXTENSIONS;
      assert(exts.length === 100, 'Should accept large list');
      assert(exts.includes('ext0'), 'Should contain first extension');
      assert(exts.includes('ext99'), 'Should contain last extension');
    });
  });

  describe('Real-world scenarios', () => {
    test('User configures custom extensions for specific file types', () => {
      const customExts = ['exe', 'msi', 'zip', 'rar'];
      Protocols.setCustomDownloadExtensions(customExts);

      const services = [
        { id: '1', type: 'synology', name: 'Synology' },
        { id: '2', type: 'qbittorrent', name: 'qBit' }
      ];

      // Check that .exe downloads would be recognized
      const exts = Protocols.DOWNLOAD_EXTENSIONS;
      assert(exts.includes('exe'), 'Should support .exe downloads');
    });

    test('Mixed service environment with varying protocol support', () => {
      const services = [
        { id: '1', type: 'synology', name: 'Synology' },
        { id: '2', type: 'qbittorrent', name: 'qBittorrent' },
        { id: '3', type: 'aria2', name: 'Aria2' }
      ];

      // For magnet links, all should be compatible
      const magnetServices = Protocols.getServicesForProtocol('magnet', services);
      assert(magnetServices.length === 3, 'All should support magnet');

      // For HTTP downloads, only Synology and Aria2
      const httpServices = Protocols.getServicesForProtocol('http', services);
      assert(httpServices.length === 2, 'Only Synology and Aria2 support HTTP');
      assert(!httpServices.some(s => s.type === 'qbittorrent'));
    });

    test('Protocol checking with empty service list', () => {
      const empty = [];
      const result = Protocols.getServicesForProtocol('magnet', empty);

      assert(Array.isArray(result), 'Should return array');
      assert(result.length === 0, 'Should return empty for no services');
    });
  });

  describe('Protocol matrix completeness', () => {
    test('all services should support at least magnet and torrent', () => {
      const services = ['synology', 'qbittorrent', 'transmission', 'deluge', 'aria2'];

      services.forEach(service => {
        assert(Protocols.supportsProtocol(service, 'magnet'), `${service} should support magnet`);
        assert(Protocols.supportsProtocol(service, 'torrent'), `${service} should support torrent`);
      });
    });

    test('aria2 and synology should support all protocols', () => {
      const protocols = ['magnet', 'torrent', 'http', 'https', 'ftp'];

      protocols.forEach(protocol => {
        assert(Protocols.supportsProtocol('synology', protocol), `synology should support ${protocol}`);
        assert(Protocols.supportsProtocol('aria2', protocol), `aria2 should support ${protocol}`);
      });
    });
  });
});
