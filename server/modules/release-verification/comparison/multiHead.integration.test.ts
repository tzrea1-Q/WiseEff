import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../../shared/database/client";
import { applyMigrations } from "../../../shared/database/migrations";
import { makeTestAuthContext } from "../../../testing/authContext";
import { seedCoreGraph } from "../../../testing/fixtures";
import { createCheckedEmptyDatabase, type ParameterCatalogDatabase } from "../../../testing/upgradeComponents";
import { createParameterModule } from "../../parameters/parameterModuleRepository";
import { registerOrClaimDriver } from "../../parameter-modules/service";
import { upsertMatchedDriverSchema, upsertMatchedPropertySpec } from "../../parameter-specs/repository";
import { captureComparisonP0Graph } from "../../catalog-cutover/comparisonRules";
import { classifyFrozenP0Graph } from "../../catalog-cutover/classifier";
import { planCutover } from "../../catalog-cutover/orchestrator";
import { acquireObservedManagementClient } from "../../catalog-cutover/retirement/managementCheckout";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { readComparisonSourceInventory } from "./planInventory";
import { COMPARISON_FAMILIES } from "./corpusContributionSchema";
import { captureConversionSourceInventory, captureConversionSourceSnapshot } from "../../catalog-cutover/conversionManifest";

if (process.env.UPG_COMPONENT_PROFILE !== "selfhost-postgres16-alpine-v1") throw new Error("comparison-multihead-owned-profile-required");

/** Start with real legacy domain commands, then capture every installed source
 * kind. A failure before P0 is a source/plan failure, not comparison evidence.
 * The fixture never inserts a mapping, rule, checkpoint or passing report. */
