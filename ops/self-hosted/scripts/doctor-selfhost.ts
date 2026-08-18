import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { caddyfileForSelfHost, evaluateSelfHostCaddyfile, evaluateSelfHostEnv, parseEnvText, summarizeEnv } from "./selfhost-profile";
import type { SelfHostTlsMode } from "./selfhost-answers";

export type DoctorResult = {
  status: "passed" | "failed";
  envFile: string;
  summary: ReturnType<typeof summarizeEnv>;
  issues: Array<{ level: "error" | "warning" | "info"; message: string }>;
};

function readArg(args: readonly string[], name: string, fallback: string) {
  const filtered = args.filter((arg) => arg !== "--");
  const index = filtered.indexOf(name);
  if (index >= 0 && filtered[index + 1]) {
    return filtered[index + 1];
  }
  return fallback;
}

export function runSelfHostDoctor(args: readonly string[] = process.argv.slice(2), cwd = process.cwd()): DoctorResult {
  const envFile = resolve(cwd, readArg(args, "--env-file", "ops/self-hosted/.env"));
  const probeLive = args.includes("--probe-live");
  const issues: DoctorResult["issues"] = [];

  if (!existsSync(envFile)) {
    return {
      status: "failed",
      envFile,
      summary: { profile: "missing", tlsMode: "", publicUrl: "", adminUsername: "", seed: "", llm: "skip" },
      issues: [{ level: "error", message: `Missing env file: ${envFile}. Run ./scripts/setup.sh first.` }]
    };
  }

  const env = parseEnvText(readFileSync(envFile, "utf8"));
  const envResult = evaluateSelfHostEnv(env);
  issues.push(...envResult.issues);

  const tlsMode = ((env.WISEEFF_TLS_MODE ?? "http").trim() || "http") as SelfHostTlsMode;
  const caddyfileName = env.WISEEFF_CADDYFILE?.trim() || caddyfileForSelfHost(tlsMode);
  const caddyfilePath = resolve(cwd, "ops/self-hosted", caddyfileName);
  if (!existsSync(caddyfilePath)) {
    issues.push({ level: "error", message: `Missing Caddyfile: ${caddyfilePath}` });
  } else {
    const caddyResult = evaluateSelfHostCaddyfile(readFileSync(caddyfilePath, "utf8"), tlsMode);
    if (caddyResult.status === "failed") {
      for (const token of caddyResult.missingTokens) {
        issues.push({ level: "error", message: `Caddyfile ${caddyfileName} is missing ${token}.` });
      }
      for (const token of caddyResult.forbiddenTokens) {
        issues.push({ level: "error", message: `Caddyfile ${caddyfileName} must not include ${token}.` });
      }
    }
  }

  if (probeLive) {
    const live = spawnSync("curl", ["-fsS", "http://127.0.0.1/health/live"], { encoding: "utf8" });
    if (live.status !== 0) {
      issues.push({
        level: "warning",
        message: "/health/live is not reachable on this host. Start the stack or check compose logs."
      });
    } else {
      issues.push({ level: "info", message: "/health/live is reachable." });
      const ready = spawnSync("curl", ["-fsS", "-o", "/dev/null", "-w", "%{http_code}", "http://127.0.0.1/health/ready"], {
        encoding: "utf8"
      });
      const code = (ready.stdout ?? "").trim();
      if (code === "200") {
        issues.push({ level: "info", message: "/health/ready returned 200." });
      } else {
        issues.push({
          level: "warning",
          message: `/health/ready returned ${code || "no status"}. Check LLM flags or live keys.`
        });
      }
    }
  }

  return {
    status: issues.some((issue) => issue.level === "error") ? "failed" : "passed",
    envFile,
    summary: summarizeEnv(env),
    issues
  };
}

function main() {
  const result = runSelfHostDoctor();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "passed" ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
