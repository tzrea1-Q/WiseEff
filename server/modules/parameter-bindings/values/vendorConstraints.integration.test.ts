import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";

import {
  compileConstrainedVendorCatalogSuccessor,
  FIRST_ACME_RELEASE_DIGEST,
  VENDOR_CONSTRAINED_RELEASE_ID,
  VENDOR_SUCCESSOR_AGGREGATE_DIGEST,
} from "../../../../scripts/compile-vendor-catalog-release";
import { runAllSeedScripts } from "../../../../scripts/seed-all";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../../shared/database/client";
import { makeTestAuthContext } from "../../../testing/authContext";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../../../testing/testDatabase";
import { seedPublishedCatalog } from "../../../testing/parameterCatalog/seedPublishedCatalog";
import { createCatalogKernel, jsonCatalogReleaseSource, type CatalogSnapshot } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { vendorDirectoryHash } from "../../catalog-publication/import/vendorYaml";
import { parseDtsValue } from "../../dts/valueAst";
import { createLocalObjectStore } from "../../logs/objectStore";
import { CatalogSubjectId, DefinitionRevisionId, ParameterDefinitionId } from "../../parameter-catalog-contract";
import { writeGuardedRegistration } from "../../parameter-governance/registration/internalGuardedRegistrationWriter";
import { createSourceBackedBindingService, appendSourceCommittedValue } from "../binding/__fixtures__/sourceBackedBinding";
import type { Binding } from "../binding";
import { dtsValueToPayload } from "../catalogProjectValueSync";
import { firstReleaseBundle } from "../../../testing/parameterCatalog/cutoverPopulatedFixture";
import { assertCanonicalValueConstraints } from "./service";

const definitionId = ParameterDefinitionId("pdef_drv_sc8562_gpio_int");
const revisionId = DefinitionRevisionId("drev_drv_sc8562_gpio_int_2");
const organizationId = "org-vendor-constraints";
const projectId = "project-vendor-constraints";
const auth = makeTestAuthContext({
  organizationId,
  userId: "user-vendor-constraints",
  roles: [{ projectId: null, roleId: "admin" }],
  permissions: ["parameter:view", "parameter:edit", "admin:access"],
});
const payload = (source: string) => dtsValueToPayload(parseDtsValue("gpio_int", source).value);

