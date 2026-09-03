# Testing Guide

Complete test suite for Download Nexus covering unit tests, integration tests, and adapter validation.

## Quick Start

```bash
# Run all unit tests (no Docker required)
npm run test:unit

# Run all tests (requires Docker containers)
npm test

# Watch mode for development
npm run test:watch
```

## Test Suites

### Unit Tests (✅ All Passing)

These tests run without any external dependencies.

#### 1. Adapter Tests (`tests/adapters.test.js`) - 45 tests
- **SynologyAdapter** (4 tests)
  - Configuration validation
  - Incomplete config detection
  - Task data mapping
  - Action parameter construction

- **QBittorrentAdapter** (11 tests)
  - Configuration validation
  - API token authentication
  - Torrent state mapping
  - Task action handling

- **TransmissionAdapter** (5 tests)
  - Configuration validation  
  - State mapping to unified format
  - RPC URL construction
  - Task action mapping

- **DelugeAdapter** (10 tests)
  - Configuration validation
  - Password-only authentication
  - State mapping
  - Magnet vs torrent file handling
  - HTTPS/HTTP support

- **JDownloaderAdapter** (10 tests)
  - Configuration validation
  - Local API connectivity
  - State mapping
  - Task data mapping
  - Download management

- **Adapter Pattern** (5 tests)
  - Consistent interface across all adapters
  - Factory pattern (getAdapter)
  - Protocol support matrix
  - Service routing

#### 2. Link Detector Tests (`tests/linkDetector.test.js`) - 30 tests
Tests protocol detection and link type classification.

**Supported Protocols:**
- Magnet links (with btih validation)
- Torrent files (.torrent URLs)
- HTTP downloads
- HTTPS downloads  
- FTP downloads

**Test Coverage:**
- Protocol detection (5 tests)
- Invalid magnet detection
- Torrent vs HTTP distinction
- Unsupported protocol rejection
- Null/undefined/empty input handling
- Non-string input handling
- Label generation
- Magnet link validation
- Torrent URL validation
- URL edge cases (query params, fragments, case sensitivity, URL encoding, very long URLs)

#### 3. Service Filter Tests (`tests/serviceFilter.test.js`) - 38 tests
Tests protocol filtering and service compatibility.

**Protocol Support Matrix:**
| Service | Magnet | Torrent | HTTP | HTTPS | FTP |
|---------|--------|---------|------|-------|-----|
| Synology | ✅ | ✅ | ✅ | ✅ | ✅ |
| qBittorrent | ✅ | ✅ | ❌ | ❌ | ❌ |
| Transmission | ✅ | ✅ | ❌ | ❌ | ❌ |
| Deluge | ✅ | ✅ | ❌ | ❌ | ❌ |
| JDownloader 2 | ✅ | ✅ | ✅ | ✅ | ✅ |

**Test Coverage:**
- Protocol support validation
- Default settings (magnet/torrent enabled, HTTP/HTTPS/FTP disabled)
- Settings normalization
- Service filtering by protocol
- User preference integration
- Compatibility checking
- Real-world scenarios

#### 4. Background Tests (`tests/background.test.js`) - 29 tests
Tests message handlers and context menu functionality.

**Message Handlers:**
- TEST_CONNECTION: Validates service configuration
- LIST_TASKS: Retrieves download list
- TASK_ACTION: Pause/resume/delete downloads
- ADD_WHITELIST: Manages content script whitelist

**Context Menu:**
- Menu creation and validation
- Service submenu generation
- Menu item ordering

**Test Coverage:**
- Valid/invalid settings detection
- Service existence validation
- Error message consistency
- Sensitive information protection

### Integration Tests

Requires Docker containers running for each service.

#### Transmission Integration (`tests/transmission-integration.test.js`)
```bash
npm run test:transmission
# Requires: docker run -d -p 6969:6969 linuxserver/transmission:latest
```

#### Deluge Integration (`tests/deluge-integration.test.js`)
```bash
npm run test:deluge
# Requires: docker run -d -p 8112:8112 linuxserver/deluge:latest
```

