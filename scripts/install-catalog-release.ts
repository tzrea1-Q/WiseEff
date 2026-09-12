import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { compileCatalogRelease, isCatalogReleaseBundle } from "../server/modules/catalog-kernel/compiler/index";
import { jsonCatalogReleaseSource } from "../server/modules/catalog-kernel/interface";
import { createCatalogInstaller } from "../server/modules/catalog-kernel/install/installer";
import {
  CatalogReleaseDigest,
  CatalogReleaseId,
} from "../server/modules/parameter-catalog-contract/index";

const USAGE =
  "Usage: install-catalog-release.ts REVIEWED_BUNDLE --confirm-digest sha256:DIGEST [--mode bootstrap|advance --expected-current-id ID --expected-current-digest sha256:DIGEST] (management DATABASE_URL required)";

export type InstallCatalogReleaseArgs =
  | {
      readonly mode: "bootstrap";
      readonly filename: string;
      readonly expectedTargetDigest: string;
    }
  | {
      readonly mode: "advance";
      readonly filename: string;
      readonly expectedTargetDigest: string;
      readonly expectedCurrentId: string;
      readonly expectedCurrentDigest: string;
    };

const digestPattern = /^sha256:[a-f0-9]{64}$/;

export const parseInstallCatalogReleaseArgs = (argv: string[]): InstallCatalogReleaseArgs => {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (
      token === "--confirm-digest" ||
      token === "--mode" ||
      token === "--expected-current-id" ||
      token === "--expected-current-digest"
    ) {
      const value = argv[index + 1];
      if (!value) throw new Error("catalog-install-usage");
      flags.set(token, value);
      index += 1;
      continue;
    }
    if (token.startsWith("-")) throw new Error("catalog-install-usage");
    positional.push(token);
  }
  if (positional.length !== 1) throw new Error("catalog-install-usage");
  const expectedTargetDigest = flags.get("--confirm-digest") ?? "";
  if (!digestPattern.test(expectedTargetDigest)) throw new Error("catalog-install-usage");
  const mode = flags.get("--mode") ?? "bootstrap";
  if (mode === "bootstrap") {
    if (flags.has("--expected-current-id") || flags.has("--expected-current-digest")) {
      throw new Error("catalog-install-usage");
    }
    return { mode, filename: positional[0]!, expectedTargetDigest };
  }
  if (mode === "advance") {
    const expectedCurrentId = flags.get("--expected-current-id") ?? "";
    const expectedCurrentDigest = flags.get("--expected-current-digest") ?? "";
    if (!expectedCurrentId || !digestPattern.test(expectedCurrentDigest)) {
      throw new Error("catalog-install-usage");
    }
    return {
      mode,
      filename: positional[0]!,
      expectedTargetDigest,
      expectedCurrentId,
      expectedCurrentDigest,
    };
  }
  throw new Error("catalog-install-usage");
};

/** Bootstrap or advance. Ordinary app startup never calls this management command. */
export async function installCatalogRelease(pool: pg.Pool, args: InstallCatalogReleaseArgs, bundle: unknown) {
  if (!isCatalogReleaseBundle(bundle)) throw new Error("catalog-install-invalid-bundle");
  const compiled = await compileCatalogRelease(bundle);
  if (!compiled.ok) throw new Error(`catalog-install-${compiled.error.kind}`);
  const expected = CatalogReleaseDigest(args.expectedTargetDigest);
  if (compiled.value.aggregateDigest !== expected) throw new Error("catalog-install-digest-mismatch");
  const installer = createCatalogInstaller(pool);
  const result =
    args.mode === "bootstrap"
      ? await installer.installPublishedRelease({
          mode: "bootstrap",
          source: jsonCatalogReleaseSource(bundle),
          expectedTargetDigest: expected,
        })
      : await installer.installPublishedRelease({
          mode: "advance",
          source: jsonCatalogReleaseSource(bundle),
          expectedTargetDigest: expected,
          expectedCurrent: {
            id: CatalogReleaseId(args.expectedCurrentId),
            digest: CatalogReleaseDigest(args.expectedCurrentDigest),
          },
        });
  if (!result.ok) throw new Error(`catalog-install-${result.error.kind}`);
  return result.value;
}

/** @deprecated Use installCatalogRelease with mode bootstrap. */
export async function installFirstCatalogRelease(pool: pg.Pool, bundle: unknown, expectedDigest: string) {
  return installCatalogRelease(
    pool,
    { mode: "bootstrap", filename: "-", expectedTargetDigest: expectedDigest },
    bundle,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) {
    console.error(USAGE);
    process.exitCode = 2;
  } else {
    try {
      const args = parseInstallCatalogReleaseArgs(process.argv.slice(2));
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      try {
        const result = await installCatalogRelease(
          pool,
          args,
          JSON.parse(await readFile(args.filename, "utf8")),
        );
        console.log(JSON.stringify(result));
      } finally {
        await pool.end();
      }
    } catch (error) {
      if (error instanceof Error && error.message === "catalog-install-usage") {
        console.error(USAGE);
        process.exitCode = 2;
      } else {
        console.error(
          error instanceof Error && error.message.startsWith("catalog-install-")
            ? error.message
            : "catalog-install-failed",
        );
        process.exitCode = 1;
      }
    }
  }
}
