// Service filtering logic
// Determines which services can handle a specific link type and user settings

import { supportsProtocol } from "./protocols.js";

/**
 * Get services compatible with a link type, respecting user settings
 * @param {string} linkType - The detected link type (magnet, torrent, http, etc.)
 * @param {Array} nasList - List of available NAS services
 * @param {Object} enabledProtocols - User settings for which protocols to show buttons for
 * @returns {Array} - List of compatible services
 */
export function getCompatibleServices(linkType, nasList, enabledProtocols) {
  if (!nasList || !enabledProtocols) return [];

  // Check if user has enabled buttons for this protocol
  if (!enabledProtocols[linkType]) return [];

  // Filter to services that support this protocol
  return nasList.filter(service =>
    supportsProtocol(service.type, linkType)
  );
}

/**
 * Check if any service can handle this link type
 */
export function hasCompatibleService(linkType, nasList, enabledProtocols) {
  return getCompatibleServices(linkType, nasList, enabledProtocols).length > 0;
}

/**
 * Get default protocol settings (all protocols enabled for services that support them)
 */
export function getDefaultProtocolSettings() {
  return {
    magnet: true,
    torrent: true,
    http: false,      // Disabled by default (only Synology + aria2 support)
    https: false,     // Disabled by default
    ftp: false        // Disabled by default
  };
}

/**
 * Validate and normalize protocol settings
 */
export function normalizeProtocolSettings(settings) {
  const defaults = getDefaultProtocolSettings();
  return {
    ...defaults,
    ...(settings || {})
  };
}
