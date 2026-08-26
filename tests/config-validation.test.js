/**
 * Config Validation Test Suite (P1-5)
 * Verifies import schema validation prevents corrupted configs
 */

const assert = require('assert');

// Mock validation functions (actual implementation in popup.js)
const VALID_ADAPTER_TYPES = new Set(['synology', 'qbittorrent', 'transmission', 'deluge']);

function isValidDomainPattern(pattern) {
  if (pattern === "*") return true;
  if (pattern.startsWith("*.")) {
    const domain = pattern.slice(2);
    return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(domain);
  }
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(pattern);
}

function validateNasConfig(nas, index) {
  const errors = [];

  if (!nas.id || typeof nas.id !== 'string') {
    errors.push(`Device ${index}: missing or invalid id`);
  }
  if (!nas.name || typeof nas.name !== 'string') {
    errors.push(`Device ${index}: missing or invalid name`);
  }
  if (!nas.type || !VALID_ADAPTER_TYPES.has(nas.type)) {
    errors.push(`Device ${index}: invalid type "${nas.type}" (must be synology, qbittorrent, transmission, or deluge)`);
  }
  if (!nas.host || typeof nas.host !== 'string') {
    errors.push(`Device ${index}: missing or invalid host`);
  }
  if (!nas.port || (typeof nas.port !== 'number' && typeof nas.port !== 'string')) {
    errors.push(`Device ${index}: missing or invalid port`);
  }

  const port = typeof nas.port === 'string' ? parseInt(nas.port) : nas.port;
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push(`Device ${index}: port must be between 1 and 65535`);
  }

  if (nas.password !== undefined && typeof nas.password !== 'string') {
    errors.push(`Device ${index}: password must be a string`);
  }
  if (nas.username !== undefined && typeof nas.username !== 'string') {
    errors.push(`Device ${index}: username must be a string`);
  }
  if (nas.destination !== undefined && typeof nas.destination !== 'string') {
    errors.push(`Device ${index}: destination must be a string`);
  }
  if (nas.https !== undefined && typeof nas.https !== 'boolean') {
    errors.push(`Device ${index}: https must be a boolean`);
  }
  if (nas.apiToken !== undefined && typeof nas.apiToken !== 'string') {
    errors.push(`Device ${index}: apiToken must be a string`);
  }

  return errors;
}

function validateConfigSchema(config) {
  const errors = [];

  if (config.version === undefined) {
    errors.push("Missing version field");
  } else if (config.version !== 1) {
    errors.push(`Unsupported config version: ${config.version} (expected 1)`);
  }

  if (config.nasList !== undefined) {
    if (!Array.isArray(config.nasList)) {
      errors.push("nasList must be an array");
    } else if (config.nasList.length > 0) {
      config.nasList.forEach((nas, i) => {
        if (typeof nas !== 'object' || nas === null) {
          errors.push(`nasList[${i}]: must be an object`);
        } else {
          errors.push(...validateNasConfig(nas, i));
        }
      });
    }
  }

  if (config.whitelist !== undefined) {
    if (!Array.isArray(config.whitelist)) {
      errors.push("whitelist must be an array");
    } else {
      config.whitelist.forEach((domain, i) => {
        if (typeof domain !== 'string') {
          errors.push(`whitelist[${i}]: must be a string`);
        } else if (!isValidDomainPattern(domain)) {
          errors.push(`whitelist[${i}]: invalid domain pattern "${domain}"`);
        }
      });
    }
  }

  if (config.whitelistMode !== undefined) {
    if (!['all', 'restricted'].includes(config.whitelistMode)) {
      errors.push(`whitelistMode must be "all" or "restricted", got "${config.whitelistMode}"`);
    }
  }

  return errors;
}

