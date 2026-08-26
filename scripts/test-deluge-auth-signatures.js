#!/usr/bin/env node

/**
 * Test different auth.login() method signatures against Deluge RPC
 */

const containers = [
  { name: 'linuxserver.io', url: 'http://localhost:8114/json' },
  { name: 'spritsail/deluge', url: 'http://localhost:8113/json' }
];

async function testAuthSignature(container, signature, params) {
  console.log(`\n  Testing: auth.${signature}(${JSON.stringify(params)})`);
  try {
    const resp = await fetch(container.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: `auth.${signature}`,
        params: params,
        id: Date.now()
      })
    });
    const data = await resp.json();

    if (data.error) {
      console.log(`    ✗ Error: ${data.error.message}`);
      return { error: data.error.message };
    } else if (data.result === null) {
      console.log(`    ? Result: null (might need auth first)`);
      return { result: null };
    } else {
      console.log(`    ✓ Success: ${JSON.stringify(data.result)}`);
      return { result: data.result };
    }
  } catch (err) {
    console.log(`    ✗ Exception: ${err.message}`);
    return { exception: err.message };
  }
}

async function testContainer(container) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${container.name}`);
  console.log(`URL: ${container.url}`);
  console.log('='.repeat(60));

  console.log('\n1️⃣  Testing auth.login() with various signatures:');

  // Test 1: Two separate arguments (current, broken)
  await testAuthSignature(container, 'login', ['admin', 'deluge']);

  // Test 2: Single dict argument
  await testAuthSignature(container, 'login', [{ username: 'admin', password: 'deluge' }]);

  // Test 3: Just password (assuming default user)
  await testAuthSignature(container, 'login', ['deluge']);

  // Test 4: Empty password
  await testAuthSignature(container, 'login', ['']);

  // Test 5: Username only
  await testAuthSignature(container, 'login', ['admin']);

  console.log('\n2️⃣  Testing other auth methods:');

  // Test auth.check_password()
  await testAuthSignature(container, 'check_password', ['deluge']);
  await testAuthSignature(container, 'check_password', ['admin', 'deluge']);

  // Test auth.set_password()
  await testAuthSignature(container, 'set_password', ['newpass']);
  await testAuthSignature(container, 'set_password', ['admin', 'deluge']);

  // Test auth.get_auth_levels()
  await testAuthSignature(container, 'get_auth_levels', []);

  // Test auth.check_session()
  await testAuthSignature(container, 'check_session', []);

  console.log('\n3️⃣  After failed auth, testing if we need session first:');

  // Maybe we need to establish a session first?
  console.log('\n  Trying to call core.get_config without auth:');
  try {
    const resp = await fetch(container.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'core.get_config',
        params: [],
        id: 1
      })
    });
    const data = await resp.json();
    if (data.error) {
      console.log(`    Result: Error - ${data.error.message}`);
      console.log(`    (Indicates auth IS required)`);
    } else {
      console.log(`    Result: Success - auth NOT required!`);
      console.log(`    Config keys: ${Object.keys(data.result || {}).length}`);
    }
  } catch (err) {
    console.log(`    Exception: ${err.message}`);
  }

  console.log('\n4️⃣  Testing web UI credentials (admin/deluge default):');
  // Maybe default is admin/deluge? Or empty password?
  const credTests = [
    { user: 'admin', pass: 'deluge' },
    { user: 'admin', pass: '' },
    { user: '', pass: '' },
    { user: 'deluge', pass: 'deluge' },
  ];

  for (const creds of credTests) {
    console.log(`\n  Trying user="${creds.user}", pass="${creds.pass}"`);
    await testAuthSignature(container, 'login', [creds.user, creds.pass]);
  }
}

async function main() {
  console.log('\n🔐 Deluge RPC Auth.login() Signature Research');
  console.log(`Started: ${new Date().toISOString()}\n`);

  for (const container of containers) {
    await testContainer(container);
  }

  console.log(`\n\n${'='.repeat(60)}`);
  console.log('📝 ANALYSIS');
  console.log('='.repeat(60));
  console.log(`
Based on the tests above, determine:
1. Which auth method signature works?
2. What credentials are needed?
3. Is auth mandatory or optional?
4. How are sessions managed?

Look for:
- ✓ Success responses (result is true or non-null)
- ? Null results (might mean success with no data)
- ✗ Errors with different messages (some might be auth errors, others might be method not found)
  `);
}

main().catch(console.error);
