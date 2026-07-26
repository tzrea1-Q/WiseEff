import { spawnSync } from "node:child_process";
import { expect, type Locator, type Page } from "playwright/test";

const runtimeCrashPattern =
  /Application error|Cannot read properties|ReferenceError|TypeError|Unhandled Runtime Error|vite\/client|failed to fetch/i;

let qualitySeeded = false;

export function seedQualityRuntime() {
  if (qualitySeeded || process.env.WISEEFF_QUALITY_SKIP_SEED === "true") {
    return;
  }

  for (const script of ["db:migrate", "reset:quality-runtime", "db:seed:m0", "db:seed:m1", "db:seed:m2", "db:seed:m3"]) {
    runNpmScript(script);
  }
  qualitySeeded = true;
}

export async function expectUsablePage(page: Page) {
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator("main, .main-content").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(runtimeCrashPattern);
}

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

export async function openXiaozePopup(page: Page, route = "/parameters?project=aurora") {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await expectUsablePage(page);

  const toggle = page.getByTestId("copilot-chat-toggle");
  await expect(toggle).toBeVisible();

  const popup = page.getByTestId("xiaoze-popup-layer");
  if ((await toggle.getAttribute("data-state")) !== "open") {
    const hintDismiss = page.locator(".xiaoze-toggle-hint__dismiss");
    if (await hintDismiss.isVisible().catch(() => false)) {
      await hintDismiss.click();
    }
    await toggle.click();
  }

  await expect(toggle).toHaveAttribute("data-state", "open", { timeout: 15_000 });
  await expect(popup).toBeVisible({ timeout: 15_000 });
  return popup;
}

export function stableMasks(page: Page, routePath = ""): Locator[] {
  const masks = [
    page.locator(".topbar-user-menu"),
    page.locator(".xiaoze-popup-window"),
    page.locator(".xiaoze-toggle-hint"),
    page.locator(".operation-history-list"),
    page.locator(".audit-column"),
    page.locator(".review-detail"),
    page.locator("[aria-live]")
  ];

  if (routePath === "/parameters") {
    masks.push(page.locator(".dts-parameter-workbench-table, .dts-workbench-list"));
  }

  return masks;
}

export async function expectNoHorizontalOverflow(page: Page, tolerancePx = 2) {
  const overflow = await page.evaluate(() => {
    const documentWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0
    );
    return documentWidth - window.innerWidth;
  });

  expect(overflow).toBeLessThanOrEqual(tolerancePx);
}

export async function expectBoundedMainScroll(
  page: Page,
  options: { maxViewportMultiples?: number } = {}
) {
  const maxViewportMultiples = options.maxViewportMultiples ?? 4;
  const metrics = await page.evaluate(() => {
    const main = document.querySelector("main, .main-content");
    const viewportHeight = window.innerHeight;
    if (!main) {
      return { scrollHeight: 0, viewportHeight };
    }
    return { scrollHeight: main.scrollHeight, viewportHeight };
  });

  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.viewportHeight * maxViewportMultiples);
}

export async function expectBoundedInteractiveControls(
  page: Page,
  options: { maxControls?: number; maxOptions?: number } = {}
) {
  const maxControls = options.maxControls ?? 200;
  const maxOptions = options.maxOptions ?? 500;
  const counts = await page.evaluate(() => {
    const main = document.querySelector("main, .main-content");
    if (!main) {
      return { controls: 0, options: 0 };
    }

    const controls = main.querySelectorAll(
      "button, input, select, textarea, [role='button'], [role='combobox']"
    ).length;
    const options = main.querySelectorAll("option").length;
    return { controls, options };
  });

  expect(counts.controls).toBeLessThanOrEqual(maxControls);
  expect(counts.options).toBeLessThanOrEqual(maxOptions);
}

export async function expectVisibleFormControlAffordances(page: Page) {
  const missingAffordances = await page.evaluate(() => {
    const main = document.querySelector("main, .main-content");
    if (!main) {
      return [] as string[];
    }

    const failures: string[] = [];
    const controls = main.querySelectorAll("input:not([type='hidden']), select, textarea");

    for (const control of controls) {
      const element = control as HTMLElement;
      if (!element.offsetParent && element.getAttribute("type") !== "hidden") {
        continue;
      }

      const style = window.getComputedStyle(element);
      const borderVisible =
        style.borderTopStyle !== "none" &&
        style.borderRightStyle !== "none" &&
        style.borderBottomStyle !== "none" &&
        style.borderLeftStyle !== "none" &&
        (parseFloat(style.borderTopWidth) > 0 ||
          parseFloat(style.borderRightWidth) > 0 ||
          parseFloat(style.borderBottomWidth) > 0 ||
          parseFloat(style.borderLeftWidth) > 0);
      const background = style.backgroundColor;
      const hasBackground =
        background !== "transparent" &&
        background !== "rgba(0, 0, 0, 0)" &&
        background !== "";
      const hasShadow = style.boxShadow !== "none";

      if (!borderVisible && !hasBackground && !hasShadow) {
        failures.push(
          element.getAttribute("aria-label") ??
            element.getAttribute("name") ??
            element.getAttribute("id") ??
            element.tagName.toLowerCase()
        );
      }
    }

    return failures;
  });

  expect(missingAffordances).toEqual([]);
}

function runNpmScript(script: string) {
  const invocation =
    process.platform === "win32"
      ? { command: "cmd.exe", args: ["/d", "/s", "/c", `npm run ${script}`] }
      : { command: "npm", args: ["run", script] };
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env
  });

  if (result.status !== 0) {
    const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    const errorDetails = result.error
      ? `child_process error: ${result.error.code ?? "unknown"} ${result.error.message ?? ""}`.trimEnd()
      : "";

    throw new Error(
      [
        `npm run ${script} failed with exit code ${result.status}.`,
        stdout,
        stderr,
        errorDetails
      ].filter(Boolean).join("\n")
    );
  }
}
