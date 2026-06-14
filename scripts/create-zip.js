#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const target = process.argv[2] || 'chrome';
const buildDir = path.join(__dirname, '..', 'dist', target === 'chrome' ? 'chrome-mv3' : 'firefox-mv3');

// Read version from package.json
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
const version = packageJson.version;

const outputZip = path.join(__dirname, '..', 'dist', `nas-download-helper-${target}-${version}.zip`);

// Create temp Python script file to avoid escaping issues
const tempScript = path.join(os.tmpdir(), `zip-${Date.now()}.py`);
const pythonScript = `import zipfile, os
from pathlib import Path

src_dir = r'${buildDir}'
output = r'${outputZip}'

with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(src_dir):
        for file in files:
            file_path = os.path.join(root, file)
            arcname = Path(file_path).relative_to(src_dir).as_posix()
            zf.write(file_path, arcname)

size = os.path.getsize(output)
print(f'Created nas-download-helper-${target}.zip ({size} bytes)')
`;

try {
  fs.writeFileSync(tempScript, pythonScript);
  execSync(`python "${tempScript}"`, { stdio: 'inherit' });
  fs.unlinkSync(tempScript);
} catch (e) {
  console.error('Failed to create zip:', e.message);
  if (fs.existsSync(tempScript)) fs.unlinkSync(tempScript);
  process.exit(1);
}
