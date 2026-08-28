/**
 * Service Filter Test Suite
 * Tests protocol filtering and service compatibility
 */

const assert = require('assert');

// Mock ServiceFilter implementation
const ServiceFilter = {
  getDefaultProtocolSettings() {
    return {
      magnet: true,
      torrent: true,
      http: false,
      https: false,
      ftp: false
    };
  },

  normalizeProtocolSettings(settings) {
    const defaults = this.getDefaultProtocolSettings();
    return {
      magnet: settings?.magnet ?? defaults.magnet,
      torrent: settings?.torrent ?? defaults.torrent,
      http: settings?.http ?? defaults.http,
      https: settings?.https ?? defaults.https,
      ftp: settings?.ftp ?? defaults.ftp
    };
  },

  supportsProtocol(serviceType, protocol) {
    const protocolMatrix = {
      synology: {
        magnet: true,
        torrent: true,
        http: true,
        https: true,
        ftp: true
      },
      qbittorrent: {
        magnet: true,
        torrent: true,
        http: false,
        https: false,
        ftp: false
      },
      transmission: {
        magnet: true,
        torrent: true,
        http: false,
        https: false,
        ftp: false
      },
      deluge: {
        magnet: true,
        torrent: true,
        http: false,
        https: false,
        ftp: false
      },
      aria2: {
        magnet: true,
        torrent: true,
        http: true,
        https: true,
        ftp: true
      }
    };

    return protocolMatrix[serviceType]?.[protocol] ?? false;
  },

  getServicesForProtocol(services, protocol) {
    if (!services || !Array.isArray(services)) return [];
    return services.filter(s => this.supportsProtocol(s.type, protocol));
  },

  getCompatibleServices(services, protocol, userSettings) {
    // First check if user has enabled this protocol
    const normalizedSettings = this.normalizeProtocolSettings(userSettings);
    if (!normalizedSettings[protocol]) {
      return [];
    }

    // Filter services that support this protocol
    return this.getServicesForProtocol(services, protocol);
  },

  hasCompatibleService(services, protocol, userSettings) {
    return this.getCompatibleServices(services, protocol, userSettings).length > 0;
  }
};

