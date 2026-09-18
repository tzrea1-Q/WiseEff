import "./helpers/loadAcceptanceEnvironment";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "playwright/test";

import { acceptanceUserIdForRole, authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute } from "./helpers/runtime";
import type { IsolatedBinding } from "./helpers/semanticBindingFixture";

useBrowserDiagnostics(test);
test.use({ viewport: { width: 1440, height: 900 } });

const databaseUrl = process.env.DATABASE_URL?.trim() || "";
const organizationId = "org-chargelab";
const userId = acceptanceUserIdForRole("admin");

async function dismissXiaozeHint(page: Page) {
  const dismiss = page.getByRole("button", { name: "不再提示" });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click({ force: true });
  }
}

async function pickAuroraNumericBinding(offset = 0): Promise<IsolatedBinding> {
  return withPgClient(async (client) => {
    const found = await client.query<{
      id: string;
      parameter_spec_id: string;
      revision_id: string;
      raw_value: string;
      property_key: string;
      node_locator: string | null;
      config_set_id: string;
    }>(
      `
      select
        b.id,
        b.parameter_spec_id,
        br.config_revision_id as revision_id,
        br.raw_value,
        coalesce(dps.property_key, 'iin_max') as property_key,
        lnr.node_locator,
        cr.config_set_id
      from project_parameter_bindings b
      join dts_config_set cs
        on cs.organization_id = b.organization_id
       and cs.project_id = b.project_id
       and cs.name = 'default'
      join dts_config_revisions cr
        on cr.config_set_id = cs.id
       and cr.id = (
         select id from dts_config_revisions
         where config_set_id = cs.id
         order by revision_number desc
         limit 1
       )
      join project_parameter_binding_revisions br
        on br.binding_id = b.id
       and br.config_revision_id = cr.id
      left join dts_property_specs dps on dps.parameter_spec_id = b.parameter_spec_id
      left join dts_logical_node_revisions lnr
        on lnr.logical_node_id = b.logical_node_id
       and lnr.config_revision_id = cr.id
      where b.organization_id = $1
        and b.project_id = 'aurora'
        and br.raw_value ~ '^<[0-9]+>$'
        and br.parameter_spec_version_id is not null
        and not exists (
          select 1 from project_parameter_value_drafts d
          where d.binding_id = b.id
        )
        and not exists (
          select 1 from parameter_drafts pd
          where pd.project_parameter_binding_id = b.id
        )
      order by cr.revision_number desc, b.id
      offset $2
      limit 1
      `,
      [organizationId, offset]
    );
    const row = found.rows[0];
    expect(row, "aurora default config set must have a numeric cell binding free of drafts").toBeTruthy();
    return {
      projectId: "aurora",
      bindingId: row!.id,
      parameterSpecId: row!.parameter_spec_id,
      revisionId: row!.revision_id,
      rawValue: row!.raw_value,
      configSetId: row!.config_set_id,
      fileName: "aurora-default.dts",
      propertyKey: row!.property_key,
      nodeLocator: row!.node_locator ?? ""
    };
  });
}

function nextCellValue(rawValue: string) {
  const numeric = Number(rawValue.replace(/^<|>$/g, ""));
  return `<${Number.isFinite(numeric) ? numeric + 1 : 1}>`;
}

async function seedOrdinaryReloadRun(input: {
  binding: IsolatedBinding;
  status: "verified" | "unverifiable";
  debugValue: string;
}) {
  const runId = randomUUID();
  const sourceBytes = Buffer.from("/dts-v1/;\n/plugin/;\n");
  const artifactBytes = Buffer.from("dtbo-promote-e2e");
  const sourceSha = createHash("sha256").update(sourceBytes).digest("hex");
  const artifactSha = createHash("sha256").update(artifactBytes).digest("hex");
  const sourceKey = `${organizationId}/${sourceSha}-debug-overlay-${runId}.dts`;
  const artifactKey = `${organizationId}/${artifactSha}-debug-overlay-${runId}.dtbo`;
  const objectRoot = process.env.OBJECT_STORE_ROOT?.trim() || ".wiseeff-object-store";
  await mkdir(join(objectRoot, organizationId), { recursive: true });
  await writeFile(join(objectRoot, sourceKey), sourceBytes);
  await writeFile(join(objectRoot, artifactKey), artifactBytes);

  await withPgClient(async (client) => {
    await client.query(
      `
      insert into dts_reload_runs (
        id, organization_id, project_id, status, purpose, failure_code, steps, diagnostics, tool_versions,
        overlay_source_storage_key, overlay_source_sha256,
        overlay_artifact_storage_key, overlay_artifact_sha256, overlay_artifact_bytes,
        created_by_user_id, completed_at
      ) values (
        $1, $2, $3, $4, 'ordinary', null, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb,
        $5, $6, $7, $8, $9, $10, now()
      )
      `,
      [
        runId,
        organizationId,
        input.binding.projectId,
        input.status,
        sourceKey,
        sourceSha,
        artifactKey,
        artifactSha,
        artifactBytes.length,
        userId
      ]
    );
    await client.query(
      `
      insert into dts_reload_run_targets (
        id, reload_run_id, binding_id, node_path, property_key, baseline_value, debug_value, sort_order
      ) values ($1, $2, $3, $4, $5, $6, $7, 0)
      `,
      [
        randomUUID(),
        runId,
        input.binding.bindingId,
        input.binding.nodeLocator || "/td079_cell",
        input.binding.propertyKey,
        input.binding.rawValue || "<2300>",
        input.debugValue
      ]
    );
  });

  return runId;
}

