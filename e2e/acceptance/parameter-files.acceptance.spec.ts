import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "playwright/test";

import { withPgClient } from "./helpers/database";
import { authHeadersForRole, authHeadersForUser } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence } from "./helpers/operationEvidence";
import { apiRoute } from "./helpers/runtime";
import { cleanupSemanticAcceptanceArtifacts } from "./helpers/semanticFixtureCleanup";

useBrowserDiagnostics(test);

const organizationId = "org-chargelab";
const projectId = "aurora";
const adminUserId = "u-xu-yun";
const parameterDefinitionId = "acceptance-param-file-temp-max";
const parameterValueId = "acceptance-aurora-param-file-temp-max";
const hardwareUserId = "acceptance-param-file-hardware-user";
const descriptionPrefix = "PARAM-FILE acceptance";

function authHeaders(userId = adminUserId) {
  if (userId === adminUserId) {
    return authHeadersForRole("admin");
  }
  if (userId === hardwareUserId) {
    return authHeadersForUser(hardwareUserId, "param-file.hw@chargelab.cn", "PF File Hardware User");
  }
  return authHeadersForUser(userId, `${userId}@chargelab.cn`, "Acceptance User");
}

async function dismissXiaozeHint(page: Page) {
  const dismiss = page.getByRole("button", { name: "不再提示" });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click();
  }
}

async function seedParameterFileAcceptanceFixture() {
  await withPgClient(async (client) => {
    await client.query(
      `
      insert into users (id, organization_id, name, email, title, is_active)
      values ($1, $2, 'PF File Hardware User', 'param-file.hw@chargelab.cn', 'Hardware User', true)
      on conflict (id) do update set
        organization_id = excluded.organization_id,
        name = excluded.name,
        email = excluded.email,
        title = excluded.title,
        is_active = excluded.is_active
      `,
      [hardwareUserId, organizationId]
    );
    await client.query(
      `
      insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
      values ($1, $2, $3, $4, 'hardware-user')
      on conflict (id) do update set
        project_id = excluded.project_id,
        role_id = excluded.role_id
      `,
      [`acceptance-${hardwareUserId}-${projectId}`, hardwareUserId, organizationId, projectId]
    );
    await client.query(
      `
      insert into parameter_definitions (
        id, organization_id, name, description, explanation, config_format,
        module, default_range, unit, risk
      )
      values (
        $1, $2, 'temp_max', 'acceptance param file temp max', 'battery max temp',
        'ENV:TEMP_MAX=number', 'battery', '0-120', 'C', 'Low'
      )
      on conflict (id) do update set
        organization_id = excluded.organization_id,
        name = excluded.name,
        module = excluded.module,
        risk = excluded.risk
      `,
      [parameterDefinitionId, organizationId]
    );
    await client.query(
      `
      insert into project_parameter_values (
        id, organization_id, project_id, parameter_definition_id,
        current_value, recommended_value, value_version, updated_by_user_id
      )
      values ($1, $2, $3, $4, '80', '80', 1, $5)
      on conflict (id) do update set
        current_value = excluded.current_value,
        recommended_value = excluded.recommended_value,
        value_version = excluded.value_version,
        source_file_name = null,
        source_node_path = null
      `,
      [parameterValueId, organizationId, projectId, parameterDefinitionId, adminUserId]
    );
    await client.query(
      `
      delete from parameter_file_sync_conflicts
      where project_parameter_value_id = $1
      `,
      [parameterValueId]
    );
    await client.query(
      `
      delete from parameter_drafts
      where project_parameter_value_id = $1
      `,
      [parameterValueId]
    );
  });
}

async function cleanupParameterFileAcceptanceArtifacts(fileName: string) {
  await cleanupSemanticAcceptanceArtifacts({
    organizationId,
    projectId,
    fileNames: [fileName],
    projectParameterValueIds: [parameterValueId]
  });

  await withPgClient(async (client) => {
    await client.query(
      `
      update project_parameter_values
      set source_file_name = null,
          source_node_path = null
      where id = $1
      `,
      [parameterValueId]
    );
  });
}

