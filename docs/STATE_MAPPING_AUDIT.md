# State Mapping Audit

## UI Tabs Available
- `downloading` (DL)
- `seeding` (Seed)
- `paused` (Paused)
- `stalled` (Stalled)
- `finished` (Done)
- `error` (Error)
- `all` (All)

---

## qBittorrent (API v2)

### All Possible States
| State | Category | Current Mapping | Tab | Issue |
|-------|----------|-----------------|-----|-------|
| `downloading` | Active | Pass through | DL | ✓ |
| `forcedDL` | Active | Pass through | DL | ✓ |
| `metaDL` | Active | Pass through | DL | ✓ |
| `forcedMetaDL` | Active | Pass through | DL | ✓ |
| `allocating` | Active | Pass through | DL | ✓ |
| `uploading` | Active | Pass through | Seed | ✓ |
| `forcedUP` | Active | Pass through | Seed | ✓ |
| `stoppedDL` | Paused | → `paused` | Paused | ✓ |
| `stoppedUP` | Paused | → `paused` | Paused | ✓ |
| `stalledDL` | Stalled | → `stalled` | Stalled | ✓ |
| `stalledUP` | Stalled | → `stalled` | Stalled | ✓ |
| `queuedForChecking` | Checking | Pass through | **None** | ❌ UNMAPPED |
| `checkingUP` | Checking | Pass through | **None** | ❌ UNMAPPED |
| `checkingDL` | Checking | Pass through | **None** | ❌ UNMAPPED |
| `checkingResumeData` | Checking | Pass through | **None** | ❌ UNMAPPED |
| `moving` | Checking | Pass through | **None** | ❌ UNMAPPED |
| `error` | Error | Pass through | **None** | ❌ UNMAPPED |
| `missingFiles` | Error | Pass through | **None** | ❌ UNMAPPED |

**Unmapped States (5):**
- `queuedForChecking`, `checkingUP`, `checkingDL`, `checkingResumeData`, `moving` → No UI tab for "checking" state
- `error`, `missingFiles` → Map through but don't match "error" filter (expect lowercase)

---

## Transmission (RPC API)

### All Possible States
| Code | State | Current Mapping | Tab | Issue |
|------|-------|-----------------|-----|-------|
| 0 | Stopped | → `paused` | Paused | ✓ |
| 1 | Check pending | → `checking` | **None** | ❌ UNMAPPED |
| 2 | Checking | → `checking` | **None** | ❌ UNMAPPED |
| 3 | Download pending | → `downloading` | DL | ✓ |
| 4 | Downloading | → `downloading` | DL | ✓ |
| 5 | Seed pending | → `seeding` | Seed | ✓ |
| 6 | Seeding | → `seeding` | Seed | ✓ |

**Unmapped States (2):**
- States 1-2 → `checking` → No UI tab for "checking" state

---

## Synology Download Station

### All Possible States
| State | Current Mapping | Tab | Issue |
|-------|-----------------|-----|-------|
| `paused` | Pass through | Paused | ✓ |
| `finished` | Pass through | Done | ✓ |
| `downloading` | Pass through | DL | ✓ |
| `error` | Pass through | Error | ✓ |

**Status:** FULLY MAPPED ✓
- All 4 states map directly to UI tabs
- No special handling needed
- Synology API state names already match UI tab names

---

## Summary of Issues

### High Priority (Breaking/Confusing)
1. **qBittorrent**: `error` and `missingFiles` pass through as-is but UI filters expect lowercase `error` tab
   - Workaround needed or mapping required

### Medium Priority (Hidden States)
2. **qBittorrent**: Checking states (5 states) have no UI tab
   - `queuedForChecking`, `checkingUP`, `checkingDL`, `checkingResumeData`, `moving`
   - Only visible in "All" tab
   - Consider: add "checking" tab or rename "stalled" to "waiting" to include these

3. **Transmission**: Checking states (2 states) have no UI tab
   - States 1-2 map to `checking`
   - Only visible in "All" tab
   - Rare for most users but should be discoverable

### Unknown Priority
4. **Synology**: No state mapping at all
   - Need to audit what Download Station actually returns
   - Likely hiding some states

---

## Recommendations

1. **Create "checking" tab** for explicitly verifying/checking torrents
   - Would accommodate qBittorrent's 5 checking states
   - Would accommodate Transmission's check-pending states
   - Alternative: merge with "waiting" or "stalled"

2. **Fix qBittorrent error state mapping**
   - Ensure `error` and `missingFiles` map to lowercase `error` for UI matching
   - Currently pass through unchanged which won't match filter

3. **Document and test Synology states**
   - Determine actual states returned by Download Station API
   - Add explicit mapping if needed

4. **Consider tab reorganization**
   - Current: DL | Seed | Paused | Stalled | Done | Error | All
   - Proposed: DL | Seed | Paused | Stalled | **Checking** | Done | Error | All
   - Or: DL | Seed | Waiting (includes Stalled + Checking) | Done | Error | All
