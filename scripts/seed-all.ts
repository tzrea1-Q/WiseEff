import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const seedScripts = ["db:seed:m0", "db:seed:m1", "db:seed:m2", "db:seed:m3"] as const;

export async function runAllSeedScripts(env: NodeJS.ProcessEnv = process.env) {
  for (const script of seedScripts) {
    const result = spawnSync("npm", ["run", script], {
      stdio: "inherit",
      env,
      shell: process.platform === "win32"
    });

    if (result.status !== 0) {
      throw new Error(`Seed step failed: ${script}`);
    }
  }
}

async function main() {
  await runAllSeedScripts();
  console.log("Seeded M0-M3 WiseEff demo data.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
