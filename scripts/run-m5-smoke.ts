import { spawnSync } from "node:child_process";
import { canSkipWithoutApi, resolveApiBaseUrl, resolveHeaders, type M5SmokeEnv } from "./run-m5-smoke.shared";

type JsonValue = Record<string, unknown> | string | number | boolean | null;

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
  const response = await fetch(`${baseUrl}${path}`, { headers: resolveHeaders(process.env as M5SmokeEnv) });
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

  const baseUrl = resolveApiBaseUrl(process.env as M5SmokeEnv);
  if (!baseUrl) {
    if (canSkipWithoutApi(process.env as M5SmokeEnv)) {
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
  if (pilotBody.ok !== true || pilotBody.status !== "pilot_ready") {
    throw new Error(`/api/v1/operations/pilot-readiness is blocked:\n${describeBody(pilot)}`);
  }

  console.log("M5 smoke passed.");
  console.log(JSON.stringify({ live, ready, pilot }, null, 2));
}

await main();
