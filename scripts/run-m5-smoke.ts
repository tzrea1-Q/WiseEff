import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  canAcceptPilotReadiness,
  canSkipWithoutApi,
  loadEnvContent,
  parseAllowedBlockedGates,
  resolveApiBaseUrl,
  resolveHeaders,
  type M5SmokeEnv
} from "./run-m5-smoke.shared";

type JsonValue = Record<string, unknown> | string | number | boolean | null;

const runtimeEnv = existsSync(".env") ? loadEnvContent(readFileSync(".env", "utf8"), process.env) : process.env;

function runCommand(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${[command, ...args].join(" ")}`);
  }
}

async function requestJson(baseUrl: string, path: string): Promise<{ status: number; body: JsonValue }> {
  const response = await fetch(`${baseUrl}${path}`, { headers: resolveHeaders(runtimeEnv as M5SmokeEnv) });
  const text = await response.text();
  let body: JsonValue = null;

  if (text) {
    try {
      body = JSON.parse(text) as JsonValue;
    } catch {
      body = text;
    }
  }

  return { status: response.status, body };
}

function describeBody(body: JsonValue) {
  return typeof body === "string" ? body : JSON.stringify(body, null, 2);
}

async function ensureOk(baseUrl: string, path: string, label: string) {
  const response = await requestJson(baseUrl, path);
  if (response.status !== 200) {
    throw new Error(`${label} returned ${response.status}:\n${describeBody(response.body)}`);
  }

  return response.body;
}

async function main() {
  runCommand("npm", ["run", "contract:check"]);
  const allowedBlockedGates = parseAllowedBlockedGates(process.argv.slice(2), runtimeEnv);

  const baseUrl = resolveApiBaseUrl(runtimeEnv as M5SmokeEnv);
  if (!baseUrl) {
    if (canSkipWithoutApi(runtimeEnv as M5SmokeEnv, process.argv.slice(2))) {
      console.log("Skipping M5 smoke: set WISEEFF_API_BASE_URL or VITE_WISEEFF_API_BASE_URL to probe a live API.");
      return;
    }

    throw new Error("WISEEFF_API_BASE_URL or VITE_WISEEFF_API_BASE_URL is required for npm run smoke:m5.");
  }

  const live = await ensureOk(baseUrl, "/health/live", "/health/live");
  const ready = await ensureOk(baseUrl, "/health/ready", "/health/ready");
  const pilot = await ensureOk(baseUrl, "/api/v1/operations/pilot-readiness", "/api/v1/operations/pilot-readiness");

  const readyBody = ready as Record<string, unknown>;
  if (readyBody.ok !== true) {
    throw new Error(`/health/ready is not ready:\n${describeBody(ready)}`);
  }

  const pilotBody = pilot as Record<string, unknown>;
  if (!canAcceptPilotReadiness(pilotBody, allowedBlockedGates)) {
    throw new Error(`/api/v1/operations/pilot-readiness is blocked:\n${describeBody(pilot)}`);
  }

  if (pilotBody.status === "blocked") {
    console.log(`M5 smoke passed with allowed blocked gates: ${allowedBlockedGates.join(", ")}.`);
  } else {
    console.log("M5 smoke passed.");
  }
  console.log(JSON.stringify({ live, ready, pilot }, null, 2));
}

await main();
