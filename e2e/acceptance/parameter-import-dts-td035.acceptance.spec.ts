import "dotenv/config";
import { expect, test, type Page } from "playwright/test";
import { authHeadersForRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import {
  recordOperationEvidence,
  summarizeApiResponse,
  writeOperationJsonArtifact
} from "./helpers/operationEvidence";
import { apiRoute } from "./helpers/runtime";
import { withPgClient } from "./helpers/database";

useBrowserDiagnostics(test);

async function dismissXiaozeHint(page: Page) {
  const dismiss = page.getByRole("button", { name: "不再提示" });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click();
  }
}

const dtsFullSource = `/dts-v1/;
&demo {
	battery_checker@0 {
		status = "ok";
		spare-cycles = <150>;
	};
	battery_checker@1 {
		status = "disabled";
	};
};
`;

test.describe("PARAM-IMPORT-DTS-FULL / REVIEW-META parameter import DTS alignment", () => {
  test("PARAM-IMPORT-DTS-FULL-001 parses full DTS with @address modules via parse-dts", async ({ page, request }, testInfo) => {
    // @acceptance PARAM-IMPORT-DTS-FULL-001
    // @operation PARAM-IMPORT-DTS-FULL-001
    const parseResponse = await request.post(apiRoute("/api/v1/parameter-import/parse-dts"), {
      headers: authHeadersForRole("admin"),
      data: { sourceName: "board.dts", content: dtsFullSource }
    });
    expect(parseResponse.status()).toBe(200);
    const parsed = (await parseResponse.json()) as {
      format: string;
      rows: Array<{ module: string; sourceNodePath: string; name: string }>;
    };
    expect(parsed.format).toBe("dts-full");
    const paths = parsed.rows.map((row) => row.sourceNodePath);
    expect(paths).toContain("demo/battery_checker@0/status");
    expect(paths).toContain("demo/battery_checker@1/status");
    expect(paths).toContain("demo/battery_checker@0/spare-cycles");
    expect(new Set(paths).size).toBe(paths.length);

    const includeResponse = await request.post(apiRoute("/api/v1/parameter-import/parse-dts"), {
      headers: authHeadersForRole("admin"),
      data: {
        sourceName: "board.dts",
        content: `/dts-v1/;\n/include/ "pin.dtsi"\n/ { board_id = <0>; };\n`
      }
    });
    // /include/ is owned by config-set resolution; single-file parse-dts must not hard-reject it.
    expect(includeResponse.status()).toBe(200);
    const includeBody = (await includeResponse.json()) as { format: string; rows: unknown[] };
    expect(includeBody.format).toBe("dts-full");
    expect(Array.isArray(includeBody.rows)).toBe(true);

    await page.goto("/parameter-admin");
    await dismissXiaozeHint(page);
    await page.getByRole("toolbar", { name: /项目参数管理后台页面操作/ }).getByRole("button", { name: "批量参数导入" }).click();
    const wizard = page.getByRole("dialog", { name: "批量参数导入向导" });
    await expect(wizard).toBeVisible();
    await wizard.getByRole("button", { name: "粘贴 JSON / CSV / DTS 内容" }).click();
    const pasteDialog = page.getByRole("dialog", { name: "粘贴导入内容" });
    await pasteDialog.getByLabel("导入内容").fill(dtsFullSource);
    await pasteDialog.getByRole("button", { name: "确认" }).click();
    await expect(wizard.getByRole("status")).toContainText("将使用服务端解析");
    await wizard.getByRole("button", { name: "下一步" }).click();
    const parseReport = wizard.getByRole("region", { name: "解析与校验" });
    await expect(parseReport).toBeVisible();
    await expect(parseReport).toContainText("总行数");
    await expect(parseReport).toContainText("3");

    await recordOperationEvidence({
      operationId: "PARAM-IMPORT-DTS-FULL-001",
      title: "full DTS parse-dts with @address module paths",
      status: "passed",
      page,
      testInfo,
      assertions: ["ui", "api"],
      api: [
        summarizeApiResponse(parseResponse, {
          method: "POST",
          path: "/api/v1/parameter-import/parse-dts",
          responseSummary: `format=${parsed.format}; rows=${parsed.rows.length}; distinctPaths=${new Set(paths).size}`
        }),
        summarizeApiResponse(includeResponse, {
          method: "POST",
          path: "/api/v1/parameter-import/parse-dts",
          responseSummary: `includeFormat=${includeBody.format}; rows=${includeBody.rows.length}`
        })
      ],
      notes: "parse-dts returned distinct @0/@1 paths; wizard showed server-parse hint and 3 rows."
    });
  });

  test("PARAM-IMPORT-REVIEW-META-001 stores skippedRows in import preview audit metadata", async ({ request }, testInfo) => {
    // @acceptance PARAM-IMPORT-REVIEW-META-001
    // @operation PARAM-IMPORT-REVIEW-META-001
    const reviewMetadata = {
      skippedRows: [{ name: "status", module: "demo/battery_checker@1", reason: "acceptance skip" }],
      notes: "PARAM-IMPORT-REVIEW-META-001"
    };

    const previewResponse = await request.post(apiRoute("/api/v1/parameter-import-batches"), {
      headers: authHeadersForRole("admin"),
      data: {
        projectId: "aurora",
        sourceName: "acceptance-review-meta.dts",
        items: [
          {
            name: "status",
            module: "demo/battery_checker@0",
            risk: "Low",
            unit: "-",
            range: "-",
            currentValue: '"ok"'
          }
        ],
        reviewMetadata
      }
    });
    expect(previewResponse.status()).toBe(201);
    const preview = (await previewResponse.json()) as { item: { id: string } };
    expect(preview.item.id).toBeTruthy();

    const audit = await withPgClient(async (client) => {
      const result = await client.query<{
        id: string;
        kind: string;
        action: string;
        target_id: string | null;
        trace_id: string | null;
        metadata: Record<string, unknown>;
      }>(
        `
        select id, kind, action, target_id, trace_id, metadata
        from audit_events
        where organization_id = 'org-chargelab'
          and kind = 'batch-import'
          and target_id = $1
        order by created_at desc
        limit 1
        `,
        [preview.item.id]
      );
      return result.rows[0] ?? null;
    });

    expect(audit).toBeTruthy();
    expect(audit!.action).toBe("preview");
    expect(audit!.metadata).toMatchObject({ reviewMetadata });
    const reviewMetadataArtifact = await writeOperationJsonArtifact(testInfo, "parameter-import-review-metadata.json", {
      batchId: preview.item.id,
      previewStatus: previewResponse.status(),
      audit
    });

    await recordOperationEvidence({
      operationId: "PARAM-IMPORT-REVIEW-META-001",
      title: "import preview audit includes reviewMetadata",
      status: "passed",
      testInfo,
      assertions: ["api", "db", "audit"],
      artifacts: [reviewMetadataArtifact],
      api: [
        summarizeApiResponse(previewResponse, {
          method: "POST",
          path: "/api/v1/parameter-import-batches",
          responseSummary: `batchId=${preview.item.id}; skippedRows=${reviewMetadata.skippedRows.length}`
        })
      ],
      db: [
        {
          table: "audit_events",
          predicate: `organizationId=org-chargelab; kind=batch-import; targetId=${preview.item.id}`,
          observed: `action=${audit?.action}; skippedRows=${reviewMetadata.skippedRows.length}`,
          rowCount: audit ? 1 : 0
        }
      ],
      audit: [
        {
          id: audit?.id,
          kind: audit!.kind,
          action: audit!.action,
          targetId: audit?.target_id,
          requestId: audit?.trace_id ?? undefined,
          metadataSummary: `reviewMetadata.skippedRows=${reviewMetadata.skippedRows.length}`
        }
      ],
      notes: `batch ${preview.item.id} preview audit metadata contained skippedRows.`
    });
  });
});
