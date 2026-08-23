import "dotenv/config";
import { expect, test, type Page } from "playwright/test";

import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import {
  disposableRuntimeOutcomeFromTestInfo,
  type DisposablePostCutoverRuntime,
} from "./helpers/disposablePostCutoverRuntime";
import { recordOperationEvidence, writeOperationJsonArtifact } from "./helpers/operationEvidence";
import { apiRoute } from "./helpers/runtime";
import {
  assertPostCutoverIdentity,
  bindHardwareUserToProject,
  createBindingDraftViaApi,
  disposablePageUrl,
  integerCellTarget,
  seedIsolatedNumericCellBinding,
  startSwappedDisposablePostCutoverRuntime,
  type RestoreDisposablePostCutoverRuntime,
  type IsolatedBinding
} from "./helpers/semanticBindingFixture";
import { cleanupSemanticAcceptanceArtifacts } from "./helpers/semanticFixtureCleanup";

useBrowserDiagnostics(test);

const organizationId = "org-chargelab";
const projectId = "aurora";
const descriptionPrefix = "PARAM-FILE acceptance";
const databaseUrl = process.env.DATABASE_URL;
const fileCellValue = 80;
const bindingHeadValue = "<70>";
const uiDraftCell = "90";

test.skip(!databaseUrl, "DATABASE_URL is required for disposable post-cutover parameter-files acceptance.");

function adminHeaders() {
  return authHeadersForRole("admin");
}

async function dismissXiaozeHint(page: Page) {
  const dismiss = page.getByRole("button", { name: "不再提示" });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click();
  }
}

async function setBindingHeadRawValue(bindingId: string, rawValue: string): Promise<void> {
  await withPgClient(async (client) => {
    const result = await client.query(
      `
      update project_parameter_binding_revisions
      set raw_value = $2
      where id = (
        select id
        from project_parameter_binding_revisions
        where binding_id = $1
        order by created_at desc
        limit 1
      )
      `,
      [bindingId, rawValue]
    );
    expect(result.rowCount, `missing head revision for binding ${bindingId}`).toBe(1);
  });
}

async function lookupHostedFile(fileName: string) {
  return withPgClient(async (client) => {
    const result = await client.query<{ id: string; file_name: string; version_number: number; current_version_id: string }>(
      `
      select f.id, f.file_name, v.version_number, f.current_version_id
      from project_parameter_files f
      inner join project_parameter_file_versions v on v.id = f.current_version_id
      where f.organization_id = $1
        and f.project_id = $2
        and f.file_name = $3
      `,
      [organizationId, projectId, fileName]
    );
    return result.rows[0] ?? null;
  });
}

async function cleanupParameterFileAcceptanceArtifacts(input: {
  fileName?: string;
  binding?: IsolatedBinding;
}): Promise<void> {
  let configSetNames: string[] = [];
  if (input.binding?.configSetId) {
    configSetNames = await withPgClient(async (client) => {
      const result = await client.query<{ name: string }>(
        `select name from dts_config_set where id = $1`,
        [input.binding!.configSetId]
      );
      return result.rows.map((row) => row.name);
    });
  }
  await cleanupSemanticAcceptanceArtifacts({
    organizationId,
    projectId,
    fileNames: input.fileName ? [input.fileName] : [],
    configSetNames,
    projectParameterBindingIds: input.binding ? [input.binding.bindingId] : []
  });
}

