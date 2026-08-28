// Unified link detection logic
// Identifies the type of download link and validates it

import { DOWNLOAD_EXTENSIONS } from "./protocols.js";

/**
 * Detect the type of a URL/link
 * @param {string} url - The URL to analyze
 * @returns {Object|null} - {type, url} or null if not a recognized download link
 */
export function detectLinkType(url) {
  if (!url || typeof url !== "string") return null;

  const lower = url.toLowerCase();

  // Magnet link
  if (lower.startsWith("magnet:")) {
    if (isValidMagnetURI(url)) {
      return { type: "magnet", url };
    }
    return null;
  }

  // Torrent file
  if (lower.endsWith(".torrent")) {
    if (isValidTorrentURL(url)) {
      return { type: "torrent", url };
    }
    return null;
  }

  // HTTP/HTTPS download (check file extension)
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    if (isDownloadUrl(url)) {
      const protocol = url.startsWith("https") ? "https" : "http";
      return { type: protocol, url };
    }
    return null;
  }

  // FTP
  if (lower.startsWith("ftp://")) {
    return { type: "ftp", url };
  }

  return null;
}

/**
 * Check if a magnet URI is valid
 * Must start with magnet:? and contain required parameters
 */
function isValidMagnetURI(url) {
  if (!url.startsWith("magnet:?")) return false;
  // Must have at least one of: xt (exact topic), dn (display name), or tr (tracker)
  return /[&?](xt|dn|tr)=/.test(url);
}

/**
 * Check if a URL points to a .torrent file
 */
function isValidTorrentURL(url) {
  try {
    const u = new URL(url);
    return /\.torrent(\?|$)/i.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Check if an HTTP(S) URL looks like a download (has download file extension)
 */
function isDownloadUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return DOWNLOAD_EXTENSIONS.some(ext => pathname.endsWith(`.${ext}`));
  } catch {
    return false;
  }
}

/**
 * Get a human-readable description of link type
 */
export function getLinkTypeLabel(linkType) {
  const labels = {
    magnet: "Magnet link",
    torrent: "Torrent file",
    http: "HTTP download",
    https: "HTTPS download",
    ftp: "FTP download"
  };
  return labels[linkType] || linkType;
}
