import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Envelope bytes: IV(12) + authentication tag(16) + ciphertext.
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function assertKey(key: Buffer): void {
  if (key.length !== 32) throw new Error("AES-256-GCM key must be 32 bytes.");
}

export function encryptAesGcmEnvelope(input: { key: Buffer; aad: Buffer; plaintext: Buffer }): Buffer {
  assertKey(input.key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", input.key, iv);
  cipher.setAAD(input.aad);
  const ciphertext = Buffer.concat([cipher.update(input.plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptAesGcmEnvelope(input: { key: Buffer; aad: Buffer; envelope: Buffer }): Buffer {
  assertKey(input.key);
  if (input.envelope.length < IV_LENGTH + TAG_LENGTH) throw new Error("Truncated AES-256-GCM envelope.");
  const decipher = createDecipheriv("aes-256-gcm", input.key, input.envelope.subarray(0, IV_LENGTH));
  decipher.setAAD(input.aad);
  decipher.setAuthTag(input.envelope.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
  return Buffer.concat([decipher.update(input.envelope.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]);
}
