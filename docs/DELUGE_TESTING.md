# Deluge Container Testing Guide

This document describes testing the DelugeAdapter against both linuxserver.io and official Deluge containers to identify differences and ensure compatibility.

## Container Setup

### Available Containers

**linuxserver.io (Community-maintained)**
- Image: `linuxserver/deluge:latest`
- Container name: `deluge-linuxserver-test`
- Web UI: `http://localhost:8112`
- RPC endpoint: `http://localhost:8112/json`
- Default credentials: admin/deluge (typical for linuxserver)

**Official Deluge**
- Image: `deluge/deluge:latest`
- Container name: `deluge-official-test`
- Web UI: `http://localhost:8113`
- RPC endpoint: `http://localhost:8113/json`
- Default credentials: (check official docs)

### Starting Both Containers

```bash
docker-compose up -d deluge-linuxserver deluge-official
```

Check status:
```bash
docker-compose ps | grep deluge
```

View logs:
```bash
docker-compose logs -f deluge-linuxserver
docker-compose logs -f deluge-official
```

Stop one:
```bash
docker-compose down deluge-official
```

## Known Differences to Test

| Aspect | linuxserver.io | Official | Status |
|--------|-----------------|----------|--------|
| **Authentication** | May not require auth by default | Requires auth | ⚠️ Needs testing |
| **Web UI Path** | `/` or `/ui/` | Check docs | ⚠️ Needs testing |
| **RPC Endpoint** | `/json` | Check docs | ⚠️ Needs testing |
| **Session Cookie** | Behavior unknown | Behavior unknown | ⚠️ Needs testing |
| **API Calls** | `core.get_torrents_status` | Same? | ⚠️ Needs testing |
| **Error Messages** | Format unknown | Format unknown | ⚠️ Needs testing |
| **Default Port** | 8112 | 8112 | ✓ Same |
| **Volume Structure** | /config | /config | ✓ Same |

## Testing Checklist

### 1. Connection Test
- [ ] Test connection to linuxserver.io (localhost:8112)
- [ ] Test connection to official (localhost:8113)
- [ ] Document which requires authentication
- [ ] Document default credentials for each

### 2. Authentication
- [ ] Verify auth.login() works on linuxserver.io
- [ ] Verify auth.login() works on official
- [ ] Test with wrong credentials
- [ ] Check session cookie handling on each
- [ ] Document any differences

### 3. List Torrents
- [ ] Add sample torrent to linuxserver.io
- [ ] Add sample torrent to official
- [ ] Call `core.get_torrents_status` on each
- [ ] Verify response format is identical
- [ ] Document any field differences
- [ ] Verify status values are the same

### 4. Add Torrent
- [ ] Test `core.add_torrent_magnet` on linuxserver.io
- [ ] Test `core.add_torrent_magnet` on official
- [ ] Test `core.add_torrent_file` on linuxserver.io
- [ ] Test `core.add_torrent_file` on official
- [ ] Verify downloads appear in UI

### 5. Pause/Resume/Delete
- [ ] Test pause on linuxserver.io
- [ ] Test pause on official
- [ ] Test resume on linuxserver.io
- [ ] Test resume on official
- [ ] Test delete on linuxserver.io
- [ ] Test delete on official

### 6. Error Handling
- [ ] Call invalid method on linuxserver.io
- [ ] Call invalid method on official
- [ ] Document error response format
- [ ] Verify adapter handles both formats

## Running Integration Tests

```bash
# Test linuxserver.io Deluge
npm run test:deluge-linuxserver

# Test official Deluge
npm run test:deluge-official

# Test both in sequence
npm run test:deluge-all
```

## Adapter Implementation Notes

Current adapter code location: `background.js` (lines 413-588)

Key methods:
- `_ensureAuthenticated()` - Needs proper auth.login() for official
- `_rpcRaw()` - May need adjustments based on response format
- `_displayStatus()` - Verify status values match both containers

## Expected Outcomes

- [ ] Adapter works with linuxserver.io
- [ ] Adapter works with official Deluge
- [ ] Error handling works for both
- [ ] Docs updated with container compatibility matrix
- [ ] Integration tests cover both containers

## Resources

- **Official Deluge**: https://deluge-torrent.org/
- **Official Docker Image**: https://hub.docker.com/r/deluge/deluge
- **linuxserver.io**: https://www.linuxserver.io/
- **Deluge RPC API**: https://deluge.readthedocs.io/
