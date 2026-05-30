import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveApiBaseUrl, resolveHeaders, type M5SmokeEnv } from "./run-m5-smoke.shared";

type RuntimeEnv = Record<string, string | undefined>;
type CheckStatus = "passed" | "failed" | "skipped";
type PilotOutcome = "pilot_ready" | "non_hdc_local" | "blocked";

export type PreflightOptions = {
  envFile: string;
  runGates: boolean;
  checkFrontend: boolean;
  frontendUrl: string;
  startRuntime: boolean;
  requirePilotReady: boolean;
  evidenceOut?: string;
};

export type CheckResult = {
  name: string;
  status: CheckStatus;
  detail: string;
};

export type RuntimeServicePlan = {
  name: string;
  command: string;
  args: string[];
  url: string;
  env: RuntimeEnv;
};

type JsonValue = Record<string, unknown> | string | number | boolean | null;

export function parsePreflightArgs(args: readonly string[], env: RuntimeEnv = process.env): PreflightOptions {
  const options: PreflightOptions = {
    envFile: env.npm_config_env_file?.trim() || ".env",
    runGates: env.npm_config_skip_gates?.trim() !== "true",
    checkFrontend: env.npm_config_skip_frontend?.trim() !== "true",
    frontendUrl: "http://127.0.0.1:5173",
    startRuntime: resolveStartRuntimeFlag(env),
    requirePilotReady: env.npm_config_require_pilot_ready?.trim() === "true",
    evidenceOut: env.npm_config_evidence_out?.trim() || undefined
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--env-file" && next) {
      options.envFile = next;
      index += 1;
    } else if (arg === "--skip-gates") {
      options.runGates = false;
    } else if (arg === "--skip-frontend") {
      options.checkFrontend = false;
    } else if (arg === "--no-start-runtime") {
      options.startRuntime = false;
    } else if (arg === "--frontend-url" && next) {
      options.frontendUrl = next;
      index += 1;
    } else if (arg === "--require-pilot-ready") {
      options.requirePilotReady = true;
    } else if (arg === "--evidence-out" && next) {
      options.evidenceOut = next;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete acceptance preflight argument: ${arg}`);
    }
  }

  return options;
}

function resolveStartRuntimeFlag(env: RuntimeEnv) {
  if (env.npm_config_no_start_runtime?.trim() === "true") {
    return false;
  }

  if (Object.prototype.hasOwnProperty.call(env, "npm_config_start_runtime")) {
    return env.npm_config_start_runtime?.trim() === "true";
  }

  return true;
}

export function isLocalHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function planRuntimeServices(options: PreflightOptions, env: RuntimeEnv): RuntimeServicePlan[] {
  if (!options.startRuntime) {
    return [];
  }

  const apiBaseUrl = resolveApiBaseUrl(env as M5SmokeEnv);
  const apiAuthorization =
    env.VITE_WISEEFF_API_AUTHORIZATION?.trim() ||
    env.M5_SMOKE_AUTHORIZATION?.trim() ||
    env.WISEEFF_SMOKE_AUTHORIZATION?.trim();
  const services: RuntimeServicePlan[] = [];

  if (apiBaseUrl && isLocalHttpUrl(apiBaseUrl)) {
    const apiPort = String(new URL(apiBaseUrl).port || "80");
    services.push({
      name: "api runtime",
      command: "npm",
      args: ["run", "dev:api"],
      url: `${apiBaseUrl}/health/live`,
      env: {
        ...env,
        PORT: apiPort,
        AGENT_PROVIDER: "deterministic",
        VITE_WISEEFF_RUNTIME_MODE: "api",
        VITE_WISEEFF_API_BASE_URL: apiBaseUrl
      }
    });
  }

  if (options.checkFrontend && isLocalHttpUrl(options.frontendUrl)) {
    services.push({
      name: "frontend runtime",
      command: "npm",
      args: ["run", "dev"],
      url: options.frontendUrl,
      env: {
        ...env,
        VITE_WISEEFF_RUNTIME_MODE: "api",
        VITE_WISEEFF_API_BASE_URL: apiBaseUrl,
        ...(apiAuthorization ? { VITE_WISEEFF_API_AUTHORIZATION: apiAuthorization } : {})
      }
    });
  }

  return services;
}

export function shouldRetryHttpStatus(status: number) {
  return status === 0 || status === 502 || status === 503 || status === 504;
}

export function loadEnvContent(content: string, baseEnv: RuntimeEnv = process.env): RuntimeEnv {
  const env: RuntimeEnv = { ...baseEnv };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }

    const [name, ...valueParts] = line.split("=");
    const key = name.trim();
    const value = unquoteEnvValue(valueParts.join("=").trim());
    if (!env[key]?.trim()) {
      env[key] = value;
    }
  }

  return env;
}

export function evaluatePilotReadiness(
  body: Record<string, unknown>,
  options: Pick<PreflightOptions, "requirePilotReady"> & Partial<Pick<PreflightOptions, "startRuntime">> = {
    requirePilotReady: false,
    startRuntime: true
  }
): { accepted: boolean; outcome: PilotOutcome; detail: string } {
  const blockedBy = Array.isArray(body.blockedBy) ? body.blockedBy.map(String) : [];
  const blockerSet = new Set(blockedBy);

  if (body.ok === true && body.status === "pilot_ready") {
    return {
      accepted: true,
      outcome: "pilot_ready",
      detail: "All pilot-readiness gates are ready."
    };
  }

  if (!options.requirePilotReady && blockedBy.length === 1 && blockedBy[0] === "deviceGateway") {
    return {
      accepted: true,
      outcome: "non_hdc_local",
      detail: "Accepted for local non-HDC preflight; deviceGateway remains blocked."
    };
  }

  if (
    !options.requirePilotReady &&
    options.startRuntime !== false &&
    blockerSet.size === 2 &&
    blockerSet.has("deviceGateway") &&
    blockerSet.has("agentProvider")
  ) {
    return {
      accepted: true,
      outcome: "non_hdc_local",
      detail: "Accepted for local non-HDC preflight; deviceGateway and agentProvider remain blocked."
    };
  }

  return {
    accepted: false,
    outcome: "blocked",
    detail: `Pilot-readiness is blocked by: ${blockedBy.length > 0 ? blockedBy.join(", ") : "unknown"}.`
  };
}

export function buildEnvSummary(env: RuntimeEnv): Record<string, string> {
  return {
    WISEEFF_API_BASE_URL: describeEnvValue(env.WISEEFF_API_BASE_URL, false),
    VITE_WISEEFF_API_BASE_URL: describeEnvValue(env.VITE_WISEEFF_API_BASE_URL, false),
    M5_SMOKE_AUTHORIZATION: describeEnvValue(env.M5_SMOKE_AUTHORIZATION, true),
    WISEEFF_SMOKE_AUTHORIZATION: describeEnvValue(env.WISEEFF_SMOKE_AUTHORIZATION, true)
  };
}

export function buildPreflightEvidence(input: {
  metadata: { branch: string; commit: string; dirty: boolean };
  envSummary: Record<string, string>;
  checks: CheckResult[];
  pilotOutcome: PilotOutcome;
}) {
  const lines = [
    "## Acceptance Preflight Evidence",
    "",
    `- Date: ${new Date().toISOString()}`,
    `- Branch: \`${input.metadata.branch}\``,
    `- Commit: \`${input.metadata.commit}\``,
    `- Dirty worktree: \`${input.metadata.dirty}\``,
    `- Pilot outcome: \`${input.pilotOutcome}\``,
    "",
    "### Environment",
    "",
    "| Key | Value |",
    "| --- | --- |",
    ...Object.entries(input.envSummary).map(([key, value]) => `| ${key} | ${value} |`),
    "",
    "### Checks",
    "",
    "| Check | Status | Detail |",
    "| --- | --- | --- |",
    ...input.checks.map((check) => `| ${check.name} | ${check.status} | ${escapeMarkdownTable(check.detail)} |`),
    ""
  ];

  return `${lines.join("\n")}\n`;
}