async function countOpenChangeRequests(bindingId: string) {
  return withPgClient(async (client) => {
    const canonical = await client.query<{ count: string }>(
      `
      select count(*)::text as count
      from project_parameter_value_change_requests
      where binding_id = $1
        and status in ('pending')
      `,
      [bindingId]
    );
    const legacy = await client.query<{ count: string }>(
      `
      select count(*)::text as count
      from parameter_change_requests
      where project_parameter_binding_id = $1
        and status not in ('merged', 'rejected')
      `,
      [bindingId]
    );
    return Number(canonical.rows[0]?.count ?? 0) + Number(legacy.rows[0]?.count ?? 0);
  });
}

async function clearAdminOpenDrafts() {
  await withPgClient(async (client) => {
    await client.query(
      `
      delete from project_parameter_value_drafts
      where organization_id = $1
        and project_id = 'aurora'
        and user_id = $2
      `,
      [organizationId, userId]
    );
    await client.query(
      `
      delete from parameter_drafts
      where organization_id = $1
        and project_id = 'aurora'
        and user_id = $2
      `,
      [organizationId, userId]
    );
  });
}

test.describe("DTS reload promote-to-drafts", () => {
  test.skip(!databaseUrl, "DATABASE_URL is required to seed a verified ordinary reload run.");

  test.beforeEach(async () => {
    await clearAdminOpenDrafts();
  });

  test("DTS-RELOAD-PROMOTE-001: promote a verified ordinary run into parameter drafts", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance DTS-RELOAD-PROMOTE-001
    // @operation DTS-RELOAD-PROMOTE-001
    test.setTimeout(120_000);
    const binding = await pickAuroraNumericBinding(0);
    const debugValue = nextCellValue(binding.rawValue);
    const runId = await seedOrdinaryReloadRun({
      binding,
      status: "verified",
      debugValue
    });
    const requestsBefore = await countOpenChangeRequests(binding.bindingId);

    await page.setViewportSize({ width: 1440, height: 900 });
    await signInBrowserAsRole(page, "admin", `/dts-reload?runId=${encodeURIComponent(runId)}`);
    await dismissXiaozeHint(page);
    const promote = page.getByRole("button", { name: "晋升为草稿" });
    await expect(promote).toBeVisible({ timeout: 30_000 });
    const promoted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/api/v1/dts-reload/runs/${runId}/promote-to-drafts`)
    );
    await promote.click();
    const promoteResponse = await promoted;
    expect(promoteResponse.ok(), await promoteResponse.text()).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/parameters\\?project=${binding.projectId}`), {
      timeout: 30_000
    });
    await expect(page.getByRole("region", { name: "参数修改提交" })).toBeVisible();
    await expect(page.getByRole("region", { name: "参数修改提交" })).toContainText(debugValue.replace(/[<>]/g, ""));

    const drafts = await request.get(
      apiRoute(`/api/v2/projects/${binding.projectId}/parameter-value-drafts`),
      { headers: authHeadersForRole("admin") }
    );
    expect(drafts.ok(), await drafts.text()).toBe(true);
    const draftBody = (await drafts.json()) as { items?: Array<{ bindingId?: string; targetValue?: string }> };
    expect(
      draftBody.items?.some(
        (item) => item.bindingId === binding.bindingId || String(item.targetValue ?? "").includes("9999")
      )
    ).toBe(true);
    const requestsAfter = await countOpenChangeRequests(binding.bindingId);
    expect(requestsAfter).toBe(requestsBefore);

    await recordOperationEvidence({
      operationId: "DTS-RELOAD-PROMOTE-001",
      title: "Verified ordinary reload run promotes stored debug values into drafts without a change request",
      status: "passed",
      role: "Admin",
      route: `/dts-reload?runId=${runId}`,
      page,
      testInfo,
      api: [
        summarizeApiResponse(promoteResponse, {
          method: "POST",
          path: `/api/v1/dts-reload/runs/${runId}/promote-to-drafts`
        }),
        summarizeApiResponse(drafts, {
          method: "GET",
          path: `/api/v2/projects/${binding.projectId}/parameter-value-drafts`
        })
      ]
    });
  });

  test("DTS-RELOAD-PROMOTE-001: unverifiable ordinary run requires acknowledgement before promote", async ({
    page,
    request
  }) => {
    // @acceptance DTS-RELOAD-PROMOTE-001
    // @operation DTS-RELOAD-PROMOTE-001
    test.setTimeout(120_000);
    const binding = await pickAuroraNumericBinding(1);
    const runId = await seedOrdinaryReloadRun({
      binding,
      status: "unverifiable",
      debugValue: nextCellValue(binding.rawValue)
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await signInBrowserAsRole(page, "admin", `/dts-reload?runId=${encodeURIComponent(runId)}`);
    await dismissXiaozeHint(page);
    await page.getByRole("button", { name: "晋升为草稿" }).click();
    const dialog = page.getByRole("dialog", { name: "确认晋升不可验证的运行" });
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole("button", { name: "晋升为草稿" });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("checkbox").check();
    const promoted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/api/v1/dts-reload/runs/${runId}/promote-to-drafts`)
    );
    await confirm.click();
    const promoteResponse = await promoted;
    expect(promoteResponse.ok(), await promoteResponse.text()).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/parameters\\?project=${binding.projectId}`), {
      timeout: 30_000
    });
  });
});
