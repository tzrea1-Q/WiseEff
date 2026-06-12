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

export async function openAgentPanel(page: Page) {
  await page.getByRole("button", { name: "打开 WiseAgent" }).click();
  const panel = page.locator(".agent-panel");
  await expect(panel).toBeVisible();
  return panel;
}

export function stableMasks(page: Page, routePath = ""): Locator[] {
  const masks = [
    page.locator(".topbar-user-menu"),
    page.locator(".agent-panel .agent-message"),
    page.locator(".agent-panel .agent-context"),
    page.locator(".agent-panel .agent-toolbar"),
    page.locator(".operation-history-list"),
    page.locator(".audit-column"),
    page.locator(".review-detail"),
    page.locator("[aria-live]")
  ];

  if (routePath === "/parameters") {
    masks.push(page.locator(".parameters-table-grid tbody"));
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
