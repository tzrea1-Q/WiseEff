import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadDotenvFiles } from "../server/config/loadDotenv";
import { getAuthContext } from "../server/modules/auth/repository";
import { createUserInvocation } from "../server/modules/auth/trustedInvocation";
import { collectPublicationPolicyInstanceSnapshot } from "../server/modules/catalog-publication/authorization/instanceSnapshot";
import { revisePublicationPolicy } from "../server/modules/catalog-publication/authorization/policy";
import { MANAGED_INSTANCE_POLICY_CONFIRMATION } from "../server/modules/catalog-publication/authorization/types";
import { CATALOG_CAPABILITY_CONTRACT_REVISION } from "../server/modules/catalog-publication/builder/capabilities";
import { adoptPreexistingCatalog } from "../server/modules/catalog-publication/runtime/adoption";
import { provisionPublicationRuntimeLogins, publicationRuntimeLoginNames } from "../server/modules/catalog-publication/runtime/provisionRuntimeLogins";
import { writeRuntimeLoginSecrets } from "../server/modules/catalog-publication/runtime/runtimeLoginSecrets";
import { createPostgresDatabase, getRootPostgresPool } from "../server/shared/database/client";
import { compileLocalizedVendorCatalogSuccessor } from "./compile-vendor-catalog-release";

const actorId = "u-xu-yun";

function assertLocalPublicationPolicy(snapshot: { frozen: boolean; publicationEnabled: boolean; policyRevision: number }) {
  if (snapshot.frozen) throw new Error("Local Catalog publication is frozen; dev:setup will not unfreeze it");
  if (!snapshot.publicationEnabled && snapshot.policyRevision !== 1) {
    throw new Error("Catalog publication was explicitly disabled; dev:setup will not re-enable it");
  }
}

export function localDevelopmentTarget(env: NodeJS.ProcessEnv, root = process.cwd()) {
  if (env.NODE_ENV !== "development") throw new Error("dev:setup requires NODE_ENV=development");
  const url = new URL(env.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.search || !url.pathname.slice(1)) {
    throw new Error("dev:setup requires a loopback PostgreSQL development database without query overrides");
  }
  const token = createHash("sha256").update(`${path.resolve(root)}:${url.host}:${url.pathname}`).digest("hex").slice(0, 16);
  return { url, runToken: `dev${token}`, directory: path.join(root, ".wiseeff-tools", "local-development", token) };
}

