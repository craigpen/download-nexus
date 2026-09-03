#!/usr/bin/env node

/**
 * Download Nexus - Browser CDP Inspector
 * Connects directly to running Chromium/Edge instances via Chrome DevTools Protocol (CDP).
 * Inspects extension targets, storage state, console logs, and evaluates code
 * without requiring manual copy-pasting into agent sessions.
 *
 * Usage:
 *   node scripts/inspect-browser.js [--port 9222] [--logs] [--listen] [--storage] [--eval "expression"] [--reload] [--targets]
 */

const http = require('http');
const WebSocket = require('ws');

const DEFAULT_PORT = 9222;

function fetchJson(port, path = '/json') {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, { timeout: 2500 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function sendCdpCommand(wsUrl, method, params = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    try {
      const ws = new WebSocket(wsUrl);
      const id = Math.floor(Math.random() * 1000000);
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { ws.close(); } catch {}
          reject(new Error(`CDP command timed out after ${timeoutMs}ms: ${method}`));
        }
      }, timeoutMs);

      ws.on('open', () => {
        ws.send(JSON.stringify({ id, method, params }));
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.id === id) {
            resolved = true;
            clearTimeout(timer);
            try { ws.close(); } catch {}
            if (msg.error) {
              reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            } else {
              resolve(msg.result);
            }
          }
        } catch (e) {
          // ignore parsing error for non-json
        }
      });

      ws.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          reject(err);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

