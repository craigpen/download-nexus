/**
 * Real-world Config Validation Scenarios (P1-5)
 * Tests that would prevent actual import errors
 */

const assert = require('assert');

// Validation functions
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
  if (!nas.id || typeof nas.id !== 'string') errors.push(`Device ${index}: missing or invalid id`);
  if (!nas.name || typeof nas.name !== 'string') errors.push(`Device ${index}: missing or invalid name`);
  if (!nas.type || !VALID_ADAPTER_TYPES.has(nas.type)) errors.push(`Device ${index}: invalid type "${nas.type}"`);
  if (!nas.host || typeof nas.host !== 'string') errors.push(`Device ${index}: missing or invalid host`);
  if (!nas.port || (typeof nas.port !== 'number' && typeof nas.port !== 'string')) errors.push(`Device ${index}: missing or invalid port`);
  const port = typeof nas.port === 'string' ? parseInt(nas.port) : nas.port;
  if (isNaN(port) || port < 1 || port > 65535) errors.push(`Device ${index}: port must be between 1 and 65535`);
  if (nas.password !== undefined && typeof nas.password !== 'string') errors.push(`Device ${index}: password must be a string`);
  if (nas.username !== undefined && typeof nas.username !== 'string') errors.push(`Device ${index}: username must be a string`);
  if (nas.destination !== undefined && typeof nas.destination !== 'string') errors.push(`Device ${index}: destination must be a string`);
  if (nas.https !== undefined && typeof nas.https !== 'boolean') errors.push(`Device ${index}: https must be a boolean`);
  if (nas.apiToken !== undefined && typeof nas.apiToken !== 'string') errors.push(`Device ${index}: apiToken must be a string`);
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

describe('Real-world Config Validation Scenarios (P1-5)', () => {
  test('Scenario 1: Corrupted export with typo in adapter type', () => {
    // User edited config file manually, typo in adapter type
    const corrupted = {
      version: 1,
      nasList: [
        {
          id: 'qb-1',
          name: 'qBittorrent',
          type: 'qbittoremt',  // TYPO: should be "qbittorrent"
          host: '192.168.1.100',
          port: 8080,
          username: 'admin'
        }
      ]
    };

    const errors = validateConfigSchema(corrupted);
    assert(errors.some(e => e.includes('qbittoremt')), 'Should catch typo in adapter type');
  });

  test('Scenario 2: Corrupted export with port as string number', () => {
    // Port accidentally converted to string by JSON editor
    const corrupted = {
      version: 1,
      nasList: [
        {
          id: 'qb-1',
          name: 'qBittorrent',
          type: 'qbittorrent',
          host: '192.168.1.100',
          port: '8080',  // Should work - string numbers are converted
          username: 'admin'
        }
      ]
    };

    const errors = validateConfigSchema(corrupted);
    assert(errors.length === 0, 'Should accept port as string number');
  });

  test('Scenario 3: Corrupted export with missing required device fields', () => {
    // Partial export missing host
    const corrupted = {
      version: 1,
      nasList: [
        {
          id: 'qb-1',
          name: 'qBittorrent',
          type: 'qbittorrent',
          // Missing: host, port
          username: 'admin'
        }
      ]
    };

    const errors = validateConfigSchema(corrupted);
    assert(errors.length > 1, 'Should report multiple missing fields');
    assert(errors.some(e => e.includes('host')), 'Should catch missing host');
    assert(errors.some(e => e.includes('port')), 'Should catch missing port');
  });

  test('Scenario 4: Corrupted export with invalid whitelist entry', () => {
    // Someone manually added invalid domains
    const corrupted = {
      version: 1,
      whitelist: [
        'example.com',      // Valid
        '..invalid',        // INVALID: starts with dots
        'site-name.org',    // Valid
        'space in domain'   // INVALID: spaces not allowed
      ]
    };

    const errors = validateConfigSchema(corrupted);
    assert(errors.some(e => e.includes('invalid')), 'Should catch invalid domain patterns');
    assert(errors.length >= 2, 'Should report all invalid domains');
  });

  test('Scenario 5: Export from old version', () => {
    // Config from a future version (version 2)
    const future = {
      version: 2,
      nasList: [
        {
          id: 'qb-1',
          name: 'qBittorrent',
          type: 'qbittorrent',
          host: '192.168.1.100',
          port: 8080,
          username: 'admin'
        }
      ]
    };

    const errors = validateConfigSchema(future);
    assert(errors.some(e => e.includes('version')), 'Should reject future version');
  });

  test('Scenario 6: Corrupted nasList is an object instead of array', () => {
    // File corruption converted array to object
    const corrupted = {
      version: 1,
      nasList: {
        'qb-1': {
          name: 'qBittorrent',
          type: 'qbittorrent',
          host: '192.168.1.100',
          port: 8080
        }
      }
    };

    const errors = validateConfigSchema(corrupted);
    assert(errors.some(e => e.includes('array')), 'Should catch nasList is not array');
  });

  test('Scenario 7: Valid config with all optional fields should pass', () => {
    // Complete valid config with all fields filled
    const valid = {
      version: 1,
      nasList: [
        {
          id: 'syn-1',
          name: 'Main NAS',
          type: 'synology',
          host: '192.168.1.50',
          port: 5000,
          https: true,
          username: 'admin',
          password: 'password123',
          destination: '/volume1/downloads'
        },
        {
          id: 'qb-1',
          name: 'qBittorrent',
          type: 'qbittorrent',
          host: '192.168.1.100',
          port: 8080,
          https: false,
          apiToken: 'token123'
        }
      ],
      whitelist: ['example.com', '*.torrent-site.org', '*'],
      whitelistMode: 'restricted'
    };

    const errors = validateConfigSchema(valid);
    assert(errors.length === 0, `Should accept valid config, got errors: ${errors.join(', ')}`);
  });

  test('Scenario 8: Port out of valid range', () => {
    // Port values outside 1-65535
    const invalid1 = {
      version: 1,
      nasList: [{
        id: 'qb-1',
        name: 'qBittorrent',
        type: 'qbittorrent',
        host: '192.168.1.100',
        port: 0,  // Too low
        username: 'admin'
      }]
    };

    const invalid2 = {
      version: 1,
      nasList: [{
        id: 'qb-1',
        name: 'qBittorrent',
        type: 'qbittorrent',
        host: '192.168.1.100',
        port: 65536,  // Too high
        username: 'admin'
      }]
    };

    const errors1 = validateConfigSchema(invalid1);
    const errors2 = validateConfigSchema(invalid2);
    assert(errors1.some(e => e.includes('65535')), 'Should reject port 0');
    assert(errors2.some(e => e.includes('65535')), 'Should reject port 65536');
  });

  test('Scenario 9: Corrupted boolean field (https as string)', () => {
    // HTTPS field converted to string "true" instead of boolean true
    const corrupted = {
      version: 1,
      nasList: [{
        id: 'qb-1',
        name: 'qBittorrent',
        type: 'qbittorrent',
        host: '192.168.1.100',
        port: 8080,
        https: 'true',  // String instead of boolean
        username: 'admin'
      }]
    };

    const errors = validateConfigSchema(corrupted);
    assert(errors.some(e => e.includes('https')), 'Should reject string boolean');
  });

  test('Scenario 10: Empty but valid config', () => {
    // Minimal config with no devices or whitelist
    const minimal = {
      version: 1
    };

    const errors = validateConfigSchema(minimal);
    assert(errors.length === 0, 'Should accept minimal config');
  });
});
