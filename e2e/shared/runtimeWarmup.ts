/** Routes visited before quality specs so Vite compiles the entry graph during warmup. */
export const QUALITY_WARMUP_ROUTES = ["/", "/logs"] as const;

/** Routes visited before acceptance specs so Vite compiles the entry graph during warmup. */
export const ACCEPTANCE_WARMUP_ROUTES = ["/"] as const;

export type WarmupPage = {
  goto: (route: string, options?: { waitUntil?: "domcontentloaded" }) => Promise<unknown>;
  locator: (selector: string) => { waitFor: (options?: { state?: "visible" }) => Promise<void> };
};

/** Load each route in a real browser so Vite transforms JS before product specs start. */
export async function warmPlaywrightFrontend(
  page: WarmupPage,
  routes: readonly string[]
): Promise<void> {
  for (const route of routes) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await page.locator("body").waitFor({ state: "visible" });
  }
}
