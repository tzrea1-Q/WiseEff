import { z } from "zod";

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(8787),
  AUTH_MODE: z.enum(["development", "production"]).default("development"),
  AUTH_PROVIDER: z.enum(["hmac", "oidc", "local"]).default("local"),
  AUTH_TOKEN_ISSUER: z.string().optional(),
  AUTH_TOKEN_HMAC_SECRET: z.string().optional(),
  AUTH_OIDC_ISSUER: z.string().optional(),
  AUTH_OIDC_AUDIENCE: z.string().optional(),
  AUTH_OIDC_JWKS_URI: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  OBJECT_STORE_MODE: z.enum(["local", "s3"]).default("local"),
  OBJECT_STORE_ROOT: z.string().default(".wiseeff-object-store"),
  OBJECT_STORAGE_ENDPOINT: z.string().optional(),
  OBJECT_STORAGE_BUCKET: z.string().optional(),
  OBJECT_STORAGE_ACCESS_KEY_ID: z.string().optional(),
  OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
  OBJECT_STORAGE_REGION: z.string().optional(),
  DEBUG_DEVICE_GATEWAY_MODE: z.enum(["simulator", "hdc", "adb", "multi"]).default("multi"),
  HDC_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  ADB_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  AGENT_MODEL: z.string().optional(),
  AGENT_API_KEY: z.string().optional(),
  AGENT_API_BASE_URL: z.string().optional(),
  AGENT_API_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  LOG_WORKER_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  LOG_ANALYSIS_QUEUE_MODE: z.enum(["polling", "durable"]).default("polling"),
  REDIS_URL: z.string().optional(),
  LOG_ANALYSIS_QUEUE_PREFIX: z.string().default("wiseeff"),
  LOG_ANALYSIS_QUEUE_ATTEMPTS: z.coerce.number().int().positive().default(4),
  LOG_ANALYSIS_QUEUE_BACKOFF_MS: z.coerce.number().int().positive().default(1000),
  LOG_ANALYSIS_QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(1),
  NOTIFICATION_WORKER_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  NOTIFICATION_DELIVERY_MODE: z.enum(["sync", "async"]).default("sync"),
  NOTIFICATION_QUEUE_MODE: z.enum(["polling", "durable"]).default("polling"),
  NOTIFICATION_QUEUE_PREFIX: z.string().default("wiseeff"),
  NOTIFICATION_QUEUE_ATTEMPTS: z.coerce.number().int().positive().default(4),
  NOTIFICATION_QUEUE_BACKOFF_MS: z.coerce.number().int().positive().default(1000),
  NOTIFICATION_QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(1),
  DEVICE_BRIDGE_ARTIFACT_ROOT: z.string().default("ops/self-hosted/bridge-artifacts"),
  DEVICE_BRIDGE_TOOL_ARTIFACT_ROOT: z.string().default("ops/self-hosted/bridge-tool-artifacts"),
  DEVICE_BRIDGE_PAIRING_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  DEVICE_BRIDGE_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(90),
  DEVICE_BRIDGE_WS_PATH: z.string().default("/api/v1/device-bridges/ws"),
  XIAOZE_MODEL: z.string().optional(),
  XIAOZE_PROACTIVE_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  XIAOZE_REASONING_FALLBACK_HEURISTIC: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  XIAOZE_CHECKPOINTER: z.enum(["memory", "postgres"]).default("memory")
});

export type ServerEnv = z.infer<typeof rawEnvSchema>;

export function loadServerEnv(raw: NodeJS.ProcessEnv): ServerEnv {
  const env = rawEnvSchema.parse(raw);

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
  if (env.NODE_ENV === "production" && env.AUTH_PROVIDER !== "oidc" && env.AUTH_PROVIDER !== "local") {
    throw new Error("AUTH_PROVIDER=oidc or AUTH_PROVIDER=local is required when NODE_ENV=production");
  }
  if (
    env.NODE_ENV === "production" &&
    !["hdc", "adb", "multi"].includes(env.DEBUG_DEVICE_GATEWAY_MODE) &&
    !env.DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION
  ) {
    throw new Error(
      "DEBUG_DEVICE_GATEWAY_MODE=hdc, adb, or multi is required when NODE_ENV=production. Set DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION=true only for non-customer staging environments that intentionally run the simulator."
    );
  }
  if (env.AUTH_MODE === "production" && env.AUTH_PROVIDER === "hmac" && (!env.AUTH_TOKEN_ISSUER?.trim() || !env.AUTH_TOKEN_HMAC_SECRET?.trim())) {
    throw new Error("AUTH_TOKEN_ISSUER and AUTH_TOKEN_HMAC_SECRET are required when AUTH_MODE=production");
  }
  if (env.AUTH_MODE === "production" && env.AUTH_PROVIDER === "hmac" && env.NODE_ENV !== "test" && (env.AUTH_TOKEN_HMAC_SECRET?.length ?? 0) < 32) {
    throw new Error("AUTH_TOKEN_HMAC_SECRET must be at least 32 characters outside tests");
  }
  if (env.AUTH_MODE === "production" && env.AUTH_PROVIDER === "oidc" && (!env.AUTH_OIDC_ISSUER?.trim() || !env.AUTH_OIDC_AUDIENCE?.trim())) {
    throw new Error("AUTH_OIDC_ISSUER and AUTH_OIDC_AUDIENCE are required when AUTH_PROVIDER=oidc");
  }
  if (env.LOG_ANALYSIS_QUEUE_MODE === "durable" && !env.REDIS_URL?.trim()) {
    throw new Error("REDIS_URL is required when LOG_ANALYSIS_QUEUE_MODE=durable");
  }
  if (env.NOTIFICATION_QUEUE_MODE === "durable" && !env.REDIS_URL?.trim()) {
    throw new Error("REDIS_URL is required when NOTIFICATION_QUEUE_MODE=durable");
  }
  if (env.NODE_ENV === "production" && (env.XIAOZE_CHECKPOINTER !== "postgres" || !env.DATABASE_URL?.trim())) {
    throw new Error("XIAOZE_CHECKPOINTER=postgres and DATABASE_URL are required in production");
  }

  return env;
}
