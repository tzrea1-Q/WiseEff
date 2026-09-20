import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";

import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute } from "./helpers/runtime";

useBrowserDiagnostics(test);
test.use({ viewport: { width: 1440, height: 900 } });

test.describe("DTS reload workbench hand-off", () => {
  test("DTS-RELOAD-HANDOFF-001: carry selected bindings from /parameters into /dts-reload", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance DTS-RELOAD-HANDOFF-001
    // @operation DTS-RELOAD-HANDOFF-001
    const listed = await request.get(apiRoute("/api/v2/projects/aurora/parameter-bindings"), {
      headers: authHeadersForRole("admin")
    });
    expect(listed.ok(), await listed.text()).toBe(true);
    const body = (await listed.json()) as { items?: Array<{ id: string }> };
    const bindingId = body.items?.[0]?.id;
    expect(bindingId, "aurora must have at least one canonical binding for handoff").toBeTruthy();

    await page.setViewportSize({ width: 1440, height: 900 });
    await signInBrowserAsRole(
      page,
      "admin",
      `/dts-reload?project=aurora&bindingIds=${encodeURIComponent(bindingId!)}`
    );
    await expect(page.getByRole("status", { name: "工作台带入的参数" })).toContainText(
      "已从参数工作台带入",
      { timeout: 30_000 }
    );
    await expect(page.getByRole("region", { name: "本轮重载" })).toHaveCount(0);

    await recordOperationEvidence({
      operationId: "DTS-RELOAD-HANDOFF-001",
      title: "Workbench bindingIds query filters /dts-reload candidates without filling the run tray",
      status: "passed",
      role: "Admin",
      route: `/dts-reload?project=aurora&bindingIds=${bindingId}`,
      page,
      testInfo,
      api: [
        summarizeApiResponse(listed, {
          method: "GET",
          path: "/api/v2/projects/aurora/parameter-bindings"
        })
      ]
    });
  });
});
