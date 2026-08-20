import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const script = path.resolve("ops/self-hosted/scripts/observability");

describe("self-hosted observability operator entry", () => {
  it("documents the complete lifecycle without requiring Docker", () => {
    const result = spawnSync("bash", [script, "help"], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: observability <up|down|restart|status|logs>");
    expect(result.stdout).toContain("127.0.0.1");
    expect(result.stdout).toContain("SSH tunnel");
  });

  it("rejects unknown actions before invoking Compose", () => {
    const result = spawnSync("bash", [script, "destroy"], { encoding: "utf8" });

    expect(result.status).toBe(64);
    expect(result.stderr).toContain("Unknown action: destroy");
  });
});
