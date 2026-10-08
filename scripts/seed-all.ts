import "dotenv/config";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import pg from "pg";

import { seedPublishedCatalog } from "../server/testing/parameterCatalog/seedPublishedCatalog";

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
    if (script === "db:seed:m1") {
      if (!env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required to seed the Catalog.");
      const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
      try {
        const release = await seedPublishedCatalog(pool);
        console.log(`Seeded published Catalog ${release.id} (${release.digest}).`);
      } finally {
        await pool.end();
      }
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
