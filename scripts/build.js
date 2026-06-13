#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const target = process.argv[2] || 'chrome';
const outputDir = path.join(__dirname, '..', 'dist', target === 'chrome' ? 'chrome-mv3' : `firefox-mv3`);

console.log(`\n📦 Building for ${target}...`);

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Copy manifest
let manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf-8'));

// Browser-specific adjustments
if (target === 'firefox') {
  // Firefox 151 doesn't have MV3 service_worker enabled, use MV2 scripts
  manifest.manifest_version = 2;
  delete manifest.background.service_worker;
  manifest.background.scripts = ["background.js"];
  manifest.background.persistent = false;

  // Convert MV3 properties to MV2
  // action -> browser_action
  if (manifest.action) {
    manifest.browser_action = manifest.action;
    delete manifest.action;
  }

  // host_permissions -> permissions (with <all_urls> equivalent)
  if (manifest.host_permissions) {
    manifest.permissions = manifest.permissions || [];
    manifest.permissions.push("<all_urls>");
    delete manifest.host_permissions;
  }

  manifest.browser_specific_settings = {
    gecko: {
      id: "nas-download-helper@craigpen",
      strict_min_version: "109.0"
    }
  };
} else if (target === 'chrome') {
  // Chrome MV3 requires service_worker
  manifest.background = {
    service_worker: "background.js"
  };
}

fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`  ✓ manifest.json`);

// Copy JavaScript files
const jsFiles = ['background.js', 'content.js', 'options.js', 'popup.js'];
jsFiles.forEach(file => {
  const src = path.join(__dirname, '..', file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(outputDir, file));
    console.log(`  ✓ ${file}`);
  }
});

// Copy HTML files
const htmlFiles = ['options.html', 'popup.html'];
htmlFiles.forEach(file => {
  const src = path.join(__dirname, '..', file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(outputDir, file));
    console.log(`  ✓ ${file}`);
  }
});

// Copy icons
const iconsDir = path.join(outputDir, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}
const srcIconsDir = path.join(__dirname, '..', 'icons');
fs.readdirSync(srcIconsDir).forEach(file => {
  fs.copyFileSync(path.join(srcIconsDir, file), path.join(iconsDir, file));
});
console.log(`  ✓ icons/`);

console.log(`\n✅ Build complete: ${outputDir}\n`);
