# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.9] - 2026-08-27

### Added
- Full multi-service support: qBittorrent, Transmission, and Deluge now fully supported alongside Synology
- Intelligent error detection for Deluge password change prompts with user-friendly guidance
- Improved button UI with better icon rendering and responsiveness

### Fixed
- Fixed download button positioning when scrolling pages
- Improved popup menu usability and click handling
- Fixed Deluge authentication flow with proper password validation
- Corrected browser header handling for qBittorrent API compatibility
- Fixed SEND_MAGNET message handler routing
- Fixed qBittorrent response parsing for both "Ok" and JSON responses
- Handle 409 Conflict as success when torrent already exists

### Changed
- Updated extension description and README to reflect all supported download services
- Refactored download button styling with embedded icon data URI
- Improved popup menu architecture with better positioning

## [1.1.8] - Previous Release

See git history for details of earlier versions.
