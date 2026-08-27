/**
 * Content Script Registry
 * Handles dynamic content script registration and re-injection into tabs
 */

let isRegisteringContentScripts = false;

async function registerContentScripts() {
  if (isRegisteringContentScripts) {
    console.debug('[ContentScriptRegistry] Registration already in progress, skipping');
    return;
  }

  isRegisteringContentScripts = true;

  try {
    if (!chrome?.scripting) {
      console.warn('[ContentScriptRegistry] chrome.scripting not available');
      return;
    }

    // Unregister existing scripts if they exist
    try {
      await chrome.scripting.unregisterContentScripts({
        ids: ['download-nexus-content'],
      });
      console.debug('[ContentScriptRegistry] Unregistered existing content scripts');
    } catch (err) {
      console.debug('[ContentScriptRegistry] No existing scripts to unregister');
    }

    // Register content scripts persistently
    await chrome.scripting.registerContentScripts([
      {
        id: 'download-nexus-content',
        matches: ['<all_urls>'],
        js: ['content.js'],
        runAt: 'document_idle',
      },
    ]);

    console.log('[ContentScriptRegistry] ✅ Content scripts registered persistently');
  } catch (err) {
    console.error('[ContentScriptRegistry] ❌ Failed to register content scripts:', err instanceof Error ? err.message : String(err));
  } finally {
    isRegisteringContentScripts = false;
  }
}

async function reinjectContentScripts() {
  console.log('[ContentScriptRegistry] 🔄 Re-injecting content scripts into all tabs...');
  try {
    if (!chrome?.scripting) {
      console.error('[ContentScriptRegistry] ❌ chrome.scripting API not available');
      return;
    }

    const allTabs = await chrome.tabs.query({
      url: ['http://*/*', 'https://*/*'],
    });

    console.log(`[ContentScriptRegistry] Found ${allTabs.length} eligible tabs`);

    let successCount = 0;
    let failureCount = 0;

    for (const tab of allTabs) {
      if (!tab.id) continue;

      try {
        const tabStatus = tab.status || 'unknown';
        const tabUrl = tab.url || 'unknown';

        // Skip extension pages and special URLs
        if (tabUrl.startsWith('chrome-extension://') ||
            tabUrl.startsWith('chrome://') ||
            tabUrl.startsWith('edge://') ||
            tabUrl.startsWith('edge-extension://')) {
          console.debug(`[ContentScriptRegistry] Skipping tab ${tab.id} (extension page) - ${tabUrl}`);
          continue;
        }

        console.log(`[ContentScriptRegistry] Injecting into tab ${tab.id} (${tabStatus}) - ${tabUrl}`);

        const injectionPromise = chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        });

        // Longer timeout for unloaded tabs
        const timeoutMs = tabStatus === 'unloaded' ? 10000 : 8000;
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Injection timeout after ${timeoutMs}ms`)), timeoutMs)
        );

        await Promise.race([injectionPromise, timeoutPromise]);
        successCount++;
        console.log(`[ContentScriptRegistry] ✅ Injected into tab ${tab.id}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);

        // Skip expected errors
        if (errMsg.includes('Cannot access contents of the page')) {
          console.debug(`[ContentScriptRegistry] Tab ${tab.id} denied extension access - skipping`);
          continue;
        }

        failureCount++;
        console.warn(`[ContentScriptRegistry] ⚠️ Failed to inject into tab ${tab.id}:`, errMsg);
      }
    }

    console.log(`[ContentScriptRegistry] 🏁 Re-injection complete: ${successCount} successful, ${failureCount} failed`);
  } catch (err) {
    console.error('[ContentScriptRegistry] ❌ Re-injection routine failed:', err instanceof Error ? err.message : String(err));
  }
}

module.exports = { registerContentScripts, reinjectContentScripts };