describe("vendor Definition constraints", () => {
  it("maps both vendor gpio_int YAML constraints into new immutable revisions", () => {
    const result = compileConstrainedVendorCatalogSuccessor();
    expect(result.previous.predecessor.digest).toBe(FIRST_ACME_RELEASE_DIGEST);
    expect(result.predecessor.digest).toBe(VENDOR_SUCCESSOR_AGGREGATE_DIGEST);
    const documents = result.bundle.releases.at(-1)!.documents;
    for (const id of ["pdef_drv_sc8562_gpio_int", "pdef_drv_mt_mt5788_gpio_int"]) {
      const definition = documents.find((document) => document.kind === "definition" && document.content.id === id);
      expect(definition).toMatchObject({ content: { revision: { number: 2, valueSchema: {
        type: "array", description: "phandle pin flags",
        items: { type: "array", minItems: 3, maxItems: 3, items: { description: "mixed" } },
      } } } });
      const old = result.previous.bundle.releases.at(-1)!.documents.find((document) => document.content.id === id);
      expect(old).toMatchObject({ content: { revision: { number: 1, valueSchema: { description: "mixed" } } } });
    }
  });

  it("reports unsupported vendor constraint keys with their source path", () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-1057-"));
    try {
      cpSync("schemas/dts", path.join(root, "schemas/dts"), { recursive: true });
      const vendorDir = path.join(root, "schemas/dts/vendor/wiseeff");
      const filename = path.join(vendorDir, "sc8562.yaml");
      const schema = parse(readFileSync(filename, "utf8"));
      schema.properties.gpio_int.constraints.enum = [1, 2];
      writeFileSync(filename, stringify(schema));
      const catalogPath = path.join(root, "schemas/dts/catalog.json");
      const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
      catalog.vendorContentHash = vendorDirectoryHash(vendorDir);
      writeFileSync(catalogPath, JSON.stringify(catalog));
      expect(() => compileConstrainedVendorCatalogSuccessor(root)).toThrow(
        "catalog-vendor-unsupported-constraint:vendor/wiseeff/sc8562.yaml.properties.gpio_int.constraints.enum:unhandled-constraint:enum",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("published vendor constraint enforcement", () => {
  let database: EphemeralTestDatabase;
  let db: RootDatabase;
  let snapshot: CatalogSnapshot;
  let binding: Binding;
  const storageDirectory = mkdtempSync(path.join(tmpdir(), "wiseeff-1057-storage-"));
  const objectStore = createLocalObjectStore(storageDirectory);

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("vendorconstraints");
    db = createPostgresDatabase(database.url);
    const pool = getRootPostgresPool(db)!;
    const compiled = compileConstrainedVendorCatalogSuccessor();
    const bootstrap = await installPublishedRelease(pool, {
      mode: "bootstrap", source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: FIRST_ACME_RELEASE_DIGEST,
    });
    expect(bootstrap, JSON.stringify(bootstrap)).toMatchObject({ ok: true });
    const previous = await installPublishedRelease(pool, {
      mode: "advance", source: jsonCatalogReleaseSource(compiled.previous.bundle),
      expectedTargetDigest: VENDOR_SUCCESSOR_AGGREGATE_DIGEST, expectedCurrent: compiled.previous.predecessor,
    });
    expect(previous.ok).toBe(true);
    const current = await seedPublishedCatalog(pool);
    const loaded = await createCatalogKernel(pool).loadPinnedCatalog({ id: current.id, digest: current.digest });
    if (!loaded.ok) throw new Error("Vendor snapshot unavailable");
    snapshot = loaded.value;
    await pool.query("insert into organizations (id,name) values ($1,'Vendor constraints')", [organizationId]);
    await pool.query("insert into projects (id,organization_id,name,code) values ($1,$2,'Vendor constraints','V1057')", [projectId, organizationId]);
    await pool.query("insert into attribution_subjects (id,organization_id,subject_kind,display_name,source_key) values ('attr-vendor-constraints',$1,'driver-registration','Vendor constraints','compatible:sc8562')", [organizationId]);
    await pool.query("insert into driver_registrations (attribution_subject_id,driver_nature,instance_cardinality) values ('attr-vendor-constraints','physical-device','multiple')");
    await pool.query("insert into parameter_modules (id,organization_id,name,path,depth,kind,origin,attribution_subject_id) values ('pmod-vendor-constraints',$1,'Vendor constraints','pmod-vendor-constraints',1,'driver-group','curated','attr-vendor-constraints')", [organizationId]);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const registration = await writeGuardedRegistration(client, {
        kind: "register", organizationId, subjectId: CatalogSubjectId("csub_drv_sc8562"), subjectKind: "driver",
        expectedRelease: { id: current.id, digest: current.digest }, placement: { mode: "use-default" },
        destinationModuleId: "pmod-vendor-constraints", method: "explicit", proof: { reason: "vendor-constraint-regression" },
        idempotencyKey: "reg-vendor-constraints", context: { actorKind: "org-admin", principalId: auth.user.id },
      });
      if (!registration.ok) throw new Error(JSON.stringify(registration.error));
      await client.query("commit");
      const stabilized = await createSourceBackedBindingService(pool, { objectStore }).stabilize({
        snapshot, organizationId, projectId, logicalNodeId: "vendor-constraint-node",
        registrationId: registration.value.registrationId, definitionId, effectiveRevisionId: revisionId, expectedEffectiveRevisionId: null,
      });
      if (!stabilized.ok) throw new Error(JSON.stringify(stabilized.error));
      binding = stabilized.value.binding;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }, 120_000);

  afterAll(async () => {
    await db?.close();
    await database?.drop();
    rmSync(storageDirectory, { recursive: true, force: true });
  });

  it("upgrades release 1 without rewriting history and seeds release 2 idempotently", async () => {
    const pool = getRootPostgresPool(db)!;
    const before = await pool.query("select count(*)::int as count from parameter_catalog.definition_revisions");
    expect((await seedPublishedCatalog(pool)).id).toBe(VENDOR_CONSTRAINED_RELEASE_ID);
    expect((await seedPublishedCatalog(pool)).id).toBe(VENDOR_CONSTRAINED_RELEASE_ID);
    expect((await pool.query("select count(*)::int as count from parameter_catalog.definition_revisions")).rows).toEqual(before.rows);
    expect((await pool.query("select content->'valueSchema' as schema from parameter_catalog.definition_revisions where id='drev_drv_sc8562_gpio_int_1'")).rows)
      .toEqual([{ schema: { description: "mixed" } }]);
  });

  it.each(["<&gpio13 29>", "<&gpio13 29 0 1>", "<&gpio13 29 0>, <&gpio2 5>", '"a", "b", "c"', "<5>"])("refuses malformed cell groups: %s", (source) => {
    const revision = snapshot.getDefinitionRevision({ definitionId, revisionId });
    if (revision.status !== "found") throw new Error("Vendor revision unavailable");
    expect(() => assertCanonicalValueConstraints(revision.revision, payload(source))).toThrowError(expect.objectContaining({
      code: "VALIDATION_FAILED", status: 400, details: expect.objectContaining({ reason: "definition-value-constraint", definitionRevisionId: revisionId }),
    }));
  });

  it("accepts correct groups and refuses invalid canonical appends without advancing the tip", async () => {
    const currentSource = await db.query<{ source_ref: string }>("select source_ref from parameter_catalog.project_parameter_values where id=$1", [binding.currentValueId]);
    const sourceRef = currentSource.rows[0]!.source_ref;
    const append = (rawText: string) => appendSourceCommittedValue(getRootPostgresPool(db)!, {
      snapshot, binding, definitionRevisionId: revisionId, payload: payload(rawText),
      source: { sourceRef, configRevisionId: "fixture" }, expectedTip: binding.currentValueId,
    });
    await expect(append("<&gpio13 29>")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(append('"a", "b", "c"')).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const current = await db.query("select current_value_id from parameter_catalog.project_parameter_bindings where id=$1", [binding.id]);
    expect(current.rows[0]?.current_value_id).toBe(binding.currentValueId);
    const accepted = await append("<&gpio13 29 0>");
    expect(accepted).toMatchObject({ ok: true, value: { outcome: "committed" } });
    if (accepted.ok) binding = { ...binding, currentValueId: accepted.value.currentTip };
  });

  it("enforces existing numeric bounds on vendor array items", () => {
    const revision = snapshot.getDefinitionRevision({
      definitionId: ParameterDefinitionId("pdef_drv_huawei_charging_core_iin_max"),
      revisionId: DefinitionRevisionId("drev_drv_huawei_charging_core_iin_max_1"),
    });
    if (revision.status !== "found") throw new Error("Vendor numeric revision unavailable");
    expect(() => assertCanonicalValueConstraints(revision.revision, payload("<(-1)>"))).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(() => assertCanonicalValueConstraints(revision.revision, payload("<5>"))).not.toThrow();
  });

  it("seeds a fresh database twice with constrained Binding pins and no duplicate Catalog or value history", async () => {
    const fresh = await createEphemeralTestDatabase("vendorconstraintseed");
    const freshDb = createPostgresDatabase(fresh.url);
    const counts = async () => (await freshDb.query(`select
      (select count(*)::int from parameter_catalog.catalog_releases) as releases,
      (select count(*)::int from parameter_catalog.definition_revisions) as revisions,
      (select count(*)::int from parameter_catalog.project_parameter_bindings) as bindings,
      (select count(*)::int from parameter_catalog.project_parameter_values) as values,
      (select count(*)::int from parameter_catalog.binding_history_events) as history`)).rows;
    try {
      await runAllSeedScripts({ ...process.env, DATABASE_URL: fresh.url });
      const before = await counts();
      const pins = await freshDb.query<{ effective_revision_id: string }>(`select effective_revision_id
        from parameter_catalog.project_parameter_bindings
        where definition_id in ('pdef_drv_sc8562_gpio_int','pdef_drv_mt_mt5788_gpio_int')`);
      expect(pins.rows.length).toBeGreaterThan(0);
      expect(pins.rows.every((pin) => pin.effective_revision_id.endsWith("_2"))).toBe(true);
      await runAllSeedScripts({ ...process.env, DATABASE_URL: fresh.url });
      expect(await counts()).toEqual(before);
    } finally {
      await freshDb.close();
      await fresh.drop();
    }
  }, 120_000);

});
