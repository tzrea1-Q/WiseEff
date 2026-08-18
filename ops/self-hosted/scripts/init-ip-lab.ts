import { existsSync, writeFileSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  detectDefaultHost,
  generateUrlSafeSecret,
  parseIpLabCliArgs,
  renderIpLabEnv
} from "./ip-lab-profile";

export async function initIpLabEnv(args: readonly string[], writeFile = writeGeneratedEnv) {
  const options = parseIpLabCliArgs(args);
  const host = options.host.trim() || detectDefaultHost();
  if (!host) {
    throw new Error("Could not detect a non-loopback IPv4 address. Pass --ip <address>.");
  }

  const envText = renderIpLabEnv({
    host,
    tlsMode: options.tlsMode,
    adminUsername: options.adminUsername,
    adminPassword: options.adminPassword || generateUrlSafeSecret(),
    postgresPassword: generateUrlSafeSecret(),
    minioPassword: generateUrlSafeSecret()
  });

  if (options.printEnv) {
    return { envFile: options.envFile, envText, wrote: false };
  }

  const envFile = resolve(options.envFile);
  if (existsSync(envFile) && !options.force) {
    throw new Error(`${envFile} already exists. Re-run with --force to overwrite.`);
  }

  await writeFile(envFile, envText);
  return { envFile, envText, wrote: true };
}

async function writeGeneratedEnv(envFile: string, envText: string) {
  writeFileSync(envFile, envText, { encoding: "utf8", mode: 0o600 });
  await chmod(envFile, 0o600);
}

async function main() {
  const result = await initIpLabEnv(process.argv.slice(2));
  if (result.wrote) {
    console.log(`Wrote ${result.envFile} (mode 600).`);
    console.log("Review WISEEFF_SITE_HOST and WISEEFF_LAB_ADMIN_PASSWORD before starting the stack.");
    return;
  }
  process.stdout.write(result.envText);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
