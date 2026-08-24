/**
 * Popup Rendering Tests
 * Verifies that task data displays correctly in the UI
 */

const assert = require('assert');

// Mock helper functions from popup.js
function fmtSpeed(bytes) {
  if (bytes === 0) return "0 B/s";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let val = bytes;
  for (const unit of units) {
    if (val < 1024) return `${val.toFixed(1)} ${unit}`;
    val /= 1024;
  }
  return `${val.toFixed(1)} TB/s`;
}

function fmt(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let val = bytes;
  for (const unit of units) {
    if (val < 1024) return `${val.toFixed(1)} ${unit}`;
    val /= 1024;
  }
  return `${val.toFixed(1)} PB`;
}

function fmtEta(seconds) {
  if (seconds === 0) return "-";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

describe('Popup Data Rendering', () => {
  describe('Speed Formatting', () => {
    test('should format speeds correctly', () => {
      assert.strictEqual(fmtSpeed(0), "0 B/s");
      assert.strictEqual(fmtSpeed(512), "512.0 B/s");
      assert.strictEqual(fmtSpeed(1024), "1.0 KB/s");
      assert.strictEqual(fmtSpeed(1048576), "1.0 MB/s");
      assert.strictEqual(fmtSpeed(1073741824), "1.0 GB/s");
    });
  });

  describe('Size Formatting', () => {
    test('should format sizes correctly', () => {
      assert.strictEqual(fmt(0), "0 B");
      assert.strictEqual(fmt(512), "512.0 B");
      assert.strictEqual(fmt(1024), "1.0 KB");
      assert.strictEqual(fmt(1048576), "1.0 MB");
      assert.strictEqual(fmt(1073741824), "1.0 GB");
    });
  });

  describe('ETA Formatting', () => {
    test('should format ETA correctly', () => {
      assert.strictEqual(fmtEta(0), "-");
      assert.strictEqual(fmtEta(30), "30s");
      assert.strictEqual(fmtEta(120), "2m");
      assert.strictEqual(fmtEta(3600), "1h");
    });
  });

  describe('qBittorrent Data Display', () => {
    test('should extract speed_down from normalized format', () => {
      const task = {
        id: 'hash1',
        title: 'Ubuntu ISO',
        status: 'downloading',
        size: 1073741824,
        downloaded: 536870912,
        speed_down: 5242880,  // 5 MB/s
        speed_up: 1048576,     // 1 MB/s
        eta: 100
      };

      // Simulate popup.js logic
      const dlSize = task.downloaded !== undefined ? task.downloaded : 0;
      const spDn = task.speed_down !== undefined ? task.speed_down : 0;
      const spUp = task.speed_up !== undefined ? task.speed_up : 0;

      assert.strictEqual(dlSize, 536870912, 'Should extract downloaded from normalized format');
      assert.strictEqual(spDn, 5242880, 'Should extract speed_down from normalized format');
      assert.strictEqual(spUp, 1048576, 'Should extract speed_up from normalized format');

      // Verify formatting
      assert.strictEqual(fmtSpeed(spDn), '5.0 MB/s', 'Should format download speed');
      assert.strictEqual(fmtSpeed(spUp), '1.0 MB/s', 'Should format upload speed');
      assert.strictEqual(fmt(dlSize), '512.0 MB', 'Should format downloaded size');
    });

    test('should fall back to Synology format when normalized fields missing', () => {
      const task = {
        id: '123',
        title: 'Ubuntu ISO',
        status: 'downloading',
        size: 1073741824,
        additional: {
          transfer: {
            size_downloaded: 536870912,
            speed_download: 5242880,
            speed_upload: 1048576
          }
        }
      };

      // Simulate popup.js logic with fallback
      const dlSize = task.downloaded !== undefined ? task.downloaded : (task.additional?.transfer?.size_downloaded || 0);
      const spDn = task.speed_down !== undefined ? task.speed_down : (task.additional?.transfer?.speed_download || 0);
      const spUp = task.speed_up !== undefined ? task.speed_up : (task.additional?.transfer?.speed_upload || 0);

      assert.strictEqual(dlSize, 536870912, 'Should fall back to Synology size_downloaded');
      assert.strictEqual(spDn, 5242880, 'Should fall back to Synology speed_download');
      assert.strictEqual(spUp, 1048576, 'Should fall back to Synology speed_upload');
    });

    test('should calculate progress percentage correctly', () => {
      const task = {
        size: 1000000,
        downloaded: 250000,
        speed_down: 100000
      };

      const dlSize = task.downloaded || 0;
      const pct = task.size > 0 ? Math.round(dlSize / task.size * 100) : 0;
      const eta = task.speed_down > 0 && task.size > dlSize
        ? Math.round((task.size - dlSize) / task.speed_down)
        : 0;

      assert.strictEqual(pct, 25, 'Should calculate progress as 25%');
      // (1000000 - 250000) / 100000 = 7.5, rounds to 8
      assert.strictEqual(eta, 8, 'Should calculate ETA correctly');
    });

    test('should handle zero speed gracefully', () => {
      const task = {
        size: 1000000,
        downloaded: 250000,
        speed_down: 0
      };

      const dlSize = task.downloaded || 0;
      const pct = task.size > 0 ? Math.round(dlSize / task.size * 100) : 0;
      const eta = task.speed_down > 0 && task.size > dlSize
        ? Math.round((task.size - dlSize) / task.speed_down)
        : 0;

      assert.strictEqual(pct, 25, 'Should calculate progress');
      assert.strictEqual(eta, 0, 'Should show ETA as 0 when speed is zero');
      assert.strictEqual(fmtEta(eta), '-', 'Should display "-" for unknown ETA');
    });
  });

  describe('Data Format Consistency', () => {
    test('qBittorrent adapter format has all required fields', () => {
      const qbTask = {
        id: 'hash1',
        title: 'Test',
        status: 'downloading',
        progress: 50,
        downloaded: 500000,
        uploaded: 1000,
        size: 1000000,
        speed_down: 10000,
        speed_up: 500,
        eta: 50
      };

      const requiredFields = ['id', 'title', 'status', 'size', 'downloaded', 'speed_down', 'speed_up'];
      requiredFields.forEach(field => {
        assert(field in qbTask, `Task should have ${field} field`);
      });
    });

    test('speed aggregation works with both formats', () => {
      const tasks = [
        { speed_down: 1000, speed_up: 100 },  // normalized
        { additional: { transfer: { speed_download: 2000, speed_upload: 200 } } }  // Synology
      ];

      let totalDn = 0, totalUp = 0;
      for (const t of tasks) {
        totalDn += (t.speed_down !== undefined) ? t.speed_down : (t.additional?.transfer?.speed_download || 0);
        totalUp += (t.speed_up !== undefined) ? t.speed_up : (t.additional?.transfer?.speed_upload || 0);
      }

      assert.strictEqual(totalDn, 3000, 'Should aggregate download speeds from both formats');
      assert.strictEqual(totalUp, 300, 'Should aggregate upload speeds from both formats');
    });
  });
});

module.exports = { fmtSpeed, fmt, fmtEta };
