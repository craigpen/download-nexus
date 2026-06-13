const fs = require('fs');
const path = require('path');

// Fix manifest in all output directories
const outputDirs = ['.output/chrome-mv3'];

outputDirs.forEach(dir => {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.log(`[fix-manifest] ${manifestPath} not found, skipping`);
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  // Apply correct manifest settings
  manifest.manifest_version = 3;
  manifest.name = "NAS Download helper";
  manifest.description = "Intercepts magnet links and sends them to Synology Download Station.";
  manifest.version = "1.1.0";

  manifest.permissions = ["storage", "notifications", "tabs", "alarms"];
  manifest.host_permissions = ["<all_urls>"];

  manifest.icons = {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  };

  // Ensure options_ui has open_in_tab
  manifest.options_ui = manifest.options_ui || {};
  manifest.options_ui.page = "options.html";
  manifest.options_ui.open_in_tab = true;

  // Ensure action has all required fields
  manifest.action = manifest.action || {};
  manifest.action.default_popup = "popup.html";
  manifest.action.default_title = "NAS Download helper";
  manifest.action.default_icon = {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  };

  // Keep service worker
  manifest.background = manifest.background || {};
  manifest.background.service_worker = "background.js";

  // Ensure only one content script entry
  if (manifest.content_scripts && Array.isArray(manifest.content_scripts)) {
    manifest.content_scripts = [{
      matches: ["<all_urls>"],
      js: ["content-scripts/content.js"],
      run_at: "document_idle"
    }];
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[fix-manifest] Fixed ${manifestPath}`);
});
