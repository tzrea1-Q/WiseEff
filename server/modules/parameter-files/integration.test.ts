import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { seedCoreGraph } from "../../testing/fixtures";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import type { ObjectStore } from "../logs/objectStore";
import { registerParameterFileRoutes } from "./routes";
import { registerParameterRoutes } from "../parameters/routes";

function makeServer(db: InMemoryTestDatabase, objectStore: ObjectStore) {
  const router = createRouter();
  const auth = makeAuth();
  const routeOptions = {
    db,
    objectStore,
    getCurrentAuthContext: () => auth
  };
  registerParameterFileRoutes(router, routeOptions);
  registerParameterRoutes(router, routeOptions);
  return createHttpServer(router);
}

async function advanceReview(server: ReturnType<typeof createHttpServer>, requestId: string) {
  const response = await requestJson<{ item: { status: string } }>(
    server,
    `/api/v1/parameter-change-requests/${requestId}/review`,
    {
      method: "POST",
      body: JSON.stringify({ decision: "advance", note: "https://example.com/integration-advance" })
    }
  );
  expect(response.status).toBe(200);
  return response.body.item.status;
}

function makeAuth() {
  return makeTestAuthContext({
    userId: "user-pf-int",
    organizationId: "org-pf-int",
    name: "Riley Chen",
    email: "riley-pf-int@example.com",
    organizationName: "ChargeLab PF",
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"]
  });
}

