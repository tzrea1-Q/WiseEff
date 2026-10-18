import { createHash } from "node:crypto";
import { resolveLogWebhookSecretKey } from "../../config/logWebhookSecretKey";
import type { Database } from "../../shared/database/client";
import { decryptArchiveObject, encryptArchiveObject } from "../catalog-cutover/archive/crypto";

const PREFIX = "logwh:v1:";
const keyId = (key: Buffer) => createHash("sha256").update(key).digest("hex").slice(0, 16);
const aad = (organizationId: string, domainId: string) => Buffer.from(JSON.stringify(["log-webhook", organizationId, domainId]));

export function encryptLogWebhookSecret(secret: string, organizationId: string, domainId: string, key = resolveLogWebhookSecretKey()): string {
  const envelope = encryptArchiveObject({ key, aad: aad(organizationId, domainId), plaintext: Buffer.from(secret) });
  return `${PREFIX}${keyId(key)}:${envelope.toString("base64")}`;
}

export function decryptLogWebhookSecret(secret: string, organizationId: string, domainId: string, key = resolveLogWebhookSecretKey()): string {
  const prefix = `${PREFIX}${keyId(key)}:`;
  if (!secret.startsWith(prefix)) throw new Error("Webhook secret version or key id mismatch; run secret backfill/rotation before delivery");
  return decryptArchiveObject({ key, aad: aad(organizationId, domainId), envelope: Buffer.from(secret.slice(prefix.length), "base64") }).toString("utf8");
}

/** Startup backfill, or offline rotation with both old and new keys available. */
export async function ensureLogWebhookSecretsEncrypted(db: Database, options: { key?: Buffer; previousKey?: Buffer } = {}): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.query<{ id: string; organization_id: string; webhook_secret: string | null }>(
      `select id, organization_id, webhook_secret from log_domains
       where webhook_secret is not null or webhook_enabled or webhook_url is not null order by id for update`
    );
    if (!rows.rows.length) return;
    const key = options.key ?? resolveLogWebhookSecretKey();
    for (const row of rows.rows) {
      if (row.webhook_secret === null) continue;
      if (row.webhook_secret.startsWith(`${PREFIX}${keyId(key)}:`)) continue;
      const secret = row.webhook_secret.startsWith("logwh:")
        ? decryptLogWebhookSecret(row.webhook_secret, row.organization_id, row.id, options.previousKey ?? key)
        : row.webhook_secret;
      await tx.query(
        `update log_domains set webhook_secret = $3, webhook_secret_last_four = $4 where organization_id = $1 and id = $2`,
        [row.organization_id, row.id, encryptLogWebhookSecret(secret, row.organization_id, row.id, key), secret.slice(-4)]
      );
    }
  });
}
