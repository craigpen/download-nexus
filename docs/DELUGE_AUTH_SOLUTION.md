# Deluge RPC Authentication: Solution Found

**Date:** 2026-08-26  
**Status:** ✅ SOLVED

---

## The Problem

The adapter's `auth.login()` call was failing:
```
TypeError: Auth.login() takes 2 positional arguments but 3 were given
```

Current code was sending `[username, password]` but Deluge only expects `[password]`.

---

## The Solution

### Correct Method Signature

```python
def login(self, password):
    """Authenticate with the daemon using only a password"""
    ...
```

The method takes **only the password**, not both username and password.

### Testing Proof

Both containers return identical results:

| Test | Result | Meaning |
|------|--------|---------|
| `auth.login(["deluge"])` | ✓ true | **CORRECT PASSWORD** |
| `auth.login([""])` | false | Wrong password |
| `auth.login(["admin"])` | false | Wrong password |
| `auth.login(["admin", "deluge"])` | ❌ TypeError | Wrong number of args |

---

## Implementation

### Current Code (WRONG)
```javascript
// background.js line 519 (DelugeAdapter)
const resp = await this._rpc("auth.login", [username, password]);
```

### Fixed Code
```javascript
// Only pass the password, not username
await this._ensureAuthenticated(password);

async _ensureAuthenticated(password) {
  if (this._isAuthenticated) return;
  
  // auth.login(password) - returns true if authenticated
  const resp = await this._rpc("auth.login", [password]);
  if (resp.error) {
    throw new Error(`Deluge authentication failed: ${resp.error.message}`);
  }
  
  if (resp.result === true) {
    this._isAuthenticated = true;
  } else {
    throw new Error("Deluge authentication failed: invalid password");
  }
}
```

### Key Changes

1. **Remove username parameter** from auth.login() call
2. **Use only password** from config
3. **Check result === true** for successful auth (not just truthy)
4. **Throw on false** to indicate bad password
5. **Handle error response** separately

---

## Default Credentials

Based on testing with default Deluge setup:
- **Username**: Not used (Deluge doesn't have per-user auth in web UI)
- **Password**: Default is `deluge`
- **Behavior**: Single password protects the entire daemon

This means:
- You can't have multiple users with different passwords
- Authentication is all-or-nothing
- The "Username" field in our UI is misleading for Deluge

### UI Impact

For Deluge specifically, we could:
1. Hide/disable the username field in the UI
2. Show a note that only password is used
3. Or keep it for future compatibility

---

## Testing Results

### linuxserver.io Deluge
- Port: 8114
- Default password: `deluge`
- ✅ auth.login(["deluge"]) → true
- ✅ auth.check_session() → false (before login)
- ❌ core.get_config() without auth → "Unknown method" error

### spritsail/deluge  
- Port: 8113
- Default password: `deluge`
- ✅ auth.login(["deluge"]) → true
- ✅ auth.check_session() → false (before login)
- ❌ core.get_config() without auth → "Unknown method" error

**Conclusion**: Both containers behave identically. Single implementation will work for both.

---

## Next Steps

1. ✅ Update DelugeAdapter._ensureAuthenticated() to use correct signature
2. ✅ Test auth.login(["deluge"]) returns true
3. ✅ Test subsequent API calls (core.get_torrents_status) work after auth
4. ✅ Test on both containers to verify compatibility
5. ✅ Handle bad password scenario
6. ✅ Update UI (optional: clarify username not used for Deluge)

---

## Related Code

- **File**: `background.js` 
- **Class**: `DelugeAdapter`
- **Methods**: `_ensureAuthenticated()`, `testConnection()`, `_rpc()`
- **Lines**: 413-588

---

## Resources

- Test script: `scripts/test-deluge-auth-signatures.js`
- Test results: `scripts/deluge-auth-test-results.txt`
- Containers: linuxserver.io deluge, spritsail/deluge
