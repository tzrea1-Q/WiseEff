import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  caddyfileForTlsMode,
  evaluateIpLabCaddyfile,
  evaluateIpLabEnv,
  parseEnvText,
  type IpLabTlsMode
} from "./ip-lab-profile";

function readArg(args: readonly string[], name: string, fallback: string) {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) {
    return args[index + 1];
  }
  return fallback;
}

export function runIpLabPreflight(args: readonly string[] = process.argv.slice(2), cwd = process.cwd()) {
  const envFile = resolve(cwd, readArg(args, "--env-file", "ops/self-hosted/.env"));
  if (!existsSync(envFile)) {
    throw new Error(`Missing env file: ${envFile}. Run deploy-ip-lab.sh or npm run selfhost:ip-lab:init first.`);
  }

  const env = parseEnvText(readFileSync(envFile, "utf8"));
  const envResult = evaluateIpLabEnv(env);
  const tlsMode = ((env.WISEEFF_TLS_MODE ?? "http").trim() === "internal" ? "internal" : "http") as IpLabTlsMode;
  const caddyfileName = env.WISEEFF_CADDYFILE?.trim() || caddyfileForTlsMode(tlsMode);
  const caddyfilePath = resolve(cwd, "ops/self-hosted", caddyfileName);
  if (!existsSync(caddyfilePath)) {
    envResult.issues.push({ level: "error", message: `Missing Caddyfile: ${caddyfilePath}` });
    envResult.status = "failed";
  } else {
    const caddyResult = evaluateIpLabCaddyfile(readFileSync(caddyfilePath, "utf8"), tlsMode);
    if (caddyResult.status === "failed") {
      envResult.status = "failed";
      for (const token of caddyResult.missingTokens) {
        envResult.issues.push({ level: "error", message: `Caddyfile ${caddyfileName} is missing ${token}.` });
      }
      for (const token of caddyResult.forbiddenTokens) {
        envResult.issues.push({ level: "error", message: `Caddyfile ${caddyfileName} must not include ${token}.` });
      }
    }
  }

  return { envFile, ...envResult };
}

function main() {
  const result = runIpLabPreflight();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "passed" ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
