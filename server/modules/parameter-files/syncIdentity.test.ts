import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph, seedSpecBindingGraph } from "../../testing/fixtures";
import { findBindingBySource, normalizeFileSyncNodePath } from "./syncIdentity";
import { insertFileVersion, insertProjectParameterFile } from "./repository";

const databaseAvailable = await isTestDatabaseAvailable();

describe("normalizeFileSyncNodePath", () => {
  it("strips leading and trailing slashes without touching inner segments", () => {
    expect(normalizeFileSyncNodePath("/td079_cell/iin_max/")).toBe("td079_cell/iin_max");
    expect(normalizeFileSyncNodePath("td079_cell/iin_max")).toBe("td079_cell/iin_max");
    expect(normalizeFileSyncNodePath("///battery/temp_max")).toBe("battery/temp_max");
  });
});

describe.skipIf(!databaseAvailable)("findBindingBySource", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley", email: "riley@example.com" }],
      projects: [{ id: "project-1", name: "Aurora", code: "AUR" }]
    });
    await seedSpecBindingGraph(db, {
      organizationId: "org-1",
      specs: [
        {
          id: "spec-1",
          specificationKey: "battery/temp_max",
          propertySpec: { id: "dps-1", propertyKey: "temp_max" },
          versions: [{ id: "psv-1", displayName: "temp_max" }]
        }
      ],
      modules: [{ id: "pm-battery", name: "battery" }],
      configSets: [
        {
          id: "set-1",
          projectId: "project-1",
          name: "main",
          revisions: [{ id: "rev-1" }],
          logicalNodes: [
            {
              id: "ln-1",
              revisions: [{ id: "lnr-1", configRevisionId: "rev-1", nodeLocator: "/battery", name: "battery" }]
            }
          ]
        }
      ],
      bindings: [
        {
          id: "binding-1",
          projectId: "project-1",
          parameterSpecId: "spec-1",
          moduleId: "pm-battery",
          logicalNodeId: "ln-1",
          revisions: [{ id: "bpr-1", configRevisionId: "rev-1", parameterSpecVersionId: "psv-1", rawValue: "<80>" }]
        }
      ]
    });
    await insertProjectParameterFile(db, {
      id: "file-1",
      organizationId: "org-1",
      projectId: "project-1",
      fileName: "board.dts",
      format: "dts"
    });
    await insertFileVersion(db, {
      id: "version-1",
      fileId: "file-1",
      versionNumber: 1,
      storageKey: "org-1/files/board.dts",
      checksum: "checksum-1",
      sizeBytes: 100,
      parsedIndex: {},
      origin: "upload",
      createdByUserId: "user-1"
    });
    await db.query(
      `insert into dts_node_occurrences (
         id, config_revision_id, file_version_id, name, node_path,
         start_offset, end_offset, start_line, start_column, end_line, end_column, raw_text
       ) values ('no-1', 'rev-1', 'version-1', 'battery', '/battery', 0, 40, 1, 1, 6, 1, 'battery { temp_max = <80>; };')`
    );
    await db.query(
      `insert into dts_property_occurrences (
         id, config_revision_id, node_occurrence_id, file_version_id, property_name,
         start_offset, end_offset, start_line, start_column, end_line, end_column, raw_text
       ) values ('po-1', 'rev-1', 'no-1', 'version-1', 'temp_max', 10, 20, 4, 2, 4, 12, 'temp_max = <80>;')`
    );
    await db.query(
      `insert into dts_occurrence_effects (
         id, config_revision_id, logical_node_revision_id, property_name, effect_kind,
         node_occurrence_id, property_occurrence_id, source_order
       ) values ('oe-1', 'rev-1', 'lnr-1', 'temp_max', 'set', 'no-1', 'po-1', 1)`
    );
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("matches locator + property against the parsed-index path for that file", async () => {
    const matched = await findBindingBySource(db, {
      organizationId: "org-1",
      projectId: "project-1",
      sourceFileName: "board.dts",
      sourceNodePath: "/battery/temp_max",
      fileVersionId: "version-1"
    });

    expect(matched).toEqual({
      id: "binding-1",
      parameterSpecId: "spec-1",
      currentValue: "<80>"
    });
  });

  it("does not match the same path on a different file name", async () => {
    const matched = await findBindingBySource(db, {
      organizationId: "org-1",
      projectId: "project-1",
      sourceFileName: "other.dts",
      sourceNodePath: "battery/temp_max",
      fileVersionId: "version-1"
    });
    expect(matched).toBeNull();
  });

  it("does not query retired project_parameter_values or parameter_definitions", async () => {
    const statements: string[] = [];
    const wrapped = {
      query: async (sql: string, values?: unknown[]) => {
        statements.push(sql);
        return db.query(sql, values);
      }
    };

    await findBindingBySource(wrapped, {
      organizationId: "org-1",
      projectId: "project-1",
      sourceFileName: "board.dts",
      sourceNodePath: "battery/temp_max",
      fileVersionId: "version-1"
    });

    expect(statements.length).toBeGreaterThan(0);
    const haystack = statements.join("\n").toLowerCase();
    expect(haystack).not.toMatch(/project_parameter_values/);
    expect(haystack).not.toMatch(/parameter_definitions/);
  });
});
