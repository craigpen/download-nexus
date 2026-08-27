#!/usr/bin/env node

/**
 * Generate release notes from conventional commits
 * Usage: node scripts/generate-release-notes.js [version]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const version = process.argv[2] || require('../package.json').version;

try {
  // Generate conventional changelog for this version
  const changelog = execSync(`npx conventional-changelog -p angular -u -r 1 | head -100`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe']
  });

  if (changelog.trim()) {
    console.log(changelog);
  } else {
    // Fallback if no conventional commits found
    console.log(`**Version ${version}**\n`);
    console.log('Published to:\n');
    console.log('- ✅ Chrome Web Store');
    console.log('- ✅ Firefox Add-ons');
    console.log('- ✅ Edge Add-ons\n');
    console.log('See CHANGELOG.md for details.');
  }
} catch (error) {
  // Fallback message if changelog generation fails
  console.log(`**Version ${version}**\n`);
  console.log('Published to:\n');
  console.log('- ✅ Chrome Web Store');
  console.log('- ✅ Firefox Add-ons');
  console.log('- ✅ Edge Add-ons\n');
  console.log('See CHANGELOG.md for details.');
}
