#!/usr/bin/env node

/**
 * CDP Console Listener
 * Connects to Chrome DevTools Protocol and streams console logs from the background page
 */

const WebSocket = require('ws');
const http = require('http');

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  try {
    console.log('Fetching targets...');
    const targets = await getTargets();

    // Find NAS Download Helper background page
    let bgTarget = null;
    for (const t of targets) {
      const url = t.url || '';
      const title = t.title || '';

      // Look for our extension - check the extension ID in the URL
      if (url.includes('chrome-extension://') && (
        url.includes('background') ||
        url.includes('service-worker') ||
        title.includes('background') ||
        title.includes('Service Worker')
      )) {
        // Try to identify as NAS Download Helper by checking dist folder extension ID
        // For now, get the first service worker that's not uBlock
        if (!url.includes('odfafepnkmbhccpbejgmiehpchacaeak') && !url.includes('jbkfoedolllekgbhcbcoahefnbanhhlh')) {
          bgTarget = t;
          console.log(`\nFound background target: ${title}`);
          console.log(`URL: ${url}\n`);
          break;
        }
      }
    }

    if (!bgTarget) {
      console.log('No background page found. Available:');
      targets.forEach(t => {
        if (t.url.includes('chrome-extension')) {
          console.log(`  - ${t.title}: ${t.url}`);
        }
      });
      process.exit(1);
    }

    const wsUrl = bgTarget.webSocketDebuggerUrl;
    console.log(`Connecting to: ${wsUrl}\n`);

    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      console.log('Connected to background page. Listening for console logs...\n');

      // Enable Runtime domain for console messages
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.enable'
      }));

      // Enable Console domain
      ws.send(JSON.stringify({
        id: 2,
        method: 'Console.enable'
      }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);

        // Console message
        if (msg.method === 'Console.messageAdded') {
          const entry = msg.params.message;
          const level = entry.level.toUpperCase();
          const text = entry.text;
          const time = new Date(entry.timestamp).toLocaleTimeString();
          console.log(`[${time}] ${level}: ${text}`);

          // Print stack trace if available
          if (entry.stackTrace) {
            entry.stackTrace.callFrames.forEach(frame => {
              console.log(`  at ${frame.functionName} (${frame.url}:${frame.lineNumber})`);
            });
          }
        }

        // Runtime error
        if (msg.method === 'Runtime.exceptionThrown') {
          const ex = msg.params.exceptionDetails;
          console.log(`\n❌ EXCEPTION: ${ex.text}`);
          if (ex.stackTrace) {
            ex.stackTrace.callFrames.forEach(frame => {
              console.log(`  at ${frame.functionName} (${frame.url}:${frame.lineNumber}:${frame.columnNumber})`);
            });
          }
          console.log();
        }
      } catch (err) {
        // Ignore JSON parse errors for protocol responses
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err.message);
      process.exit(1);
    });

    ws.on('close', () => {
      console.log('\nDisconnected from background page');
      process.exit(0);
    });

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