test.describe("project parameter files browser acceptance", () => {
  let disposableRuntime: DisposablePostCutoverRuntime;
  let restoreDisposable: RestoreDisposablePostCutoverRuntime | undefined;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    const baseDatabaseUrl = databaseUrl?.trim();
    if (!baseDatabaseUrl) {
      throw new Error("DATABASE_URL is required to create the disposable parameter-files post-cutover database.");
    }
    const started = await startSwappedDisposablePostCutoverRuntime(baseDatabaseUrl, {
      label: "param_files",
      markerPurpose: "param-files"
    });
    disposableRuntime = started.runtime;
    restoreDisposable = started.restore;
    await assertPostCutoverIdentity();
    expect(disposableRuntime.markerPurpose).toBe("param-files");
  });

  test.afterAll(async ({}, testInfo) => {
    test.setTimeout(60_000);
    await restoreDisposable?.(disposableRuntimeOutcomeFromTestInfo(testInfo));
  });

  test("uploads, lists, and syncs project parameter files", async ({ page, request }, testInfo) => {
    // @acceptance PARAM-FILE-ADMIN-001
    // @operation PARAM-FILE-UPLOAD-001
    // @operation PARAM-FILE-SYNC-001
    test.setTimeout(180_000);
    let binding: IsolatedBinding | undefined;

    try {
      binding = await seedIsolatedNumericCellBinding(request, {
        propertyKey: "iin_max",
        cellValue: fileCellValue,
        reason: `${descriptionPrefix} sync binding`
      });
      await setBindingHeadRawValue(binding.bindingId, bindingHeadValue);

      const listResponse = await request.get(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: adminHeaders()
      });
      expect(listResponse.ok(), await listResponse.text()).toBe(true);
      const listBody = (await listResponse.json()) as {
        items: Array<{ id: string; fileName: string; currentVersionId?: string }>;
      };
      const listed = listBody.items.find((item) => item.fileName === binding!.fileName);
      expect(listed, `missing hosted file ${binding.fileName}`).toBeTruthy();
      expect(listed!.currentVersionId).toBeTruthy();

      const fileDbRow = await lookupHostedFile(binding.fileName);
      expect(fileDbRow).toMatchObject({
        id: listed!.id,
        file_name: binding.fileName
      });

      const syncResponse = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-files/${listed!.id}/sync`),
        {
          headers: adminHeaders(),
          data: { versionId: listed!.currentVersionId }
        }
      );
      expect(syncResponse.ok(), await syncResponse.text()).toBe(true);
      const syncBody = (await syncResponse.json()) as {
        item: { draftsCreated: number; skipped: boolean };
      };
      expect(syncBody.item.skipped).toBe(false);
      expect(syncBody.item.draftsCreated).toBeGreaterThanOrEqual(1);

      const draftRow = await withPgClient(async (client) => {
        const result = await client.query<{ target_value: string; origin: string }>(
          `
          select target_value, origin
          from parameter_drafts
          where project_parameter_binding_id = $1
            and origin = 'file_sync'
          order by updated_at desc
          limit 1
          `,
          [binding!.bindingId]
        );
        return result.rows[0];
      });
      expect(draftRow).toEqual(expect.objectContaining({ target_value: `<${fileCellValue}>`, origin: "file_sync" }));

      const fileDbEvidence = {
        table: "project_parameter_files/project_parameter_file_versions",
        predicate: `organizationId=${organizationId}; projectId=${projectId}; fileName=${binding.fileName}`,
        observed: `fileId=${fileDbRow?.id}; fileName=${fileDbRow?.file_name}; version=${fileDbRow?.version_number}`,
        rowCount: fileDbRow ? 1 : 0
      };
      const syncDbEvidence = {
        table: "parameter_drafts",
        predicate: `projectParameterBindingId=${binding.bindingId}; origin=file_sync`,
        observed: `targetValue=${draftRow?.target_value}; origin=${draftRow?.origin}`,
        rowCount: draftRow ? 1 : 0
      };

      await signInBrowserAsRole(
        page,
        "admin",
        disposablePageUrl(
          disposableRuntime,
          `/parameter-admin/projects/${projectId}/configuration?inspector=file`
        )
      );
      await dismissXiaozeHint(page);
      await expect(page).toHaveURL(new RegExp(`/parameter-admin/projects/${projectId}/configuration`));
      await expect(page.getByRole("region", { name: "项目配置工作台" })).toBeVisible({ timeout: 30_000 });

      await recordOperationEvidence({
        operationId: "PARAM-FILE-UPLOAD-001",
        title: "upload and list project parameter files",
        status: "passed",
        page,
        testInfo,
        assertions: ["ui", "api", "db"],
        api: [
          {
            method: "GET",
            path: `/api/v1/projects/${projectId}/parameter-files`,
            status: listResponse.status(),
            responseSummary: `file=${binding.fileName}`
          }
        ],
        db: [fileDbEvidence]
      });
      await recordOperationEvidence({
        operationId: "PARAM-FILE-SYNC-001",
        title: "manual sync creates file_sync draft",
        status: "passed",
        testInfo,
        assertions: ["api", "db"],
        api: [
          {
            method: "POST",
            path: `/api/v1/projects/${projectId}/parameter-files/${listed!.id}/sync`,
            status: syncResponse.status(),
            responseSummary: `draftsCreated=${syncBody.item.draftsCreated}; skipped=${syncBody.item.skipped}`
          }
        ],
        db: [syncDbEvidence]
      });
    } finally {
      await cleanupParameterFileAcceptanceArtifacts({ fileName: binding?.fileName, binding });
    }
  });

  test("resolves file/UI draft conflicts", async ({ request }, testInfo) => {
    // @acceptance PARAM-FILE-CONFLICT-001
    // @operation PARAM-FILE-RESOLVE-001
    test.setTimeout(180_000);
    let binding: IsolatedBinding | undefined;

    try {
      await bindHardwareUserToProject(projectId);
      binding = await seedIsolatedNumericCellBinding(request, {
        propertyKey: "iin_max",
        cellValue: fileCellValue,
        reason: `${descriptionPrefix} conflict binding`
      });
      await setBindingHeadRawValue(binding.bindingId, bindingHeadValue);

      const uiDraft = await createBindingDraftViaApi(request, {
        binding,
        targetValue: integerCellTarget(uiDraftCell),
        reason: `${descriptionPrefix} manual ui draft`,
        role: "hardware-user"
      });
      expect(uiDraft.status, uiDraft.bodyText).toBe(201);
      expect(uiDraft.draft).toBeTruthy();

      const fileRow = await lookupHostedFile(binding.fileName);
      expect(fileRow?.current_version_id).toBeTruthy();

      const syncResponse = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-files/${fileRow!.id}/sync`),
        {
          headers: adminHeaders(),
          data: { versionId: fileRow!.current_version_id }
        }
      );
      expect(syncResponse.ok(), await syncResponse.text()).toBe(true);

      const conflictId = await withPgClient(async (client) => {
        const result = await client.query<{ id: string }>(
          `
          select id
          from parameter_file_sync_conflicts
          where project_parameter_binding_id = $1
            and status = 'open'
          order by created_at desc
          limit 1
          `,
          [binding!.bindingId]
        );
        return result.rows[0]?.id ?? null;
      });
      expect(conflictId).toBeTruthy();

      const resolveResponse = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-file-conflicts/${conflictId}/resolve`),
        {
          headers: adminHeaders(),
          data: { resolution: "file" }
        }
      );
      expect(resolveResponse.ok(), await resolveResponse.text()).toBe(true);

      const openConflicts = await withPgClient(async (client) => {
        const result = await client.query<{ count: string }>(
          `
          select count(*)::text as count
          from parameter_file_sync_conflicts
          where project_parameter_binding_id = $1
            and status = 'open'
          `,
          [binding!.bindingId]
        );
        return Number(result.rows[0]?.count ?? 0);
      });
      expect(openConflicts).toBe(0);
      const resolveArtifact = await writeOperationJsonArtifact(testInfo, "parameter-file-conflict-resolution.json", {
        conflictId,
        resolution: "file",
        status: resolveResponse.status(),
        openConflicts
      });

      await recordOperationEvidence({
        operationId: "PARAM-FILE-RESOLVE-001",
        title: "resolve file/ui draft conflict keeping file value",
        status: "passed",
        testInfo,
        assertions: ["api", "db"],
        artifacts: [resolveArtifact],
        api: [
          {
            method: "POST",
            path: `/api/v1/projects/${projectId}/parameter-file-conflicts/${conflictId}/resolve`,
            status: resolveResponse.status(),
            responseSummary: "resolution=file"
          }
        ],
        db: [
          {
            table: "parameter_file_sync_conflicts",
            predicate: `projectParameterBindingId=${binding.bindingId}; status=open`,
            observed: `openConflicts=${openConflicts}; resolvedConflictId=${conflictId}`,
            rowCount: openConflicts
          }
        ]
      });
    } finally {
      await cleanupParameterFileAcceptanceArtifacts({ fileName: binding?.fileName, binding });
    }
  });

  test("PARAM-FILE-ROLLBACK-001: restore historical version as current pointer", async ({
    page
  }) => {
    // @acceptance-planned PARAM-FILE-ROLLBACK-001
    // @operation-planned PARAM-FILE-ROLLBACK-001
    test.skip(
      true,
      "Rollback pointer restore is TD-056 (already on main); this session must not change rollback routes."
    );
    void page;
  });
});
