import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";

import { signInBrowserAsRole } from "./helpers/bearerAuth";
import { recordOperationEvidence } from "./helpers/operationEvidence";

const projectRoute = "/parameters?project=aurora";

test.describe("Xiaoze modeless popup layout", () => {
  test("moves, persists, resets, survives navigation, and preserves mobile full screen", async ({ page }, testInfo) => {
    // @acceptance XIAOZE-POPUP-MOVE-001
    // @operation XIAOZE-POPUP-MOVE-001
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInBrowserAsRole(page, "admin", projectRoute);

    const hintDismiss = page.getByRole("button", { name: "不再提示" });
    if (await hintDismiss.isVisible().catch(() => false)) {
      await hintDismiss.click();
    }
    const toggle = page.getByTestId("copilot-chat-toggle");
    const launcher = page.locator("[data-xiaoze-launcher-anchor]");
    await expect(toggle).toBeVisible();
    if ((await toggle.getAttribute("data-state")) === "open") {
      await toggle.click();
    }

    const closedLauncherBefore = await launcher.boundingBox();
    if (!closedLauncherBefore) {
      throw new Error("Xiaoze launcher has no desktop bounding box.");
    }
    await page.mouse.move(
      closedLauncherBefore.x + closedLauncherBefore.width / 2,
      closedLauncherBefore.y + closedLauncherBefore.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(20, 20, { steps: 8 });
    await page.mouse.up();
    await expect(toggle).toHaveAttribute("data-state", "closed");
    const closedLauncherMoved = await launcher.boundingBox();
    expect(closedLauncherMoved).not.toBeNull();
    expect(closedLauncherMoved!.x).toBeLessThanOrEqual(24);
    expect(closedLauncherMoved!.y).toBeLessThanOrEqual(24);
    const closedCenter = {
      x: closedLauncherMoved!.x + closedLauncherMoved!.width / 2,
      y: closedLauncherMoved!.y + closedLauncherMoved!.height / 2
    };
    await page.waitForTimeout(750);
    const closedLauncherSettled = await launcher.boundingBox();
    expect(closedLauncherSettled).not.toBeNull();
    expect(closedLauncherSettled!.x + closedLauncherSettled!.width / 2).toBeCloseTo(closedCenter.x, 0);
    expect(closedLauncherSettled!.y + closedLauncherSettled!.height / 2).toBeCloseTo(closedCenter.y, 0);
    expect(await page.evaluate(() => localStorage.getItem("wiseeff.xiaoze.launcher.position.v1"))).toBeNull();

    await toggle.click();

    const layer = page.getByTestId("xiaoze-popup-layer");
    const popup = page.getByTestId("copilot-popup");
    const dragHandle = page.getByRole("button", { name: "拖动小泽窗口" });
    await expect(layer).toBeVisible();
    await expect(layer).toHaveAttribute("data-presentation", "modeless");
    await expect(popup).not.toHaveAttribute("aria-modal");
    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => {
        const iterations = animation.effect?.getComputedTiming().iterations;
        return iterations === Infinity || animation.playState === "finished" || animation.playState === "idle";
      })
    );

    const coupledPopupBefore = await popup.boundingBox();
    const coupledLauncherBefore = await launcher.boundingBox();
    if (!coupledPopupBefore || !coupledLauncherBefore) {
      throw new Error("Xiaoze coupled surfaces have no desktop bounding box.");
    }
    await page.mouse.move(
      coupledLauncherBefore.x + coupledLauncherBefore.width / 2,
      coupledLauncherBefore.y + coupledLauncherBefore.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(1420, 880, { steps: 12 });
    await page.mouse.up();
    await expect(toggle).toHaveAttribute("data-state", "open");
    const coupledPopupAfter = await popup.boundingBox();
    const coupledLauncherAfter = await launcher.boundingBox();
    expect(coupledPopupAfter).not.toBeNull();
    expect(coupledLauncherAfter).not.toBeNull();
    expect(coupledLauncherAfter!.x).toBeGreaterThanOrEqual(1360);
    expect(coupledLauncherAfter!.y).toBeGreaterThanOrEqual(820);
    expect(coupledPopupAfter!.x).toBeGreaterThan(coupledPopupBefore.x + 500);
    expect(coupledPopupAfter!.x).toBeGreaterThanOrEqual(16);
    expect(coupledPopupAfter!.y).toBeGreaterThanOrEqual(16);
    expect(coupledPopupAfter!.x + coupledPopupAfter!.width).toBeLessThanOrEqual(1424);
    expect(coupledPopupAfter!.y + coupledPopupAfter!.height).toBeLessThanOrEqual(884);

    const before = await popup.boundingBox();
    if (!before) {
      throw new Error("Xiaoze popup has no desktop bounding box.");
    }
    await dragHandle.hover();
    await page.mouse.down();
    await page.mouse.move(before.x - 180, before.y + 80, { steps: 8 });
    await page.mouse.up();
    const moved = await popup.boundingBox();
    expect(moved).not.toBeNull();
    expect(moved!.x).toBeLessThan(before.x - 100);
    expect(moved!.y).toBeGreaterThanOrEqual(16);

    const resizeHandle = page.getByRole("button", { name: "调整小泽窗口大小" });
    const resizeBox = await resizeHandle.boundingBox();
    if (!resizeBox) {
      throw new Error("Xiaoze resize handle has no desktop bounding box.");
    }
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 80, resizeBox.y + resizeBox.height / 2 + 40, { steps: 6 });
    await page.mouse.up();
    const resized = await popup.boundingBox();
    expect(resized).not.toBeNull();
    expect(resized!.width).toBeGreaterThan(moved!.width + 50);
    expect(resized!.height).toBeGreaterThan(moved!.height + 20);

    const storedAfterDrag = await page.evaluate(() => localStorage.getItem("wiseeff.xiaoze.popup.layout.v2"));
    expect(storedAfterDrag).toContain('"version":2');

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(toggle).toHaveAttribute("data-state", "closed");
    const launcherAfterReload = await launcher.boundingBox();
    expect(launcherAfterReload).not.toBeNull();
    expect(launcherAfterReload!.x).toBeGreaterThanOrEqual(1350);
    expect(launcherAfterReload!.y).toBeGreaterThanOrEqual(810);
    await toggle.click();
    await expect(layer).toBeVisible();
    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => {
        const iterations = animation.effect?.getComputedTiming().iterations;
        return iterations === Infinity || animation.playState === "finished" || animation.playState === "idle";
      })
    );
    const restored = await popup.boundingBox();
    expect(restored).not.toBeNull();
    expect(restored!.width).toBeCloseTo(resized!.width, 0);
    expect(restored!.height).toBeCloseTo(resized!.height, 0);

    const pageSearch = page.getByRole("searchbox", { name: "搜索 DTS 参数" });
    await pageSearch.fill("gpio");
    await expect(pageSearch).toHaveValue("gpio");
    await expect(layer).toBeVisible();

    await page.getByRole("button", { name: "新建项目" }).click();
    const businessDialog = page.getByRole("dialog", { name: /项目初始化|新项目参数初始化/ });
    await expect(businessDialog).toBeVisible();
    const layerZ = await layer.evaluate((element) => Number.parseInt(getComputedStyle(element).zIndex, 10));
    const businessModalZ = await page.locator(".modal-backdrop").last().evaluate((element) =>
      Number.parseInt(getComputedStyle(element).zIndex, 10)
    );
    expect(businessModalZ).toBeGreaterThan(layerZ);
    await businessDialog.getByRole("button", { name: "取消" }).click();

    await page.getByRole("button", { name: "我的工作台" }).click();
    await expect(page).toHaveURL(/\/parameter-home$/u);
    await expect(layer).toBeVisible();
    await expect(popup).toHaveAttribute("role", "dialog");

    await dragHandle.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Home");
    await expect(page.getByRole("button", { name: "恢复小泽默认位置和大小" })).toBeHidden();

    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(layer).toHaveAttribute("data-presentation", "modeless");
    await toggle.focus();
    await page.keyboard.press("Home");
    const tabletLauncherBeforeCancel = await launcher.boundingBox();
    if (!tabletLauncherBeforeCancel) {
      throw new Error("Xiaoze launcher has no tablet bounding box.");
    }
    const launcherTouch = await page.context().newCDPSession(page);
    await launcherTouch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{
        x: tabletLauncherBeforeCancel.x + tabletLauncherBeforeCancel.width / 2,
        y: tabletLauncherBeforeCancel.y + tabletLauncherBeforeCancel.height / 2
      }]
    });
    await launcherTouch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 380, y: 470 }]
    });
    await launcherTouch.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await launcherTouch.detach();
    const tabletLauncherAfterCancel = await launcher.boundingBox();
    expect(tabletLauncherAfterCancel).not.toBeNull();
    expect(tabletLauncherAfterCancel!.x).toBeLessThan(500);
    expect(tabletLauncherAfterCancel!.y).toBeLessThan(600);

    const tabletHandleBox = await dragHandle.boundingBox();
    if (!tabletHandleBox) {
      throw new Error("Xiaoze drag handle has no tablet bounding box.");
    }
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: tabletHandleBox.x + tabletHandleBox.width / 2, y: tabletHandleBox.y + tabletHandleBox.height / 2 }]
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 20, y: 20 }]
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
    const tabletClamped = await popup.boundingBox();
    expect(tabletClamped).not.toBeNull();
    expect(tabletClamped!.x).toBeGreaterThanOrEqual(16);
    expect(tabletClamped!.y).toBeGreaterThanOrEqual(16);
    expect(tabletClamped!.x + tabletClamped!.width).toBeLessThanOrEqual(752);
    expect(tabletClamped!.y + tabletClamped!.height).toBeLessThanOrEqual(1008);

    const desktopStored = await page.evaluate(() => localStorage.getItem("wiseeff.xiaoze.popup.layout.v2"));
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(layer).toHaveAttribute("data-presentation", "modal");
    await expect(popup).toHaveAttribute("aria-modal", "true");
    await expect(page.getByRole("button", { name: "拖动小泽窗口" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "调整小泽窗口大小" })).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem("wiseeff.xiaoze.popup.layout.v2"))).toBe(desktopStored);

    await recordOperationEvidence({
      operationId: "XIAOZE-POPUP-MOVE-001",
      title: "xiaoze modeless popup move and recovery",
      status: "passed",
      role: "Admin",
      route: projectRoute,
      page,
      testInfo,
      notes:
        "Desktop launcher moved without toggling while closed; after opening, launcher drag moved the launcher and popup by the same delta without closing; effective launcher movement survived a tablet touch-cancel release; header drag, resize, and reload restoration remained intact; the business page remained operable and its modal covered Xiaoze; SPA navigation retained the popup; keyboard reset restored default layout; tablet touch input stayed viewport-clamped; and mobile retained full-screen modal semantics without overwriting desktop layout."
    });
  });
});
