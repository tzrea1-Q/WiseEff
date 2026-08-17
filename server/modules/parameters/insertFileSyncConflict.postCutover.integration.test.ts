/**
 * insertFileSyncConflict must not write dropped PPV / definition columns
 * after semantic identity cutover.
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph, seedSpecBindingGraph } from "../../testing/fixtures";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { insertFileSyncConflict, listOpenConflicts } from "./fileSyncConflictRepository";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("insertFileSyncConflict post-cutover SQL", () => {
  let db: InMemoryTestDatabase | null = null;

  afterEach(async () => {
    setParameterIdentityMode(null);
    if (db) {
      await db.rollback();
      db = null;
    }
  });

  async function dropLegacyConflictIdentityColumns() {
    const fks = await db!.query<{ conname: string }>(
      `
      select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
      where rel.relname = 'parameter_file_sync_conflicts'
        and con.contype = 'f'
        and att.attname in ('project_parameter_value_id', 'parameter_definition_id')
      `
    );
    for (const row of fks.rows) {
      await db!.query(`alter table parameter_file_sync_conflicts drop constraint if exists "${row.conname}"`);
    }
    await db!.query(`alter table parameter_file_sync_conflicts drop column if exists project_parameter_value_id`);
    await db!.query(`alter table parameter_file_sync_conflicts drop column if exists parameter_definition_id`);
  }

  it("inserts and lists a binding-identified conflict after PPV columns are gone", async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [
        { id: "reviewer-1", name: "Reviewer", email: "reviewer@example.com" },
        { id: "user-sync", name: "Sync Bot", email: "sync@example.com" },
        { id: "user-ui", name: "UI Editor", email: "ui@example.com" }
      ],
      projects: [{ id: "project-1", name: "Aurora", code: "AUR" }]
    });
    await seedSpecBindingGraph(db, {
      organizationId: "org-1",
      specs: [
        {
          id: "spec-1",
          specificationKey: "battery/temp_max",
          versions: [{ id: "psv-1", displayName: "temp_max" }],
          propertySpec: { id: "dps-1", propertyKey: "temp_max" }
        }
      ],
      modules: [{ id: "pm-battery", name: "battery" }],
      configSets: [
        {
          id: "set-1",
          projectId: "project-1",
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
          revisions: [{ id: "bpr-1", configRevisionId: "rev-1", parameterSpecVersionId: "psv-1", rawValue: "80" }]
        }
      ]
    });
    await db.query(
      `insert into project_parameter_files (id, organization_id, project_id, file_name, format, config_set_id)
       values ('file-1', 'org-1', 'project-1', 'board.dts', 'dts', 'set-1')`
    );
    await db.query(
      `insert into project_parameter_file_versions (
         id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
       ) values ('version-1', 'file-1', 1, 'org-1/files/board.dts', 'checksum-1', 100, '{}', 'upload', 'reviewer-1')`
    );
    await db.query(
      `insert into parameter_definitions (
         id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk
       ) values ('pd-1', 'org-1', 'temp_max', 'max temperature', 'battery max temperature', 'ENV', 'battery', '0-120', 'C', 'High')`
    );
    await db.query(
      `insert into project_parameter_values (
         id, organization_id, project_id, parameter_definition_id,
         current_value, recommended_value, value_version, updated_by_user_id
       ) values ('ppv-1', 'org-1', 'project-1', 'pd-1', '80', '80', 1, 'reviewer-1')`
    );
    await db.query(
      `insert into parameter_drafts (
         id, organization_id, project_id, project_parameter_value_id, user_id,
         target_value, reason, origin, origin_file_version_id,
         action, edit_subject_kind, project_parameter_binding_id
       ) values
         ('draft-file', 'org-1', 'project-1', 'ppv-1', 'user-sync', '85', 'file sync draft', 'file_sync', 'version-1', 'set', 'binding', 'binding-1'),
         ('draft-ui', 'org-1', 'project-1', 'ppv-1', 'user-ui', '82', 'ui draft', 'manual', null, 'set', 'binding', 'binding-1')`
    );

    await dropLegacyConflictIdentityColumns();
    setParameterIdentityMode("semantic");

    const inserted = await insertFileSyncConflict(db, {
      id: randomUUID(),
      organizationId: "org-1",
      projectId: "project-1",
      projectParameterValueId: "binding-1",
      parameterDefinitionId: "spec-1",
      fileVersionId: "version-1",
      fileDraftId: "draft-file",
      uiDraftId: "draft-ui",
      fileValue: "85",
      uiDraftValue: "82",
      parameterSpecId: "spec-1",
      projectParameterBindingId: "binding-1"
    });
    expect(inserted).toMatchObject({
      projectParameterValueId: "binding-1",
      parameterDefinitionId: "spec-1",
      fileValue: "85",
      uiDraftValue: "82",
      status: "open"
    });

    const open = await listOpenConflicts(db, {
      organizationId: "org-1",
      projectId: "project-1"
    });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      id: inserted.id,
      projectParameterValueId: "binding-1",
      parameterName: "temp_max",
      baseValue: "80"
    });
  });
});