async function cleanupAllParameterFileAcceptanceArtifacts() {
  await withPgClient(async (client) => {
    const files = await client.query<{ file_name: string }>(
      `
      select file_name
      from project_parameter_files
      where organization_id = $1
        and project_id = $2
        and file_name like 'acceptance-%'
      `,
      [organizationId, projectId]
    );

    for (const row of files.rows) {
      await cleanupParameterFileAcceptanceArtifacts(row.file_name);
    }
  });
}

test.describe("project parameter files browser acceptance", () => {
  test.beforeEach(async () => {
    await cleanupAllParameterFileAcceptanceArtifacts();
    await seedParameterFileAcceptanceFixture();
  });

  test("uploads, lists, and syncs project parameter files", async ({ page, request }, testInfo) => {
    // @acceptance PARAM-FILE-ADMIN-001
    // @operation PARAM-FILE-UPLOAD-001
    // @operation PARAM-FILE-SYNC-001
    const fileName = `acceptance-${randomUUID()}.json`;
    const payload = Buffer.from(JSON.stringify({ battery: { temp_max: 85 } }), "utf8").toString("base64");

    try {
      const uploadResponse = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: authHeaders(),
        data: { fileName, contentBase64: payload }
      });
      expect(uploadResponse.ok()).toBe(true);
      const uploadBody = (await uploadResponse.json()) as {
        item: { id: string; fileName: string };
        version: { id: string; versionNumber: number };
      };
      expect(uploadBody.item.fileName).toBe(fileName);
      expect(uploadBody.version.versionNumber).toBe(1);

      await withPgClient(async (client) => {
        await client.query(
          `
          update project_parameter_values
          set source_file_name = $1,
              source_node_path = 'battery/temp_max'
          where id = $2
          `,
          [fileName, parameterValueId]
        );
      });

      const listResponse = await request.get(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: authHeaders()
      });
      expect(listResponse.ok()).toBe(true);
      const listBody = (await listResponse.json()) as { items: Array<{ fileName: string }> };
      expect(listBody.items.some((item) => item.fileName === fileName)).toBe(true);

      const syncResponse = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-files/${uploadBody.item.id}/sync`),
        {
          headers: authHeaders(),
          data: { versionId: uploadBody.version.id }
        }
      );
      expect(syncResponse.ok()).toBe(true);
      const syncBody = (await syncResponse.json()) as { item: { draftsCreated: number } };
      expect(syncBody.item.draftsCreated).toBe(1);

      const draftRow = await withPgClient(async (client) => {
        const result = await client.query<{ target_value: string; origin: string }>(
          `
          select target_value, origin
          from parameter_drafts
          where project_parameter_value_id = $1
          order by updated_at desc
          limit 1
          `,
          [parameterValueId]
        );
        return result.rows[0];
      });
      expect(draftRow).toEqual(expect.objectContaining({ target_value: "85", origin: "file_sync" }));

      await page.goto("/parameter-admin/projects");
      await dismissXiaozeHint(page);
      await page.getByRole("button", { name: /管理文件 Aurora 量产平台/ }).click();
      const dialog = page.getByRole("dialog", { name: /管理文件 · Aurora 量产平台/ });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("tab", { name: "参数文件" })).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "参数文件" })).toBeVisible();
      await expect(dialog.locator('input[type="file"].project-parameter-files__input')).toBeAttached();

      await recordOperationEvidence({
        operationId: "PARAM-FILE-UPLOAD-001",
        title: "upload and list project parameter files",
        status: "passed",
        page,
        testInfo,
        assertions: ["ui", "api", "db"],
        api: [
          {
            method: "POST",
            path: `/api/v1/projects/${projectId}/parameter-files`,
            status: uploadResponse.status(),
            responseSummary: `file=${fileName}`
          }
        ]
      });
      await recordOperationEvidence({
        operationId: "PARAM-FILE-SYNC-001",
        title: "manual sync creates file_sync draft",
        status: "passed",
        page,
        testInfo,
        assertions: ["api", "db"],
        api: [
          {
            method: "POST",
            path: `/api/v1/projects/${projectId}/parameter-files/${uploadBody.item.id}/sync`,
            status: syncResponse.status(),
            responseSummary: `draftsCreated=${syncBody.item.draftsCreated}`
          }
        ]
      });
    } finally {
      await cleanupParameterFileAcceptanceArtifacts(fileName);
    }
  });

  test("resolves file/UI draft conflicts", async ({ request }, testInfo) => {
    // @acceptance PARAM-FILE-CONFLICT-001
    // @operation PARAM-FILE-RESOLVE-001
    const fileName = `acceptance-conflict-${randomUUID()}.json`;
    const payload = Buffer.from(JSON.stringify({ battery: { temp_max: 85 } }), "utf8").toString("base64");

    try {
      await withPgClient(async (client) => {
        await client.query(
          `
          delete from parameter_file_sync_conflicts
          where project_parameter_value_id = $1
          `,
          [parameterValueId]
        );
        await client.query(
          `
          delete from parameter_drafts
          where project_parameter_value_id = $1
          `,
          [parameterValueId]
        );
      });

      await request.post(apiRoute("/api/v1/parameter-drafts"), {
        headers: authHeaders(hardwareUserId),
        data: {
          projectId,
          parameterId: parameterValueId,
          targetValue: "90",
          reason: `${descriptionPrefix} manual ui draft`
        }
      });

      const uploadResponse = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: authHeaders(),
        data: { fileName, contentBase64: payload }
      });
      const uploadBody = (await uploadResponse.json()) as {
        item: { id: string };
        version: { id: string };
      };

      await withPgClient(async (client) => {
        await client.query(
          `
          update project_parameter_values
          set source_file_name = $1,
              source_node_path = 'battery/temp_max'
          where id = $2
          `,
          [fileName, parameterValueId]
        );
      });

      const syncResponse = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-files/${uploadBody.item.id}/sync`),
        {
          headers: authHeaders(),
          data: { versionId: uploadBody.version.id }
        }
      );
      expect(syncResponse.ok(), await syncResponse.text()).toBe(true);

      const conflictId = await withPgClient(async (client) => {
        const result = await client.query<{ id: string }>(
          `
          select id
          from parameter_file_sync_conflicts
          where project_parameter_value_id = $1
            and status = 'open'
          order by created_at desc
          limit 1
          `,
          [parameterValueId]
        );
        return result.rows[0]?.id ?? null;
      });
      expect(conflictId).toBeTruthy();

      const resolveResponse = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-file-conflicts/${conflictId}/resolve`),
        {
          headers: authHeaders(),
          data: { resolution: "file" }
        }
      );
      expect(resolveResponse.ok(), await resolveResponse.text()).toBe(true);

      const openConflicts = await withPgClient(async (client) => {
        const result = await client.query<{ count: string }>(
          `
          select count(*)::text as count
          from parameter_file_sync_conflicts
          where project_parameter_value_id = $1
            and status = 'open'
          `,
          [parameterValueId]
        );
        return Number(result.rows[0]?.count ?? 0);
      });
      expect(openConflicts).toBe(0);

      await recordOperationEvidence({
        operationId: "PARAM-FILE-RESOLVE-001",
        title: "resolve file/ui draft conflict keeping file value",
        status: "passed",
        testInfo,
        assertions: ["api", "db"],
        api: [
          {
            method: "POST",
            path: `/api/v1/projects/${projectId}/parameter-file-conflicts/${conflictId}/resolve`,
            status: resolveResponse.status(),
            responseSummary: "resolution=file"
          }
        ]
      });
    } finally {
      await cleanupParameterFileAcceptanceArtifacts(fileName);
    }
  });
});
