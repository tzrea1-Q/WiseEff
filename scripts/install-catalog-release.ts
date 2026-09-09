import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { compileCatalogRelease, isCatalogReleaseBundle } from "../server/modules/catalog-kernel/compiler/index";
import { jsonCatalogReleaseSource } from "../server/modules/catalog-kernel/interface";
import { createCatalogInstaller } from "../server/modules/catalog-kernel/install/installer";
import { CatalogReleaseDigest } from "../server/modules/parameter-catalog-contract/index";

/** Bootstrap only. The operator supplies a repository-reviewed nonempty bundle
 * and explicitly confirms its compiler digest; ordinary app startup never calls
 * this management command. Existing publications cannot be replaced here. */
export async function installFirstCatalogRelease(pool: pg.Pool, bundle: unknown, expectedDigest: string) {
  if (!isCatalogReleaseBundle(bundle)) throw new Error("catalog-install-invalid-bundle");
  const compiled = await compileCatalogRelease(bundle);
  if (!compiled.ok) throw new Error(`catalog-install-${compiled.error.kind}`);
  const expected = CatalogReleaseDigest(expectedDigest);
  if (compiled.value.aggregateDigest !== expected) throw new Error("catalog-install-digest-mismatch");
  const result = await createCatalogInstaller(pool).installPublishedRelease({
    mode: "bootstrap", source: jsonCatalogReleaseSource(bundle), expectedTargetDigest: expected,
  });
  if (!result.ok) throw new Error(`catalog-install-${result.error.kind}`);
  return result.value;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [filename, confirmation, expectedDigest, ...extra] = process.argv.slice(2);
  if (!filename || confirmation !== "--confirm-digest" || !/^sha256:[a-f0-9]{64}$/.test(expectedDigest ?? "") || extra.length || !process.env.DATABASE_URL) {
    console.error("Usage: install-catalog-release.ts REVIEWED_BUNDLE --confirm-digest sha256:DIGEST (management DATABASE_URL required)");
    process.exitCode = 2;
  } else {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const result = await installFirstCatalogRelease(pool, JSON.parse(await readFile(filename, "utf8")), expectedDigest);
      console.log(JSON.stringify(result));
    } catch (error) {
      console.error(error instanceof Error && error.message.startsWith("catalog-install-") ? error.message : "catalog-install-failed");
      process.exitCode = 1;
    } finally { await pool.end(); }
  }
}
