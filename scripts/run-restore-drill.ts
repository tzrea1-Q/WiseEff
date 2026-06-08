import { existsSync, readFileSync } from "node:fs";
import { loadEnvContent } from "./run-m5-smoke.shared";

type RuntimeEnv = Record<string, string | undefined>;

export type RestoreTargetInput = {
  liveDatabaseUrl?: string;
  restoreDatabaseUrl?: string;
  liveBucket?: string;
  restoreBucket?: string;
  restorePrefix?: string;
};

export type RestoreTargetEvaluation = {
  status: "passed" | "failed";
  unsafeFields: string[];
  validationErrors: string[];
};

type RestoreDrillFileSystem = {
  existsSync: typeof existsSync;
  readFileSync: (filePath: string, encoding: BufferEncoding) => string;
};

function normalize(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export function evaluateRestoreTargets(input: RestoreTargetInput): RestoreTargetEvaluation {
  const unsafeFields: string[] = [];
  const validationErrors: string[] = [];
  const liveDatabaseUrl = normalize(input.liveDatabaseUrl);
  const restoreDatabaseUrl = normalize(input.restoreDatabaseUrl);
  const liveBucket = normalize(input.liveBucket);
  const restoreBucket = normalize(input.restoreBucket);
  const restorePrefix = input.restorePrefix?.trim() ?? "";

  if (!restoreDatabaseUrl) {
    unsafeFields.push("restoreDatabaseUrl");
    validationErrors.push("restoreDatabaseUrl is required.");
  } else if (liveDatabaseUrl && restoreDatabaseUrl === liveDatabaseUrl) {
    unsafeFields.push("restoreDatabaseUrl");
    validationErrors.push("restoreDatabaseUrl must not match the live database URL.");
  }

  if (!restoreBucket) {
    unsafeFields.push("restoreBucket");
    validationErrors.push("restoreBucket is required.");
  } else if (liveBucket && restoreBucket === liveBucket) {
    unsafeFields.push("restoreBucket");
    validationErrors.push("restoreBucket must not match the live object-store bucket.");
  }

  if (!restorePrefix || !restorePrefix.endsWith("/") || restorePrefix === "/") {
    unsafeFields.push("restorePrefix");
    validationErrors.push("restorePrefix must be non-empty and end with '/'.");
  }

  return {
    status: unsafeFields.length ? "failed" : "passed",
    unsafeFields,
    validationErrors
  };
}

export function parseRestoreDrillArgs(
  args: readonly string[],
  {
    processEnv = process.env,
    fileSystem = { existsSync, readFileSync }
  }: {
    processEnv?: RuntimeEnv;
    fileSystem?: RestoreDrillFileSystem;
  } = {}
): RuntimeEnv {
  let envFile = envValue(processEnv.npm_config_target_env_file) || envValue(processEnv.npm_config_env_file) || "ops/self-hosted/.env";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg.startsWith("--env-file=")) {
      envFile = arg.slice("--env-file=".length);
    } else if (arg === "--env-file" && next) {
      envFile = next;
      index += 1;
    } else if (arg.startsWith("--target-env-file=")) {
      envFile = arg.slice("--target-env-file=".length);
    } else if (arg === "--target-env-file" && next) {
      envFile = next;
      index += 1;
    } else if (!arg.startsWith("--") && args.length === 1) {
      envFile = arg;
    } else {
      throw new Error(`Unknown or incomplete restore drill argument: ${arg}`);
    }
  }

  return envFile && fileSystem.existsSync(envFile)
    ? loadEnvContent(fileSystem.readFileSync(envFile, "utf8"), processEnv)
    : processEnv;
}

function envValue(value: string | undefined) {
  const normalized = value?.trim();
  return normalized && normalized !== "true" ? normalized : "";
}

export function runRestoreDrillCli({
  args = process.argv.slice(2),
  processEnv = process.env
}: {
  args?: readonly string[];
  processEnv?: RuntimeEnv;
} = {}) {
  const env = parseRestoreDrillArgs(args, { processEnv });
  return evaluateRestoreTargets({
    liveDatabaseUrl: env.DATABASE_URL,
    restoreDatabaseUrl: env.RESTORE_DATABASE_URL,
    liveBucket: env.OBJECT_STORAGE_BUCKET,
    restoreBucket: env.RESTORE_OBJECT_STORAGE_BUCKET,
    restorePrefix: env.RESTORE_OBJECT_STORAGE_PREFIX
  });
}

if (process.argv[1]?.endsWith("run-restore-drill.ts")) {
  const evaluation = runRestoreDrillCli();

  console.log(JSON.stringify(evaluation, null, 2));
  if (evaluation.status !== "passed") {
    process.exitCode = 1;
  }
}
