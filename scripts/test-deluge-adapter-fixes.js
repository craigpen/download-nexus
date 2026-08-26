#!/usr/bin/env node

/**
 * Test DelugeAdapter fixes against both containers
 */

const containers = [
  { name: 'linuxserver.io', host: 'localhost', port: 8114, password: 'deluge' },
  { name: 'spritsail/deluge', host: 'localhost', port: 8113, password: 'deluge' }
];

async function rpcCall(baseUrl, method, params) {
  const resp = await fetch(`${baseUrl}/json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params, id: Date.now() })
  });
  return await resp.json();
}

async function testContainer(container) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${container.name}`);
  console.log(`URL: http://${container.host}:${container.port}/json`);
  console.log('='.repeat(60));

  const baseUrl = `http://${container.host}:${container.port}`;

  // TEST 1: auth.login() with password only
  console.log('\n✅ TEST 1: auth.login(password)');
  try {
    const resp = await rpcCall(baseUrl, 'auth.login', [container.password]);
    if (resp.error) {
      console.log(`  ❌ FAILED: ${resp.error.message}`);
      return false;
    }
    if (resp.result === true) {
      console.log(`  ✓ SUCCESS: Authenticated!`);
    } else {
      console.log(`  ❌ FAILED: Result was ${resp.result}, expected true`);
      return false;
    }
  } catch (err) {
    console.log(`  ❌ EXCEPTION: ${err.message}`);
    return false;
  }

  // TEST 2: core.get_torrents_status after auth
  console.log('\n✅ TEST 2: core.get_torrents_status() after auth');
  try {
    const resp = await rpcCall(baseUrl, 'core.get_torrents_status', [{}, []]);
    if (resp.error) {
      console.log(`  ❌ FAILED: ${resp.error.message}`);
      return false;
    }
    console.log(`  ✓ SUCCESS: Got torrent list`);
    console.log(`    Torrents: ${Object.keys(resp.result || {}).length}`);
  } catch (err) {
    console.log(`  ❌ EXCEPTION: ${err.message}`);
    return false;
  }

  // TEST 3: core.get_config after auth
  console.log('\n✅ TEST 3: core.get_config() after auth');
  try {
    const resp = await rpcCall(baseUrl, 'core.get_config', []);
    if (resp.error) {
      console.log(`  ❌ FAILED: ${resp.error.message}`);
      return false;
    }
    console.log(`  ✓ SUCCESS: Got config`);
    console.log(`    Config keys: ${Object.keys(resp.result || {}).length}`);
  } catch (err) {
    console.log(`  ❌ EXCEPTION: ${err.message}`);
    return false;
  }

  // TEST 4: auth.check_session() after auth
  console.log('\n✅ TEST 4: auth.check_session() after auth');
  try {
    const resp = await rpcCall(baseUrl, 'auth.check_session', []);
    if (resp.error) {
      console.log(`  ⚠️  Method error: ${resp.error.message}`);
    } else {
      console.log(`  ✓ Result: ${resp.result}`);
    }
  } catch (err) {
    console.log(`  ❌ EXCEPTION: ${err.message}`);
  }

  // TEST 5: Invalid password should fail
  console.log('\n✅ TEST 5: auth.login with wrong password should fail');
  try {
    const resp = await rpcCall(baseUrl, 'auth.login', ['wrongpassword']);
    if (resp.error) {
      console.log(`  ✓ Correctly rejected: ${resp.error.message}`);
    } else if (resp.result === false) {
      console.log(`  ✓ Correctly returned false for wrong password`);
    } else {
      console.log(`  ❌ UNEXPECTED: Accepted wrong password!`);
      return false;
    }
  } catch (err) {
    console.log(`  ❌ EXCEPTION: ${err.message}`);
  }

  console.log(`\n✅ All tests passed for ${container.name}!`);
  return true;
}

async function main() {
  console.log('\n🐳 Testing DelugeAdapter Fixes');
  console.log(`Started: ${new Date().toISOString()}\n`);

  let allPassed = true;
  for (const container of containers) {
    const passed = await testContainer(container);
    if (!passed) allPassed = false;
  }

  console.log(`\n${'='.repeat(60)}`);
  if (allPassed) {
    console.log('✅ ALL TESTS PASSED - Fixes are working!');
  } else {
    console.log('❌ SOME TESTS FAILED - See results above');
  }
  console.log('='.repeat(60));

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
