# Synology Download Station Status Investigation

## UI Categories (from user screenshot)
Synology Download Manager shows these filters:
- All Downloads
- Downloading
- Completed
- Active
- Inactive
- Stopped

## Current Code Behavior
- `SynologyAdapter.listTasks()` returns raw API response
- No status mapping/normalization
- Status values pass through unchanged
- Unknown what Synology API actually returns

## How to Determine Actual Values

### Option 1: Check Browser Network Tab (Easiest)
1. Open Synology DSM in browser
2. Open Developer Tools → Network tab
3. Click on Download Manager
4. Look for requests to `/DownloadStation/task.cgi`
5. Check the response JSON for the `status` field values

Example response structure:
```json
{
  "data": {
    "tasks": [
      {
        "id": "1",
        "title": "File.torrent",
        "status": "???",  // <- This is what we need
        "additional": {
          "transfer": {
            "size_downloaded": 1000000,
            "size_uploaded": 0,
            "speed_download": 1048576,
            "speed_upload": 0
          }
        }
      }
    ]
  }
}
```

### Option 2: Check Synology API Documentation
- Search for "Synology Download Station API documentation"
- Look for SYNO.DownloadStation.Task API docs
- Check the `list` method response schema for status field values

## Expected Status Values (to verify)

Based on the UI categories and standard download manager patterns:

| UI Category | Likely API Status | Confidence |
|-------------|-------------------|------------|
| Downloading | `downloading` | High |
| Completed | `completed` or `finished` | High |
| Active | `active` or `uploading` | Medium |
| Inactive | `inactive` or `waiting` | Medium |
| Stopped | `stopped` or `paused` | High |

## Once Determined

Create mapping in `SynologyAdapter._displayStatus()`:
```javascript
_displayStatus(rawStatus) {
  // Map Synology Download Station status to UI-compatible strings
  const statusMap = {
    "downloading": "downloading",    // DL tab
    "completed": "finished",         // Done tab (if needed)
    "finished": "finished",          // Done tab (if needed)
    "active": "seeding",             // Seed tab
    "uploading": "seeding",          // Seed tab
    "inactive": "stalled",           // Stalled tab
    "waiting": "stalled",            // Stalled tab
    "stopped": "paused",             // Paused tab
    "paused": "paused"               // Paused tab
  };
  return statusMap[rawStatus] || "stalled";
}
```

## Testing After Mapping

1. Add a Synology device to extension
2. Add torrents in various states
3. Verify each appears in correct tab
4. Update `SYNOLOGY_CONFIG` test to use real status values

---

**Note**: Status values are case-sensitive in API responses. 
Verify exact casing when mapping (e.g., "Downloading" vs "downloading").
