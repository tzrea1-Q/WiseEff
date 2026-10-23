import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";
import { WebSocket } from "ws";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { apiRoute } from "./helpers/runtime";

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [{ method: "POST", path: "/api/v1/device-bridges/organization", status: 503 }] });

test("inventories a member's live Bridge and revokes it by keyboard while retaining failed confirmation input", async ({ page, request }, testInfo) => {
  await seedAcceptanceRoleMatrix(); const member = authHeadersForRole("software-user"), admin = authHeadersForRole("admin");
  const issued = await request.post(apiRoute("/api/v1/device-bridges/pairing-codes"), { headers: member, data: {} }); expect(issued.status()).toBe(201);
  const machineLabel = `治理测试电脑-${Date.now().toString(36)}`;
  const pairedResponse = await request.post(apiRoute("/api/v1/device-bridges/pair"), { data: { code: (await issued.json() as { code: string }).code, machineLabel, platform: "linux", arch: "amd64", clientVersion: "0.1.1" } }); expect(pairedResponse.status()).toBe(201);
  const paired = await pairedResponse.json() as { bridgeId: string; bridgeToken: string };
  const wsUrl = new URL(apiRoute("/api/v1/device-bridges/ws")); wsUrl.protocol = "ws:";
  const socket = new WebSocket(wsUrl, { headers: { authorization: `Bridge ${paired.bridgeToken}` } });
  const closed = (connection: WebSocket) => new Promise<number>((resolve, reject) => { connection.once("close", resolve); connection.once("error", reject); });
  try {
    await new Promise<void>((resolve, reject) => { socket.once("message", raw => { expect(JSON.parse(raw.toString()).type).toBe("bridge.hello"); resolve(); }); socket.once("error", reject); });
    await signInBrowserAsRole(page, "admin", "/organization"); await prepareInteractionSurface(page);
    await page.getByRole("button", { name: "设备代理", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(url => url.pathname === "/organization/bridges" && url.searchParams.get("organizationId") === "org-chargelab");
    const row = page.getByRole("row").filter({ has: page.getByText(machineLabel, { exact: true }) });
    await expect(row.getByText("在线", { exact: true })).toBeVisible(); await expect(row).toContainText("0.1.1"); await expect(row).toContainText(paired.bridgeId);
    expect(await page.locator("body").innerText()).not.toContain(paired.bridgeToken);
    await row.getByRole("button", { name: "撤销配对", exact: true }).focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "撤销设备代理配对？", exact: true }); await expect(dialog).toContainText(machineLabel);
    await expect(dialog.getByRole("button", { name: "撤销配对", exact: true })).toBeDisabled();
    await dialog.getByRole("textbox", { name: "撤销原因", exact: true }).fill("成员离职，回收配对授权");
    const path = `/api/v1/device-bridges/organization/${paired.bridgeId}/revoke`;
    await page.route(url => url.pathname === path, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "撤销暂时不可用，请重试。" } }) }), { times: 1 });
    await dialog.getByRole("button", { name: "撤销配对", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(dialog.getByRole("alert")).toContainText("请重试"); await expect(dialog.getByRole("textbox", { name: "撤销原因", exact: true })).toHaveValue("成员离职，回收配对授权");
    const failureImage = testInfo.outputPath("bridge-revoke-failed-1440.png"); await page.screenshot({ path: failureImage, animations: "disabled" }); await testInfo.attach("bridge-revoke-failed-1440", { path: failureImage, contentType: "image/png" });
    const disconnected = closed(socket);
    await dialog.getByRole("button", { name: "撤销配对", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0); await expect(row.getByText("已撤销", { exact: true })).toBeVisible(); expect(await disconnected).toBe(4401);
    const oldCredentials = new WebSocket(wsUrl, { headers: { authorization: `Bridge ${paired.bridgeToken}` } }); expect(await closed(oldCredentials)).toBe(4401);
    await page.reload(); await expect(page.getByRole("row").filter({ has: page.getByText(machineLabel, { exact: true }) }).getByText("已撤销", { exact: true })).toBeVisible();
    await expect(page.getByRole("row").filter({ has: page.getByText(machineLabel, { exact: true }) })).not.toContainText("尚无活动");
    const readyImage = testInfo.outputPath("bridge-revoked-1440.png"); await page.screenshot({ path: readyImage, animations: "disabled" }); await testInfo.attach("bridge-revoked-1440", { path: readyImage, contentType: "image/png" });
    const listed = await request.get(apiRoute("/api/v1/device-bridges/organization"), { headers: admin }); expect(listed.status()).toBe(200);
    expect((await listed.json() as { items: Array<{ id: string; online: boolean; revokedAt: string | null }> }).items).toContainEqual(expect.objectContaining({ id: paired.bridgeId, online: false, revokedAt: expect.any(String) }));
    await signInBrowserAsRole(page, "software-user", "/organization/bridges"); await expect(page.getByRole("table", { name: "组织设备代理", exact: true })).toHaveCount(0);
    expect((await request.get(apiRoute("/api/v1/device-bridges/organization"), { headers: member })).status()).toBe(403);
  } finally { socket.terminate(); }
});
