#!/usr/bin/env node

/**
 * Test script to compare linuxserver.io and official Deluge containers
 * Run with: node scripts/test-deluge-containers.js
 */

const containers = [
  {
    name: 'linuxserver.io',
    host: 'localhost',
    port: 8114,
    webUI: 'http://localhost:8114',
    rpcUrl: 'http://localhost:8114/json'
  },
  {
    name: 'spritsail/deluge',
    host: 'localhost',
    port: 8113,
    webUI: 'http://localhost:8113',
    rpcUrl: 'http://localhost:8113/json'
  }
];

const results = {};

async function testContainer(container) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${container.name} Deluge`);
  console.log(`Port: ${container.port}`);
  console.log(`RPC URL: ${container.rpcUrl}`);
  console.log(`${'='.repeat(60)}\n`);

  results[container.name] = {};

  // Test 1: Web UI Accessibility
  await testWebUI(container);

  // Test 2: RPC Endpoint Accessibility
  await testRPCEndpoint(container);

  // Test 3: Authentication
  await testAuthentication(container);

  // Test 4: API Calls (if authenticated)
  await testAPICalls(container);

  // Test 5: Error Handling
  await testErrorHandling(container);
}

async function testWebUI(container) {
  console.log('📋 TEST 1: Web UI Accessibility');
  try {
    const resp = await fetch(container.webUI, { timeout: 5000 });
    results[container.name].webUI = {
      status: resp.status,
      ok: resp.ok,
      contentType: resp.headers.get('content-type'),
      timestamp: new Date().toISOString()
    };
    console.log(`  ✓ Status: ${resp.status}`);
    console.log(`  ✓ Content-Type: ${resp.headers.get('content-type')}`);
  } catch (err) {
    results[container.name].webUI = { error: err.message };
    console.log(`  ✗ Failed: ${err.message}`);
  }
}

async function testRPCEndpoint(container) {
  console.log('\n📋 TEST 2: RPC Endpoint');
  try {
    const resp = await fetch(container.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'core.get_torrents_status', params: [{}, []], id: 1 })
    });
    const data = await resp.text();
    results[container.name].rpcEndpoint = {
      status: resp.status,
      ok: resp.ok,
      headers: {
        contentType: resp.headers.get('content-type'),
        setCookie: resp.headers.get('set-cookie') ? 'Yes' : 'No'
      },
      responsePreview: data.substring(0, 200)
    };
    console.log(`  ✓ Status: ${resp.status}`);
    console.log(`  ✓ Content-Type: ${resp.headers.get('content-type')}`);
    console.log(`  ✓ Set-Cookie header: ${resp.headers.get('set-cookie') ? 'Yes' : 'No'}`);
    console.log(`  ✓ Response preview: ${data.substring(0, 100)}...`);
  } catch (err) {
    results[container.name].rpcEndpoint = { error: err.message };
    console.log(`  ✗ Failed: ${err.message}`);
  }
}

async function testAuthentication(container) {
  console.log('\n📋 TEST 3: Authentication');

  // Test 3a: RPC call without auth
  console.log('  [3a] Unauthenticated RPC call...');
  try {
    const resp = await fetch(container.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'core.get_config', params: [], id: 1 })
    });
    const data = await resp.json();
    results[container.name].authNoAuth = {
      status: resp.status,
      hasError: !!data.error,
      errorMessage: data.error?.message || 'No error',
      succeeded: !!data.result
    };
    console.log(`    Status: ${resp.status}`);
    console.log(`    Has error: ${!!data.error}`);
    if (data.error) console.log(`    Error: ${data.error.message}`);
    if (data.result) console.log(`    Result: ${JSON.stringify(data.result).substring(0, 100)}`);
  } catch (err) {
    results[container.name].authNoAuth = { error: err.message };
    console.log(`    ✗ Failed: ${err.message}`);
  }

  // Test 3b: auth.login() call
  console.log('  [3b] auth.login() RPC call...');
  try {
    const resp = await fetch(container.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'auth.login', params: ['admin', 'deluge'], id: 2 })
    });
    const data = await resp.json();
    results[container.name].authLogin = {
      status: resp.status,
      hasError: !!data.error,
      errorMessage: data.error?.message || 'No error',
      result: data.result,
      setCookie: resp.headers.get('set-cookie') ? 'Yes' : 'No'
    };
    console.log(`    Status: ${resp.status}`);
    console.log(`    Set-Cookie: ${resp.headers.get('set-cookie') ? 'Yes' : 'No'}`);
    console.log(`    Result: ${data.result}`);
    if (data.error) console.log(`    Error: ${data.error.message}`);
  } catch (err) {
    results[container.name].authLogin = { error: err.message };
    console.log(`    ✗ Failed: ${err.message}`);
  }

  // Test 3c: Test with empty credentials
  console.log('  [3c] auth.login() with empty password...');
  try {
    const resp = await fetch(container.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'auth.login', params: ['admin', ''], id: 3 })
    });
    const data = await resp.json();
    results[container.name].authEmptyPassword = {
      status: resp.status,
      result: data.result,
      errorMessage: data.error?.message || 'No error'
    };
    console.log(`    Status: ${resp.status}`);
    console.log(`    Result: ${data.result}`);
    if (data.error) console.log(`    Error: ${data.error.message}`);
  } catch (err) {
    results[container.name].authEmptyPassword = { error: err.message };
    console.log(`    ✗ Failed: ${err.message}`);
  }
}

async function testAPICalls(container) {
  console.log('\n📋 TEST 4: API Calls');

  // Test 4a: core.get_torrents_status (empty)
  console.log('  [4a] core.get_torrents_status...');
  try {
    const resp = await fetch(container.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'core.get_torrents_status', params: [{}, []], id: 4 })
    });
    const data = await resp.json();
    results[container.name].getStatus = {
      status: resp.status,
      hasError: !!data.error,
      resultType: typeof data.result,
      resultKeys: data.result ? Object.keys(data.result).length : 0,
      errorMessage: data.error?.message || 'No error'
    };
    console.log(`    Status: ${resp.status}`);
    console.log(`    Result type: ${typeof data.result}`);
    console.log(`    Torrents found: ${data.result ? Object.keys(data.result).length : 0}`);
    if (data.error) console.log(`    Error: ${data.error.message}`);
  } catch (err) {
    results[container.name].getStatus = { error: err.message };
    console.log(`    ✗ Failed: ${err.message}`);
  }

  // Test 4b: core.get_config
  console.log('  [4b] core.get_config...');
  try {
    const resp = await fetch(container.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'core.get_config', params: [], id: 5 })
    });
    const data = await resp.json();
    results[container.name].getConfig = {
      status: resp.status,
      hasError: !!data.error,
      resultType: typeof data.result,
      resultKeys: data.result ? Object.keys(data.result).length : 0,
      errorMessage: data.error?.message || 'No error'
    };
    console.log(`    Status: ${resp.status}`);
    console.log(`    Result type: ${typeof data.result}`);
    console.log(`    Config keys: ${data.result ? Object.keys(data.result).length : 0}`);
    if (data.error) console.log(`    Error: ${data.error.message}`);
  } catch (err) {
    results[container.name].getConfig = { error: err.message };
    console.log(`    ✗ Failed: ${err.message}`);
  }
}

async function testErrorHandling(container) {
  console.log('\n📋 TEST 5: Error Handling');

  // Test 5a: Invalid method
  console.log('  [5a] Invalid method call...');
  try {
    const resp = await fetch(container.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'invalid.method', params: [], id: 6 })
    });
    const data = await resp.json();
    results[container.name].errorInvalidMethod = {
      status: resp.status,
      error: {
        message: data.error?.message,
        code: data.error?.code
      }
    };
    console.log(`    Status: ${resp.status}`);
    console.log(`    Error code: ${data.error?.code}`);
    console.log(`    Error message: ${data.error?.message}`);
  } catch (err) {
    results[container.name].errorInvalidMethod = { error: err.message };
    console.log(`    ✗ Failed: ${err.message}`);
  }

  // Test 5b: Malformed JSON
  console.log('  [5b] Malformed JSON...');
  try {
    const resp = await fetch(container.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid json'
    });
    results[container.name].errorMalformed = {
      status: resp.status,
      contentType: resp.headers.get('content-type')
    };
    console.log(`    Status: ${resp.status}`);
    console.log(`    Content-Type: ${resp.headers.get('content-type')}`);
  } catch (err) {
    results[container.name].errorMalformed = { error: err.message };
    console.log(`    ✗ Failed: ${err.message}`);
  }
}

async function main() {
  console.log('\n🐳 Deluge Container Comparison Test');
  console.log(`Started: ${new Date().toISOString()}\n`);

  for (const container of containers) {
    await testContainer(container);
  }

  // Generate comparison report
  console.log(`\n\n${'='.repeat(60)}`);
  console.log('📊 COMPARISON REPORT');
  console.log(`${'='.repeat(60)}\n`);

  // Web UI comparison
  console.log('Web UI Accessibility:');
  console.log(`  linuxserver.io: ${results['linuxserver.io'].webUI.status || results['linuxserver.io'].webUI.error}`);
  console.log(`  Official:       ${results['Official'].webUI.status || results['Official'].webUI.error}`);

  // RPC endpoint comparison
  console.log('\nRPC Endpoint:');
  console.log(`  linuxserver.io: ${results['linuxserver.io'].rpcEndpoint.status || 'Error'}`);
  console.log(`  Official:       ${results['Official'].rpcEndpoint.status || 'Error'}`);

  // Authentication comparison
  console.log('\nAuthentication Required:');
  const lsAuthNoAuth = results['linuxserver.io'].authNoAuth.succeeded;
  const offAuthNoAuth = results['Official'].authNoAuth.succeeded;
  console.log(`  linuxserver.io (no auth): ${lsAuthNoAuth ? '❌ Works without auth' : '✓ Requires auth'}`);
  console.log(`  Official (no auth):       ${offAuthNoAuth ? '❌ Works without auth' : '✓ Requires auth'}`);

  const lsAuthLogin = results['linuxserver.io'].authLogin.result;
  const offAuthLogin = results['Official'].authLogin.result;
  console.log(`  linuxserver.io (auth.login): ${lsAuthLogin ? '✓ Works' : '❌ Failed'}`);
  console.log(`  Official (auth.login):       ${offAuthLogin ? '✓ Works' : '❌ Failed'}`);

  // API calls comparison
  console.log('\nAPI Calls (core.get_torrents_status):');
  console.log(`  linuxserver.io: ${results['linuxserver.io'].getStatus.hasError ? '❌ Error' : '✓ Works'}`);
  console.log(`  Official:       ${results['Official'].getStatus.hasError ? '❌ Error' : '✓ Works'}`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📝 SUMMARY OF FINDINGS');
  console.log('='.repeat(60));
  console.log('\nKey Differences:');
  if (lsAuthNoAuth !== offAuthNoAuth) {
    console.log('  ⚠️  Authentication requirement differs between containers');
  }
  if (lsAuthLogin !== offAuthLogin) {
    console.log('  ⚠️  auth.login() behavior differs between containers');
  }
  console.log('\n✓ Full results saved to test-deluge-results.json');

  // Save results to file
  const fs = require('fs');
  fs.writeFileSync(
    'test-deluge-results.json',
    JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2)
  );

  console.log('\nNext steps:');
  console.log('  1. Review the differences noted above');
  console.log('  2. Implement conditional auth handling in DelugeAdapter');
  console.log('  3. Test adapter against both containers');
}

main().catch(console.error);
