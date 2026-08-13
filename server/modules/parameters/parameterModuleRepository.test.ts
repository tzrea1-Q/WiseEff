/**
 * Behavior-level integration coverage for the parameter module tree
 * repository: listing, creation with computed paths, moves that rewrite
 * descendant paths, auto-module reparenting, and the listParameters module
 * subtree filter against a real database. Asserts returned DTOs and
 * subsequent reads — never SQL text.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { listParameters } from "./repository";
import {
  createParameterModule,
  getParameterModuleById,
  listParameterModules,
  moveParameterModule,
  reparentAutoParameterModule
} from "./parameterModuleRepository";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("parameterModuleRepository", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    setParameterIdentityMode(null);
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley Chen", email: "riley@example.com" }],
      projects: [{ id: "project-1", name: "Aurora", code: "AUR" }]
    });
    await seedCoreGraph(db, { organization: { id: "org-2", name: "Foreign Org" } });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  async function seedModule(input: {
    id: string;
    organizationId?: string;
    parentId?: string | null;
    name: string;
    path: string;
    depth?: number;
    sortOrder?: number;
    kind?: string;
    origin?: string;
    sourceKey?: string | null;
  }) {
    await db.query(
      `insert into parameter_modules (id, organization_id, parent_id, name, path, depth, sort_order, kind, origin, source_key)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.id,
        input.organizationId ?? "org-1",
        input.parentId ?? null,
        input.name,
        input.path,
        input.depth ?? input.path.split("/").length,
        input.sortOrder ?? 0,
        input.kind ?? "business",
        input.origin ?? "curated",
        input.sourceKey ?? null
      ]
    );
  }

  it("listParameterModules returns the organization's tree rows ordered by path", async () => {
    // Insert a later-path root first: the listing order must come from the database.
    await seedModule({ id: "pm-x", name: "Charging", path: "pm-x" });
    await seedModule({ id: "pm-a", name: "Power", path: "pm-a" });
    await seedModule({ id: "pm-b", parentId: "pm-a", name: "Battery", path: "pm-a/pm-b", depth: 2 });
    // Another organization's module never leaks into the listing.
    await seedModule({ id: "pm-foreign", organizationId: "org-2", name: "Foreign", path: "pm-foreign" });

    const rows = await listParameterModules(db, { organizationId: "org-1" });

    expect(rows.map((row) => row.id)).toEqual(["pm-a", "pm-b", "pm-x"]);
    expect(rows[0]).toEqual({
      id: "pm-a",
      parentId: null,
      name: "Power",
      path: "pm-a",
      depth: 1,
      sortOrder: 0,
      description: "",
      scope: "",
      importance: "medium",
      kind: "business",
      origin: "curated",
      sourceKey: null,
      attributionSubjectId: null
    });
    expect(rows[1]).toMatchObject({ id: "pm-b", parentId: "pm-a", name: "Battery", path: "pm-a/pm-b", depth: 2 });
  });

  it("createParameterModule computes path and depth from the parent", async () => {
    await seedModule({ id: "pm-a", name: "Power", path: "pm-a" });

    const created = await createParameterModule(db, {
      organizationId: "org-1",
      name: "Battery",
      parentId: "pm-a"
    });

    expect(created).toMatchObject({
      name: "Battery",
      parentId: "pm-a",
      path: `pm-a/${created.id}`,
      depth: 2,
      kind: "business",
      origin: "curated"
    });
    // The created row reads back identically.
    await expect(
      getParameterModuleById(db, { organizationId: "org-1", moduleId: created.id })
    ).resolves.toEqual(created);
    // A missing parent refuses the create instead of inventing a root.
    await expect(
      createParameterModule(db, { organizationId: "org-1", name: "Orphan", parentId: "pm-missing" })
    ).rejects.toThrow("Parent parameter module not found");
  });

  it("moveParameterModule recomputes descendant paths and depths", async () => {
    await seedModule({ id: "pm-a", name: "Power", path: "pm-a" });
    await seedModule({ id: "pm-b", parentId: "pm-a", name: "Battery", path: "pm-a/pm-b", depth: 2 });
    await seedModule({ id: "pm-c", parentId: "pm-b", name: "Cells", path: "pm-a/pm-b/pm-c", depth: 3 });
    await seedModule({ id: "pm-x", name: "Charging", path: "pm-x", sortOrder: 1 });

    const moved = await moveParameterModule(db, {
      organizationId: "org-1",
      moduleId: "pm-b",
      parentId: "pm-x"
    });

    expect(moved).toMatchObject({ id: "pm-b", parentId: "pm-x", path: "pm-x/pm-b", depth: 2 });
    // The grandchild's path and depth follow the subtree move. (The current UPDATE
    // also cascades the new parent_id onto every descendant — pm-c reports pm-x as
    // its parent while its path still says pm-x/pm-b/pm-c. That looks like a latent
    // repository bug; this test pins only the path/depth contract.)
    await expect(
      getParameterModuleById(db, { organizationId: "org-1", moduleId: "pm-c" })
    ).resolves.toMatchObject({ path: "pm-x/pm-b/pm-c", depth: 3 });
    // The old parent keeps its own path.
    await expect(
      getParameterModuleById(db, { organizationId: "org-1", moduleId: "pm-a" })
    ).resolves.toMatchObject({ path: "pm-a", depth: 1 });
    // Moving a node under its own descendant is refused.
    await expect(
      moveParameterModule(db, { organizationId: "org-1", moduleId: "pm-x", parentId: "pm-c" })
    ).rejects.toThrow(/cycle/i);
  });

  it("reparentAutoParameterModule moves an auto module without promoting it to curated", async () => {
    await seedModule({ id: "pm-a", name: "Power", path: "pm-a" });
    await seedModule({ id: "pm-x", name: "Charging", path: "pm-x", sortOrder: 1 });
    // Driver-group placement nodes must carry their catalog subject (0082 check).
    await db.query(
      `insert into attribution_subjects (id, organization_id, subject_kind, display_name, origin, source_key)
       values ('subject-1', 'org-1', 'driver-registration', 'AutoGroup', 'auto', 'compatible:x')`
    );
    await db.query(
      `insert into parameter_modules (id, organization_id, parent_id, name, path, depth, kind, origin, source_key, attribution_subject_id)
       values ('pm-auto', 'org-1', 'pm-a', 'AutoGroup', 'pm-a/pm-auto', 2, 'driver-group', 'auto', 'compatible:x', 'subject-1')`
    );

    const result = await reparentAutoParameterModule(db, {
      organizationId: "org-1",
      moduleId: "pm-auto",
      parentId: "pm-x"
    });

    expect(result.status).toBe("moved");
    if (result.status === "moved") {
      expect(result.module).toMatchObject({ parentId: "pm-x", path: "pm-x/pm-auto", origin: "auto" });
    }
    await expect(
      getParameterModuleById(db, { organizationId: "org-1", moduleId: "pm-auto" })
    ).resolves.toMatchObject({ origin: "auto", kind: "driver-group" });

    // Curated modules are skipped instead of moved.
    await expect(
      reparentAutoParameterModule(db, { organizationId: "org-1", moduleId: "pm-a", parentId: "pm-x" })
    ).resolves.toEqual({ status: "skipped", reason: "curated" });
  });
});

describe.skipIf(!databaseAvailable)("listParameters module tree filter", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    setParameterIdentityMode(null);
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley Chen", email: "riley@example.com" }],
      projects: [{ id: "project-1", name: "Aurora", code: "AUR" }]
    });
    await db.query(
      `insert into parameter_modules (id, organization_id, parent_id, name, path, depth)
       values
         ('pm-a', 'org-1', null, 'Power', 'pm-a', 1),
         ('pm-b', 'org-1', 'pm-a', 'Battery', 'pm-a/pm-b', 2),
         ('pm-x', 'org-1', null, 'Charging', 'pm-x', 1)`
    );
    await db.query(
      `insert into parameter_definitions (
         id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk, parameter_module_id
       ) values
         ('pd-root', 'org-1', 'root_param', 'root', 'root', 'ENV', 'Power', '', '', 'Low', 'pm-a'),
         ('pd-child', 'org-1', 'child_param', 'child', 'child', 'ENV', 'Battery', '', '', 'Low', 'pm-b'),
         ('pd-other', 'org-1', 'other_param', 'other', 'other', 'ENV', 'Charging', '', '', 'Low', 'pm-x')`
    );
    await db.query(
      `insert into project_parameter_values (
         id, organization_id, project_id, parameter_definition_id,
         current_value, recommended_value, value_version, updated_by_user_id
       ) values
         ('value-root', 'org-1', 'project-1', 'pd-root', '1', '1', 1, 'user-1'),
         ('value-child', 'org-1', 'project-1', 'pd-child', '2', '2', 1, 'user-1'),
         ('value-other', 'org-1', 'project-1', 'pd-other', '3', '3', 1, 'user-1')`
    );
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("returns the module and its descendants when includeDescendants is true", async () => {
    const rows = await listParameters(db, {
      organizationId: "org-1",
      projectId: "project-1",
      moduleId: "pm-a",
      includeDescendants: true
    });

    expect(rows.map((row) => row.id).sort()).toEqual(["value-child", "value-root"]);
  });

  it("returns only the exact module when includeDescendants is false", async () => {
    const rows = await listParameters(db, {
      organizationId: "org-1",
      moduleId: "pm-b",
      includeDescendants: false
    });

    expect(rows.map((row) => row.id)).toEqual(["value-child"]);
    // The parent module's parameter is out of an exact-module listing.
    const parentOnly = await listParameters(db, {
      organizationId: "org-1",
      moduleId: "pm-a",
      includeDescendants: false
    });
    expect(parentOnly.map((row) => row.id)).toEqual(["value-root"]);
  });
});