export function ensureEvidenceParentDirectory(evidenceOut: string) {
  return dirname(evidenceOut);
}

async function main() {
  const options = parsePreflightArgs(process.argv.slice(2));
  const env = await loadEnvFile(options.envFile, process.env);
  const checks: CheckResult[] = [];

  checks.push(...(await ensureRuntimeServices(planRuntimeServices(options, env), env)));

  if (options.runGates) {
    checks.push(runCommandCheck("docs:check", "npm", ["run", "docs:check"]));
    checks.push(runCommandCheck("contract:check", "npm", ["run", "contract:check"]));
    checks.push(runCommandCheck("test:all", "npm", ["run", "test:all"]));
    checks.push(runCommandCheck("build", "npm", ["run", "build"]));
    checks.push(runCommandCheck("git diff --check", "git", ["diff", "--check"]));
  } else {
    checks.push({ name: "automation gates", status: "skipped", detail: "--skip-gates was provided." });
  }

  const apiChecks = await runApiChecks(env, options);
  checks.push(...apiChecks.checks);

  if (options.checkFrontend) {
    checks.push(await runHttpCheck("frontend", options.frontendUrl, env));
  } else {
    checks.push({ name: "frontend", status: "skipped", detail: "--skip-frontend was provided." });
  }

  const metadata = getGitMetadata();
  const evidence = buildPreflightEvidence({
    metadata,
    envSummary: buildEnvSummary(env),
    checks,
    pilotOutcome: apiChecks.pilotOutcome
  });

  console.log(evidence);

  if (options.evidenceOut) {
    await mkdir(ensureEvidenceParentDirectory(options.evidenceOut), { recursive: true });
    await writeFile(options.evidenceOut, evidence, "utf8");
  }

  const failures = checks.filter((check) => check.status === "failed");
  if (failures.length > 0) {
    process.exit(1);
  }
}

