import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateDurableQueueReadyBody } from "../../../scripts/check-durable-queue";
import { canAcceptPilotReadiness, loadEnvContent, parseAllowedBlockedGates } from "../../../scripts/run-m5-smoke.shared";

type RuntimeEnv = Record<string, string | undefined>;
type JsonValue = Record<string, unknown> | string | number | boolean | null;

export type SelfHostedSmokeCheck = {
  name: string;
  status: "passed" | "failed";
  statusCode: number;
  detail: string;
  requestId?: string;
  body?: JsonValue;
};

export type SelfHostedSmokeResult = {
  status: "passed" | "failed";
  checks: SelfHostedSmokeCheck[];
};

type SelfHostedSmokeOptions = {
  baseUrl: string;
  authorization?: string;
  allowedBlockedGates?: string[];
  fetchImpl?: typeof fetch;
};

type EvidenceInput = {
  date: string;
  branch: string;
  commit: string;
  baseUrl: string;
  authorization?: string;
  status: "passed" | "failed";
  checks: SelfHostedSmokeCheck[];
};

const defaultEvidenceOut = "docs/generated/m6-self-hosted-runtime-evidence.md";

const smokeRoutes = [
  { name: "health live", path: "/health/live" },
  { name: "health ready", path: "/health/ready" },
  { name: "current user", path: "/api/v1/me" },
  { name: "pilot readiness", path: "/api/v1/operations/pilot-readiness" }
] as const;

export async function runSelfHostedSmokeChecks({
  baseUrl,
  authorization,
  allowedBlockedGates = [],
  fetchImpl = fetch
}: SelfHostedSmokeOptions): Promise<SelfHostedSmokeResult> {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const checks: SelfHostedSmokeCheck[] = [];

  for (const route of smokeRoutes) {
    const check = await requestCheck({
      url: `${normalizedBaseUrl}${route.path}`,
      name: route.name,
      authorization,
      fetchImpl
    });

    if (route.name === "health ready" && check.status === "passed") {
      const durableQueue = evaluateDurableQueueReadyBody(check.body);
      if (durableQueue.status === "failed") {
        check.status = "failed";
        check.detail = durableQueue.detail;
      } else if (check.detail !== "ok") {
        check.status = "failed";
      }
    }

    if (route.name === "pilot readiness" && check.status === "passed") {
      const body = check.body && typeof check.body === "object" && !Array.isArray(check.body) ? (check.body as Record<string, unknown>) : null;
      if (!body || !canAcceptPilotReadiness(body, allowedBlockedGates)) {
        check.status = "failed";
      }
    }

    checks.push(check);
  }

  return {
    status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
    checks
  };
}

export function buildSelfHostedSmokeEvidence(input: EvidenceInput) {
  return [
    "# M6.1 Self-Hosted Runtime Evidence",
    "",
    `- Date: ${input.date}`,
    `- Branch: \`${input.branch}\``,
    `- Commit: \`${input.commit}\``,
    `- Outcome: \`${input.status}\``,
    "",
    "## Target",
    "",
    "| Key | Value |",
    "| --- | --- |",
    `| Base URL | ${input.baseUrl} |`,
    `| Authorization | ${redactSecret(input.authorization)} |`,
    "",
    "## Checks",
    "",
    "| Check | Status | HTTP | Detail |",
    "| --- | --- | --- | --- |",
    ...input.checks.map((check) => `| ${check.name} | ${check.status} | ${check.statusCode} | ${escapeTableCell(summarizeDetail(check.detail))} |`),
    ""
  ].join("\n");
}

export function redactSecret(value: string | undefined) {
  return value?.trim() ? "<set>" : "<unset>";
}

