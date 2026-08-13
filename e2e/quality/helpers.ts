import { expect, type Locator, type Page } from "playwright/test";
import { runNpmScript } from "../acceptance/helpers/database";

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

/**
 * Deterministically clear the global toast layer before a screenshot.
 * Runtime-connect notifications are timing-dependent (they auto-dismiss after
 * ~4s), so a visual baseline must never race them: dismiss whatever is showing
 * and wait for the queue to drain.
 */
export async function settleAppToasts(page: Page, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  const toast = page.locator(".toast");
  while (Date.now() < deadline) {
    if ((await toast.count()) === 0) {
      return;
    }
    const close = page.locator(".toast__close").first();
    if ((await close.count()) > 0) {
      await close.click({ timeout: 1_000 }).catch(() => undefined);
    }
    await page.waitForTimeout(150);
  }
  await expect(toast).toHaveCount(0);
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

/**
 * Wait until the Xiaoze popup layer settles hidden. CopilotKit mounts the
 * popup DOM briefly visible before XiaozePopupOpenPolicy closes it on first
 * commit; an axe scan launched right after `main` becomes visible can race
 * that transient and report the (visually closed) chat panel. Require the
 * layer to stay hidden for a short dwell so scans always see the steady state.
 */
export async function settleXiaozePopupClosed(page: Page, dwellMs = 600, timeoutMs = 15_000) {
  const layer = page.getByTestId("xiaoze-popup-layer");
  const deadline = Date.now() + timeoutMs;
  let hiddenSince: number | null = null;

  while (Date.now() < deadline) {
    const visible = await layer.isVisible().catch(() => false);
    if (!visible) {
      hiddenSince ??= Date.now();
      if (Date.now() - hiddenSince >= dwellMs) {
        return;
      }
    } else {
      hiddenSince = null;
    }
    await page.waitForTimeout(100);
  }

  await expect(layer).toBeHidden();
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

  if (routePath === "/parameter-home") {
    // Governance trend chart: the x-axis date labels (and the fallback table
    // inside the same <figure>) are bucketed from "today", so they shift with
    // the calendar day the suite runs on. KPI numbers and hotspot cards come
    // from the freshly seeded window and stay stable, so only the chart moves.
    masks.push(page.locator(".parameter-home__chart-shell"));
  }

  if (routePath === "/dts-reload" || routePath === "/node-debugging") {
    // Bridge install guide: the API mints a fresh random 6-digit pairing code
    // on every page load; the surrounding copy is static, so only the <strong>
    // digits need masking.
    masks.push(page.locator(".local-device-bridge-panel__already-installed strong"));
  }

  return masks;
}

/**
 * Route-specific readiness waits for the quality routes added by FA-25. These
 * pages stream API data after first paint (dashboard sections, the bridge
 * install guide with its async pairing code, seeded tables), so screenshots
 * and axe scans must wait for the settled state instead of racing skeletons.
 * Routes without an entry settle through the generic page checks alone.
 */
export async function settleQualityRoute(page: Page, routePath: string) {
  const timeout = 20_000;

  if (routePath === "/parameter-home") {
    // The trend panel swaps its loading skeleton for the chart once the
    // dashboard summary API answers.
    await expect(page.locator(".parameter-home__chart-shell")).toBeVisible({ timeout });
    return;
  }

  if (routePath === "/parameter-admin/projects/aurora/configuration") {
    // The deep link resolves the seeded config set + file, then renders the
    // source canvas with the seeded aurora DTS baseline.
    await expect(page.getByText("aurora-board.dts").first()).toBeVisible({ timeout });
    return;
  }

  if (routePath === "/dts-reload" || routePath === "/node-debugging") {
    // No local bridge listens on 127.0.0.1:18787 in CI, so the wizard settles
    // on the install guide; wait for the async release manifest and pairing
    // code so the "not connected" state is fully rendered before asserting.
    await expect(page.getByText("已识别当前环境").first()).toBeVisible({ timeout });
    await expect(page.getByText("当前配对码").first()).toBeVisible({ timeout });
    if (routePath === "/dts-reload") {
      // The seeded reload workbench (tree + table + history) loads below the wizard.
      await expect(page.getByText("运行历史").first()).toBeVisible({ timeout });
    } else {
      // A seeded catalog row proves the debug parameter table finished loading.
      await expect(page.getByText("Fast charge current").first()).toBeVisible({ timeout });
    }
    return;
  }

  if (routePath === "/feedback-admin") {
    // The seed ships no product feedback, so the list settles on its empty state.
    await expect(page.getByText("暂无产品反馈")).toBeVisible({ timeout });
  }
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

    const hasOwnAffordance = (element: Element) => {
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
      return borderVisible || hasBackground || hasShadow;
    };

    /** Nested search fields put chrome on the wrapper (e.g. `.parameters-table-search`). */
    const hasAncestorAffordance = (element: Element) => {
      let current = element.parentElement;
      let depth = 0;
      while (current && current !== main && depth < 4) {
        if (hasOwnAffordance(current)) return true;
        current = current.parentElement;
        depth += 1;
      }
      return false;
    };

    const failures: string[] = [];
    const controls = main.querySelectorAll("input:not([type='hidden']), select, textarea");

    for (const control of controls) {
      const element = control as HTMLInputElement;
      if (!element.offsetParent) {
        continue;
      }

      const inputType = (element.getAttribute("type") ?? "text").toLowerCase();
      // Native checkbox/radio already have platform chrome; do not require CSS borders.
      if (inputType === "checkbox" || inputType === "radio") {
        continue;
      }

      if (!hasOwnAffordance(element) && !hasAncestorAffordance(element)) {
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
