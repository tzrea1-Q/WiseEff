import { describe, expect, it } from "vitest";
import { loadServerEnv } from "./env";
import { resolveLogWebhookSecretKey } from "./logWebhookSecretKey";

describe("log webhook encryption key", () => {
  it("uses a deterministic key only outside production", () => {
    expect(resolveLogWebhookSecretKey({ NODE_ENV: "test" })).toHaveLength(32);
    expect(resolveLogWebhookSecretKey({ NODE_ENV: "test" })).toEqual(resolveLogWebhookSecretKey({ NODE_ENV: "development" }));
    expect(() => resolveLogWebhookSecretKey({ NODE_ENV: "production" })).toThrow("LOG_WEBHOOK_SECRET_ENCRYPTION_KEY is required");
  });
  it("validates canonical base64 and length through server env parsing", () => {
    for (const encoded of ["invalid", Buffer.alloc(31).toString("base64"), "!" + Buffer.alloc(32).toString("base64")]) {
      expect(() => loadServerEnv({ LOG_WEBHOOK_SECRET_ENCRYPTION_KEY: encoded })).toThrow("base64");
    }
    const encoded = Buffer.alloc(32, 9).toString("base64");
    expect(loadServerEnv({ LOG_WEBHOOK_SECRET_ENCRYPTION_KEY: encoded }).LOG_WEBHOOK_SECRET_ENCRYPTION_KEY).toBe(encoded);
    expect(resolveLogWebhookSecretKey({ NODE_ENV: "production", LOG_WEBHOOK_SECRET_ENCRYPTION_KEY: encoded })).toEqual(Buffer.alloc(32, 9));
  });
});