async function loadEnvFile(envFile: string, baseEnv: RuntimeEnv): Promise<RuntimeEnv> {
  if (!existsSync(envFile)) {
    throw new Error(`Acceptance preflight env file not found: ${envFile}`);
  }

  return loadEnvContent(await readFile(envFile, "utf8"), baseEnv);
}

async function runApiChecks(env: RuntimeEnv, options: PreflightOptions) {
  const baseUrl = resolveApiBaseUrl(env as M5SmokeEnv);
  const checks: CheckResult[] = [];
  let pilotOutcome: PilotOutcome = "blocked";

  if (!baseUrl) {
    return {
      pilotOutcome,
      checks: [
        {
          name: "api base url",
          status: "failed" as const,
          detail: "WISEEFF_API_BASE_URL or VITE_WISEEFF_API_BASE_URL is required."
        }
      ]
    };
  }

  checks.push(await runJsonCheck("health live", baseUrl, "/health/live", env));
  checks.push(await runReadyCheck(baseUrl, env));
  checks.push(await runJsonCheck("current user", baseUrl, "/api/v1/me", env));

  const pilot = await requestJson(baseUrl, "/api/v1/operations/pilot-readiness", env);
  if (pilot.status !== 200 || !isObject(pilot.body)) {
    checks.push({
      name: "pilot readiness",
      status: "failed",
      detail: `Expected 200 JSON response; received ${pilot.status}.`
    });
  } else {
    const result = evaluatePilotReadiness(pilot.body, {
      requirePilotReady: options.requirePilotReady,
      startRuntime: options.startRuntime
    });
    pilotOutcome = result.outcome;
    checks.push({
      name: "pilot readiness",
      status: result.accepted ? "passed" : "failed",
      detail: result.detail
    });
  }

  return { checks, pilotOutcome };
}

function runCommandCheck(name: string, command: string, args: string[]): CheckResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32"
  });

  return commandResultToCheck(name, result);
}

async function ensureRuntimeServices(services: RuntimeServicePlan[], env: RuntimeEnv): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  for (const service of services) {
    if (await canFetch(service.url, env)) {
      checks.push({ name: service.name, status: "passed", detail: `already listening at ${service.url}` });
      continue;
    }

    const child = spawn(service.command, service.args, {
      cwd: process.cwd(),
      env: { ...process.env, ...service.env },
      detached: true,
      shell: process.platform === "win32",
      stdio: "ignore",
      windowsHide: true
    });
    child.once("error", () => undefined);
    child.unref();

    const ready = await waitForUrl(service.url, env, 60_000);
    checks.push({
      name: service.name,
      status: ready ? "passed" : "failed",
      detail: ready
        ? `started in the background and ready at ${service.url}`
        : `timed out waiting for ${service.url}`
    });
  }

  return checks;
}

