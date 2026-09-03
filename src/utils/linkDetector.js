// Unified link detection logic
// Identifies the type of download link and validates it

(function() {
  if (!window.DownloadNexus) window.DownloadNexus = {};

  function isValidMagnetURI(url) {
    if (!url.startsWith("magnet:?")) return false;
    return /[&?](xt|dn|tr)=/.test(url);
  }

  function isValidTorrentURL(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return false;
      return /\.torrent(\?|$)/i.test(u.pathname);
    } catch {
      return false;
    }
  }

  function isDownloadUrl(url) {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      const ext = window.DownloadNexus.Protocols.DOWNLOAD_EXTENSIONS;
      return ext.some(e => pathname.endsWith(`.${e}`));
    } catch {
      return false;
    }
  }

  window.DownloadNexus.LinkDetector = {
    detectLinkType(url) {
      if (!url || typeof url !== "string") return null;

      const lower = url.toLowerCase();

      if (lower.startsWith("magnet:")) {
        if (isValidMagnetURI(url)) {
          return { type: "magnet", url };
        }
        return null;
      }

      if ((lower.startsWith("http://") || lower.startsWith("https://")) && isValidTorrentURL(url)) {
        return { type: "torrent", url };
      }

      if (lower.startsWith("http://") || lower.startsWith("https://")) {
        if (isDownloadUrl(url)) {
          const protocol = url.startsWith("https") ? "https" : "http";
          return { type: protocol, url };
        }
        return null;
      }

      if (lower.startsWith("ftp://")) {
        return { type: "ftp", url };
      }

      return null;
    },

    getLinkTypeLabel(linkType) {
      const labels = {
        magnet: "Magnet link",
        torrent: "Torrent file",
        http: "HTTP download",
        https: "HTTPS download",
        ftp: "FTP download"
      };
      return labels[linkType] || linkType;
    }
  };
})();
