import "./helpers/loadAcceptanceEnvironment";
import { spawn, type ChildProcess } from "node:child_process";
import { expect, test } from "playwright/test";

import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import {
  CATALOG_EXPECTED_API_FAILURES,
  CATALOG_PAGE_PATH,
  catalogJson,
  catalogPage,
  catalogScreenshot,
  catalogUiCopy,
  confirmGovernanceDialog,
  openCatalogAt
} from "./helpers/catalogBrowser";
import {
  countProposals,
  countSubjectRegistrations,
  ensureCatalogAcceptanceFixture,
  type CatalogAcceptanceFixture
} from "./helpers/catalogEvidence";

useBrowserDiagnostics(test, { expectedApiFailures: CATALOG_EXPECTED_API_FAILURES });

const MOCK_FRONTEND_URL = "http://127.0.0.1:5174";

let fixture: CatalogAcceptanceFixture;

test.beforeAll(async () => {
  fixture = await ensureCatalogAcceptanceFixture();
});

test.describe("canonical parameter catalog negative and responsive contract", () => {
  test("preserves conflict input, refreshes evidence, and requires reconfirmation without partial writes", async ({
    page
  }, testInfo) => {
    // @acceptance PCAT-UI-10
    // @operation PCAT-CONFLICT-RECONFIRM-001
    const before = await countProposals(fixture.pool);
    await openCatalogAt(page, "org-admin");
    await page.route("**/api/v2/catalog/definition-proposals**", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "CONFLICT",
            message: "Catalog release drifted.",
            details: { reason: "release-drift" }
          }
        })
      });
    });
    const panel = page.getByRole("region", { name: "定义修订" });
    const reason = panel.getByRole("textbox", { name: "原因" });
    await reason.fill("op08 conflict keep this reason");
    await panel.getByRole("button", { name: "继续确认" }).click();
    await confirmGovernanceDialog(page, "确认提出修订");
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(panel.locator("[data-preserve-input='true']")).toBeVisible();
    await expect(panel.locator("[data-silent-retry='false']")).toBeVisible();
    await expect(reason).toHaveValue("op08 conflict keep this reason");
    const after = await countProposals(fixture.pool);
    expect(after).toBe(before);
    await panel.getByRole("button", { name: "刷新证据" }).click();
    await expect(panel.getByRole("button", { name: "继续确认" })).toBeVisible();
    await page.unroute("**/api/v2/catalog/definition-proposals**");
    await catalogScreenshot(page, testInfo, "pcat-ui-10-conflict");
  });

  test("resolves legacy bookmarks to exact mapped, gone, conflict, unknown, and scope-hidden outcomes", async ({
    page
  }, testInfo) => {
    // @acceptance PCAT-UI-11
    // @operation PCAT-LEGACY-LINK-001
    const mapped = await catalogJson(
      page.request,
      "GET",
      `/api/v2/catalog/legacy-identifiers/parameter-spec/${fixture.legacy.mapped}`
    );
    expect(mapped.status).toBe(200);
    const mappedBody = mapped.body as { item: { disposition: string; target: { kind: string; id: string } } };
    expect(mappedBody.item.disposition).toBe("mapped");
    expect(mappedBody.item.target.kind).toBe("parameter-definition");
    expect(mappedBody.item.target.id).toBe(fixture.xDefinitionId);

    await openCatalogAt(page, "org-admin", `?spec=${fixture.legacy.mapped}`);
    await expect(page).toHaveURL(new RegExp(`definitionId=${fixture.xDefinitionId}`));
    await expect(page).not.toHaveURL(/[?&]spec=/);
    await expect(page.getByRole("region", { name: "定义详情" })).toContainText("iin_max");

    const gone = await catalogJson(
      page.request,
      "GET",
      `/api/v2/catalog/legacy-identifiers/parameter-spec/${fixture.legacy.gone}`
    );
    expect(gone.status).toBe(410);
    expect(JSON.stringify(gone.body)).not.toMatch(/archive-op08-gone|candidate/i);

    const conflict = await catalogJson(
      page.request,
      "GET",
      `/api/v2/catalog/legacy-identifiers/parameter-spec/${fixture.legacy.conflict}`
    );
    expect(conflict.status).toBe(409);
    expect(JSON.stringify(conflict.body)).not.toMatch(/pdef_acme_power_iin_min|candidate/i);

    const unknown = await catalogJson(
      page.request,
      "GET",
      `/api/v2/catalog/legacy-identifiers/parameter-spec/${fixture.legacy.unknown}`
    );
    expect(unknown.status).toBe(404);

    const hidden = await catalogJson(
      page.request,
      "GET",
      `/api/v2/catalog/legacy-identifiers/parameter-spec/${fixture.legacy.scopeHidden}`
    );
    expect(hidden.status).toBe(404);
    expect(JSON.stringify(hidden.body)).not.toMatch(new RegExp(fixture.xDefinitionId));

    await page.goto(`${CATALOG_PAGE_PATH}?spec=${fixture.legacy.unknown}`);
    await expect(catalogPage(page)).toHaveAttribute("data-catalog-state", /error|conflict|retired/);
    await expect(page.getByText("iin_max")).toHaveCount(0);
    await catalogScreenshot(page, testInfo, "pcat-ui-11-legacy");
  });

  test("keeps Agent access read-only and refuses governance mutation or role-spoof paths", async ({
    page
  }, testInfo) => {
    // @acceptance PCAT-UI-12
    // @operation PCAT-AGENT-READONLY-001
    const before = await countSubjectRegistrations(fixture.pool, fixture.organizationId, fixture.sensorSubjectId);
    await openCatalogAt(page, "agent");
    await expect(page.getByRole("button", { name: catalogUiCopy.actionLabels["register-subject"] })).toHaveCount(0);
    await expect(page.getByRole("button", { name: catalogUiCopy.actionLabels["accept-proposal"] })).toHaveCount(0);
    const read = await catalogJson(page.request, "GET", "/api/v2/catalog", { actor: "agent" });
    expect(read.status).toBe(200);
    const write = await catalogJson(page.request, "POST", `/api/v2/organizations/${fixture.organizationId}/subject-registrations`, {
      actor: "agent",
      headers: {
        "X-WiseEff-Catalog-Release": fixture.chain.pinF.id,
        "Idempotency-Key": `pcat-ui-12:${Date.now()}`,
        "X-WiseEff-Role": "platform-admin",
        "X-WiseEff-Organization": fixture.organizationId,
        "X-WiseEff-Actor-Kind": "org-admin"
      },
      data: { subjectId: fixture.sensorSubjectId, placement: { mode: "use-default" }, reason: "spoofed agent write" }
    });
    expect(write.status).toBe(403);
    const after = await countSubjectRegistrations(fixture.pool, fixture.organizationId, fixture.sensorSubjectId);
    expect(after).toBe(before);
    await catalogScreenshot(page, testInfo, "pcat-ui-12-agent");
  });

  test("replays identical API and mock catalog states without extra mock governance authority", async ({
    page,
    browser
  }, testInfo) => {
    // @acceptance PCAT-UI-13
    // @operation PCAT-ADAPTER-PARITY-001
    const collectDigest = async (target: typeof page, label: string) => {
      const region = catalogPage(target);
      await expect(region).toBeVisible({ timeout: 30_000 });
      const state = await region.getAttribute("data-catalog-state");
      const actions = await target.locator("[data-catalog-action]").evaluateAll((nodes) =>
        nodes.map((node) => ({
          action: node.getAttribute("data-catalog-action"),
          disabled: (node as HTMLButtonElement).disabled,
          label: node.textContent?.trim()
        }))
      );
      const digest = { label, state, actions };
      await testInfo.attach(`pcat-ui-13-${label}`, {
        body: Buffer.from(JSON.stringify(digest, null, 2)),
        contentType: "application/json"
      });
      return digest;
    };

    await openCatalogAt(page, "org-admin");
    const apiDigest = await collectDigest(page, "api-org-admin");
    expect(apiDigest.actions.some((action) => action.action === "accept-proposal")).toBe(false);
    expect(apiDigest.actions.some((action) => action.action === "register-subject")).toBe(true);

    const mock = await startMockFrontend();
    try {
      const mockPage = await browser.newPage();
      await mockPage.goto(`${MOCK_FRONTEND_URL}${CATALOG_PAGE_PATH}`, { waitUntil: "domcontentloaded" });
      const mockDigest = await collectDigest(mockPage, "mock-admin");
      expect(mockDigest.state).toBe(apiDigest.state);
      expect(
        mockDigest.actions.map((action) => ({ action: action.action, disabled: action.disabled }))
      ).toEqual(apiDigest.actions.map((action) => ({ action: action.action, disabled: action.disabled })));
      await catalogScreenshot(mockPage, testInfo, "pcat-ui-13-mock");
      await mockPage.close();
    } finally {
      await mock.close();
    }
    await catalogScreenshot(page, testInfo, "pcat-ui-13-api");
  });
});

async function startMockFrontend(): Promise<{ close: () => Promise<void> }> {
  const child: ChildProcess = spawn(
    "npx",
    ["vite", "--host", "127.0.0.1", "--port", "5174", "--strictPort"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        VITE_WISEEFF_RUNTIME_MODE: "mock"
      },
      stdio: "pipe"
    }
  );
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    try {
      const response = await fetch(MOCK_FRONTEND_URL);
      if (response.ok) {
        return {
          close: async () => {
            child.kill("SIGTERM");
          }
        };
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  child.kill("SIGTERM");
  throw new Error("Mock Catalog frontend on :5174 did not become ready.");
}
