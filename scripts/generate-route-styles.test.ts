import { execFileSync } from "node:child_process";
import { it } from "vitest";

it("keeps the generated entry styles in sync with the route graph", () => {
  execFileSync(process.execPath, ["--import", "tsx", "scripts/generate-route-styles.ts", "--check"], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 180_000,
  });
}, 180_000);
