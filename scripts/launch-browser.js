#!/usr/bin/env node

/**
 * Download Nexus - Test Browser Launcher
 * Launches an isolated Chromium / Edge instance with remote debugging enabled.
 * Automatically loads the unpacked Download Nexus extension (dist/chrome-mv3).
 *
 * Usage:
 *   node scripts/launch-browser.js [--port 9222] [--browser chrome|edge|brave] [--url <url>]
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const projectRoot = path.join(__dirname, '..');
const extensionPath = path.join(projectRoot, 'dist', 'chrome-mv3');

function findBrowserPath(preference) {
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const browsers = {
    edge: [
      path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ],
    chrome: [
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ],
    brave: [
      path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ]
  };

  // If specific browser requested
  if (preference && browsers[preference.toLowerCase()]) {
    for (const p of browsers[preference.toLowerCase()]) {
      if (fs.existsSync(p)) return { name: preference, path: p };
    }
  }

  // Default fallback check order: Edge -> Chrome -> Brave
  for (const [name, paths] of Object.entries(browsers)) {
    for (const p of paths) {
      if (fs.existsSync(p)) return { name, path: p };
    }
  }

  // Fallback to msedge on PATH
  return { name: 'msedge', path: 'msedge' };
}

function removeLockFiles(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        removeLockFiles(fullPath);
      } else if (entry.name === 'LOCK' || entry.name.endsWith('.lock')) {
        try {
          fs.unlinkSync(fullPath);
        } catch {
          // ignore locked files
        }
      }
    }
  } catch {
    // ignore
  }
}

async function checkPortReady(port, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const isReady = await new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 1000 }, (res) => {
          if (res.statusCode === 200) {
            resolve(true);
          } else {
            resolve(false);
          }
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });
      });

      if (isReady) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  let port = process.env.DEBUG_PORT || 9222;
  let browserPref = null;
  let targetUrl = 'https://webtorrent.io/free-torrents';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--browser' && args[i + 1]) {
      browserPref = args[i + 1];
      i++;
    } else if (args[i] === '--url' && args[i + 1]) {
      targetUrl = args[i + 1];
      i++;
    }
  }

  // 1. Build Chrome MV3 if not present
  if (!fs.existsSync(extensionPath) || !fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
    console.log('[Launcher] Extension build not found, building dist/chrome-mv3...');
    execSync('npm run build:chrome', { cwd: projectRoot, stdio: 'inherit' });
  }

  const browser = findBrowserPath(browserPref);
  console.log(`[Launcher] Selected Browser: ${browser.name} (${browser.path})`);

  const userDataDir = path.join(
    process.env.LOCALAPPDATA || process.env.USERPROFILE || 'C:\\temp',
    '.download-nexus-test-profile'
  );

  removeLockFiles(userDataDir);

  console.log(`\n========================================================`);
  console.log(`  Download Nexus - Isolated Test Browser Environment`);
  console.log(`========================================================`);
  console.log(`  - Debug Port   : http://127.0.0.1:${port}`);
  console.log(`  - Extension    : ${extensionPath}`);
  console.log(`  - User Profile : ${userDataDir}`);
  console.log(`  - Start Page   : ${targetUrl}`);
  console.log(`========================================================\n`);

  const browserArgs = [
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${userDataDir}`,
    `--load-extension=${extensionPath}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    '--disable-features=Translate',
    targetUrl
  ];

  console.log(`[Launcher] Spawning browser process...`);
  const browserProc = spawn(browser.path, browserArgs, { stdio: 'ignore' });

  // Handle termination
  const cleanup = () => {
    try {
      browserProc.kill();
    } catch {}
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const isReady = await checkPortReady(port);
  if (isReady) {
    console.log(`\n[Launcher] Ready! Remote debugging endpoint active on port ${port}.`);
    console.log(`  * Inspect logs:   node scripts/inspect-browser.js --logs`);
    console.log(`  * Stream logs:    node scripts/inspect-browser.js --listen`);
    console.log(`  * Check storage:  node scripts/inspect-browser.js --storage`);
    console.log(`  * Reload ext:     node scripts/inspect-browser.js --reload\n`);
  } else {
    console.log(`\n[Launcher] Browser spawned. Waiting for debug endpoint on port ${port}...`);
  }

  // Keep parent node process open while browser runs
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('[Launcher] Fatal error:', err);
  process.exit(1);
});