function streamLogs(wsUrl, targetTitle) {
  return new Promise((resolve) => {
    console.log(`\n[Stream] Listening to live logs for: ${targetTitle}... (Ctrl+C to stop)`);
    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
      ws.send(JSON.stringify({ id: 2, method: 'Console.enable' }));
      ws.send(JSON.stringify({ id: 3, method: 'Log.enable' }));
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const timestamp = new Date().toLocaleTimeString();

        if (msg.method === 'Runtime.consoleAPICalled') {
          const type = msg.params.type.toUpperCase();
          const args = msg.params.args.map((a) => {
            if (a.value !== undefined) return typeof a.value === 'object' ? JSON.stringify(a.value) : a.value;
            return a.description || '';
          }).join(' ');
          console.log(`[${timestamp}] [Console ${type}] ${args}`);
        } else if (msg.method === 'Log.entryAdded') {
          const entry = msg.params.entry;
          console.log(`[${timestamp}] [Browser Log - ${entry.level}] ${entry.text}`);
        } else if (msg.method === 'Runtime.exceptionThrown') {
          const exc = msg.params.exceptionDetails;
          console.error(`[${timestamp}] [Exception] ${exc.text || ''} ${exc.exception?.description || ''}`);
        }
      } catch (err) {
        // ignore
      }
    });

    ws.on('error', (err) => {
      console.error('[Stream] WebSocket error:', err.message);
      resolve();
    });

    ws.on('close', () => {
      console.log('[Stream] Target closed.');
      resolve();
    });

    process.on('SIGINT', () => {
      try { ws.close(); } catch {}
      console.log('\n[Stream] Stopped.');
      process.exit(0);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const options = {
    port: DEFAULT_PORT,
    storage: args.includes('--storage'),
    logs: args.includes('--logs'),
    listen: args.includes('--listen') || args.includes('--tail'),
    reload: args.includes('--reload'),
    targets: args.includes('--targets') || args.includes('--list'),
    eval: null,
    targetType: null,
    help: args.includes('--help') || args.includes('-h')
  };

  if (options.help) {
    console.log(`
Download Nexus - Browser CDP Inspector

Options:
  --port <number>       Debug port to connect to (default: 9222)
  --targets             List all active targets and their debug WebSocket URLs
  --storage             Dump chrome.storage.local and chrome.storage.sync
  --logs                Fetch runtime console logs and recent diagnostic info
  --listen, --tail      Stream live console messages and exceptions continuously
  --eval "<expression>" Evaluate arbitrary JavaScript in the background service worker
  --reload              Trigger chrome.runtime.reload() to reload the extension
  --help                Show this help message

Examples:
  node scripts/inspect-browser.js --storage
  node scripts/inspect-browser.js --logs
  node scripts/inspect-browser.js --listen
  node scripts/inspect-browser.js --eval "chrome.runtime.getManifest()"
  node scripts/inspect-browser.js --reload
`);
    return;
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      options.port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--eval' && args[i + 1]) {
      options.eval = args[i + 1];
      i++;
    } else if (args[i] === '--target' && args[i + 1]) {
      options.targetType = args[i + 1];
      i++;
    }
  }

  const version = await fetchJson(options.port, '/json/version');
  if (!version) {
    console.error(`[Inspector] Cannot connect to browser on port ${options.port}.`);
    console.error(`Make sure the test browser is running via 'npm run dev:browser' or 'launch-test-browser.bat'.`);
    process.exit(1);
  }

  const targets = await fetchJson(options.port, '/json');
  if (!targets || !Array.isArray(targets)) {
    console.log(`[Inspector] No active targets found on port ${options.port}.`);
    return;
  }

  // Find Download Nexus extension specifically by checking manifest
  const candidateTargets = targets.filter(
    (t) => (t.type === 'service_worker' || t.type === 'background_page') &&
           t.webSocketDebuggerUrl &&
           (t.url?.includes('chrome-extension://') || t.title?.includes('Download Nexus'))
  );

  let primaryTarget = null;
  const extensionTargets = [];

  for (const t of candidateTargets) {
    try {
      const res = await sendCdpCommand(t.webSocketDebuggerUrl, 'Runtime.evaluate', {
        expression: '({ name: (typeof chrome !== "undefined" && chrome?.i18n?.getMessage) ? (chrome.i18n.getMessage("extName") || chrome.runtime?.getManifest?.()?.name) : null, rawName: chrome?.runtime?.getManifest?.()?.name, id: chrome?.runtime?.id, version: chrome?.runtime?.getManifest?.()?.version })',
        returnByValue: true
      }, 1000);

      const extInfo = res?.result?.value;
      if (extInfo && (extInfo.name === 'Download Nexus' || extInfo.name === 'NAS Download Helper' || (extInfo.rawName === '__MSG_extName__' && t.url?.endsWith('/background.js') && !t.url.includes('/js/')))) {
        primaryTarget = t;
        extensionTargets.push({ ...t, manifest: extInfo });
        break;
      }
    } catch {
      // not accessible or not an extension
    }
  }

  // If manifest search didn't match immediately, check for root background.js URL pattern
  if (!primaryTarget) {
    primaryTarget = candidateTargets.find(t => t.url?.match(/chrome-extension:\/\/[a-z0-9]+\/background\.js$/i));
  }

  console.log(`\n========================================================`);
  console.log(`  Browser on Port ${options.port} (${version['User-Agent']?.split(' ')[0] || 'Chromium'})`);
  console.log(`  Download Nexus Target: ${primaryTarget ? primaryTarget.url : 'Not Found'} | Total Targets: ${targets.length}`);
  console.log(`========================================================`);

  if (options.targets || (!options.storage && !options.logs && !options.listen && !options.eval && !options.reload)) {
    console.log(`\nActive Browser Targets:`);
    for (const t of targets) {
      const isNexus = primaryTarget && primaryTarget.id === t.id;
      const flag = isNexus ? '[DOWNLOAD-NEXUS]' : '[TARGET]        ';
      console.log(`  ${flag} ${t.type.padEnd(16)} ${(t.title || 'Untitled').substring(0, 35).padEnd(37)} ${t.url || ''}`);
    }
    if (!options.storage && !options.logs && !options.listen && !options.eval && !options.reload) {
      console.log(`\nTip: Use --storage, --logs, --listen, --eval "<expr>", or --reload to inspect.`);
      return;
    }
  }

  if (!primaryTarget || !primaryTarget.webSocketDebuggerUrl) {
    console.error(`[Inspector] No Download Nexus background target found with WebSocket debugging enabled.`);
    return;
  }

  console.log(`\nTarget: [${primaryTarget.type}] ${primaryTarget.title || primaryTarget.url}`);

  // 1. Reload extension
  if (options.reload) {
    console.log(`\n[Action] Triggering chrome.runtime.reload()...`);
    try {
      await sendCdpCommand(primaryTarget.webSocketDebuggerUrl, 'Runtime.evaluate', {
        expression: 'chrome.runtime.reload(); "Reload triggered successfully."',
        returnByValue: true
      });
      console.log(`[Action] Extension reloaded successfully!`);
    } catch (err) {
      // Reload often closes the WS immediately which is expected
      console.log(`[Action] Extension reloaded (connection reset acknowledged).`);
    }
    return;
  }

  // 2. Evaluate custom expression
  if (options.eval) {
    console.log(`\n[Eval] > ${options.eval}`);
    try {
      const result = await sendCdpCommand(primaryTarget.webSocketDebuggerUrl, 'Runtime.evaluate', {
        expression: options.eval,
        returnByValue: true,
        awaitPromise: true,
      });

      if (result.exceptionDetails) {
        console.error(`[Eval Error]`, result.exceptionDetails.text || result.exceptionDetails.exception?.description);
      } else {
        const val = result.result?.value !== undefined ? result.result.value : result.result;
        console.log(`[Eval Result]:\n`, typeof val === 'object' ? JSON.stringify(val, null, 2) : val);
      }
    } catch (err) {
      console.error(`[Eval Error]:`, err.message);
    }
  }

  // 3. Storage inspection
  if (options.storage) {
    console.log(`\n[Storage] Querying chrome.storage.local & sync...`);
    try {
      const result = await sendCdpCommand(primaryTarget.webSocketDebuggerUrl, 'Runtime.evaluate', {
        expression: `new Promise((resolve) => {
          chrome.storage.local.get(null, (local) => {
            chrome.storage.sync.get(null, (sync) => {
              resolve({
                localStorageKeys: Object.keys(local || {}),
                syncStorageKeys: Object.keys(sync || {}),
                local: local || {},
                sync: sync || {}
              });
            });
          });
        })`,
        returnByValue: true,
        awaitPromise: true,
      });

      const storageData = result.result?.value || {};
      console.log(`\n--- Local Storage (Keys: ${storageData.localStorageKeys?.join(', ') || 'none'}) ---`);
      console.log(JSON.stringify(storageData.local, null, 2));

      console.log(`\n--- Sync Storage (Keys: ${storageData.syncStorageKeys?.join(', ') || 'none'}) ---`);
      console.log(JSON.stringify(storageData.sync, null, 2));
    } catch (err) {
      console.error(`[Storage Error]:`, err.message);
    }
  }

  // 4. Logs inspection
  if (options.logs && !options.listen) {
    console.log(`\n[Logs] Fetching background state and diagnostics...`);
    try {
      const result = await sendCdpCommand(primaryTarget.webSocketDebuggerUrl, 'Runtime.evaluate', {
        expression: `({
          url: location.href,
          manifestVersion: chrome.runtime.getManifest()?.version,
          manifestName: chrome.runtime.getManifest()?.name,
          permissions: chrome.runtime.getManifest()?.permissions,
          userAgent: navigator.userAgent
        })`,
        returnByValue: true,
        awaitPromise: true,
      });

      console.log(`Extension Environment:`, JSON.stringify(result.result?.value, null, 2));
      console.log(`\nTip: To stream real-time console messages and download intercepts, run:`);
      console.log(`  node scripts/inspect-browser.js --listen`);
    } catch (err) {
      console.error(`[Logs Error]:`, err.message);
    }
  }

  // 5. Live streaming
  if (options.listen) {
    await streamLogs(primaryTarget.webSocketDebuggerUrl, primaryTarget.title || primaryTarget.url);
  }

  console.log(`\n========================================================\n`);
}

main().catch((err) => {
  console.error('[Inspector Error]:', err.message);
  process.exit(1);
});
