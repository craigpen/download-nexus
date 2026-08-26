#!/usr/bin/env node

/**
 * Direct test of qBittorrent auth - mimics the extension's _login() method
 */

const http = require('http');
const querystring = require('querystring');

async function testQBittorrentAuth() {
  const config = {
    host: 'localhost',
    port: 8080,
    https: false,
    username: 'admin',
    password: 'adminadmin'
  };

  const scheme = config.https ? 'https' : 'http';
  const url = `${scheme}://${config.host}:${config.port}/api/v2/auth/login`;

  const body = new URLSearchParams();
  body.append('username', config.username);
  body.append('password', config.password);

  console.log(`[Test] POST to ${url}`);
  console.log(`[Test] Body: ${body.toString()}`);
  console.log(`[Test] Sending request...`);

  return new Promise((resolve, reject) => {
    const bodyString = body.toString();
    const options = {
      hostname: config.host,
      port: config.port,
      path: '/api/v2/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyString)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        console.log(`[Test] Status: ${res.statusCode}`);
        console.log(`[Test] Headers:`, res.headers);
        console.log(`[Test] Response body: ${data}`);
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('error', (e) => {
      console.error(`[Test] Error: ${e.message}`);
      reject(e);
    });

    req.write(bodyString);
    req.end();
  });
}

testQBittorrentAuth()
  .then((result) => {
    if (result.status === 204 || result.status === 200) {
      console.log(`\n✅ SUCCESS: qBittorrent auth works!`);
      process.exit(0);
    } else {
      console.log(`\n❌ FAILED: Got status ${result.status}`);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error(`\n❌ ERROR: ${err.message}`);
    process.exit(1);
  });
