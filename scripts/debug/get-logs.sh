#!/bin/bash
# Query NAS Download Helper logs via hang-time inspector
cd ../hang-time
node scripts/inspect-browsers.js --port 9222 --eval "JSON.stringify(self.debugLog || debugLog || [])" 2>&1 | grep -A 20 "bnibcl"
