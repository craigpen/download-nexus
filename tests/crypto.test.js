const {
  encryptCredentials,
  decryptCredentials,
  deriveKey,
  buf2hex,
  hex2buf,
  buf2b64,
  b642buf
} = require('../src/crypto');

describe('Cryptographic Backup Encryption & Decryption', () => {
  const mockCredentials = {
    'syn-1': { password: 'MySecretPassword123!', apiToken: '' },
    'qbit-1': { password: '', apiToken: 'token_abc_xyz_987' },
    'deluge-1': { password: 'delugePassword#$%' }
  };

  test('should successfully encrypt and decrypt credentials with correct password', async () => {
    const password = 'SuperSecureBackupPassword!';
    const envelope = await encryptCredentials(mockCredentials, password);

    expect(envelope).toBeDefined();
    expect(envelope.version).toBe(1);
    expect(envelope.algorithm).toBe('AES-GCM-256');
    expect(envelope.kdf).toBe('PBKDF2-SHA256');
    expect(envelope.iterations).toBe(100000);
    expect(typeof envelope.salt).toBe('string');
    expect(typeof envelope.iv).toBe('string');
    expect(typeof envelope.ciphertext).toBe('string');
    expect(envelope.salt.length).toBe(32); // 16 bytes hex = 32 chars
    expect(envelope.iv.length).toBe(24);   // 12 bytes hex = 24 chars

    // Decrypt
    const decrypted = await decryptCredentials(envelope, password);
    expect(decrypted).toEqual(mockCredentials);
  });

  test('should fail decryption when using wrong password', async () => {
    const envelope = await encryptCredentials(mockCredentials, 'CorrectPassword123');
    await expect(decryptCredentials(envelope, 'WrongPassword456'))
      .rejects
      .toThrow('Incorrect password or corrupted backup data.');
  });

  test('should fail decryption when ciphertext is tampered with', async () => {
    const envelope = await encryptCredentials(mockCredentials, 'ValidPassword');
    // Corrupt ciphertext
    const corrupted = { ...envelope, ciphertext: 'AAAA' + envelope.ciphertext.slice(4) };
    await expect(decryptCredentials(corrupted, 'ValidPassword'))
      .rejects
      .toThrow('Incorrect password or corrupted backup data.');
  });

  test('should reject encryption when password is empty', async () => {
    await expect(encryptCredentials(mockCredentials, ''))
      .rejects
      .toThrow('Encryption password is required.');
    await expect(encryptCredentials(mockCredentials, '   '))
      .rejects
      .toThrow('Encryption password is required.');
  });

  // ── Encryption input validation ───────────────────────────────────────────

  describe('encryption password validation', () => {
    test.each([
      ['undefined', undefined],
      ['null', null],
      ['a number', 12345],
      ['an object', { pw: 'x' }],
      ['an array', ['x']],
      ['a tab/newline-only string', '\t\n  ']
    ])('rejects %s as a password', async (_label, badPassword) => {
      await expect(encryptCredentials(mockCredentials, badPassword))
        .rejects.toThrow('Encryption password is required.');
    });

    test('accepts a password that merely contains whitespace', async () => {
      const envelope = await encryptCredentials(mockCredentials, 'my pass phrase');
      await expect(decryptCredentials(envelope, 'my pass phrase'))
        .resolves.toEqual(mockCredentials);
    });

    test('a single character password is permitted', async () => {
      const envelope = await encryptCredentials(mockCredentials, 'x');
      await expect(decryptCredentials(envelope, 'x')).resolves.toEqual(mockCredentials);
    });
  });

  // ── Envelope shape validation on decrypt ──────────────────────────────────

  describe('decryption envelope validation', () => {
    let validEnvelope;

    beforeAll(async () => {
      validEnvelope = await encryptCredentials(mockCredentials, 'pw');
    });

    test.each([
      ['undefined', undefined],
      ['null', null],
      ['an empty object', {}]
    ])('rejects %s as an envelope', async (_label, envelope) => {
      await expect(decryptCredentials(envelope, 'pw'))
        .rejects.toThrow('Invalid encrypted credentials format.');
    });

    test.each(['ciphertext', 'salt', 'iv'])('rejects an envelope missing %s', async (field) => {
      const broken = { ...validEnvelope };
      delete broken[field];
      await expect(decryptCredentials(broken, 'pw'))
        .rejects.toThrow('Invalid encrypted credentials format.');
    });

    test.each([
      ['undefined', undefined],
      ['null', null],
      ['an empty string', '']
    ])('rejects %s as a decryption password', async (_label, badPassword) => {
      await expect(decryptCredentials(validEnvelope, badPassword))
        .rejects.toThrow('Password is required for decryption.');
    });

    test('checks the password before the envelope shape', async () => {
      // Both are invalid; the password error should surface first.
      await expect(decryptCredentials({}, ''))
        .rejects.toThrow('Password is required for decryption.');
    });

    test('rejects a tampered salt', async () => {
      const tampered = { ...validEnvelope, salt: 'f'.repeat(32) };
      await expect(decryptCredentials(tampered, 'pw'))
        .rejects.toThrow('Incorrect password or corrupted backup data.');
    });

    test('rejects a tampered IV', async () => {
      const tampered = { ...validEnvelope, iv: '0'.repeat(24) };
      await expect(decryptCredentials(tampered, 'pw'))
        .rejects.toThrow('Incorrect password or corrupted backup data.');
    });

    test('rejects an envelope whose iteration count was altered', async () => {
      // Changing iterations derives a different key, so the GCM tag fails.
      const tampered = { ...validEnvelope, iterations: 50000 };
      await expect(decryptCredentials(tampered, 'pw'))
        .rejects.toThrow('Incorrect password or corrupted backup data.');
    });

    test('truncated ciphertext is rejected rather than silently partial', async () => {
      const tampered = { ...validEnvelope, ciphertext: validEnvelope.ciphertext.slice(0, 8) };
      await expect(decryptCredentials(tampered, 'pw'))
        .rejects.toThrow('Incorrect password or corrupted backup data.');
    });

    test('defaults to 100000 iterations when the field is absent', async () => {
      const noIterations = { ...validEnvelope };
      delete noIterations.iterations;
      // The envelope was produced with the 100000 default, so it still opens.
      await expect(decryptCredentials(noIterations, 'pw')).resolves.toEqual(mockCredentials);
    });
  });

  // ── Round-trip fidelity ───────────────────────────────────────────────────

  describe('round-trip fidelity', () => {
    const roundTrip = async (payload, password = 'pw') =>
      decryptCredentials(await encryptCredentials(payload, password), password);

    test('preserves an empty credentials map', async () => {
      await expect(roundTrip({})).resolves.toEqual({});
    });

    test('preserves unicode and emoji passwords in the payload', async () => {
      const payload = { 's1': { password: 'pässwörd-日本語-🔐', apiToken: '' } };
      await expect(roundTrip(payload)).resolves.toEqual(payload);
    });

    test('works with a unicode encryption password', async () => {
      const payload = { 's1': { password: 'secret' } };
      await expect(roundTrip(payload, 'пароль-🔑-中文')).resolves.toEqual(payload);
    });

    test('preserves characters that would break naive query encoding', async () => {
      const payload = { 's1': { password: 'a&b=c?d#e/f\\g"h\'i<j>k' } };
      await expect(roundTrip(payload)).resolves.toEqual(payload);
    });

    test('preserves newlines and tabs inside credentials', async () => {
      const payload = { 's1': { password: 'line1\nline2\ttabbed' } };
      await expect(roundTrip(payload)).resolves.toEqual(payload);
    });

    test('preserves nested structures and non-string values', async () => {
      const payload = {
        's1': { password: 'p', apiToken: '', extra: { nested: [1, 2, 3], flag: true, n: null } }
      };
      await expect(roundTrip(payload)).resolves.toEqual(payload);
    });

    test('handles a large credentials map', async () => {
      const payload = {};
      for (let i = 0; i < 200; i++) {
        payload[`svc-${i}`] = { password: `pw-${i}-${'x'.repeat(50)}`, apiToken: `tok-${i}` };
      }
      await expect(roundTrip(payload)).resolves.toEqual(payload);
    });

    test('preserves a long password near typical field limits', async () => {
      const payload = { 's1': { password: 'z'.repeat(4096) } };
      await expect(roundTrip(payload)).resolves.toEqual(payload);
    });
  });

  // ── Non-determinism / uniqueness guarantees ───────────────────────────────

  describe('salt and IV uniqueness', () => {
    test('produces a distinct salt, IV and ciphertext for identical inputs', async () => {
      const a = await encryptCredentials(mockCredentials, 'samePassword');
      const b = await encryptCredentials(mockCredentials, 'samePassword');

      expect(a.salt).not.toBe(b.salt);
      expect(a.iv).not.toBe(b.iv);
      expect(a.ciphertext).not.toBe(b.ciphertext);
    });

    test('both independently-encrypted envelopes decrypt to the same plaintext', async () => {
      const a = await encryptCredentials(mockCredentials, 'samePassword');
      const b = await encryptCredentials(mockCredentials, 'samePassword');

      expect(await decryptCredentials(a, 'samePassword'))
        .toEqual(await decryptCredentials(b, 'samePassword'));
    });

    test('generates unique salts across many encryptions', async () => {
      const envelopes = await Promise.all(
        Array.from({ length: 12 }, () => encryptCredentials(mockCredentials, 'pw'))
      );
      const salts = new Set(envelopes.map((e) => e.salt));
      const ivs = new Set(envelopes.map((e) => e.iv));

      expect(salts.size).toBe(12);
      expect(ivs.size).toBeGreaterThan(1);
    });

    test('ciphertext does not contain the plaintext secret', async () => {
      const envelope = await encryptCredentials(
        { 's1': { password: 'UNIQUE_PLAINTEXT_MARKER' } },
        'pw'
      );
      const asText = Buffer.from(envelope.ciphertext, 'base64').toString('latin1');
      expect(asText).not.toContain('UNIQUE_PLAINTEXT_MARKER');
      expect(envelope.ciphertext).not.toContain('UNIQUE_PLAINTEXT_MARKER');
    });

    test('a salt of 16 bytes and IV of 12 bytes are emitted as hex', async () => {
      const envelope = await encryptCredentials(mockCredentials, 'pw');
      expect(envelope.salt).toMatch(/^[0-9a-f]{32}$/);
      expect(envelope.iv).toMatch(/^[0-9a-f]{24}$/);
    });

    test('ciphertext is valid base64', async () => {
      const envelope = await encryptCredentials(mockCredentials, 'pw');
      expect(envelope.ciphertext).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    });

    test('envelope is JSON-serialisable and survives a file round-trip', async () => {
      const envelope = await encryptCredentials(mockCredentials, 'pw');
      const reparsed = JSON.parse(JSON.stringify(envelope));
      await expect(decryptCredentials(reparsed, 'pw')).resolves.toEqual(mockCredentials);
    });
  });

  // ── deriveKey ─────────────────────────────────────────────────────────────

  describe('deriveKey()', () => {
    const salt = new Uint8Array(16).fill(7);

    test('returns a non-extractable AES-GCM 256 CryptoKey', async () => {
      const key = await deriveKey('password', salt, 1000);

      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('AES-GCM');
      expect(key.algorithm.length).toBe(256);
      expect(key.extractable).toBe(false);
    });

    test('grants only encrypt and decrypt usages', async () => {
      const key = await deriveKey('password', salt, 1000);
      expect([...key.usages].sort()).toEqual(['decrypt', 'encrypt']);
    });

    test('is deterministic for the same password, salt and iteration count', async () => {
      // Keys are non-extractable, so verify determinism by cross-decrypting.
      const iv = new Uint8Array(12).fill(3);
      const { webcrypto } = require('crypto');
      const k1 = await deriveKey('pw', salt, 1000);
      const k2 = await deriveKey('pw', salt, 1000);

      const ct = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, k1,
        new TextEncoder().encode('hello'));
      const pt = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, k2, ct);

      expect(new TextDecoder().decode(pt)).toBe('hello');
    });

    test('a different salt yields a different key', async () => {
      const iv = new Uint8Array(12).fill(3);
      const { webcrypto } = require('crypto');
      const k1 = await deriveKey('pw', salt, 1000);
      const k2 = await deriveKey('pw', new Uint8Array(16).fill(9), 1000);

      const ct = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, k1,
        new TextEncoder().encode('hello'));

      await expect(webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, k2, ct))
        .rejects.toThrow();
    });

    test('defaults to 100000 iterations', async () => {
      // Derived with the default, opened with an explicit 100000 -> same key.
      const iv = new Uint8Array(12).fill(1);
      const { webcrypto } = require('crypto');
      const kDefault = await deriveKey('pw', salt);
      const kExplicit = await deriveKey('pw', salt, 100000);

      const ct = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, kDefault,
        new TextEncoder().encode('ok'));
      const pt = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, kExplicit, ct);

      expect(new TextDecoder().decode(pt)).toBe('ok');
    });
  });

  // ── Byte/string conversion helpers ────────────────────────────────────────

  describe('buf2hex() / hex2buf()', () => {
    test('encodes bytes as lowercase hex', () => {
      expect(buf2hex(new Uint8Array([0, 1, 15, 16, 255]))).toBe('00010f10ff');
    });

    test('zero-pads single-digit bytes', () => {
      expect(buf2hex(new Uint8Array([1, 2, 3]))).toBe('010203');
    });

    test('returns an empty string for empty input', () => {
      expect(buf2hex(new Uint8Array([]))).toBe('');
    });

    test('accepts an ArrayBuffer as well as a typed array', () => {
      expect(buf2hex(new Uint8Array([171, 205]).buffer)).toBe('abcd');
    });

    test('hex2buf reverses buf2hex', () => {
      const original = new Uint8Array([0, 1, 127, 128, 255, 42]);
      expect(Array.from(hex2buf(buf2hex(original)))).toEqual(Array.from(original));
    });

    test('hex2buf returns a Uint8Array of half the string length', () => {
      const out = hex2buf('00010f10ff');
      expect(out).toBeInstanceOf(Uint8Array);
      expect(out.length).toBe(5);
      expect(Array.from(out)).toEqual([0, 1, 15, 16, 255]);
    });

    test('hex2buf handles an empty string', () => {
      expect(hex2buf('').length).toBe(0);
    });

    test('round-trips a realistic 16-byte salt', () => {
      const salt = new Uint8Array(16).map((_, i) => (i * 17) % 256);
      const hex = buf2hex(salt);
      expect(hex.length).toBe(32);
      expect(Array.from(hex2buf(hex))).toEqual(Array.from(salt));
    });
  });

  describe('buf2b64() / b642buf()', () => {
    test('encodes bytes as base64', () => {
      // "Man" -> "TWFu"
      expect(buf2b64(new Uint8Array([77, 97, 110]))).toBe('TWFu');
    });

    test('applies base64 padding correctly', () => {
      expect(buf2b64(new Uint8Array([77]))).toBe('TQ==');
      expect(buf2b64(new Uint8Array([77, 97]))).toBe('TWE=');
      expect(buf2b64(new Uint8Array([77, 97, 110]))).toBe('TWFu');
    });

    test('returns an empty string for empty input', () => {
      expect(buf2b64(new Uint8Array([]))).toBe('');
    });

    test('b642buf reverses buf2b64', () => {
      const original = new Uint8Array([0, 1, 127, 128, 255, 64, 63]);
      expect(Array.from(new Uint8Array(b642buf(buf2b64(original)))))
        .toEqual(Array.from(original));
    });

    test('b642buf returns an ArrayBuffer', () => {
      const out = b642buf('TWFu');
      expect(out).toBeInstanceOf(ArrayBuffer);
      expect(Array.from(new Uint8Array(out))).toEqual([77, 97, 110]);
    });

    test('handles bytes across the full 0-255 range', () => {
      const all = new Uint8Array(256).map((_, i) => i);
      const decoded = new Uint8Array(b642buf(buf2b64(all)));
      expect(Array.from(decoded)).toEqual(Array.from(all));
    });

    test('b642buf slices to the exact byte range (no Buffer pool bleed)', () => {
      // Node Buffers come from a shared pool; the helper must slice precisely
      // or extra pool bytes would corrupt decryption.
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      const out = b642buf(buf2b64(bytes));
      expect(out.byteLength).toBe(5);
    });
  });
});
