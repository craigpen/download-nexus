// Shared download sending logic
// Handles communication between UI and background service adapters

(function() {
  if (!window.DownloadNexus) window.DownloadNexus = {};

  window.DownloadNexus.DownloadSender = {
    sendDownloadToService(url, nasId) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: "SEND_MAGNET", url, nasId },
          (resp) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (!resp?.ok) {
              reject(new Error(resp?.error || "Failed to send download"));
            } else {
              resolve(resp);
            }
          }
        );
      });
    },

    getNASList() {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "GET_NAS_LIST" }, (resp) => {
          resolve(resp?.list || []);
        });
      });
    },

    getWhitelist() {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "GET_WHITELIST" }, (resp) => {
          resolve({
            list: resp?.list || [],
            mode: resp?.mode || "disabled"
          });
        });
      });
    }
  };
})();
