import { z } from "zod";

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),
  AUTH_MODE: z.enum(["development", "production"]).default("development"),
  AUTH_TOKEN_ISSUER: z.string().optional(),
  AUTH_TOKEN_HMAC_SECRET: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  OBJECT_STORE_MODE: z.enum(["local", "s3"]).default("local"),
  OBJECT_STORE_ROOT: z.string().default(".wiseeff-object-store"),
  OBJECT_STORAGE_ENDPOINT: z.string().optional(),
  OBJECT_STORAGE_BUCKET: z.string().optional(),
  OBJECT_STORAGE_ACCESS_KEY_ID: z.string().optional(),
  OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
  OBJECT_STORAGE_REGION: z.string().optional(),
  DEBUG_DEVICE_GATEWAY_MODE: z.enum(["simulator", "hdc"]).default("simulator"),
  HDC_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  AGENT_PROVIDER: z.enum(["deterministic", "live"]).default("deterministic"),
  AGENT_API_FORMAT: z.enum(["wiseeff", "openai"]).default("wiseeff"),
  AGENT_MODEL: z.string().optional(),
  AGENT_API_KEY: z.string().optional(),
  AGENT_API_BASE_URL: z.string().optional(),
  AGENT_API_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  AGENT_PROMPT_VERSION: z.string().default("m5-agent-v1"),
  MOCK_RUNTIME_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true")
});

export type ServerEnv = z.infer<typeof rawEnvSchema>;

export function loadServerEnv(raw: NodeJS.ProcessEnv): ServerEnv {
  const env = rawEnvSchema.parse(raw);

  if (env.NODE_ENV === "production" && env.MOCK_RUNTIME_ENABLED) {
    throw new Error("MOCK_RUNTIME_ENABLED cannot be true in production");
  }
  if (env.NODE_ENV === "production" && !env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required in production");
  }
  if (env.NODE_ENV === "production" && env.OBJECT_STORE_MODE !== "s3") {
    throw new Error("OBJECT_STORE_MODE=s3 is required when NODE_ENV=production");
  }
  if (
    env.OBJECT_STORE_MODE === "s3" &&
    (!env.OBJECT_STORAGE_ENDPOINT?.trim() ||
      !env.OBJECT_STORAGE_BUCKET?.trim() ||
      !env.OBJECT_STORAGE_ACCESS_KEY_ID?.trim() ||
      !env.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim())
  ) {
    throw new Error(
      "OBJECT_STORAGE_ENDPOINT, OBJECT_STORAGE_BUCKET, OBJECT_STORAGE_ACCESS_KEY_ID, and OBJECT_STORAGE_SECRET_ACCESS_KEY are required when OBJECT_STORE_MODE=s3"
    );
  }
  if (env.NODE_ENV === "production" && env.AUTH_MODE !== "production") {
    throw new Error("AUTH_MODE=production is required when NODE_ENV=production");
  }
  if (
    env.NODE_ENV === "production" &&
    env.DEBUG_DEVICE_GATEWAY_MODE !== "hdc" &&
    !env.DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION
  ) {
    throw new Error(
      "DEBUG_DEVICE_GATEWAY_MODE=hdc is required when NODE_ENV=production. Set DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION=true only for non-customer staging environments that intentionally run the simulator."
    );
  }
  if (env.AUTH_MODE === "production" && (!env.AUTH_TOKEN_ISSUER?.trim() || !env.AUTH_TOKEN_HMAC_SECRET?.trim())) {
    throw new Error("AUTH_TOKEN_ISSUER and AUTH_TOKEN_HMAC_SECRET are required when AUTH_MODE=production");
  }
  if (env.AUTH_MODE === "production" && env.NODE_ENV !== "test" && (env.AUTH_TOKEN_HMAC_SECRET?.length ?? 0) < 32) {
    throw new Error("AUTH_TOKEN_HMAC_SECRET must be at least 32 characters outside tests");
  }
  if (env.NODE_ENV === "production" && env.AGENT_PROVIDER !== "live") {
    throw new Error("AGENT_PROVIDER=live is required when NODE_ENV=production");
  }
  if (env.AGENT_PROVIDER === "live" && !env.AGENT_MODEL?.trim()) {
    throw new Error("AGENT_MODEL is required when AGENT_PROVIDER=live");
  }
  if (env.AGENT_PROVIDER === "live" && !env.AGENT_API_KEY?.trim()) {
    throw new Error("AGENT_API_KEY is required when AGENT_PROVIDER=live");
  }
  if (env.AGENT_PROVIDER === "live" && !env.AGENT_API_BASE_URL?.trim()) {
    throw new Error("AGENT_API_BASE_URL is required when AGENT_PROVIDER=live");
  }

  return env;
}