async function waitForUrl(url: string, env: RuntimeEnv, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canFetch(url, env)) {
      return true;
    }
    await delay(500);
  }

  return false;
}

async function canFetch(url: string, env: RuntimeEnv) {
  try {
    const response = await fetch(url, { headers: resolveHeaders(env as M5SmokeEnv) });
    return response.ok;
  } catch {
    return false;
  }
}

function commandResultToCheck(name: string, result: SpawnSyncReturns<string>): CheckResult {
  if (result.error) {
    return { name, status: "failed", detail: result.error.message };
  }

  if (result.status !== 0) {
    const output = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    return { name, status: "failed", detail: output || `Exited with status ${result.status}.` };
  }

  return { name, status: "passed", detail: "ok" };
}

async function runJsonCheck(name: string, baseUrl: string, route: string, env: RuntimeEnv): Promise<CheckResult> {
  const response = await requestJsonWithRetry(baseUrl, route, env);
  if (response.status !== 200) {
    return { name, status: "failed", detail: `${route} returned ${response.status}.` };
  }

  return { name, status: "passed", detail: "ok" };
}

async function runReadyCheck(baseUrl: string, env: RuntimeEnv): Promise<CheckResult> {
  const response = await requestJsonWithRetry(baseUrl, "/health/ready", env);
  if (response.status !== 200 || !isObject(response.body) || response.body.ok !== true) {
    return { name: "health ready", status: "failed", detail: "/health/ready is not ready." };
  }

  return { name: "health ready", status: "passed", detail: "database, object store, worker, and agent are ready." };
}

async function runHttpCheck(name: string, url: string, env: RuntimeEnv): Promise<CheckResult> {
  try {
  const response = await requestTextWithRetry(url, env);
  return response.status >= 200 && response.status < 300
    ? { name, status: "passed", detail: `${url} returned ${response.status}.` }
    : { name, status: "failed", detail: `${url} returned ${response.status}.` };
  } catch (error) {
    return {
      name,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

async function requestJson(baseUrl: string, route: string, env: RuntimeEnv): Promise<{ status: number; body: JsonValue }> {
  try {
    const response = await fetch(`${baseUrl}${route}`, { headers: resolveHeaders(env as M5SmokeEnv) });
    const text = await response.text();
    return { status: response.status, body: parseJson(text) };
  } catch (error) {
    return {
      status: 0,
      body: error instanceof Error ? error.message : String(error)
    };
  }
}

async function requestJsonWithRetry(baseUrl: string, route: string, env: RuntimeEnv) {
  let response = await requestJson(baseUrl, route, env);
  for (let attempt = 1; shouldRetryHttpStatus(response.status) && attempt < 6; attempt += 1) {
    await delay(500);
    response = await requestJson(baseUrl, route, env);
  }

  return response;
}

async function requestTextWithRetry(url: string, env: RuntimeEnv) {
  let response = await requestText(url, env);
  for (let attempt = 1; shouldRetryHttpStatus(response.status) && attempt < 6; attempt += 1) {
    await delay(500);
    response = await requestText(url, env);
  }

  return response;
}

async function requestText(url: string, env: RuntimeEnv): Promise<{ status: number; body: string }> {
  try {
    const response = await fetch(url, { headers: resolveHeaders(env as M5SmokeEnv) });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    return { status: 0, body: error instanceof Error ? error.message : String(error) };
  }
}

function parseJson(text: string): JsonValue {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return text;
  }
}

function getGitMetadata() {
  return {
    branch: captureGit(["branch", "--show-current"]) || "unknown",
    commit: captureGit(["rev-parse", "HEAD"]) || "unknown",
    dirty: captureGit(["status", "--short"]).length > 0
  };
}

function captureGit(args: string[]) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function unquoteEnvValue(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function describeEnvValue(value: string | undefined, secret: boolean) {
  if (!value?.trim()) {
    return "<empty>";
  }

  return secret ? "<set>" : value.trim();
}

function isObject(value: JsonValue): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeMarkdownTable(value: string) {
  return value.replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