describe('Config Validation (P1-5)', () => {
  describe('NAS Device Validation', () => {
    test('should accept valid NAS config', () => {
      const validNas = {
        id: 'qb-1',
        name: 'qBittorrent',
        type: 'qbittorrent',
        host: '192.168.1.100',
        port: 8080,
        username: 'admin',
        password: 'pass123'
      };

      const errors = validateNasConfig(validNas, 0);
      assert(errors.length === 0, `Expected no errors, got: ${errors.join(', ')}`);
    });

    test('should accept valid NAS config with token auth', () => {
      const validNas = {
        id: 'qb-2',
        name: 'qBittorrent',
        type: 'qbittorrent',
        host: '192.168.1.100',
        port: 8080,
        apiToken: 'token123'
      };

      const errors = validateNasConfig(validNas, 0);
      assert(errors.length === 0, `Expected no errors, got: ${errors.join(', ')}`);
    });

    test('should reject missing id', () => {
      const invalidNas = {
        name: 'qBittorrent',
        type: 'qbittorrent',
        host: '192.168.1.100',
        port: 8080
      };

      const errors = validateNasConfig(invalidNas, 0);
      assert(errors.some(e => e.includes('id')), 'Should reject missing id');
    });

    test('should reject invalid type', () => {
      const invalidNas = {
        id: 'qb-1',
        name: 'qBittorrent',
        type: 'invalid-service',
        host: '192.168.1.100',
        port: 8080
      };

      const errors = validateNasConfig(invalidNas, 0);
      assert(errors.some(e => e.includes('invalid type')), 'Should reject invalid adapter type');
    });

    test('should reject port out of range', () => {
      const invalidNas = {
        id: 'qb-1',
        name: 'qBittorrent',
        type: 'qbittorrent',
        host: '192.168.1.100',
        port: 99999
      };

      const errors = validateNasConfig(invalidNas, 0);
      assert(errors.some(e => e.includes('65535')), 'Should reject port > 65535');
    });

    test('should reject port as invalid string', () => {
      const invalidNas = {
        id: 'qb-1',
        name: 'qBittorrent',
        type: 'qbittorrent',
        host: '192.168.1.100',
        port: 'not-a-port'
      };

      const errors = validateNasConfig(invalidNas, 0);
      assert(errors.some(e => e.includes('port')), 'Should reject invalid port');
    });

    test('should reject wrong field types', () => {
      const invalidNas = {
        id: 'qb-1',
        name: 'qBittorrent',
        type: 'qbittorrent',
        host: '192.168.1.100',
        port: 8080,
        https: 'yes' // should be boolean
      };

      const errors = validateNasConfig(invalidNas, 0);
      assert(errors.some(e => e.includes('https')), 'Should reject non-boolean https');
    });
  });

  describe('Full Config Schema Validation', () => {
    test('should accept valid complete config', () => {
      const validConfig = {
        version: 1,
        nasList: [
          {
            id: 'qb-1',
            name: 'qBittorrent',
            type: 'qbittorrent',
            host: '192.168.1.100',
            port: 8080,
            username: 'admin',
            password: 'pass123'
          }
        ],
        whitelist: ['example.com', '*.torrent-site.org'],
        whitelistMode: 'restricted'
      };

      const errors = validateConfigSchema(validConfig);
      assert(errors.length === 0, `Expected no errors, got: ${errors.join(', ')}`);
    });

    test('should accept minimal valid config', () => {
      const validConfig = {
        version: 1
      };

      const errors = validateConfigSchema(validConfig);
      assert(errors.length === 0, `Expected no errors, got: ${errors.join(', ')}`);
    });

    test('should reject missing version', () => {
      const invalidConfig = {
        nasList: []
      };

      const errors = validateConfigSchema(invalidConfig);
      assert(errors.some(e => e.includes('version')), 'Should reject missing version');
    });

    test('should reject unsupported version', () => {
      const invalidConfig = {
        version: 2,
        nasList: []
      };

      const errors = validateConfigSchema(invalidConfig);
      assert(errors.some(e => e.includes('version') && e.includes('2')), 'Should reject version 2');
    });

    test('should reject non-array nasList', () => {
      const invalidConfig = {
        version: 1,
        nasList: { id: 'qb-1' }
      };

      const errors = validateConfigSchema(invalidConfig);
      assert(errors.some(e => e.includes('nasList') && e.includes('array')), 'Should reject non-array nasList');
    });

    test('should reject invalid whitelist domain patterns', () => {
      const invalidConfig = {
        version: 1,
        whitelist: ['example.com', 'invalid..domain']
      };

      const errors = validateConfigSchema(invalidConfig);
      assert(errors.some(e => e.includes('whitelist') && e.includes('invalid')), 'Should reject invalid domain');
    });

    test('should accept whitelist wildcard', () => {
      const validConfig = {
        version: 1,
        whitelist: ['*']
      };

      const errors = validateConfigSchema(validConfig);
      assert(!errors.some(e => e.includes('whitelist')), 'Should accept * in whitelist');
    });

    test('should accept whitelist subdomain wildcard', () => {
      const validConfig = {
        version: 1,
        whitelist: ['*.example.com']
      };

      const errors = validateConfigSchema(validConfig);
      assert(!errors.some(e => e.includes('whitelist')), 'Should accept *.example.com in whitelist');
    });

    test('should reject invalid whitelistMode', () => {
      const invalidConfig = {
        version: 1,
        whitelistMode: 'permissive'
      };

      const errors = validateConfigSchema(invalidConfig);
      assert(errors.some(e => e.includes('whitelistMode')), 'Should reject invalid whitelistMode');
    });

    test('should accumulate multiple validation errors', () => {
      const invalidConfig = {
        version: 2,
        nasList: [
          {
            id: 'qb-1',
            name: 'qBittorrent',
            type: 'invalid',
            port: 99999
          }
        ],
        whitelist: ['invalid..domain'],
        whitelistMode: 'invalid'
      };

      const errors = validateConfigSchema(invalidConfig);
      assert(errors.length > 1, 'Should report multiple errors');
      assert(errors.some(e => e.includes('version')), 'Should include version error');
      assert(errors.some(e => e.includes('type')), 'Should include type error');
      assert(errors.some(e => e.includes('port')), 'Should include port error');
      assert(errors.some(e => e.includes('whitelist')), 'Should include whitelist error');
      assert(errors.some(e => e.includes('whitelistMode')), 'Should include whitelistMode error');
    });
  });
});
