import { z } from "zod";

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_URL: z.string().optional(),
  OBJECT_STORE_ROOT: z.string().default(".wiseeff-object-store"),
  DEBUG_DEVICE_GATEWAY_MODE: z.enum(["simulator"]).default("simulator"),
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
  if (env.NODE_ENV === "production" && !env.OBJECT_STORE_ROOT.trim()) {
    throw new Error("OBJECT_STORE_ROOT is required in production");
  }

  return env;
}
