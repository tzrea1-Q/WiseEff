import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadAcceptanceEnvironment } from "../e2e/acceptance/helpers/acceptanceEnvironment";
import { runNpmScript } from "../e2e/acceptance/helpers/database";

type CaptureEnvironment = Record<string, string | undefined>;

export function requireCaptureDatabase(env: CaptureEnvironment = process.env) {
  const connectionString = env.USER_GUIDE_CAPTURE_DATABASE_URL?.trim();
  if (!connectionString) throw new Error("Set USER_GUIDE_CAPTURE_DATABASE_URL explicitly to a disposable PostgreSQL database.");
  let database: URL;
  try {
    database = new URL(connectionString);
  } catch {
    throw new Error("USER_GUIDE_CAPTURE_DATABASE_URL must be a PostgreSQL URL.");
  }
  const name = decodeURIComponent(database.pathname.slice(1));
  if (!["postgres:", "postgresql:"].includes(database.protocol) || !database.hostname
    || !/^[a-z0-9_-]*(screenshot|ugshots|capture)[a-z0-9_-]*$/i.test(name)
    || database.searchParams.has("database") || database.searchParams.has("dbname")) {
    throw new Error("Capture requires a disposable PostgreSQL database name containing screenshot, ugshots, or capture; database query overrides are forbidden.");
  }
  if (env.DATABASE_URL !== connectionString) {
    throw new Error("DATABASE_URL must match USER_GUIDE_CAPTURE_DATABASE_URL; run npm run docs:screenshots.");
  }
  return { connectionString, name };
}

export function configureCaptureEnvironment(env: CaptureEnvironment = process.env) {
  env.DATABASE_URL = env.USER_GUIDE_CAPTURE_DATABASE_URL?.trim();
  const database = requireCaptureDatabase(env);
  Object.assign(env, {
    NODE_ENV: "development",
    WISEEFF_WORKER_DATABASE_URL: database.connectionString,
    AUTH_MODE: "production",
    AUTH_PROVIDER: "local",
    AUTH_LOCAL_SELF_REGISTER: "true",
    VITE_WISEEFF_API_AUTHORIZATION: "",
    M5_SMOKE_AUTHORIZATION: "",
    WISEEFF_SMOKE_AUTHORIZATION: "",
    WISEEFF_QUALITY_SKIP_SEED: "false",
    LOG_WORKER_ENABLED: "true",
    LOG_ANALYSIS_QUEUE_MODE: "polling",
    LOG_ANALYSIS_DETERMINISTIC: "true",
    LOG_ANALYSIS_JUDGE_SAMPLE_RATE: "0",
    XIAOZE_DETERMINISTIC: "true",
    XIAOZE_PROACTIVE_ENABLED: "false",
    VITE_XIAOZE_PROACTIVE_ENABLED: "false",
    XIAOZE_LLM_API_BASE_URL: "",
    XIAOZE_LLM_API_KEY: "",
    XIAOZE_LLM_MODEL: "",
    EMBEDDING_API_BASE_URL: "",
    EMBEDDING_API_KEY: "",
    EMBEDDING_MODEL: "",
    OBJECT_STORE_MODE: "local",
    OBJECT_STORE_ROOT: path.resolve("test-results/user-guide-object-store", database.name)
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    configureCaptureEnvironment();
    loadAcceptanceEnvironment();
    runNpmScript("db:migrate");
    const result = spawnSync(process.execPath, [
      path.resolve("node_modules/playwright/cli.js"), "test", "--config", "playwright.user-guide.config.ts", ...process.argv.slice(2)
    ], { stdio: "inherit", env: process.env });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "User Guide capture failed.");
    process.exitCode = 1;
  }
}