**Integration Test Coverage:**
- Connection and authentication
- Adding downloads (magnet, HTTP, torrent)
- Listing active/waiting/stopped downloads
- Task actions (pause, resume, delete)
- Data format consistency
- Error handling
- Edge cases (invalid IDs, malformed requests)

#### General Integration (`tests/integration.test.js`)
```bash
npm run test:integration
# Requires: docker run -d -p 8080:8080 linuxserver/qbittorrent:latest
```

## Test Commands Reference

```bash
# Unit Tests (No Docker)
npm run test:unit              # All unit tests
npm run test:adapters         # Adapter tests only
npm run test:link-detector    # Link detector tests only
npm run test:service-filter   # Service filter tests only
npm run test:background       # Background handler tests only
npm run test:crypto           # Encryption tests only

# Integration Tests (Requires Docker)
npm run test:integration      # qBittorrent integration
npm run test:transmission     # Transmission integration
npm run test:deluge           # Deluge integration
npm run test:integration:all  # All integration tests

# All Tests
npm test                       # Run entire test suite
npm run test:all              # Same as npm test
npm run test:watch            # Watch mode for development
```

## Docker Setup for Integration Tests

### Quick Setup (All Services)

```bash
# Start all services at once
docker-compose up -d

# Run all integration tests
npm run test:integration:all

# Cleanup
docker-compose down
```

### Individual Service Setup

```bash
# qBittorrent (port 8080)
docker run -d -p 8080:8080 \
  -e PUID=1000 -e PGID=1000 \
  linuxserver/qbittorrent:latest

# Transmission (port 9091)
docker run -d -p 9091:9091 \
  -e PUID=1000 -e PGID=1000 \
  linuxserver/transmission:latest

# Deluge (port 8112)
docker run -d -p 8112:8112 \
  -e PUID=1000 -e PGID=1000 \
  linuxserver/deluge:latest

# JDownloader 2 (runs locally as desktop application)
# No Docker container needed - uses local API on port 3129
```

## Test Statistics

**Total Tests: 150+**

- Unit Tests: 120+ ✅
- Integration Tests: ~20 each (varies by service)
- Suites: 9 (6 unit + 3 integration)

**Coverage Areas:**
- ✅ Adapter implementations (all 5 services)
- ✅ Protocol detection and filtering
- ✅ Message handlers and RPC communication
- ✅ Service compatibility matrix
- ✅ Error handling and validation
- ✅ Configuration management
- ✅ Context menu functionality
- ✅ Credential encryption/decryption
- ✅ Real-world user scenarios

## Adding New Tests

### For a New Adapter

1. Add unit tests to `tests/adapters.test.js`
2. Create `tests/{adapter}-integration.test.js` for integration tests
3. Add test script to `package.json`: `"test:{adapter}": "jest tests/{adapter}-integration.test.js"`

### For Protocol or Feature Changes

1. Update relevant test file (linkDetector, serviceFilter, etc.)
2. Ensure all existing tests still pass
3. Run: `npm run test:unit` to verify

## Continuous Integration

The test suite is designed to run in CI/CD pipelines:

```bash
# In CI environment (without Docker)
npm run test:unit

# In full test environment (with Docker)
npm test
```

## Troubleshooting

### Tests Timeout
- Integration tests may timeout if Docker containers are slow to start
- Increase Jest timeout: `jest --testTimeout=10000`

### Docker Connection Refused
- Ensure Docker containers are running: `docker ps`
- Check port mappings: `docker ps --format "table {{.Ports}}"`
- Restart containers: `docker-compose restart`

### Port Already in Use
- Check what's using the port: `lsof -i :PORT_NUMBER`
- Stop the service or use different ports in docker-compose.yml

## Test Maintenance

- Unit tests should run in < 1 second
- Integration tests should run in < 5 seconds per service
- New features should have corresponding tests before merge
- Tests should be updated when APIs change
