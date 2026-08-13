import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { createParameterModule } from "../parameters/parameterModuleRepository";
import { resolveModuleIdForBinding, unclassifiedModuleId } from "./resolveModuleForBinding";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("resolveModuleIdForBinding", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    setParameterIdentityMode(null);
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, { organization: { id: "org-1", name: "ChargeLab" } });
    await seedCoreGraph(db, { organization: { id: "org-2", name: "OtherOrg" } });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  async function seedMappedModule(input: {
    name: string;
    matchKind: "compatible" | "node-type";
    matchValue: string;
    priority?: number;
  }): Promise<string> {
    const module = await createParameterModule(db, { organizationId: "org-1", name: input.name });
    await db.query(
      `insert into parameter_module_mappings (id, organization_id, parameter_module_id, match_kind, match_value, priority)
       values ($1, 'org-1', $2, $3, $4, $5)`,
      [`map-${input.name}`, module.id, input.matchKind, input.matchValue, input.priority ?? 0]
    );
    return module.id;
  }

  async function moduleRow(moduleId: string) {
    const result = await db.query<{
      organization_id: string;
      name: string;
      kind: string;
      origin: string;
    }>(`select organization_id, name, kind, origin from parameter_modules where id = $1`, [moduleId]);
    return result.rows[0];
  }

  it("prefers a compatible mapping over a node-type mapping", async () => {
    const compatibleModuleId = await seedMappedModule({
      name: "SC8562 Group",
      matchKind: "compatible",
      matchValue: "richtek,sc8562"
    });
    await seedMappedModule({ name: "SC8562 Type", matchKind: "node-type", matchValue: "sc8562" });

    const moduleId = await resolveModuleIdForBinding(db, {
      organizationId: "org-1",
      driverModule: "sc8562",
      compatible: "richtek,sc8562",
      nodeType: "sc8562"
    });

    expect(moduleId).toBe(compatibleModuleId);
  });

  it("falls back to a node-type mapping when no compatible mapping matches", async () => {
    const nodeTypeModuleId = await seedMappedModule({
      name: "Middle CPU",
      matchKind: "node-type",
      matchValue: "middle_cpu"
    });

    const moduleId = await resolveModuleIdForBinding(db, {
      organizationId: "org-1",
      driverModule: "middle_cpu",
      compatible: null,
      nodeType: "middle_cpu"
    });

    expect(moduleId).toBe(nodeTypeModuleId);
  });

  it("treats DTS-quoted compatible as equal to an unquoted mapping value", async () => {
    const mappedModuleId = await seedMappedModule({
      name: "MT5788",
      matchKind: "compatible",
      matchValue: "mt,mt5788",
      priority: 300
    });

    const moduleId = await resolveModuleIdForBinding(db, {
      organizationId: "org-1",
      driverModule: "mt5788",
      compatible: '"mt,mt5788"',
      nodeType: null
    });

    expect(moduleId).toBe(mappedModuleId);
  });

  it("retired instance mappings cannot exist and never capture bindings", async () => {
    const module = await createParameterModule(db, { organizationId: "org-1", name: "Instance Bucket" });

    // The schema itself retired the legacy kind: the check constraint refuses it.
    await expect(
      db.transaction((tx) =>
        tx.query(
          `insert into parameter_module_mappings (id, organization_id, parameter_module_id, match_kind, match_value, priority)
           values ('map-instance', 'org-1', $1, 'instance', 'sc8562@6e', 0)`,
          [module.id]
        )
      )
    ).rejects.toMatchObject({ code: "23514" });

    const moduleId = await resolveModuleIdForBinding(db, {
      organizationId: "org-1",
      driverModule: "sc8562",
      compatible: "richtek,sc8562",
      nodeType: "sc8562"
    });

    expect(moduleId).toBe(unclassifiedModuleId("org-1"));
  });

  it("ensures and returns the deterministic unclassified module when no mapping matches", async () => {
    const moduleId = await resolveModuleIdForBinding(db, {
      organizationId: "org-1",
      driverModule: "sc8562",
      compatible: "richtek,sc8562",
      nodeType: "sc8562"
    });

    expect(moduleId).toBe(unclassifiedModuleId("org-1"));
    expect(await moduleRow(moduleId)).toMatchObject({
      organization_id: "org-1",
      name: "未分类",
      kind: "unclassified",
      origin: "auto"
    });
  });

  it("never returns null/undefined even when driver/compatible/nodeType are all null", async () => {
    const moduleId = await resolveModuleIdForBinding(db, {
      organizationId: "org-1",
      driverModule: null,
      compatible: null,
      nodeType: null
    });

    expect(moduleId).toBe(unclassifiedModuleId("org-1"));
  });

  it("is stable across organizations (id is org-scoped) and idempotent across calls", async () => {
    const first = await resolveModuleIdForBinding(db, {
      organizationId: "org-1",
      driverModule: null,
      compatible: null,
      nodeType: null
    });
    const second = await resolveModuleIdForBinding(db, {
      organizationId: "org-1",
      driverModule: null,
      compatible: null,
      nodeType: null
    });
    const otherOrg = await resolveModuleIdForBinding(db, {
      organizationId: "org-2",
      driverModule: null,
      compatible: null,
      nodeType: null
    });

    expect(first).toBe(second);
    expect(first).not.toBe(otherOrg);
    // Idempotent ensure: still exactly one unclassified row per organization.
    const rows = await db.query<{ organization_id: string }>(
      `select organization_id from parameter_modules where kind = 'unclassified' order by organization_id`
    );
    expect(rows.rows.map((row) => row.organization_id)).toEqual(["org-1", "org-2"]);
    expect((await moduleRow(otherOrg))?.organization_id).toBe("org-2");
  });
});
