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

  await page.keyboard.press("Escape");
  await expect(popup).toBeHidden({ timeout: 10_000 });
}

export async function prepareInteractionSurface(page: Page) {
  await dismissCopilotDevOverlays(page);
  await closeXiaozePopupIfOpen(page);
  await dismissCopilotDevOverlays(page);
}
