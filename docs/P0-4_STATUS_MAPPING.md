# P0-4: Unified Status Mapping

## Problem
Unmapped states like "Checking", "Allocating", "Stalled" are shown as raw strings instead of consistent UI states.

## Solution
Define 8 unified states and map all adapters to them.

## Unified State Set (8 states)

```
downloading   - Actively downloading (priority: DL > Stalled)
seeding       - Actively seeding/uploading
paused        - User explicitly paused/stopped
checking      - Checking files, verifying integrity
allocating    - Pre-allocating disk space
stalled       - Queued but not active (no progress)
finished      - 100% complete
error         - Error state
```

---

## Adapter Mappings

### Synology Download Station

| Raw State | Mapped State | Notes |
|-----------|--------------|-------|
| downloading | downloading | ✅ Direct |
| active | seeding | Actively seeding |
| uploading | seeding | Same as active |
| seeding | seeding | ✅ Direct |
| stopped | paused | User stopped |
| paused | paused | ✅ Direct |
| inactive | paused | Paused by user |
| waiting | stalled | Waiting for resources |
| error | error | ✅ Direct |
| completed | finished | 100% done |
| finished | finished | ✅ Direct |

### qBittorrent

| Raw State | Mapped State | Notes |
|-----------|--------------|-------|
| downloading | downloading | ✅ Direct |
| forcedDL | downloading | Force download |
| metaDL | downloading | Metadata download |
| allocating | allocating | Pre-allocating space |
| uploading | seeding | Actively seeding |
| forcedUP | seeding | Force seed |
| stoppedDL | paused | Stopped download |
| stoppedUP | paused | Stopped seeding |
| stalledDL | stalled | Stalled, not downloading |
| stalledUP | stalled | Stalled, not seeding |
| queuedForChecking | checking | Queued for hash check |
| checkingUP | checking | Checking for upload |
| checkingDL | checking | Checking download |
| error | error | ✅ Direct |
| missingFiles | error | Missing files error |

### Transmission

| Numeric | Raw State | Mapped State | Notes |
|---------|-----------|--------------|-------|
| 0 | Stopped | paused | User stopped |
| 1 | Check pending | checking | Wait for check |
| 2 | Checking | checking | File hash check |
| 3 | Download pending | stalled | Wait to download |
| 4 | Downloading | downloading | ✅ Active download |
| 5 | Seed pending | stalled | Wait to seed |
| 6 | Seeding | seeding | ✅ Active seeding |

### Deluge

| Raw State | Mapped State | Notes |
|-----------|--------------|-------|
| Downloading | downloading | ✅ Direct |
| Seeding | seeding | ✅ Direct |
| Paused | paused | ✅ Direct |
| Queued | stalled | Queued, waiting |
| Checking | checking | File check |
| Allocating | allocating | Space allocation |
| Error | error | ✅ Direct |

---

## Implementation

For each adapter, update `_displayStatus()` or `_statusString()`:

```javascript
_displayStatus(rawState) {
  const stateMap = {
    // Active states
    "Downloading": "downloading",
    "Seeding": "seeding",
    // Paused states
    "Paused": "paused",
    // Check/queue/stalled states
    "Queued": "stalled",
    "Checking": "checking",
    "Allocating": "allocating",
    // Completion
    "Error": "error",
    "Finished": "finished"
  };
  return stateMap[rawState] || rawState;
}
```

---

## UI Impact

**No UI changes needed** - existing tabs handle all 8 states:
- Download tab: `downloading`
- Seeding tab: `seeding`
- Paused tab: `paused`
- Other tab (or new): `checking`, `allocating`, `stalled`, `finished`, `error`

If UI needs reorganization, that's a separate enhancement.

---

## Testing

1. ✅ Unit tests already cover state mapping in `tests/adapters.test.js`
2. ✅ Integration tests verify with real containers
3. 🔄 Manual testing with various torrent states

---

## PR Checklist

- [ ] Synology status mapping complete
- [ ] qBittorrent status mapping complete
- [ ] Transmission status mapping complete
- [ ] Deluge status mapping complete (already has new states)
- [ ] Unit tests pass (33 tests)
- [ ] Integration tests pass
- [ ] Manual verification with real containers