describe('Service Filter', () => {
  describe('Protocol Support Matrix', () => {
    test('should define protocol support for all services', () => {
      const services = ['synology', 'qbittorrent', 'transmission', 'deluge', 'aria2'];
      const protocols = ['magnet', 'torrent', 'http', 'https', 'ftp'];

      services.forEach(service => {
        protocols.forEach(protocol => {
          const supported = ServiceFilter.supportsProtocol(service, protocol);
          assert(typeof supported === 'boolean', `${service} should have boolean support for ${protocol}`);
        });
      });
    });

    test('should support magnet and torrent on all services', () => {
      const services = ['synology', 'qbittorrent', 'transmission', 'deluge', 'aria2'];

      services.forEach(service => {
        assert(ServiceFilter.supportsProtocol(service, 'magnet') === true, `${service} should support magnet`);
        assert(ServiceFilter.supportsProtocol(service, 'torrent') === true, `${service} should support torrent`);
      });
    });

    test('should support HTTP/HTTPS/FTP only on synology and aria2', () => {
      const httpServices = ['synology', 'aria2'];
      const torrentOnlyServices = ['qbittorrent', 'transmission', 'deluge'];
      const protocols = ['http', 'https', 'ftp'];

      httpServices.forEach(service => {
        protocols.forEach(protocol => {
          assert(ServiceFilter.supportsProtocol(service, protocol) === true,
            `${service} should support ${protocol}`);
        });
      });

      torrentOnlyServices.forEach(service => {
        protocols.forEach(protocol => {
          assert(ServiceFilter.supportsProtocol(service, protocol) === false,
            `${service} should NOT support ${protocol}`);
        });
      });
    });

    test('should return false for unknown service type', () => {
      assert(ServiceFilter.supportsProtocol('unknown', 'magnet') === false);
      assert(ServiceFilter.supportsProtocol('unknown', 'http') === false);
    });

    test('should return false for unknown protocol', () => {
      assert(ServiceFilter.supportsProtocol('synology', 'unknown') === false);
      assert(ServiceFilter.supportsProtocol('qbittorrent', 'unknown') === false);
    });
  });

  describe('Default Protocol Settings', () => {
    test('should enable magnet and torrent by default', () => {
      const defaults = ServiceFilter.getDefaultProtocolSettings();

      assert(defaults.magnet === true, 'Magnet should be enabled by default');
      assert(defaults.torrent === true, 'Torrent should be enabled by default');
    });

    test('should disable HTTP/HTTPS/FTP by default', () => {
      const defaults = ServiceFilter.getDefaultProtocolSettings();

      assert(defaults.http === false, 'HTTP should be disabled by default');
      assert(defaults.https === false, 'HTTPS should be disabled by default');
      assert(defaults.ftp === false, 'FTP should be disabled by default');
    });
  });

  describe('normalizeProtocolSettings', () => {
    test('should apply defaults to incomplete settings', () => {
      const settings = { magnet: false };
      const normalized = ServiceFilter.normalizeProtocolSettings(settings);

      assert(normalized.magnet === false, 'Should preserve explicit false');
      assert(normalized.torrent === true, 'Should apply default for torrent');
      assert(normalized.http === false, 'Should apply default for http');
    });

    test('should use defaults when settings is null/undefined', () => {
      const defaults = ServiceFilter.getDefaultProtocolSettings();

      assert.deepStrictEqual(ServiceFilter.normalizeProtocolSettings(null), defaults);
      assert.deepStrictEqual(ServiceFilter.normalizeProtocolSettings(undefined), defaults);
      assert.deepStrictEqual(ServiceFilter.normalizeProtocolSettings({}), defaults);
    });

    test('should handle partial settings', () => {
      const settings = {
        magnet: true,
        http: true,
        ftp: false
      };

      const normalized = ServiceFilter.normalizeProtocolSettings(settings);

      assert(normalized.magnet === true);
      assert(normalized.http === true);
      assert(normalized.ftp === false);
      assert(normalized.torrent === true, 'Should fill in missing torrent');
      assert(normalized.https === false, 'Should fill in missing https');
    });
  });

  describe('getServicesForProtocol', () => {
    test('should filter services by protocol support', () => {
      const services = [
        { id: '1', type: 'synology', name: 'Synology' },
        { id: '2', type: 'qbittorrent', name: 'qBittorrent' },
        { id: '3', type: 'aria2', name: 'Aria2' }
      ];

      const httpSupported = ServiceFilter.getServicesForProtocol(services, 'http');

      assert(httpSupported.length === 2, 'Only Synology and Aria2 should support HTTP');
      assert(httpSupported.some(s => s.type === 'synology'));
      assert(httpSupported.some(s => s.type === 'aria2'));
      assert(!httpSupported.some(s => s.type === 'qbittorrent'));
    });

    test('should return all services for magnet (all support it)', () => {
      const services = [
        { id: '1', type: 'synology' },
        { id: '2', type: 'qbittorrent' },
        { id: '3', type: 'transmission' },
        { id: '4', type: 'deluge' },
        { id: '5', type: 'aria2' }
      ];

      const magnetSupported = ServiceFilter.getServicesForProtocol(services, 'magnet');

      assert(magnetSupported.length === 5, 'All services should support magnet');
    });

    test('should return empty array for invalid input', () => {
      assert.deepStrictEqual(ServiceFilter.getServicesForProtocol(null, 'magnet'), []);
      assert.deepStrictEqual(ServiceFilter.getServicesForProtocol(undefined, 'magnet'), []);
      assert.deepStrictEqual(ServiceFilter.getServicesForProtocol('not-array', 'magnet'), []);
    });
  });

  describe('getCompatibleServices', () => {
    test('should filter by both protocol support AND user settings', () => {
      const services = [
        { id: '1', type: 'synology', name: 'Synology' },
        { id: '2', type: 'qbittorrent', name: 'qBittorrent' },
        { id: '3', type: 'aria2', name: 'Aria2' }
      ];

      // HTTP is supported by Synology and Aria2, but disabled by user
      const httpDisabled = ServiceFilter.getCompatibleServices(services, 'http', { http: false });
      assert(httpDisabled.length === 0, 'Should return empty when user disabled protocol');

      // Magnet is enabled and all support it
      const magnetEnabled = ServiceFilter.getCompatibleServices(services, 'magnet', { magnet: true });
      assert(magnetEnabled.length === 3, 'Should return all when protocol enabled');

      // HTTP enabled but only some support it
      const httpEnabled = ServiceFilter.getCompatibleServices(services, 'http', { http: true });
      assert(httpEnabled.length === 2, 'Should return only services that support HTTP');
      assert(httpEnabled.some(s => s.type === 'synology'));
      assert(httpEnabled.some(s => s.type === 'aria2'));
    });

    test('should use default settings when not provided', () => {
      const services = [
        { id: '1', type: 'synology', name: 'Synology' },
        { id: '2', type: 'qbittorrent', name: 'qBittorrent' }
      ];

      // Magnet is enabled by default
      const magnet = ServiceFilter.getCompatibleServices(services, 'magnet');
      assert(magnet.length === 2, 'Should use default settings (magnet enabled)');

      // HTTP is disabled by default
      const http = ServiceFilter.getCompatibleServices(services, 'http');
      assert(http.length === 0, 'Should use default settings (http disabled)');
    });
  });

  describe('hasCompatibleService', () => {
    test('should return true when compatible services exist', () => {
      const services = [
        { id: '1', type: 'synology' },
        { id: '2', type: 'qbittorrent' }
      ];

      // Magnet is enabled by default and all support it
      const hasMagnet = ServiceFilter.hasCompatibleService(services, 'magnet');
      assert(hasMagnet === true, 'Should return true for magnet');
    });

    test('should return false when protocol is disabled', () => {
      const services = [
        { id: '1', type: 'synology' },
        { id: '2', type: 'aria2' }
      ];

      // HTTP is disabled by default
      const hasHttp = ServiceFilter.hasCompatibleService(services, 'http', { http: false });
      assert(hasHttp === false, 'Should return false when protocol disabled');
    });

    test('should return false when no services support protocol', () => {
      const services = [
        { id: '1', type: 'qbittorrent' },
        { id: '2', type: 'transmission' }
      ];

      // FTP not supported by qBit/Transmission
      const hasFtp = ServiceFilter.hasCompatibleService(services, 'ftp', { ftp: true });
      assert(hasFtp === false, 'Should return false when no services support protocol');
    });

    test('should return false for empty service list', () => {
      const hasAny = ServiceFilter.hasCompatibleService([], 'magnet');
      assert(hasAny === false, 'Should return false for empty service list');
    });
  });

  describe('Real-world scenarios', () => {
    test('User has only qBittorrent, tries to download HTTP file', () => {
      const services = [
        { id: '1', type: 'qbittorrent', name: 'My qBit' }
      ];

      // HTTP enabled by user
      const compatible = ServiceFilter.getCompatibleServices(services, 'http', { http: true });
      assert(compatible.length === 0, 'qBittorrent does not support HTTP, should be empty');
    });

    test('User has Synology and qBittorrent, wants to download torrent', () => {
      const services = [
        { id: '1', type: 'synology', name: 'NAS' },
        { id: '2', type: 'qbittorrent', name: 'qBit' }
      ];

      // Torrent enabled (default)
      const compatible = ServiceFilter.getCompatibleServices(services, 'torrent');
      assert(compatible.length === 2, 'Both services support torrent');
    });

    test('User has Synology and Aria2, disabled all protocols except magnet', () => {
      const services = [
        { id: '1', type: 'synology', name: 'NAS' },
        { id: '2', type: 'aria2', name: 'Aria2' }
      ];

      const settings = {
        magnet: true,
        torrent: false,
        http: false,
        https: false,
        ftp: false
      };

      // Only magnet enabled
      assert(ServiceFilter.hasCompatibleService(services, 'magnet', settings) === true);
      assert(ServiceFilter.hasCompatibleService(services, 'torrent', settings) === false);
      assert(ServiceFilter.hasCompatibleService(services, 'http', settings) === false);
    });
  });
});
