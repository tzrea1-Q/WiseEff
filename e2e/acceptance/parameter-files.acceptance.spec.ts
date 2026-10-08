import "./helpers/loadAcceptanceEnvironment";
import { expect, test, type Page } from "playwright/test";

import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import {
  disposableRuntimeOutcomeFromTestInfo,
  type DisposablePostCutoverRuntime,
} from "./helpers/disposablePostCutoverRuntime";
import { recordOperationEvidence } from "./helpers/operationEvidence";
import { apiRoute } from "./helpers/runtime";
import {
  assertPostCutoverIdentity,
  disposablePageUrl,
  numericCellDts,
  startSwappedDisposablePostCutoverRuntime,
  type RestoreDisposablePostCutoverRuntime
} from "./helpers/semanticBindingFixture";

test.use({ viewport: { width: 1440, height: 900 } });

useBrowserDiagnostics(test);

const organizationId = "org-chargelab";
const projectId = "aurora";
const databaseUrl = process.env.DATABASE_URL;
const fileCellValue = 80;

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

  test("uploads and lists project parameter files", async ({ page, request }, testInfo) => {
    // @acceptance PARAM-FILE-ADMIN-001
    // @operation PARAM-FILE-UPLOAD-001
    // Manual source sync and file/UI draft conflict resolution run through the canonical
    // prepared-source transaction in b906-manual-sync-ui and b906-canonical-conflict-decision.
    test.setTimeout(180_000);
    const fileName = `param-file-upload-${Date.now().toString(36)}.dts`;
    const upload = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
      headers: adminHeaders(),
      data: { fileName, contentBase64: Buffer.from(numericCellDts("iin_max", fileCellValue)).toString("base64") }
    });
    expect(upload.status(), await upload.text()).toBe(201);
    const uploaded = (await upload.json()) as { item: { id: string }; version: { id: string; versionNumber: number } };

    const listResponse = await request.get(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
      headers: adminHeaders()
    });
    expect(listResponse.ok(), await listResponse.text()).toBe(true);
    const listBody = (await listResponse.json()) as {
      items: Array<{ id: string; fileName: string; currentVersionId?: string }>;
    };
    const listed = listBody.items.find((item) => item.fileName === fileName);
    expect(listed, `missing hosted file ${fileName}`).toBeTruthy();
    expect(listed).toMatchObject({ id: uploaded.item.id, currentVersionId: uploaded.version.id });

    const fileDbRow = await lookupHostedFile(fileName);
    expect(fileDbRow).toMatchObject({
      id: uploaded.item.id,
      file_name: fileName,
      current_version_id: uploaded.version.id,
      version_number: uploaded.version.versionNumber
    });

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
          responseSummary: `file=${fileName}`
        }
      ],
      db: [
        {
          table: "project_parameter_files/project_parameter_file_versions",
          predicate: `organizationId=${organizationId}; projectId=${projectId}; fileName=${fileName}`,
          observed: `fileId=${fileDbRow?.id}; fileName=${fileDbRow?.file_name}; version=${fileDbRow?.version_number}`,
          rowCount: fileDbRow ? 1 : 0
        }
      ]
    });
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
