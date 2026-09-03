const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ICONS_DIR = path.resolve(__dirname, '..', 'icons');

const THEMES = {
  active: { r: 22, g: 163, b: 74, name: 'Active Green' },     // #16a34a
  paused: { r: 217, g: 119, b: 6, name: 'Paused Amber' },     // #d97706
  error: { r: 220, g: 38, b: 38, name: 'Error Red' },        // #dc2626
  offline: { r: 100, g: 116, b: 139, name: 'Offline Slate' }  // #64748b
};

const SIZES = [16, 24, 32, 48, 128];

async function generateStateIcons() {
  console.log('Generating HiDPI base icons and offline variants...');

  const src128Path = path.join(ICONS_DIR, 'icon128.png');
  if (!fs.existsSync(src128Path)) {
    throw new Error(`Master icon not found: ${src128Path}`);
  }

  // Ensure base icons for 24 and 32 exist from master
  for (const size of [24, 32]) {
    const targetBase = path.join(ICONS_DIR, `icon${size}.png`);
    await sharp(src128Path).resize(size, size).png().toFile(targetBase);
    console.log(`  ✓ Generated base icon${size}.png`);
  }

  // Generate grayscale offline variants
  for (const size of SIZES) {
    const srcPath = path.join(ICONS_DIR, `icon${size}.png`);
    const outPath = path.join(ICONS_DIR, `icon${size}-offline.png`);
    await sharp(srcPath).grayscale().png().toFile(outPath);
    console.log(`  ✓ Generated icon${size}-offline.png (Offline Slate)`);
  }

  console.log('✅ Icons generated successfully!');
}

if (require.main === module) {
  generateStateIcons().catch(err => {
    console.error('Error generating icons:', err);
    process.exit(1);
  });
}

module.exports = { generateStateIcons, THEMES };
