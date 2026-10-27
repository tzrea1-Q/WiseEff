import { chmodSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { localDevelopmentTarget, prepareLocalCatalogPublication, readLocalDevelopmentRuntime } from "../../scripts/local-development";
import { seedM0Foundation } from "../../scripts/seed-m0";
import { getAuthContext } from "../modules/auth/repository";
import { createUserInvocation } from "../modules/auth/trustedInvocation";
import { readCurrentCatalogPointer } from "../modules/catalog-kernel/install/currentPointer";
import { createCatalogInstaller } from "../modules/catalog-kernel/install/installer";
import { bootstrapFirstAcme } from "../modules/catalog-kernel/install/publicationTestHarness";
import { collectPublicationPolicyInstanceSnapshot } from "../modules/catalog-publication/authorization/instanceSnapshot";
import { revisePublicationPolicy } from "../modules/catalog-publication/authorization/policy";
import { MANAGED_INSTANCE_POLICY_CONFIRMATION } from "../modules/catalog-publication/authorization/types";
import { CATALOG_CAPABILITY_CONTRACT_REVISION } from "../modules/catalog-publication/builder/capabilities";
import { vendorIntegerChange } from "../modules/catalog-publication/builder/predecessorHarness";
import { runPublicationManagerOnce } from "../modules/catalog-publication/jobs/manager";
import { setPublicationFreeze } from "../modules/catalog-publication/runtime/freeze";
import { bindCatalogPublicationCommands } from "../modules/parameter-catalog-api/publication/ports";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../shared/database/client";
import { dropLabRuntimeLogins, publicationRuntimeLoginNames } from "../testing/labRuntimeLogins";
import { seedPublishedCatalog } from "../testing/parameterCatalog/seedPublishedCatalog";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../testing/testDatabase";

type Fixture = {
  database: EphemeralTestDatabase;
  db: RootDatabase;
  root: string;
  env: NodeJS.ProcessEnv;
};

const fixtures: Fixture[] = [];
const actorId = "u-xu-yun";

async function fixture(label: string) {
  const database = await createEphemeralTestDatabase(label);
  const entry = {
    database,
    db: createPostgresDatabase(database.url),
    root: mkdtempSync(path.join(tmpdir(), "wiseeff-local-development-")),
    env: { NODE_ENV: "development", DATABASE_URL: database.url },
  };
  fixtures.push(entry);
  await seedM0Foundation(entry.db);
  return entry;
}

async function publicationState(db: RootDatabase) {
  const snapshot = await collectPublicationPolicyInstanceSnapshot(db);
  const receipts = await db.query<{ count: string }>("select count(*)::text as count from parameter_catalog.catalog_activation_receipts");
  return { ...snapshot, receiptCount: Number(receipts.rows[0]!.count) };
}

async function reviseEnabled(db: RootDatabase, publicationEnabled: boolean) {
  const snapshot = await collectPublicationPolicyInstanceSnapshot(db);
  const result = await revisePublicationPolicy(db, {
    trustedActor: createUserInvocation(await getAuthContext(db, actorId)),
    publicationEnabled,
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
  expect(result.ok).toBe(true);
}

describe.sequential("explicit local development Catalog preparation against PostgreSQL", () => {
  let local: Fixture;
  let api: RootDatabase;
  let manager: RootDatabase;
  let runtime: Awaited<ReturnType<typeof prepareLocalCatalogPublication>>;

  beforeAll(async () => {
    local = await fixture("localdev");
    await seedPublishedCatalog(getRootPostgresPool(local.db)!);
    expect((await publicationState(local.db)).adopted).toBe(false);
    runtime = await prepareLocalCatalogPublication(local.env, local.root);
    api = createPostgresDatabase(runtime.api);
    manager = createPostgresDatabase(runtime.manager);
  }, 120_000);

  afterAll(async () => {
    await api?.close();
    await manager?.close();
    for (const entry of fixtures) {
      try {
        const cleaned = await dropLabRuntimeLogins(entry.database.url, localDevelopmentTarget(entry.env, entry.root).runToken);
        expect(cleaned.failed).toEqual([]);
      } finally {
        await entry.db.close();
        await entry.database.drop();
        rmSync(entry.root, { recursive: true, force: true });
      }
    }
  }, 120_000);

  it("makes the real administrator authoring/publication surface usable with separate runtime LOGINs", async () => {
    const state = await publicationState(local.db);
    expect(state).toMatchObject({ adopted: true, publicationEnabled: true, frozen: false, receiptCount: 1 });
    const auth = await getAuthContext(api, actorId);
    const surface = await bindCatalogPublicationCommands({ db: api, pool: getRootPostgresPool(api)! }).getPublicationSurface({
      organizationId: auth.organization.id, actorKind: "org-admin", permissions: auth.permissions,
    });
    expect(surface).toMatchObject({ ok: true, value: { authoringAllowed: true, publishingAllowed: true, blockers: [] } });
    const loginQuery = `select current_user as name, rolsuper, rolinherit,
      has_table_privilege(current_user, 'parameter_catalog.parameter_definitions', 'INSERT') as catalog_insert
      from pg_roles where rolname=current_user`;
    const apiLogin = (await api.query<{ name: string; rolsuper: boolean; rolinherit: boolean; catalog_insert: boolean }>(loginQuery)).rows[0]!;
    const managerLogin = (await manager.query<{ name: string; rolsuper: boolean; rolinherit: boolean; catalog_insert: boolean }>(loginQuery)).rows[0]!;
    expect(apiLogin).toMatchObject({ rolsuper: false, rolinherit: false, catalog_insert: false });
    expect(managerLogin).toMatchObject({ rolsuper: false, rolinherit: false, catalog_insert: false });
    expect(apiLogin.name).not.toBe(managerLogin.name);
  });

  it("reuses credentials and adoption without adding a Receipt or policy revision", async () => {
    const before = await publicationState(local.db);
    const repeated = await prepareLocalCatalogPublication(local.env, local.root);
    expect(JSON.stringify(repeated) === JSON.stringify(runtime)).toBe(true);
    expect(JSON.stringify(readLocalDevelopmentRuntime(local.env, local.root)) === JSON.stringify(runtime)).toBe(true);
    expect(await publicationState(local.db)).toEqual(before);
  });

  it("preserves an actual online successor through repeated seeding and local preparation", async () => {
    const pool = getRootPostgresPool(api)!;
    const ports = bindCatalogPublicationCommands({ db: api, pool });
    const auth = await getAuthContext(api, actorId);
    const pointer = await readCurrentCatalogPointer(pool);
    if (pointer.kind !== "installed") throw new Error("local Catalog was not installed");
    const scope = {
      trustedActor: createUserInvocation(auth), organizationId: auth.organization.id,
      principalId: auth.user.id, permissions: auth.permissions, actorKind: "org-admin" as const,
      catalogReleaseId: pointer.current.id,
    };
    const preview = await ports.previewCandidate({ ...scope, changeSet: [vendorIntegerChange("local_setup_probe", "Local setup probe")] });
    expect(preview.ok, JSON.stringify(preview)).toBe(true);
    if (!preview.ok) return;
    const queued = await ports.publishCandidate({ ...scope, candidateId: preview.value.id, idempotencyKey: "local-development-successor" });
    expect(queued.ok, JSON.stringify(queued)).toBe(true);
    if (!queued.ok) return;
    expect(queued.value.status).toBe("queued");
    const managerPool = getRootPostgresPool(manager)!;
    expect(await runPublicationManagerOnce({
      db: manager, pool: managerPool, installer: createCatalogInstaller(managerPool),
      resolvePublisherActor: async (principalId) => createUserInvocation(await getAuthContext(manager, principalId)),
      ownerId: "local-development-regression",
    })).toBe("claimed");
    const activated = await ports.getPublication({ jobId: queued.value.id, organizationId: auth.organization.id, actorKind: "org-admin" });
    expect(activated, JSON.stringify(activated)).toMatchObject({ ok: true, value: { status: "active", effective: true } });
    const after = await publicationState(local.db);
    expect(after.currentReleaseId).not.toBe(pointer.current.id);
    expect(after.receiptKinds).toContain("online-publication");
    expect((await seedPublishedCatalog(getRootPostgresPool(local.db)!)).id).toBe(after.currentReleaseId);
    await prepareLocalCatalogPublication(local.env, local.root);
    expect(await publicationState(local.db)).toEqual(after);
  }, 120_000);

  it("keeps a maintenance freeze and a deliberately disabled policy unchanged", async () => {
    expect((await setPublicationFreeze(local.db, { frozen: true, actorPrincipalId: actorId })).ok).toBe(true);
    const frozen = await publicationState(local.db);
    try {
      await expect(prepareLocalCatalogPublication(local.env, local.root)).rejects.toThrow(/frozen/);
      expect(await publicationState(local.db)).toEqual(frozen);
    } finally {
      expect((await setPublicationFreeze(local.db, { frozen: false, actorPrincipalId: actorId })).ok).toBe(true);
    }
    await reviseEnabled(local.db, false);
    const disabled = await publicationState(local.db);
    try {
      await expect(prepareLocalCatalogPublication(local.env, local.root)).rejects.toThrow(/explicitly disabled/);
      expect(await publicationState(local.db)).toEqual(disabled);
    } finally {
      await reviseEnabled(local.db, true);
    }
  });

  it("refuses an unrelated unadopted Catalog without changing its pointer or policy", async () => {
    const other = await fixture("localunknown");
    await bootstrapFirstAcme(getRootPostgresPool(other.db)!);
    const before = await publicationState(other.db);
    await expect(prepareLocalCatalogPublication(other.env, other.root)).rejects.toThrow(/exact committed demo Catalog/);
    expect(await publicationState(other.db)).toEqual(before);
  }, 60_000);

  it("rejects unsafe or partial credential storage before database writes and recovers after correction", async () => {
    const other = await fixture("localstorage");
    await seedPublishedCatalog(getRootPostgresPool(other.db)!);
    const before = await publicationState(other.db);
    const target = localDevelopmentTarget(other.env, other.root);
    const names = publicationRuntimeLoginNames({ mode: "lab", runToken: target.runToken });
    const existingLogins = () => other.db.query("select rolname from pg_roles where rolname=any($1::text[])", [Object.values(names)]);
    mkdirSync(target.directory, { recursive: true, mode: 0o700 });
    chmodSync(target.directory, 0o755);
    await expect(prepareLocalCatalogPublication(other.env, other.root)).rejects.toThrow(/private \(0700\)/);
    expect(await publicationState(other.db)).toEqual(before);
    expect((await existingLogins()).rows).toEqual([]);

    chmodSync(target.directory, 0o700);
    const partialFile = path.join(target.directory, "api.dsn");
    writeFileSync(partialFile, "incomplete-fixture\n", { mode: 0o600 });
    await expect(prepareLocalCatalogPublication(other.env, other.root)).rejects.toThrow(/credentials are incomplete/);
    expect(await publicationState(other.db)).toEqual(before);
    expect((await existingLogins()).rows).toEqual([]);

    unlinkSync(partialFile);
    const prepared = await prepareLocalCatalogPublication(other.env, other.root);
    expect(JSON.stringify(readLocalDevelopmentRuntime(other.env, other.root)) === JSON.stringify(prepared)).toBe(true);
    expect(await publicationState(other.db)).toMatchObject({ adopted: true, publicationEnabled: true, frozen: false, receiptCount: 1 });
    expect((await existingLogins()).rows).toHaveLength(3);
  }, 120_000);

  it("refuses non-development and remote targets before preparation", async () => {
    const before = await publicationState(local.db);
    await expect(prepareLocalCatalogPublication({ ...local.env, NODE_ENV: "production" }, local.root)).rejects.toThrow(/NODE_ENV=development/);
    await expect(prepareLocalCatalogPublication({ NODE_ENV: "development", DATABASE_URL: "postgres://dev@remote.example/dev" }, local.root)).rejects.toThrow(/loopback/);
    expect(await publicationState(local.db)).toEqual(before);
  });
});
