// Service filtering logic
// Determines which services can handle a specific link type and user settings

(function() {
  if (!window.DownloadNexus) window.DownloadNexus = {};

  window.DownloadNexus.ServiceFilter = {
    getCompatibleServices(linkType, nasList, enabledProtocols) {
      if (!nasList || !enabledProtocols) return [];

      if (!enabledProtocols[linkType]) return [];

      return nasList.filter(service =>
        window.DownloadNexus.Protocols.supportsProtocol(service.type, linkType)
      );
    },

    hasCompatibleService(linkType, nasList, enabledProtocols) {
      return this.getCompatibleServices(linkType, nasList, enabledProtocols).length > 0;
    },

    getDefaultProtocolSettings() {
      return {
        magnet: true,
        torrent: true,
        otherFileTypes: false
      };
    },

    normalizeProtocolSettings(settings) {
      const defaults = this.getDefaultProtocolSettings();
      return Object.assign({}, defaults, settings || {});
    }
  };
})();
