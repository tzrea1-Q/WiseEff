import { createHash } from "node:crypto";

export function resolveLogWebhookSecretKey(raw: NodeJS.ProcessEnv = process.env): Buffer {
  const encoded = raw.LOG_WEBHOOK_SECRET_ENCRYPTION_KEY?.trim();
  if (!encoded) {
    if (raw.NODE_ENV === "production") {
      throw new Error("LOG_WEBHOOK_SECRET_ENCRYPTION_KEY is required when webhooks are configured in production");
    }
    return createHash("sha256").update("wiseeff-local-log-webhook-secret-key").digest();
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error("LOG_WEBHOOK_SECRET_ENCRYPTION_KEY must be canonical base64 encoding of 32 bytes");
  }
  return key;
}
