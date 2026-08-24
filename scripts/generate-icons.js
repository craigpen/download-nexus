#!/usr/bin/env node
// Regenerates icons/icon{16,48,128}.png from the cloud-download glyph
// used throughout the UI (options.html header, popup.html header).

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="12" fill="#1a6fb5"/>
  <g transform="translate(12,12) scale(0.72) translate(-12,-12)"
     fill="none" stroke="#ffffff" stroke-width="2.8"
     stroke-linecap="round" stroke-linejoin="round">
    <polyline points="8 17 12 21 16 17"/>
    <line x1="12" y1="12" x2="12" y2="21"/>
    <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>
  </g>
</svg>
`;

const outDir = path.join(__dirname, '..', 'icons');
const sizes = [16, 48, 128];

(async () => {
  for (const size of sizes) {
    const outPath = path.join(outDir, `icon${size}.png`);
    await sharp(Buffer.from(ICON_SVG), { density: 384 })
      .resize(size, size)
      .png()
      .toFile(outPath);
    console.log(`  ✓ icons/icon${size}.png`);
  }
})();
