const { encryptCredentials, decryptCredentials } = require('../src/crypto');

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
});
