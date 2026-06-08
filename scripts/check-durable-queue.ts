import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnvContent } from "./run-m5-smoke.shared";

type CheckStatus = "passed" | "failed";

type DurableQueueCheckResult = {
  status: CheckStatus;
  detail: string;
  body?: unknown;
};

type RuntimeEnv = Record<string, string | undefined>;

const defaultEvidenceOutput = "docs/generated/m6-queue-readiness-evidence.md";

type DurableQueueFileSystem = {
  existsSync: typeof existsSync;
  readFileSync: (filePath: string, encoding: BufferEncoding) => string;
  mkdirSync: (filePath: string, options: { recursive: true }) => unknown;
  writeFileSync: (filePath: string, content: string, encoding: BufferEncoding) => unknown;
};

export function evaluateDurableQueueReadyBody(body: unknown): DurableQueueCheckResult {
  const root = asRecord(body);
  const dependencies = asRecord(root?.dependencies);
  const durableQueue = asRecord(dependencies?.durableQueue);
  if (!durableQueue) {
    return {
      status: "failed",
      detail: "Ready health does not include dependencies.durableQueue."
    };
  }

  const transport = asRecord(durableQueue.transport);
  const database = asRecord(durableQueue.database);
  const queueStatus = String(durableQueue.status ?? "unknown");
  if (durableQueue.ok !== true || queueStatus !== "ready") {
    return {
      status: "failed",
      detail: `Durable queue health is ${queueStatus}: ${trimTrailingPeriod(String(durableQueue.message ?? "no message"))}.`
    };
  }
  if (!transport || transport.ok !== true || transport.status !== "ready") {
    return {
      status: "failed",
      detail: `Durable queue transport is ${String(transport?.status ?? "missing")}.`
    };
  }
  if (!database || database.ok !== true || database.status !== "ready") {
    return {
      status: "failed",
      detail: `PostgreSQL job-state health is ${String(database?.status ?? "missing")}.`
    };
  }

  return {
    status: "passed",
    detail: "Durable queue transport and PostgreSQL job state are ready."
  };
}

export async function runDurableQueueCheck({
  baseUrl,
  authorization,
  fetchImpl = fetch
}: {
  baseUrl: string;
  authorization?: string;
  fetchImpl?: typeof fetch;
}): Promise<DurableQueueCheckResult> {
  const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/health/ready`, {
    headers: authorization?.trim() ? { Accept: "application/json", Authorization: authorization } : { Accept: "application/json" }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  const result = evaluateDurableQueueReadyBody(body);
  return {
    ...result,
    status: response.status === 200 && result.status === "passed" ? "passed" : "failed",
    detail: response.status === 200 ? result.detail : `Ready health returned HTTP ${response.status}: ${result.detail}`,
    body
  };
}

export function parseDurableQueueArgs(args: readonly string[], env: RuntimeEnv = process.env) {
  const options = {
    envFile: env.npm_config_env_file?.trim() || "ops/self-hosted/.env",
    baseUrl:
      env.npm_config_base_url?.trim() ||
      env.WISEEFF_API_BASE_URL?.trim() ||
      env.VITE_WISEEFF_API_BASE_URL?.trim() ||
      "",
    authorization: env.M6_SELFHOSTED_SMOKE_AUTHORIZATION?.trim() || env.M5_SMOKE_AUTHORIZATION?.trim() || env.WISEEFF_SMOKE_AUTHORIZATION?.trim(),
    output: env.npm_config_output?.trim() || defaultEvidenceOutput
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg.startsWith("--env-file=")) {
      options.envFile = arg.slice("--env-file=".length);
    } else if (arg === "--env-file" && next) {
      options.envFile = next;
      index += 1;
    } else if (arg.startsWith("--base-url=")) {
      options.baseUrl = arg.slice("--base-url=".length);
    } else if (arg === "--base-url" && next) {
      options.baseUrl = next;
      index += 1;
    } else if (arg.startsWith("--authorization=")) {
      options.authorization = arg.slice("--authorization=".length);
    } else if (arg === "--authorization" && next) {
      options.authorization = next;
      index += 1;
    } else if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
    } else if (arg === "--output" && next) {
      options.output = next;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete durable queue check argument: ${arg}`);
    }
  }

  return options;
}

export function buildDurableQueueEvidence(args: {
  date: string;
  baseUrl: string;
  authorization?: string;
  result: DurableQueueCheckResult;
}): string {
  const lines = [
    "## M6.4 Durable Queue Readiness Evidence",
    "",
    `- Date: ${args.date}`,
    `- Status: \`${args.result.status}\``,
    `- Base URL: \`${sanitize(args.baseUrl)}\``,
    `- Authorization: \`${args.authorization?.trim() ? "<set>" : "<unset>"}\``,
    "",
    "### Result",
    "",
    `- Detail: ${sanitize(args.result.detail)}`,
    "",
    "### Ready Body Summary",
    "",
    "```json",
    JSON.stringify(redactValue(args.result.body ?? null), null, 2),
    "```",
    ""
  ];

  return lines.join("\n");
}

export async function runDurableQueueCli({
  args = process.argv.slice(2),
  env: runtimeEnv = process.env,
  fileSystem = { existsSync, readFileSync, mkdirSync, writeFileSync },
  fetchImpl = fetch
}: {
  args?: readonly string[];
  env?: RuntimeEnv;
  fileSystem?: DurableQueueFileSystem;
  fetchImpl?: typeof fetch;
} = {}): Promise<DurableQueueCheckResult> {
  const cli = parseDurableQueueArgs(args, runtimeEnv);
  const env = fileSystem.existsSync(cli.envFile) ? loadEnvContent(fileSystem.readFileSync(cli.envFile, "utf8"), runtimeEnv) : runtimeEnv;
  const baseUrl = cli.baseUrl || env.WISEEFF_API_BASE_URL?.trim() || env.VITE_WISEEFF_API_BASE_URL?.trim();
  const authorization =
    cli.authorization || env.M6_SELFHOSTED_SMOKE_AUTHORIZATION?.trim() || env.M5_SMOKE_AUTHORIZATION?.trim() || env.WISEEFF_SMOKE_AUTHORIZATION?.trim();
  const result = baseUrl
    ? await runDurableQueueCheck({ baseUrl, authorization, fetchImpl })
    : {
        status: "failed" as const,
        detail: "Durable queue check requires --base-url, WISEEFF_API_BASE_URL, or VITE_WISEEFF_API_BASE_URL."
      };
  const evidence = buildDurableQueueEvidence({
    date: new Date().toISOString(),
    baseUrl: baseUrl || "not-configured",
    authorization,
    result
  });
  fileSystem.mkdirSync(path.dirname(cli.output), { recursive: true });
  fileSystem.writeFileSync(cli.output, evidence, "utf8");
  return result;
}

async function main() {
  const result = await runDurableQueueCli();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "passed" ? 0 : 1);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function trimTrailingPeriod(value: string) {
  return value.endsWith(".") ? value.slice(0, -1) : value;
}

function sanitize(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/(token|secret|key|password)=([^&\s]+)/gi, "$1=<redacted>")
    .replace(/(token|secret|key|password):([^@\s]+)/gi, "$1:<redacted>");
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitize(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  const record = asRecord(value);
  if (!record) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, nested]) => [
      key,
      /(authorization|token|secret|key|password)/i.test(key) ? "<redacted>" : redactValue(nested)
    ])
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
