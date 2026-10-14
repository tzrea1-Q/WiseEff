import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import { runBrowserSeedScripts } from "./browser-seed-contract";

describe("browser seed contract", () => {
  it("migrates, resets transient data, installs the Catalog and seeds quality fixtures in order", () => {
    const scripts: string[] = [];
    runBrowserSeedScripts((script) => { scripts.push(script); });
    expect(scripts).toEqual(["db:migrate", "reset:quality-runtime", "db:seed:all", "seed:quality:admin-lists"]);
  });

  it("stops before subsequent seeds when a prerequisite fails", () => {
    const scripts: string[] = [];
    expect(() => runBrowserSeedScripts((script) => {
      scripts.push(script);
      if (script === "reset:quality-runtime") throw new Error("reset failed");
    })).toThrow("reset failed");
    expect(scripts).toEqual(["db:migrate", "reset:quality-runtime"]);
  });

  it("uses the same registered contract locally and in both CI browser lanes", async () => {
    vi.resetModules();
    vi.stubEnv("WISEEFF_QUALITY_SKIP_SEED", "false");
    try {
      const { seedQualityRuntime } = await import("../e2e/quality/helpers");
      const scripts: string[] = [];
      seedQualityRuntime((script) => { scripts.push(script); });
      expect(scripts).toEqual(["seed:browser"]);
      const workflow = YAML.parse(readFileSync(".github/workflows/ci.yml", "utf8"));
      for (const job of ["acceptance-quality-lanes", "acceptance-smoke"]) {
        const seed = workflow.jobs[job].steps.find((step: { name: string }) => step.name === "Migrate and seed database");
        expect(seed.run.split("\n")[0]).toBe("npm run seed:browser");
      }
      const manifest = JSON.parse(readFileSync("package.json", "utf8"));
      expect(manifest.scripts["seed:browser"]).toBe("tsx scripts/browser-seed-contract.ts");
    } finally { vi.unstubAllEnvs(); }
  });
});
