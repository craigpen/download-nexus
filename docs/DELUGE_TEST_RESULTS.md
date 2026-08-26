# Deluge Container Testing Results

**Test Date:** 2026-08-26  
**Containers Tested:**
- linuxserver.io Deluge (port 8114)
- spritsail/deluge (port 8113)

---

## Key Findings

### ✅ Similarities (Both Containers Behave Identically)

1. **Web UI Accessibility**: Both return HTTP 200 with HTML content
2. **RPC Endpoint**: Both accessible at `/json` endpoint
3. **Error Response Format**: Identical error structure
   ```json
   {
     "result": null,
     "error": {
       "message": "Unknown method",
       "code": 2
     },
     "id": 1
   }
   ```
4. **Unauthenticated Access**: Both allow RPC calls without authentication (currently returns "Unknown method" error)

### ⚠️ Critical Issue: auth.login() Method Signature

**Problem**: `auth.login()` fails on BOTH containers with identical error:
- **linuxserver.io**: `TypeError: Auth.login() takes 2 positional arguments but 3 were given`
- **spritsail/deluge**: `TypeError: login() takes 2 positional arguments but 3 were given`

**Current Adapter Code** (background.js line 519):
```javascript
const resp = await this._rpc("auth.login", [uri, options]);
```

**Expected Behavior**: Method should accept username and password as separate arguments

**What's Happening**: The error indicates the method is receiving 3 arguments when it expects only 2:
- Argument 1: self (implicit)
- Argument 2: ??? (only one other argument expected)
- Argument 3: ??? (extra argument causing error)

**Possible Causes**:
1. Method signature is different than expected
2. Parameters should be passed differently (single dict vs two args)
3. Authentication might work differently in the RPC API
4. Method name might be wrong

---

## Test Data Details

### Test 1: Web UI Accessibility
| Container | Status | Content-Type |
|-----------|--------|--------------|
| linuxserver.io | 200 | text/html; charset=utf-8 |
| spritsail/deluge | 200 | text/html; charset=utf-8 |

### Test 2: RPC Endpoint
| Container | Status | Content-Type | Set-Cookie |
|-----------|--------|--------------|------------|
| linuxserver.io | 200 | application/json | No |
| spritsail/deluge | 200 | application/json | No |

### Test 3a: Unauthenticated RPC Call
Both containers respond to `core.get_torrents_status` without auth:
- Status: 200
- Response: `{"result": null, "error": {"message": "Unknown method", "code": 2}}`

This indicates both allow the RPC call but don't recognize the method (possibly because we're using the wrong calling convention).

### Test 3b: auth.login() Method
| Container | Method Error | Set-Cookie |
|-----------|-------------|------------|
| linuxserver.io | Auth.login() takes 2 positional arguments but 3 were given | No |
| spritsail/deluge | login() takes 2 positional arguments but 3 were given | No |

### Test 4: API Calls (core.get_torrents_status & core.get_config)
Both containers respond with "Unknown method" errors - likely because authentication failed in Test 3.

### Test 5: Error Handling
Both containers return identical error structure with code 2 for unknown methods.

---

## Next Steps

### 1. Fix auth.login() Method Call
Need to research the correct Deluge RPC auth method:
- Check if it's `auth.login(username, password)` or `auth.login({username, password})`
- Check if the method requires only username (password optional)
- Review Deluge documentation for RPC auth method signature

### 2. Possible Solutions
```javascript
// Option A: Single parameter dict
await this._rpc("auth.login", [{ username, password }]);

// Option B: Positional arguments (current, but might be wrong)
await this._rpc("auth.login", [username, password]);

// Option C: Only username (if password is stored differently)
await this._rpc("auth.login", [username]);

// Option D: Different method name
await this._rpc("auth.check_password", [username, password]);
```

### 3. Test Plan
Once we identify the correct method signature:
1. Test auth.login() with correct parameters
2. Test core.get_config() after successful auth
3. Test core.get_torrents_status() after successful auth
4. Verify session management (cookies/tokens)
5. Test on both containers to confirm compatibility

---

## Conclusion

**Finding**: Both containers are functionally equivalent at the RPC level. The primary issue is not with container differences but with how the adapter calls the `auth.login()` method.

**Recommendation**: Fix the auth.login() method signature and test with both containers. Since they're identical, we can support both with a single implementation.

---

## Resources
- Deluge RPC Documentation: https://deluge.readthedocs.io/
- Method Reference: https://deluge.readthedocs.io/developers/rpc/methods/
- linuxserver.io Deluge: https://docs.linuxserver.io/images/docker-deluge
- spritsail/deluge: https://github.com/spritsail/deluge
