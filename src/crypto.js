/**
 * Download Nexus Cryptographic Utilities
 * Uses native Web Crypto API (SubtleCrypto) - zero external dependencies.
 */

// Helper: Convert Uint8Array to hex string
function buf2hex(buf) {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// Helper: Convert hex string to Uint8Array
function hex2buf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// Helper: Convert ArrayBuffer to Base64
function buf2b64(buf) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(buf).toString("base64");
  }
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Helper: Convert Base64 to ArrayBuffer
function b642buf(b64) {
  if (typeof Buffer !== "undefined") {
    const b = Buffer.from(b64, "base64");
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Get SubtleCrypto API in browser or Node.js
function getSubtleCrypto() {
  if (typeof window !== "undefined" && window.crypto && window.crypto.subtle) {
    return window.crypto.subtle;
  }
  if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto.subtle;
  }
  try {
    const nodeCrypto = require("crypto");
    if (nodeCrypto.webcrypto && nodeCrypto.webcrypto.subtle) {
      return nodeCrypto.webcrypto.subtle;
    }
  } catch (e) {}
  throw new Error("Web Crypto API (subtle) not available.");
}

function getRandomValues(arr) {
  if (typeof window !== "undefined" && window.crypto) {
    return window.crypto.getRandomValues(arr);
  }
  if (typeof globalThis !== "undefined" && globalThis.crypto) {
    return globalThis.crypto.getRandomValues(arr);
  }
  try {
    const nodeCrypto = require("crypto");
    if (nodeCrypto.webcrypto) {
      return nodeCrypto.webcrypto.getRandomValues(arr);
    }
    return nodeCrypto.randomFillSync(arr);
  } catch (e) {}
  throw new Error("crypto.getRandomValues not available.");
}

/**
 * Derive an AES-GCM 256-bit key from a plaintext password and salt using PBKDF2-SHA256
 */
async function deriveKey(password, salt, iterations = 100000) {
  const subtle = getSubtleCrypto();
  const enc = new TextEncoder();
  const keyMaterial = await subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: iterations,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt a credentials payload with a user password.
 * @param {Object} credentials - Map of service IDs to sensitive data (e.g. { syn1: { password: "foo" } })
 * @param {string} password - User's encryption password
 * @returns {Promise<Object>} The encrypted envelope
 */
async function encryptCredentials(credentials, password) {
  if (!password || typeof password !== "string" || password.trim().length === 0) {
    throw new Error("Encryption password is required.");
  }
  const subtle = getSubtleCrypto();
  const salt = getRandomValues(new Uint8Array(16));
  const iv = getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, 100000);

  const enc = new TextEncoder();
  const plainBytes = enc.encode(JSON.stringify(credentials));

  const cipherBuffer = await subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    plainBytes
  );

  return {
    version: 1,
    algorithm: "AES-GCM-256",
    kdf: "PBKDF2-SHA256",
    iterations: 100000,
    salt: buf2hex(salt),
    iv: buf2hex(iv),
    ciphertext: buf2b64(cipherBuffer)
  };
}

/**
 * Decrypt an encrypted credentials envelope using a user password.
 * @param {Object} envelope - The encrypted envelope
 * @param {string} password - User's encryption password
 * @returns {Promise<Object>} The decrypted credentials map
 */
async function decryptCredentials(envelope, password) {
  if (!password) {
    throw new Error("Password is required for decryption.");
  }
  if (!envelope || !envelope.ciphertext || !envelope.salt || !envelope.iv) {
    throw new Error("Invalid encrypted credentials format.");
  }

  const subtle = getSubtleCrypto();
  const salt = hex2buf(envelope.salt);
  const iv = hex2buf(envelope.iv);
  const iterations = envelope.iterations || 100000;

  const key = await deriveKey(password, salt, iterations);
  const cipherBuffer = b642buf(envelope.ciphertext);

  let decryptedBuffer;
  try {
    decryptedBuffer = await subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      cipherBuffer
    );
  } catch (err) {
    throw new Error("Incorrect password or corrupted backup data.");
  }

  const dec = new TextDecoder();
  const jsonStr = dec.decode(decryptedBuffer);
  return JSON.parse(jsonStr);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    encryptCredentials,
    decryptCredentials,
    deriveKey,
    buf2hex,
    hex2buf,
    buf2b64,
    b642buf
  };
}
