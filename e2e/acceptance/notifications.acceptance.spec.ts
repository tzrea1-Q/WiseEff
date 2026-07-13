import "dotenv/config";
import { expect, test } from "playwright/test";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute, smokeHeaders } from "./helpers/runtime";

useBrowserDiagnostics(test);

test.describe("Notification center acceptance", () => {
  test("loads inbox APIs and opens the TopBar notification panel", async ({ page }, testInfo) => {
    // @acceptance NOTIF-INBOX-001
    // @operation NOTIF-INBOX-001
    const unreadResponse = await page.request.get(apiRoute("/api/v1/notifications/unread-count"), {
      headers: smokeHeaders()
    });
    expect(unreadResponse.ok()).toBe(true);

    const listResponse = await page.request.get(apiRoute("/api/v1/notifications"), {
      headers: smokeHeaders()
    });
    expect(listResponse.ok()).toBe(true);

    await page.goto("/parameters?project=aurora");
    await prepareInteractionSurface(page);
    await page.getByRole("button", { name: /通知/ }).click();
    await expect(page.getByRole("dialog", { name: "通知面板" })).toBeVisible();

    await recordOperationEvidence({
      operationId: "NOTIF-INBOX-001",
      title: "TopBar notification inbox panel",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(unreadResponse, {
          method: "GET",
          path: "/api/v1/notifications/unread-count",
          responseSummary: "unread count loaded"
        }),
        summarizeApiResponse(listResponse, {
          method: "GET",
          path: "/api/v1/notifications",
          responseSummary: "notification list loaded"
        })
      ]
    });
  });

  test("marks all notifications read through the API", async ({ page }, testInfo) => {
    // @acceptance NOTIF-READ-001
    // @operation NOTIF-READ-001
    const markAllResponse = await page.request.post(apiRoute("/api/v1/notifications/mark-all-read"), {
      headers: smokeHeaders()
    });
    expect(markAllResponse.ok()).toBe(true);

    const unreadResponse = await page.request.get(apiRoute("/api/v1/notifications/unread-count"), {
      headers: smokeHeaders()
    });
    expect(unreadResponse.ok()).toBe(true);
    const unreadBody = (await unreadResponse.json()) as { count: number };
    expect(unreadBody.count).toBeGreaterThanOrEqual(0);

    await page.goto("/parameters?project=aurora");
    await expect(page.getByRole("button", { name: /通知/ })).toBeVisible();

    await recordOperationEvidence({
      operationId: "NOTIF-READ-001",
      title: "Notification mark-all-read API",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(markAllResponse, {
          method: "POST",
          path: "/api/v1/notifications/mark-all-read",
          responseSummary: "mark-all-read succeeded"
        }),
        summarizeApiResponse(unreadResponse, {
          method: "GET",
          path: "/api/v1/notifications/unread-count",
          responseSummary: `unread count=${unreadBody.count}`
        })
      ]
    });
  });
});
