import { test } from "playwright/test";
import { QUALITY_WARMUP_ROUTES, warmPlaywrightFrontend } from "../shared/runtimeWarmup";

test("warm vite entry graph before quality specs", async ({ page }) => {
  test.setTimeout(120_000);
  await warmPlaywrightFrontend(page, QUALITY_WARMUP_ROUTES);
});
