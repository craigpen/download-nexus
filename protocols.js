// Protocol support matrix and configuration
// Single source of truth for which services support which protocols

export const PROTOCOL_SUPPORT = {
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
};

// Common file extensions for downloads (no leading dot)
export const DOWNLOAD_EXTENSIONS = [
  // Archives
  "zip", "rar", "7z", "tar", "gz", "bz2", "xz",
  // Disk images
  "iso", "img", "dmg",
  // Executables
  "exe", "msi", "pkg", "deb", "rpm",
  // Documents
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  // Media
  "mp4", "mkv", "avi", "mov", "flv", "wmv", "webm", "m4v",
  "mp3", "m4a", "flac", "wav", "aac", "ogg",
  // Other
  "apk", "jar", "bin", "dat"
];

// Get protocol support for a service type
export function getServiceProtocols(serviceType) {
  const info = PROTOCOL_SUPPORT[serviceType];
  return info ? info.protocols : [];
}

// Check if service supports protocol
export function supportsProtocol(serviceType, protocol) {
  const protocols = getServiceProtocols(serviceType);
  return protocols.includes(protocol);
}

// Get all services that support a protocol
export function getServicesForProtocol(protocol, serviceList) {
  return serviceList.filter(service =>
    supportsProtocol(service.type, protocol)
  );
}
