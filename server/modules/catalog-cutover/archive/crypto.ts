import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Envelope bytes: magic(6) + version(1) + iv(12) + gcm-tag(16) + ciphertext.
const MAGIC = Buffer.from("WEARC1", "ascii");
const VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ALGORITHM = "aes-256-gcm";
const MIN_ENVELOPE_LENGTH = MAGIC.length + 1 + IV_LENGTH + TAG_LENGTH;

export class ArchiveCryptoError extends Error {
  readonly kind: "truncated" | "integrity";

  constructor(kind: "truncated" | "integrity", detail: string) {
    super(detail);
    this.name = "ArchiveCryptoError";
    this.kind = kind;
  }
}

export const assertArchiveKey = (key: Buffer): Buffer => {
  if (key.length !== KEY_LENGTH) {
    throw new ArchiveCryptoError("integrity", "Archive encryption key must be 32 bytes");
  }
  return key;
};

export const buildArchiveAad = (input: {
  readonly archiveId: string;
  readonly legacyIdentityId: string;
  readonly cutoverRunId: string;
  readonly sourceChecksum: string;
  readonly graphChecksum: string;
}): Buffer =>
  Buffer.from(
    [
      input.archiveId,
      input.legacyIdentityId,
      input.cutoverRunId,
      input.sourceChecksum,
      input.graphChecksum,
    ].join("\n"),
    "utf8",
  );

export const encryptArchiveObject = (input: {
  readonly key: Buffer;
  readonly aad: Buffer;
  readonly plaintext: Buffer;
}): Buffer => {
  const key = assertArchiveKey(input.key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(input.aad);
  const ciphertext = Buffer.concat([cipher.update(input.plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), iv, tag, ciphertext]);
};

export const decryptArchiveObject = (input: {
  readonly key: Buffer;
  readonly aad: Buffer;
  readonly envelope: Buffer;
}): Buffer => {
  const key = assertArchiveKey(input.key);
  if (input.envelope.length < MIN_ENVELOPE_LENGTH) {
    throw new ArchiveCryptoError("truncated", "truncated archive object");
  }
  if (!input.envelope.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new ArchiveCryptoError("integrity", "archive object integrity failure");
  }
  if (input.envelope[MAGIC.length] !== VERSION) {
    throw new ArchiveCryptoError("integrity", "archive object integrity failure");
  }
  const ivStart = MAGIC.length + 1;
  const tagStart = ivStart + IV_LENGTH;
  const dataStart = tagStart + TAG_LENGTH;
  const iv = input.envelope.subarray(ivStart, tagStart);
  const tag = input.envelope.subarray(tagStart, dataStart);
  const ciphertext = input.envelope.subarray(dataStart);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(input.aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new ArchiveCryptoError("integrity", "archive object integrity failure");
  }
};
