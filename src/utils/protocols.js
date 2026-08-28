// Protocol support matrix and configuration
// Single source of truth for which services support which protocols

(function() {
  if (!window.DownloadNexus) window.DownloadNexus = {};

  const PROTOCOL_SUPPORT = {
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

  const DOWNLOAD_EXTENSIONS = [
    "zip", "rar", "7z", "tar", "gz", "bz2", "xz",
    "iso", "img", "dmg",
    "exe", "msi", "pkg", "deb", "rpm",
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "mp4", "mkv", "avi", "mov", "flv", "wmv", "webm", "m4v",
    "mp3", "m4a", "flac", "wav", "aac", "ogg",
    "apk", "jar", "bin", "dat"
  ];

  window.DownloadNexus.Protocols = {
    PROTOCOL_SUPPORT,
    DOWNLOAD_EXTENSIONS,

    getServiceProtocols(serviceType) {
      const info = PROTOCOL_SUPPORT[serviceType];
      return info ? info.protocols : [];
    },

    supportsProtocol(serviceType, protocol) {
      const protocols = this.getServiceProtocols(serviceType);
      return protocols.includes(protocol);
    },

    getServicesForProtocol(protocol, serviceList) {
      return serviceList.filter(service =>
        this.supportsProtocol(service.type, protocol)
      );
    }
  };
})();
