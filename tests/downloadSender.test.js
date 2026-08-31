/**
 * Download Sender Test Suite
 * Tests messaging and communication with background service
 */

const assert = require('assert');

// Mock Chrome API for testing
let mockRuntimeError = null;
let mockLastError = null;
let messageResponses = {};

const chrome = {
  runtime: {
    get lastError() {
      return mockLastError;
    },
    sendMessage(message, callback) {
      // Simulate async behavior
      setTimeout(() => {
        if (mockRuntimeError) {
          mockLastError = { message: mockRuntimeError };
          callback(undefined);
        } else {
          mockLastError = null;
          const response = messageResponses[message.type] || { ok: false, error: 'Unknown message type' };
          callback(response);
        }
      }, 0);
    }
  }
};

// Mock DownloadNexus namespace
const window = { DownloadNexus: {} };

// Mock implementation of DownloadSender
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

describe('Download Sender', () => {
  beforeEach(() => {
    mockRuntimeError = null;
    mockLastError = null;
    messageResponses = {};
  });

  describe('sendDownloadToService', () => {
    test('should send magnet link successfully', (done) => {
      messageResponses['SEND_MAGNET'] = { ok: true };

      const url = 'magnet:?xt=urn:btih:abc123def456';
      const nasId = 'nas-1';

      window.DownloadNexus.DownloadSender.sendDownloadToService(url, nasId)
        .then(result => {
          assert(result.ok === true, 'Should resolve with ok=true');
          done();
        })
        .catch(err => done(err));
    });

    test('should send torrent URL successfully', (done) => {
      messageResponses['SEND_MAGNET'] = { ok: true };

      const url = 'http://example.com/file.torrent';
      const nasId = 'nas-1';

      window.DownloadNexus.DownloadSender.sendDownloadToService(url, nasId)
        .then(result => {
          assert(result.ok === true, 'Should resolve with ok=true');
          done();
        })
        .catch(err => done(err));
    });

    test('should handle service errors', (done) => {
      messageResponses['SEND_MAGNET'] = { ok: false, error: 'Service unavailable' };

      const url = 'magnet:?xt=urn:btih:abc123def456';
      const nasId = 'nas-1';

      window.DownloadNexus.DownloadSender.sendDownloadToService(url, nasId)
        .then(() => done(new Error('Should have rejected')))
        .catch(err => {
          assert(err.message.includes('Service unavailable'), 'Should include error message');
          done();
        });
    });

    test('should handle missing error message', (done) => {
      messageResponses['SEND_MAGNET'] = { ok: false };

      const url = 'magnet:?xt=urn:btih:abc123def456';
      const nasId = 'nas-1';

      window.DownloadNexus.DownloadSender.sendDownloadToService(url, nasId)
        .then(() => done(new Error('Should have rejected')))
        .catch(err => {
          assert(err.message.includes('Failed to send download'), 'Should provide fallback error');
          done();
        });
    });

    test('should handle runtime errors', (done) => {
      mockRuntimeError = 'Extension context invalid';

      const url = 'magnet:?xt=urn:btih:abc123def456';
      const nasId = 'nas-1';

      window.DownloadNexus.DownloadSender.sendDownloadToService(url, nasId)
        .then(() => done(new Error('Should have rejected')))
        .catch(err => {
          assert(err.message.includes('Extension context invalid'), 'Should include runtime error');
          done();
        });
    });

    test('should handle null response', (done) => {
      messageResponses['SEND_MAGNET'] = null;

      const url = 'magnet:?xt=urn:btih:abc123def456';
      const nasId = 'nas-1';

      window.DownloadNexus.DownloadSender.sendDownloadToService(url, nasId)
        .then(() => done(new Error('Should have rejected')))
        .catch(err => {
          assert(err.message, 'Should reject with error');
          done();
        });
    });

    test('should pass correct URL and NAS ID in message', (done) => {
      let capturedMessage = null;
      const originalSendMessage = chrome.runtime.sendMessage;

      chrome.runtime.sendMessage = function(message, callback) {
        capturedMessage = message;
        originalSendMessage.call(this, message, callback);
      };

      messageResponses['SEND_MAGNET'] = { ok: true };

      const url = 'magnet:?xt=urn:btih:abc123def456';
      const nasId = 'nas-1';

      window.DownloadNexus.DownloadSender.sendDownloadToService(url, nasId)
        .then(() => {
          assert(capturedMessage.type === 'SEND_MAGNET', 'Should send SEND_MAGNET message');
          assert(capturedMessage.url === url, 'Should include URL');
          assert(capturedMessage.nasId === nasId, 'Should include NAS ID');
          chrome.runtime.sendMessage = originalSendMessage;
          done();
        })
        .catch(err => {
          chrome.runtime.sendMessage = originalSendMessage;
          done(err);
        });
    });
  });

  describe('getNASList', () => {
    test('should retrieve NAS list successfully', (done) => {
      const nasList = [
        { id: 'nas-1', name: 'My Synology', type: 'synology' },
        { id: 'nas-2', name: 'My qBit', type: 'qbittorrent' }
      ];
      messageResponses['GET_NAS_LIST'] = { list: nasList };

      window.DownloadNexus.DownloadSender.getNASList()
        .then(list => {
          assert(Array.isArray(list), 'Should return array');
          assert(list.length === 2, 'Should return all NAS devices');
          assert(list[0].id === 'nas-1', 'Should preserve NAS data');
          done();
        })
        .catch(err => done(err));
    });

    test('should return empty array when no NAS configured', (done) => {
      messageResponses['GET_NAS_LIST'] = { list: [] };

      window.DownloadNexus.DownloadSender.getNASList()
        .then(list => {
          assert(Array.isArray(list), 'Should return array');
          assert(list.length === 0, 'Should return empty array');
          done();
        })
        .catch(err => done(err));
    });

    test('should return empty array when response is undefined', (done) => {
      messageResponses['GET_NAS_LIST'] = undefined;

      window.DownloadNexus.DownloadSender.getNASList()
        .then(list => {
          assert(Array.isArray(list), 'Should return array');
          assert(list.length === 0, 'Should return empty array for missing response');
          done();
        })
        .catch(err => done(err));
    });

    test('should handle response without list property', (done) => {
      messageResponses['GET_NAS_LIST'] = { some: 'data' };

      window.DownloadNexus.DownloadSender.getNASList()
        .then(list => {
          assert(Array.isArray(list), 'Should return array');
          assert(list.length === 0, 'Should return empty array when list missing');
          done();
        })
        .catch(err => done(err));
    });
  });

  describe('getWhitelist', () => {
    test('should retrieve whitelist in restricted mode', (done) => {
      messageResponses['GET_WHITELIST'] = {
        list: ['example.com', 'test.org'],
        mode: 'restricted'
      };

      window.DownloadNexus.DownloadSender.getWhitelist()
        .then(whitelist => {
          assert(Array.isArray(whitelist.list), 'Should have list array');
          assert(whitelist.list.length === 2, 'Should contain whitelist entries');
          assert(whitelist.mode === 'restricted', 'Should indicate restricted mode');
          done();
        })
        .catch(err => done(err));
    });

    test('should retrieve whitelist in disabled mode', (done) => {
      messageResponses['GET_WHITELIST'] = {
        list: [],
        mode: 'disabled'
      };

      window.DownloadNexus.DownloadSender.getWhitelist()
        .then(whitelist => {
          assert(Array.isArray(whitelist.list), 'Should have list array');
          assert(whitelist.mode === 'disabled', 'Should indicate disabled mode');
          done();
        })
        .catch(err => done(err));
    });

    test('should return empty list and default mode when response undefined', (done) => {
      messageResponses['GET_WHITELIST'] = undefined;

      window.DownloadNexus.DownloadSender.getWhitelist()
        .then(whitelist => {
          assert(Array.isArray(whitelist.list), 'Should have list array');
          assert(whitelist.list.length === 0, 'Should have empty list');
          assert(whitelist.mode === 'disabled', 'Should default to disabled');
          done();
        })
        .catch(err => done(err));
    });

    test('should handle response without mode property', (done) => {
      messageResponses['GET_WHITELIST'] = {
        list: ['example.com']
      };

      window.DownloadNexus.DownloadSender.getWhitelist()
        .then(whitelist => {
          assert(whitelist.mode === 'disabled', 'Should default mode to disabled');
          done();
        })
        .catch(err => done(err));
    });

    test('should handle response without list property', (done) => {
      messageResponses['GET_WHITELIST'] = {
        mode: 'restricted'
      };

      window.DownloadNexus.DownloadSender.getWhitelist()
        .then(whitelist => {
          assert(Array.isArray(whitelist.list), 'Should have list array');
          assert(whitelist.list.length === 0, 'Should default to empty list');
          done();
        })
        .catch(err => done(err));
    });

    test('should handle null response', (done) => {
      messageResponses['GET_WHITELIST'] = null;

      window.DownloadNexus.DownloadSender.getWhitelist()
        .then(whitelist => {
          assert(Array.isArray(whitelist.list), 'Should have list array');
          assert(whitelist.list.length === 0, 'Should have empty list');
          assert(whitelist.mode === 'disabled', 'Should default mode to disabled');
          done();
        })
        .catch(err => done(err));
    });
  });

  describe('Real-world scenarios', () => {
    test('should handle multiple sequential downloads', (done) => {
      messageResponses['SEND_MAGNET'] = { ok: true };

      const urls = [
        'magnet:?xt=urn:btih:hash1',
        'magnet:?xt=urn:btih:hash2',
        'magnet:?xt=urn:btih:hash3'
      ];

      Promise.all(urls.map(url =>
        window.DownloadNexus.DownloadSender.sendDownloadToService(url, 'nas-1')
      ))
        .then(results => {
          assert(results.length === 3, 'Should send all downloads');
          assert(results.every(r => r.ok === true), 'All should succeed');
          done();
        })
        .catch(err => done(err));
    });

    test('should recover from temporary service failure', (done) => {
      let callCount = 0;
      chrome.runtime.sendMessage = function(message, callback) {
        callCount++;
        if (callCount === 1) {
          messageResponses[message.type] = { ok: false, error: 'Temporary failure' };
        } else {
          messageResponses[message.type] = { ok: true };
        }
        setTimeout(() => {
          if (chrome.runtime.lastError) {
            callback(undefined);
          } else {
            callback(messageResponses[message.type]);
          }
        }, 0);
      };

      const url = 'magnet:?xt=urn:btih:abc123def456';
      const nasId = 'nas-1';

      // First attempt fails
      window.DownloadNexus.DownloadSender.sendDownloadToService(url, nasId)
        .then(() => done(new Error('Should have failed')))
        .catch(() => {
          // Second attempt succeeds
          window.DownloadNexus.DownloadSender.sendDownloadToService(url, nasId)
            .then(result => {
              assert(result.ok === true, 'Should succeed on retry');
              done();
            })
            .catch(err => done(err));
        });
    });
  });
});
