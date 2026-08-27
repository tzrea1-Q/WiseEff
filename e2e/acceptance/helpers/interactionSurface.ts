import { expect, type Page } from "playwright/test";

export async function dismissCopilotDevOverlays(page: Page) {
  await page.evaluate(() => {
    for (const element of document.querySelectorAll("cpk-web-inspector")) {
      element.remove();
    }
  });
}

export async function closeXiaozePopupIfOpen(page: Page) {
  const popup = page.getByTestId("xiaoze-popup-layer");
  if (!(await popup.isVisible().catch(() => false))) {
    return;
  }

  // Desktop Xiaoze intentionally ignores Escape while page focus is outside
  // the popup, and the mobile sheet can cover the floating toggle. Use the
  // popup-owned close control so setup works in every presentation mode.
  await popup.getByTestId("copilot-close-button").click();
  await expect(popup).toBeHidden({ timeout: 10_000 });
}

/**
 * The Xiaoze toggle hint reveals ~1.4s after every full page load and floats
 * next to the bottom-right chat toggle, where it can swallow clicks aimed at
 * page actions underneath. Call after a goto when the flow clicks controls in
 * that corner (same pattern as the workbench/negative specs' local helpers).
 */
export async function dismissXiaozeToggleHint(page: Page) {
  const dismiss = page.getByRole("button", { name: "不再提示" });
  await dismiss.waitFor({ state: "visible", timeout: 2_000 }).catch(() => undefined);
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click();
  }
}

export async function prepareInteractionSurface(page: Page) {
  await dismissCopilotDevOverlays(page);
  await closeXiaozePopupIfOpen(page);
  await dismissCopilotDevOverlays(page);
}
