// Shared download sending logic
// Handles communication between UI and background service adapters

/**
 * Send a download URL to a service
 * @param {string} url - The download URL (magnet, torrent, http, etc.)
 * @param {string} nasId - The service ID to send to
 * @returns {Promise} - Resolves to response from background, rejects on error
 */
export function sendDownloadToService(url, nasId) {
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
}

/**
 * Get list of configured NAS services
 * @returns {Promise<Array>} - List of services
 */
export function getNASList() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_NAS_LIST" }, (resp) => {
      resolve(resp?.list || []);
    });
  });
}

/**
 * Get whitelist configuration
 * @returns {Promise<Object>} - {list, mode}
 */
export function getWhitelist() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_WHITELIST" }, (resp) => {
      resolve({
        list: resp?.list || [],
        mode: resp?.mode || "disabled"
      });
    });
  });
}