export function parseSelfHostedSmokeArgs(args: readonly string[], env: RuntimeEnv = process.env) {
  const options = {
    envFile: env.npm_config_env_file?.trim() || "ops/self-hosted/.env",
    baseUrl: env.WISEEFF_API_BASE_URL?.trim() || env.VITE_WISEEFF_API_BASE_URL?.trim() || "",
    authorization: env.M6_SELFHOSTED_SMOKE_AUTHORIZATION?.trim() || env.M5_SMOKE_AUTHORIZATION?.trim() || env.WISEEFF_SMOKE_AUTHORIZATION?.trim(),
    evidenceOut: env.npm_config_evidence_out?.trim() || defaultEvidenceOut,
    allowedBlockedGates: parseAllowedBlockedGates(args, env)
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--env-file" && next) {
      options.envFile = next;
      index += 1;
    } else if (arg === "--base-url" && next) {
      options.baseUrl = next;
      index += 1;
    } else if (arg === "--authorization" && next) {
      options.authorization = next;
      index += 1;
    } else if (arg === "--evidence-out" && next) {
      options.evidenceOut = next;
      index += 1;
    } else if (arg.startsWith("--allow-only-blocked=")) {
      continue;
    } else {
      throw new Error(`Unknown or incomplete self-hosted smoke argument: ${arg}`);
    }
  }

  return options;
}

async function requestCheck({
  url,
  name,
  authorization,
  fetchImpl
}: {
  url: string;
  name: string;
  authorization?: string;
  fetchImpl: typeof fetch;
}): Promise<SelfHostedSmokeCheck> {
  try {
    const response = await fetchImpl(url, {
      headers: authorization?.trim()
        ? { Accept: "application/json", Authorization: authorization }
        : { Accept: "application/json" }
    });
    const text = await response.text();
    const requestId = response.headers.get("x-request-id") ?? undefined;
    const body = text ? parseMaybeJson(text) : null;
    const passed = response.status === 200;

    return {
      name,
      status: passed ? "passed" : "failed",
      statusCode: response.status,
      detail: body && passed && isReadyBody(body) ? "ok" : formatBody(body ?? text),
      requestId,
      body
    };
  } catch (error) {
    return {
      name,
      status: "failed",
      statusCode: 0,
      detail: error instanceof Error ? error.message : "fetch failed"
    };
  }
}

function isReadyBody(body: JsonValue) {
  if (body && typeof body === "object" && "ok" in body && body.ok === false) {
    return false;
  }

  return true;
}

function parseMaybeJson(value: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return value;
  }
}

function formatBody(body: JsonValue) {
  return typeof body === "string" ? body : JSON.stringify(body);
}

function summarizeDetail(detail: string) {
  return detail.length > 240 ? `${detail.slice(0, 237)}...` : detail;
}

function escapeTableCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

async function main() {
  const cli = parseSelfHostedSmokeArgs(process.argv.slice(2));
  const env = existsSync(cli.envFile) ? loadEnvContent(readFileSync(cli.envFile, "utf8"), process.env) : process.env;
  const baseUrl = cli.baseUrl || env.WISEEFF_API_BASE_URL?.trim() || env.VITE_WISEEFF_API_BASE_URL?.trim();

  if (!baseUrl) {
    throw new Error("Self-hosted smoke requires --base-url, WISEEFF_API_BASE_URL, or VITE_WISEEFF_API_BASE_URL.");
  }

  const authorization =
    cli.authorization || env.M6_SELFHOSTED_SMOKE_AUTHORIZATION?.trim() || env.M5_SMOKE_AUTHORIZATION?.trim() || env.WISEEFF_SMOKE_AUTHORIZATION?.trim();
  const result = await runSelfHostedSmokeChecks({
    baseUrl,
    authorization,
    allowedBlockedGates: cli.allowedBlockedGates
  });
  const evidence = buildSelfHostedSmokeEvidence({
    date: new Date().toISOString(),
    branch: readGitValue("rev-parse --abbrev-ref HEAD"),
    commit: readGitValue("rev-parse HEAD"),
    baseUrl,
    authorization,
    status: result.status,
    checks: result.checks
  });

  mkdirSync(dirname(cli.evidenceOut), { recursive: true });
  writeFileSync(cli.evidenceOut, evidence, "utf8");
  console.log(evidence);
  process.exit(result.status === "passed" ? 0 : 1);
}

function readGitValue(command: string) {
  try {
    return execSync(`git ${command}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
