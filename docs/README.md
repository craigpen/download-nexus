# Download Nexus Documentation

Complete documentation for Download Nexus developers and users.

## Quick Links

### For Developers

- **[API Reference](API_REFERENCE.md)** - Official API docs for all supported download services
- **[Testing Guide](TESTING.md)** - Comprehensive test setup and running tests
- **[Architecture](../README.md)** - Project structure and design decisions

### For Users

- **[Main README](../README.md)** - Installation, features, and usage

## Supported Services

### Download Managers
- [Synology DownloadStation](API_REFERENCE.md#synology-downloadstation)
- [qBittorrent](API_REFERENCE.md#qbittorrent-webui-api)
- [Transmission](API_REFERENCE.md#transmission-rpc-api)
- [Deluge](API_REFERENCE.md#deluge-json-rpc-api)
- [Aria2](API_REFERENCE.md#aria2-json-rpc-api)

### Protocols
- ✅ Magnet links
- ✅ Torrent files (.torrent)
- ✅ HTTP/HTTPS downloads (Synology, Aria2 only)
- ✅ FTP downloads (Synology, Aria2 only)

## Development

### Getting Started

1. Clone the repo
2. Install dependencies: `npm install`
3. Start Docker containers: `docker-compose up -d`
4. Run tests: `npm test`
5. Build extension: `npm run package`

### Project Structure

```
/src                    # Extension source files
  /utils              # Utility modules (protocols, link detection, etc)
  background.js       # Background service worker
  content.js          # Content script (page injection)
  popup.js            # Popup UI logic
  popup.html          # Popup UI markup
  manifest.json       # Extension manifest

/scripts              # Build and tool scripts
  build.js            # Package builder
  create-zip.js       # ZIP archive creator

/tests                # Test suite
  /adapters.test.js           # Adapter unit tests (113 tests)
  /*-integration.test.js       # Service integration tests

/docs                 # Documentation
  README.md           # This file
  API_REFERENCE.md    # API documentation for all services
  TESTING.md          # Testing guide and setup

/dist                 # Build output (generated)
  /chrome-mv3         # Chrome extension build
  /firefox-mv3        # Firefox extension build
```

### Running Tests

```bash
# Unit tests (no Docker required)
npm run test:unit              # 113 unit tests

# Integration tests (requires Docker)
npm run test:integration       # qBittorrent
npm run test:transmission      # Transmission
npm run test:deluge            # Deluge
npm run test:aria2             # Aria2

# All tests
npm test
```

### Building

```bash
# Build for all browsers
npm run package

# Build specific browser
npm run build:chrome
npm run build:firefox

# Create distribution zips
npm run zip
```

## API Documentation

See [API_REFERENCE.md](API_REFERENCE.md) for:
- Official API links for each service
- Key endpoints and methods
- Authentication requirements
- Protocol support matrix
- Standard task data format
- Implementation patterns

## Testing

See [TESTING.md](TESTING.md) for:
- Complete test suite overview (194 tests)
- Test setup and Docker configuration
- How to run tests
- Adding tests for new features
- Test coverage details

## Contributing

When adding a new download service:

1. Create adapter class in [src/background.js](../src/background.js)
2. Add unit tests to [tests/adapters.test.js](../tests/adapters.test.js)
3. Create integration tests in [tests/{service}-integration.test.js](../tests/)
4. Update UI in [src/popup.html](../src/popup.html) and [src/popup.js](../src/popup.js)
5. Document the service in [API_REFERENCE.md](API_REFERENCE.md)

See [TESTING.md](TESTING.md#adding-new-tests) for detailed testing requirements.

## Resources

- **GitHub:** https://github.com/craigpen/download-nexus
- **Issues:** https://github.com/craigpen/download-nexus/issues
- **Chrome Store:** https://chrome.google.com/webstore/
- **Firefox Store:** https://addons.mozilla.org/

## License

GPL-3.0 License - See [LICENSE](../LICENSE)

---

**Last Updated:** August 2026
