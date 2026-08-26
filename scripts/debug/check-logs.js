#!/usr/bin/env node

/**
 * Check Extension Logs - Query via chrome.runtime.sendMessage
 */

const path = require('path');
const { execSync } = require('child_process');

// Use Chrome DevTools Protocol to send message to extension via content script
const script = `
const extensionId = 'bnibclmindjpdfiipicpdhljfblkpkml'; // NAS Download Helper ID

chrome.runtime.sendMessage(extensionId, { type: 'GET_LOGS' }, (response) => {
  if (chrome.runtime.lastError) {
    console.log(JSON.stringify({ error: chrome.runtime.lastError.message }));
  } else {
    console.log(JSON.stringify(response));
  }
});
`;

try {
  // Execute script in browser context via Edge/Chrome
  // This is a workaround - we'll just inform the user to rebuild and check
  console.log('To get logs, run after rebuilding with npm run build:all:');
  console.log('  1. Open the extension popup (click the NAS icon)');
  console.log('  2. Try the download that fails');
  console.log('  3. Open edge://extensions');
  console.log('  4. Click "Inspect views -> Service Worker" on NAS Download Helper');
  console.log('  5. Go to Console tab - you\'ll see all logs there');
  console.log('\nAlternatively, rebuild and run: npm run build:all');
} catch (err) {
  console.error('Error:', err.message);
}