async function seedBaseline(db: InMemoryTestDatabase) {
  await seedCoreGraph(db, {
    organization: { id: "org-pf-int", name: "ChargeLab PF" },
    users: [{ id: "user-pf-int", name: "Riley Chen", email: "riley-pf-int@example.com" }],
    projects: [{ id: "project-pf-int", name: "Aurora", code: "AUR" }]
  });
  await db.query(
    `
    insert into parameter_definitions (
      id, organization_id, name, description, explanation, config_format,
      module, default_range, unit, risk
    )
    values (
      'pd-pf-int', 'org-pf-int', 'temp_max', 'max temperature', 'battery max temperature',
      'ENV:TEMP_MAX=number', 'battery', '0-120', 'C', 'High'
    )
    on conflict (id) do update set
      organization_id = excluded.organization_id,
      name = excluded.name,
      module = excluded.module
    `
  );
  await db.query(
    `
    insert into project_parameter_values (
      id, organization_id, project_id, parameter_definition_id,
      current_value, recommended_value, value_version, updated_by_user_id
    )
    values (
      'ppv-pf-int', 'org-pf-int', 'project-pf-int', 'pd-pf-int',
      '80', '80', 1, 'user-pf-int'
    )
    on conflict (id) do update set
      current_value = excluded.current_value,
      recommended_value = excluded.recommended_value,
      value_version = excluded.value_version
    `
  );
}

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("parameter file integration", () => {
  let db: InMemoryTestDatabase | undefined;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedBaseline(db);
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("upload + sync creates file_sync draft for battery/temp_max: 80 -> 85", async () => {
    const fileName = `config-${randomUUID()}.json`;
    const objectStore = createMemoryObjectStore();
    const server = makeServer(db, objectStore);
    const bytes = Buffer.from('{"battery":{"temp_max":85}}', "utf8");

    const uploadResponse = await requestJson<{
      item: { id: string };
      version: { id: string; versionNumber: number };
    }>(server, "/api/v1/projects/project-pf-int/parameter-files", {
      method: "POST",
      body: JSON.stringify({
        fileName,
        contentBase64: bytes.toString("base64")
      })
    });

    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.body.version.versionNumber).toBe(1);

    await db.query(
      `
      update project_parameter_values
      set source_file_name = $1, source_node_path = 'battery/temp_max'
      where id = 'ppv-pf-int'
      `,
      [fileName]
    );

    const syncResponse = await requestJson<{
      item: { draftsCreated: number; unchanged: number; unmatched: number; skipped: boolean };
    }>(server, `/api/v1/projects/project-pf-int/parameter-files/${uploadResponse.body.item.id}/sync`, {
      method: "POST",
      body: JSON.stringify({ versionId: uploadResponse.body.version.id })
    });

    expect(syncResponse.status).toBe(200);
    expect(syncResponse.body.item).toEqual({
      draftsCreated: 1,
      unchanged: 0,
      unmatched: 0,
      skipped: false,
      identityFallbackUses: expect.any(Number)
    });

    const drafts = await db.query<{
      id: string;
      target_value: string;
      reason: string;
      origin: "manual" | "file_sync";
      origin_file_version_id: string | null;
    }>(
      `
      select id, target_value, reason, origin, origin_file_version_id
      from parameter_drafts
      where organization_id = $1
        and project_id = $2
        and project_parameter_value_id = $3
      `,
      ["org-pf-int", "project-pf-int", "ppv-pf-int"]
    );
    expect(drafts.rowCount).toBe(1);
    expect(drafts.rows[0]).toEqual(
      expect.objectContaining({
        id: "ppv-pf-int-user-pf-int-file-sync",
        target_value: "85",
        origin: "file_sync",
        origin_file_version_id: uploadResponse.body.version.id
      })
    );
    expect(drafts.rows[0].reason).toContain(`Synced from ${fileName}:battery/temp_max`);

    const parameter = await db.query<{
      current_value: string;
      source_file_name: string | null;
      source_node_path: string | null;
    }>(
      `
      select current_value, source_file_name, source_node_path
      from project_parameter_values
      where id = 'ppv-pf-int'
      `
    );
    expect(parameter.rows[0]).toEqual({
      current_value: "80",
      source_file_name: fileName,
      source_node_path: "battery/temp_max"
    });
  });

  it("submit + review merge writebacks JSON file version", async () => {
    const fileName = `writeback-${randomUUID()}.json`;
    const objectStore = createMemoryObjectStore();
    const server = makeServer(db, objectStore);
    const bytes = Buffer.from('{"battery":{"temp_max":85}}', "utf8");

    const uploadResponse = await requestJson<{
      item: { id: string };
      version: { id: string; versionNumber: number };
    }>(server, "/api/v1/projects/project-pf-int/parameter-files", {
      method: "POST",
      body: JSON.stringify({
        fileName,
        contentBase64: bytes.toString("base64")
      })
    });
    expect(uploadResponse.status).toBe(201);

    await db.query(
      `
      update project_parameter_values
      set source_file_name = $1, source_node_path = 'battery/temp_max'
      where id = 'ppv-pf-int'
      `,
      [fileName]
    );

    await requestJson(server, `/api/v1/projects/project-pf-int/parameter-files/${uploadResponse.body.item.id}/sync`, {
      method: "POST",
      body: JSON.stringify({ versionId: uploadResponse.body.version.id })
    });

    const submitResponse = await requestJson<{ item: { id: string } }>(
      server,
      "/api/v1/parameter-submission-rounds",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: "project-pf-int",
          items: [
            {
              parameterId: "ppv-pf-int",
              targetValue: "85",
              reason: "integration writeback submit"
            }
          ]
        })
      }
    );
    expect(submitResponse.status).toBe(201);

    const requestRow = await db.query<{ id: string; status: string }>(
      `
      select id, status
      from parameter_change_requests
      where project_id = 'project-pf-int'
        and project_parameter_value_id = 'ppv-pf-int'
      order by created_at desc
      limit 1
      `
    );
    const requestId = requestRow.rows[0]?.id;
    expect(requestId).toBeTruthy();

    let status = requestRow.rows[0]?.status ?? "";
    while (status !== "merged") {
      status = await advanceReview(server, requestId!);
    }
    expect(status).toBe("merged");

    const versions = await db.query<{ version_number: number; origin: string }>(
      `
      select v.version_number, v.origin
      from project_parameter_file_versions v
      join project_parameter_files f on f.id = v.file_id
      where f.project_id = 'project-pf-int'
        and f.file_name = $1
      order by v.version_number asc
      `,
      [fileName]
    );
    expect(versions.rows).toHaveLength(2);
    expect(versions.rows[1]).toEqual({ version_number: 2, origin: "writeback" });

    const writebackVersion = await db.query<{ storage_key: string }>(
      `
      select v.storage_key
      from project_parameter_file_versions v
      join project_parameter_files f on f.id = v.file_id
      where f.file_name = $1
        and v.version_number = 2
      limit 1
      `,
      [fileName]
    );
    const written = await objectStore.get(writebackVersion.rows[0]!.storage_key);
    expect(JSON.parse(written.toString("utf8"))).toEqual({ battery: { temp_max: 85 } });

    const mergedValue = await db.query<{ current_value: string }>(
      `select current_value from project_parameter_values where id = 'ppv-pf-int'`
    );
    expect(mergedValue.rows[0]?.current_value).toBe("85");
  });

  it("enriches open conflicts, audits resolve reason, and supports bulk preview/resolve", async () => {
    const { resolveParameterFileConflict, previewBulkConflictResolution, resolveConflictsBulk } =
      await import("./conflictService");
    const { insertFileSyncConflict, listOpenConflicts } = await import("../parameters/repository");

    const auth = makeAuth();
    const objectStore = createMemoryObjectStore();
    const server = makeServer(db!, objectStore);

    await db!.query(
      `
      insert into parameter_definitions (
        id, organization_id, name, description, explanation, config_format,
        module, default_range, unit, risk
      )
      values (
        'pd-pf-int-b', 'org-pf-int', 'temp_min', 'min temperature', 'battery min temperature',
        'ENV:TEMP_MIN=number', 'battery', '0-120', 'C', 'High'
      )
      on conflict (id) do update set name = excluded.name
      `
    );
    await db!.query(
      `
      insert into project_parameter_values (
        id, organization_id, project_id, parameter_definition_id,
        current_value, recommended_value, value_version, updated_by_user_id
      )
      values (
        'ppv-pf-int-b', 'org-pf-int', 'project-pf-int', 'pd-pf-int-b',
        '10', '10', 1, 'user-pf-int'
      )
      on conflict (id) do update set current_value = excluded.current_value
      `
    );

    async function seedOpenConflict(input: {
      fileName: string;
      valueId: string;
      definitionId: string;
      fileValue: string;
      uiValue: string;
    }) {
      await db!.query(`delete from parameter_file_sync_conflicts where project_parameter_value_id = $1`, [
        input.valueId
      ]);
      await db!.query(`delete from parameter_drafts where project_parameter_value_id = $1`, [input.valueId]);

      const bytes = Buffer.from(JSON.stringify({ battery: { value: Number(input.fileValue) } }), "utf8");
      const upload = await requestJson<{ item: { id: string }; version: { id: string; versionNumber: number } }>(
        server,
        "/api/v1/projects/project-pf-int/parameter-files",
        {
          method: "POST",
          body: JSON.stringify({ fileName: input.fileName, contentBase64: bytes.toString("base64") })
        }
      );
      expect(upload.status).toBe(201);

      // Unique (project, value, user) — file_sync and UI drafts must belong to different users.
      await db!.query(
        `
        insert into users (id, organization_id, name, email, title, is_active)
        values ('user-pf-int-hw', 'org-pf-int', 'HW Reviewer', 'hw-pf-int@example.com', 'Hardware User', true)
        on conflict (id) do update set organization_id = excluded.organization_id
        `
      );
      const fileDraftId = `file-draft-${input.valueId}-${randomUUID()}`;
      const uiDraftId = `ui-draft-${input.valueId}-${randomUUID()}`;
      await db!.query(
        `
        insert into parameter_drafts (
          id, organization_id, project_id, project_parameter_value_id, user_id,
          target_value, reason, origin, origin_file_version_id
        )
        values
          ($1, 'org-pf-int', 'project-pf-int', $3, 'user-pf-int', $4, 'integration file draft', 'file_sync', $5),
          ($2, 'org-pf-int', 'project-pf-int', $3, 'user-pf-int-hw', $6, 'integration ui draft', 'manual', null)
        `,
        [fileDraftId, uiDraftId, input.valueId, input.fileValue, upload.body.version.id, input.uiValue]
      );

      const conflict = await insertFileSyncConflict(db!, {
        id: randomUUID(),
        organizationId: "org-pf-int",
        projectId: "project-pf-int",
        projectParameterValueId: input.valueId,
        parameterDefinitionId: input.definitionId,
        fileVersionId: upload.body.version.id,
        fileDraftId,
        uiDraftId,
        fileValue: input.fileValue,
        uiDraftValue: input.uiValue
      });

      const [enriched] = await listOpenConflicts(db!, {
        organizationId: "org-pf-int",
        conflictId: conflict.id
      });
      expect(enriched).toBeTruthy();
      return { conflict: enriched!, versionNumber: upload.body.version.versionNumber };
    }

    const first = await seedOpenConflict({
      fileName: `conflict-a-${randomUUID()}.json`,
      valueId: "ppv-pf-int",
      definitionId: "pd-pf-int",
      fileValue: "85",
      uiValue: "90"
    });
    expect(first.conflict.baseValue).toBe("80");
    expect(first.conflict.parameterName).toBe("temp_max");
    expect(first.conflict.fileVersionLabel).toBe(`v${first.versionNumber}`);
    expect(first.conflict.fileVersionNumber).toBe(first.versionNumber);

    const resolved = await resolveParameterFileConflict(db!, auth, {
      conflictId: first.conflict.id,
      resolution: "file",
      reason: "  integration keep file  "
    });
    expect(resolved.status).toBe("resolved_file");

    const audits = await db!.query<{ kind: string; metadata: Record<string, unknown> }>(
      `
      select kind, metadata
      from audit_events
      where organization_id = 'org-pf-int'
        and project_id = 'project-pf-int'
        and kind = 'parameter-file-conflict-resolve'
      order by created_at desc
      limit 5
      `
    );
    expect(audits.rows[0]?.metadata).toMatchObject({
      resolution: "file",
      reason: "integration keep file"
    });

    const second = await seedOpenConflict({
      fileName: `conflict-b-${randomUUID()}.json`,
      valueId: "ppv-pf-int",
      definitionId: "pd-pf-int",
      fileValue: "88",
      uiValue: "91"
    });
    const third = await seedOpenConflict({
      fileName: `conflict-c-${randomUUID()}.json`,
      valueId: "ppv-pf-int-b",
      definitionId: "pd-pf-int-b",
      fileValue: "12",
      uiValue: "8"
    });

    const preview = await previewBulkConflictResolution(db!, auth, {
      projectId: "project-pf-int",
      resolution: "ui",
      conflictIds: [second.conflict.id, third.conflict.id, "missing"]
    });
    expect(preview.eligible.map((item) => item.id).sort()).toEqual(
      [second.conflict.id, third.conflict.id].sort()
    );
    expect(preview.ineligible.some((item) => item.reason === "not_found")).toBe(true);
    expect(preview.impact.eligibleCount).toBe(2);

    const bulk = await resolveConflictsBulk(db!, auth, {
      projectId: "project-pf-int",
      resolution: "ui",
      conflictIds: [second.conflict.id, third.conflict.id],
      reason: "integration bulk keep ui"
    });
    expect(bulk.resolved).toHaveLength(2);

    const remaining = await listOpenConflicts(db!, {
      organizationId: "org-pf-int",
      projectId: "project-pf-int"
    });
    expect(remaining).toHaveLength(0);
  });
});
