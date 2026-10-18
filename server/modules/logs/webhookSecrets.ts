import { createHash } from "node:crypto";
import { resolveLogWebhookSecretKey } from "../../config/logWebhookSecretKey";
import type { Database } from "../../shared/database/client";
import { decryptAesGcmEnvelope, encryptAesGcmEnvelope } from "../../shared/crypto/aesGcm";

const PREFIX = "logwh:v1:";
// Preserve the v1 header already used by stored webhook secrets.
const ENVELOPE_HEADER = Buffer.concat([Buffer.from("WEARC1", "ascii"), Buffer.from([1])]);
const keyId = (key: Buffer) => createHash("sha256").update(key).digest("hex").slice(0, 16);
const aad = (organizationId: string, domainId: string) => Buffer.from(JSON.stringify(["log-webhook", organizationId, domainId]));

export class LogWebhookSecretDecryptionError extends Error {}

export function encryptLogWebhookSecret(secret: string, organizationId: string, domainId: string, key = resolveLogWebhookSecretKey()): string {
  const envelope = Buffer.concat([ENVELOPE_HEADER,
    encryptAesGcmEnvelope({ key, aad: aad(organizationId, domainId), plaintext: Buffer.from(secret) })]);
  return `${PREFIX}${keyId(key)}:${envelope.toString("base64")}`;
}

export function decryptLogWebhookSecret(secret: string, organizationId: string, domainId: string, key = resolveLogWebhookSecretKey()): string {
  const prefix = `${PREFIX}${keyId(key)}:`;
  if (!secret.startsWith(prefix)) throw new LogWebhookSecretDecryptionError("Webhook secret version or key id mismatch; restore the correct key or rotate this domain's secret.");
  try {
    const envelope = Buffer.from(secret.slice(prefix.length), "base64");
    if (!envelope.subarray(0, ENVELOPE_HEADER.length).equals(ENVELOPE_HEADER)) throw new Error("Invalid webhook envelope header.");
    return decryptAesGcmEnvelope({ key, aad: aad(organizationId, domainId), envelope: envelope.subarray(ENVELOPE_HEADER.length) }).toString("utf8");
  } catch {
    throw new LogWebhookSecretDecryptionError("Webhook secret integrity check failed; restore the correct key or rotate this domain's secret.");
  }
}

/** Startup backfill, or offline rotation with both old and new keys available. */
export async function ensureLogWebhookSecretsEncrypted(db: Database, options: { key?: Buffer; previousKey?: Buffer } = {}): Promise<void> {
  await db.transaction(async (tx) => {
    const configured = await tx.query(
      `select 1 from log_domains where webhook_secret is not null or webhook_enabled or webhook_url is not null limit 1`
    );
    if (!configured.rows.length) return;
    const key = options.key ?? resolveLogWebhookSecretKey();
    const rotating = options.key !== undefined || options.previousKey !== undefined;
    const rows = await tx.query<{ id: string; organization_id: string; webhook_secret: string | null; webhook_secret_encrypted: boolean }>(
      `select id, organization_id, webhook_secret, webhook_secret_encrypted from log_domains
       where webhook_secret is not null
         and (not webhook_secret_encrypted or ($1 and webhook_secret not like $2))
       order by id for update`,
      [rotating, `${PREFIX}${keyId(key)}:%`]
    );
    for (const row of rows.rows) {
      if (row.webhook_secret === null) continue;
      const secret = row.webhook_secret_encrypted
        ? decryptLogWebhookSecret(row.webhook_secret, row.organization_id, row.id, options.previousKey ?? key)
        : row.webhook_secret;
      await tx.query(
        `update log_domains set webhook_secret = $3, webhook_secret_last_four = $4, webhook_secret_encrypted = true where organization_id = $1 and id = $2`,
        [row.organization_id, row.id, encryptLogWebhookSecret(secret, row.organization_id, row.id, key), secret.slice(-4)]
      );
    }
  });
}