describe("complete legacy source to multi-head comparison", () => {
  let owned: ParameterCatalogDatabase | undefined;
  let database: RootDatabase | undefined;
  let directory: string | undefined;
  const organizationId = `multihead-${randomUUID()}`, userId = `multihead-${randomUUID()}`;
  const created: Array<{ parameterSpecId: string; parameterSpecVersionId: string }> = [];
  beforeAll(async () => {
    owned = await createCheckedEmptyDatabase("comparisonmultihead");
    directory = await mkdtemp(path.join(await realpath(os.tmpdir()), "comparison-multihead-"));
    const migrations = path.join(directory, "source-migrations"); await mkdir(migrations);
    const sourceSha = "82344044b436a8dafecefbb85dfd724cecb05e3f";
    const files = execFileSync("git", ["--no-replace-objects", "ls-tree", "--name-only", `${sourceSha}:server/migrations`], { encoding: "utf8" })
      .trim().split("\n").filter(file => file.endsWith(".sql"));
    for (const file of files) await writeFile(path.join(migrations, file),
      execFileSync("git", ["--no-replace-objects", "show", `${sourceSha}:server/migrations/${file}`]));
    database = createPostgresDatabase(owned.url);
    await applyMigrations(database, migrations);
    await seedCoreGraph(database, { organization: { id: organizationId }, users: [{ id: userId }] });
    const auth = makeTestAuthContext({ organizationId, userId,
      permissions: ["parameter:view", "parameter:edit", "admin:access"] });
    const business = await createParameterModule(database, { organizationId, name: "Power" });
    await registerOrClaimDriver(database, auth, { displayName: "Power driver", businessCategoryId: business.id, compatibles: ["acme,power"] });
    const namespace = `org/${organizationId}/acme,power`, driverId = `${namespace}:v1`;
    // These are explicit synthetic source-document inputs to the existing
    // materialization owner, not post-hoc graph or mapping declarations.
    await database.transaction(async transaction => {
      await upsertMatchedDriverSchema(transaction, { id: driverId, compatible: "acme,power", compatiblePatterns: ["acme,power"],
        nodenamePatterns: [], source: "manual", scope: "organization", schemaNamespace: namespace, version: 1,
        lifecycle: "active", propertyIds: ["iin_max", "enabled"], commonRefs: [] });
      for (const propertyKey of ["iin_max", "enabled"]) created.push(await upsertMatchedPropertySpec(transaction, {
        id: `propspec:${namespace}:${propertyKey}`, parameterSpecId: `pspec:${namespace}:${propertyKey}`, driverSchemaId: driverId,
        propertyKey, schemaNamespace: namespace, source: "manual", scope: "organization", lifecycle: "active", version: 1,
        valueShape: propertyKey === "enabled" ? { kind: "bool" } : { kind: "u32-array" },
        constraints: {}, documentation: "Explicit synthetic comparison source.", exampleValue: propertyKey === "enabled" ? true : [43],
      }));
    });
    await applyMigrations(database, path.resolve("server/migrations"));
  });
  afterAll(async () => {
    const results = await Promise.allSettled([database?.close()]);
    try { await owned?.close(); } catch { throw new Error("comparison-multihead-owned-cleanup-failed"); }
    if (results.some(result => result.status === "rejected")) throw new Error("comparison-multihead-root-cleanup-failed");
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it("plans the complete actual graph without discarding version, registration or placement identities", async () => {
    if (!database || created.length !== 2) throw new Error("comparison-multihead-source-unavailable");
    const client = await acquireObservedManagementClient(getRootPostgresPool(database)!, () => undefined);
    const graph = await (async () => {
      try {
        await client.query("begin isolation level repeatable read read only");
        const observed = new Proxy(client, { get(target, property) {
          if (property !== "query") return Reflect.get(target, property);
          return async (sql: string, values?: unknown[]) => {
            try { return await target.query(sql, values); }
            catch (error) {
              const code = error && typeof error === "object" ? Reflect.get(error, "code") : undefined;
              console.info(JSON.stringify({ stage: "source-query-refused",
                relation: /from (public\.[a-z_]+)\b/.exec(sql)?.[1] ?? "owner-query",
                sqlState: typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : "unclassified" }));
              throw error;
            }
          };
        } });
        const graph = await captureComparisonP0Graph(observed, "wiseeff-v1");
        const snapshot = await captureConversionSourceSnapshot(observed);
        expect(snapshot.sourceInventoryFingerprint).toBe(await captureConversionSourceInventory(observed));
        for (const source of created) {
          const version = snapshot.records.find(record => record.sourceKind === "parameter-spec-version" && record.sourceId === source.parameterSpecVersionId);
          expect(version?.payload.parameter_spec_id).toBe(source.parameterSpecId);
          expect(version?.sqlNullColumns).not.toContain("example_value");
          expect(version?.payload.example_value).toEqual(source.parameterSpecId.endsWith(":enabled") ? true : [43]);
        }
        return graph;
      } finally {
        try { await client.query("rollback"); } finally { client.release(); }
      }
    })();
    for (const source of created) {
      expect(graph.identities.filter(identity => identity.sourceKind === "parameter-spec" && identity.sourceId === source.parameterSpecId)).toHaveLength(1);
      expect(graph.identities.filter(identity => identity.sourceKind === "parameter-spec-version" && identity.sourceId === source.parameterSpecVersionId)).toHaveLength(1);
    }
    expect(graph.identities.some(identity => identity.sourceKind === "parameter-subject")).toBe(true);
    expect(graph.driverRegistrations.length).toBeGreaterThan(0);
    expect(graph.placements.length).toBeGreaterThan(0);
    const classified = classifyFrozenP0Graph(graph);
    expect(classified.ok).toBe(true);
    const inventory = await readComparisonSourceInventory(database,
      graph.identities.map(({ id, ...identity }) => ({ legacyIdentityId: id, ...identity })));
    expect(Object.keys(inventory).sort()).toEqual([...COMPARISON_FAMILIES].sort());
    console.info(JSON.stringify({ stage: "full-source-inventory", families: COMPARISON_FAMILIES.map(family => ({ family,
      count: inventory[family].length })), comparisonRulesProduced: false }));
    const full = validCatalogReleaseBundle(), release = full.releases[0]!;
    const bundle = { ...full, targetReleaseId: release.manifest.release.id, releases: [release] };
    const planned = await planCutover({ graph, targetArtifactSha: "e".repeat(40),
      targetCatalogReleaseDigest: release.manifest.release.digest, catalogReleaseSource: jsonCatalogReleaseSource(bundle) });
    console.info(JSON.stringify({ stage: "full-source-plan", sourceIdentityCount: graph.identities.length,
      sourceKinds: [...new Set(graph.identities.map(identity => identity.sourceKind))].sort(),
      classifications: classified.ok ? [...new Set(classified.value.assignments.map(assignment => assignment.rClass))].sort() : [],
      planned: planned.ok, failure: planned.ok ? null : planned.error, comparisonExecuted: false }));
    expect(planned).toMatchObject({
      ok: false,
      error: { code: "PCAT-ORC-INVALID-PLAN", detail: "conversion-business-history-producer-unavailable" },
    });
  });
});
