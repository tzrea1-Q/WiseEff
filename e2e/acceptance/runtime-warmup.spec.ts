import { test } from "playwright/test";
import { ACCEPTANCE_WARMUP_ROUTES, warmPlaywrightFrontend } from "../shared/runtimeWarmup";

test("warm vite entry graph before acceptance specs", async ({ page }) => {
  test.setTimeout(120_000);
  await warmPlaywrightFrontend(page, ACCEPTANCE_WARMUP_ROUTES);
});