export function readLocalDevelopmentRuntime(env: NodeJS.ProcessEnv, root = process.cwd()) {
  const target = localDevelopmentTarget(env, root);
  const names = publicationRuntimeLoginNames({ mode: "lab", runToken: target.runToken });
  const urls = {} as Record<"api" | "worker" | "manager", string>;
  for (const kind of ["api", "worker", "manager"] as const) {
    const file = path.join(target.directory, `${kind}.dsn`);
    for (const entry of [target.directory, file]) {
      const stat = lstatSync(entry);
      if (stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error("Unsafe local runtime credential permissions");
    }
    const value = readFileSync(file, "utf8").trim();
    const url = new URL(value);
    if (url.host !== target.url.host || url.pathname !== target.url.pathname || url.search
      || decodeURIComponent(url.username) !== names[kind] || !url.password) {
      throw new Error("Local runtime credentials do not match this development database");
    }
    urls[kind] = value;
  }
  return urls;
}

/** Explicit local management only. Ordinary API startup remains verify-only. */
export async function prepareLocalCatalogPublication(env: NodeJS.ProcessEnv, root = process.cwd()) {
  const target = localDevelopmentTarget(env, root);
  // Check storage before committing adoption, policy or LOGIN creation.
  mkdirSync(target.directory, { recursive: true, mode: 0o700 });
  const directory = lstatSync(target.directory);
  if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0) {
    throw new Error("Local runtime credential directory must be private (0700) and not a symlink");
  }
  accessSync(target.directory, constants.W_OK);
  const files = ["api", "worker", "manager"].map((kind) => path.join(target.directory, `${kind}.dsn`));
  const presentFiles = files.filter(existsSync).length;
  if (presentFiles > 0 && presentFiles !== files.length) throw new Error("Local runtime credentials are incomplete; restore all three private DSN files before retrying");
  if (presentFiles) readLocalDevelopmentRuntime(env, root);
  const db = createPostgresDatabase(target.url.href);
  try {
    const names = publicationRuntimeLoginNames({ mode: "lab", runToken: target.runToken });
    const existing = await db.query("select 1 from pg_roles where rolname = any($1::text[])", [Object.values(names)]);
    if (!presentFiles && existing.rows.length) {
      throw new Error(`Local runtime LOGINs exist but their credentials are missing. Restore the private DSN files, or explicitly recover this owned lab with catalog:publication:ops provision-logins --mode lab --run-token ${target.runToken} --credential-dir ${target.directory} --rotate-passwords using WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL. No password was rotated.`);
    }
    let snapshot = await collectPublicationPolicyInstanceSnapshot(db);
    assertLocalPublicationPolicy(snapshot);
    if (!snapshot.adopted) {
      const seed = compileLocalizedVendorCatalogSuccessor();
      if (snapshot.currentReleaseId !== seed.compiled.release.id || snapshot.currentReleaseDigest !== seed.compiled.release.digest) {
        throw new Error("Local adoption requires the exact committed demo Catalog; use operator inspect/adopt for other catalogs");
      }
      const fingerprint = await db.query<{ compiled_fingerprint: string }>(
        "select compiled_fingerprint from parameter_catalog.catalog_materializations where release_id=$1",
        [snapshot.currentReleaseId],
      );
      const adopted = await adoptPreexistingCatalog(getRootPostgresPool(db)!, {
        expectedCurrent: { id: seed.compiled.release.id, digest: seed.compiled.release.digest },
        actorPrincipalId: actorId,
        sourceBytes: Buffer.from(JSON.stringify(seed.bundle)),
        artifactDigest: seed.compiled.release.digest,
        evidenceKind: "synthetic-fixture",
        adoptionEvidence: {
          source_bundle_digest: seed.compiled.release.digest,
          verification_digest: fingerprint.rows[0]?.compiled_fingerprint ?? "",
          data_mode: "fresh",
          collected_at: new Date().toISOString(),
          approved_by: actorId,
        },
        toolchain: { profile: "local-development" },
      });
      if (!adopted.ok) throw new Error(`Local Catalog adoption failed: ${adopted.error.kind}`);
      snapshot = await collectPublicationPolicyInstanceSnapshot(db);
    }
    if (!snapshot.publicationEnabled) {
      const enabled = await revisePublicationPolicy(db, {
        trustedActor: createUserInvocation(await getAuthContext(db, actorId)),
        publicationEnabled: true,
        lowRiskSingleActorPublish: false,
        capabilityContractRevision: CATALOG_CAPABILITY_CONTRACT_REVISION,
        mode: "execute",
        managedInstance: {
          confirmation: MANAGED_INSTANCE_POLICY_CONFIRMATION,
          expectedDatabaseOid: snapshot.databaseOid,
          expectedCurrentId: snapshot.currentReleaseId!,
          expectedCurrentDigest: snapshot.currentReleaseDigest!,
          expectedPolicyRevision: snapshot.policyRevision,
          expectedFrozen: snapshot.frozen,
          expectedAdopted: snapshot.adopted,
        },
      });
      if (!enabled.ok) throw new Error(`Local publication policy failed: ${enabled.error.reason}`);
    }
    const logins = await provisionPublicationRuntimeLogins(target.url.href, { mode: "lab", runToken: target.runToken });
    if (logins.passwordsDelivered) {
      writeRuntimeLoginSecrets({ directory: target.directory, apiUrl: logins.apiUrl, workerUrl: logins.workerUrl, managerUrl: logins.managerUrl });
    }
    const runtime = readLocalDevelopmentRuntime(env, root);
    const api = createPostgresDatabase(runtime.api);
    const manager = createPostgresDatabase(runtime.manager);
    try {
      const { bindCatalogPublicationCommands } = await import("../server/modules/parameter-catalog-api/publication/ports");
      const auth = await getAuthContext(api, actorId);
      const surface = await bindCatalogPublicationCommands({ db: api, pool: getRootPostgresPool(api)! }).getPublicationSurface({
        organizationId: auth.organization.id, actorKind: "org-admin", permissions: auth.permissions,
      });
      if (!surface.ok || !surface.value.authoringAllowed || !surface.value.publishingAllowed) {
        throw new Error("Local Catalog authoring/publication verification failed");
      }
      const { readPublicationManagerHealth } = await import("../server/modules/catalog-publication/jobs/manager");
      await readPublicationManagerHealth(manager);
      console.log("Local Catalog adopted; admin authoring/publication and dedicated manager LOGIN verified (synthetic local evidence).");
    } finally {
      await api.close();
      await manager.close();
    }
    return runtime;
  } finally {
    await db.close();
  }
}

async function main() {
  loadDotenvFiles();
  if (process.argv[2] && process.argv[2] !== "manager") throw new Error("Usage: local-development.ts [manager]");
  localDevelopmentTarget(process.env);
  if (process.argv[2] === "manager") {
    const runtime = readLocalDevelopmentRuntime(process.env);
    Object.assign(process.env, {
      DATABASE_URL: runtime.api,
      WISEEFF_PUBLICATION_MANAGER_DATABASE_URL: runtime.manager,
      WISEEFF_PUBLICATION_MANAGER: "1",
      WISEEFF_API_PROCESS: "0",
      LOG_WORKER_ENABLED: "false",
    });
    await import("../server/modules/catalog-publication/jobs/managerRunner");
    return;
  }
  const migrated = spawnSync("npm", ["run", "db:migrate"], { stdio: "inherit", env: process.env, shell: process.platform === "win32" });
  if (migrated.status !== 0) throw new Error("Local development migrations failed");
  const db = createPostgresDatabase(process.env.DATABASE_URL!);
  try {
    assertLocalPublicationPolicy(await collectPublicationPolicyInstanceSnapshot(db));
  } finally {
    await db.close();
  }
  const { runAllSeedScripts } = await import("./seed-all");
  await runAllSeedScripts(process.env);
  await prepareLocalCatalogPublication(process.env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
