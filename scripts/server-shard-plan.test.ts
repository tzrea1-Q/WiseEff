import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { balanceServerShards, orderServerFiles, serverDurationsFromReport } from "./server-shard-plan";

describe("duration-balanced backend ownership", () => {
  it("defaults to three complete, disjoint backend owners", () => {
    const files = ["a", "b", "c", "d", "e", "f"].map((name) => `server/${name}.test.ts`);
    const plan = balanceServerShards(files);
    expect(plan).toHaveLength(3);
    expect(plan.map((shard) => shard.files.length)).toEqual([2, 2, 2]);
    expect(plan.flatMap((shard) => shard.files).sort()).toEqual(files);
  });
  it("runs long files first without changing the inventory, with conservative unknown weights and deterministic ties", () => {
    const files = ["server/d.test.ts", "server/b.test.ts", "server/a.test.ts", "server/c.test.ts"];
    const durations = { "server/a.test.ts": 90, "server/b.test.ts": 80, "server/c.test.ts": 80, "server/d.test.ts": 10 };
    expect(orderServerFiles([])).toEqual([]);
    expect(orderServerFiles(files, durations)).toEqual(["server/a.test.ts", "server/b.test.ts", "server/c.test.ts", "server/d.test.ts"]);
    expect(orderServerFiles([...files].reverse(), durations)).toEqual(orderServerFiles(files, durations));
    expect(files).toEqual(["server/d.test.ts", "server/b.test.ts", "server/a.test.ts", "server/c.test.ts"]);
    expect(orderServerFiles([...files, "server/new.test.ts", "server/zero.test.ts"], { ...durations, "server/zero.test.ts": 0 }))
      .toEqual(["server/a.test.ts", "server/new.test.ts", "server/zero.test.ts", "server/b.test.ts", "server/c.test.ts", "server/d.test.ts"]);
    expect(() => orderServerFiles(["server/a.test.ts", "server/a.test.ts"], durations)).toThrow();
    expect(() => orderServerFiles(files, { "server/a.test.ts": -1 })).toThrow();
  });

  it("balances whole files deterministically and covers new and zero-duration files exactly once", () => {
    const durations = { "server/a.test.ts": 90, "server/b.test.ts": 80, "server/c.test.ts": 20, "server/d.test.ts": 10 };
    const files = Object.keys(durations);
    const plan = balanceServerShards(files, 2, durations);
    expect(plan).toEqual([
      { files: ["server/a.test.ts", "server/d.test.ts"], durationMs: 100 },
      { files: ["server/b.test.ts", "server/c.test.ts"], durationMs: 100 },
    ]);
    expect(balanceServerShards([...files].reverse(), 2, durations)).toEqual(plan);
    expect(plan.flatMap((shard) => shard.files).sort()).toEqual(files);
    const expanded = [...files, "server/new.test.ts", "server/zero.test.ts"];
    const fallback = balanceServerShards(expanded, 2, { ...durations, "server/zero.test.ts": 0 });
    expect(fallback.flatMap((shard) => shard.files).sort()).toEqual([...expanded].sort());
    expect(fallback.map((shard) => shard.durationMs)).toEqual([190, 190]);
    expect(balanceServerShards(files, 2, {}).map((shard) => shard.files.length)).toEqual([2, 2]);
  });

  it("rejects invalid inventories and weights instead of dropping coverage", () => {
    for (const files of [[], ["server/a.test.ts"], ["server/a.test.ts", "server/a.test.ts"], ["../server/a.test.ts", "server/b.test.ts"]]) {
      expect(() => balanceServerShards(files)).toThrow();
    }
    expect(() => balanceServerShards(["server/a.test.ts", "server/b.test.ts"], 2, { "server/a.test.ts": -1 })).toThrow();
    expect(() => balanceServerShards(["server/a.test.ts", "server/b.test.ts"], 2, { "server/a.test.ts": NaN })).toThrow();
  });

  it("refreshes portable weights from file wall duration, including failed runs and hooks", () => {
    const report = { testResults: [
      { name: "/repo/server/b.test.ts", startTime: 10, endTime: 60, status: "failed", assertionResults: [{ duration: 1 }] },
      { name: "/repo/server/a.test.ts", startTime: 20, endTime: 120, status: "passed", assertionResults: [{ duration: 2 }] },
    ] };
    expect(serverDurationsFromReport(report, "/repo")).toEqual({ "server/a.test.ts": 100, "server/b.test.ts": 50 });
    for (const invalid of [{ testResults: [] }, { testResults: [...report.testResults, report.testResults[0]] },
      { testResults: [{ name: "/foreign/server/a.test.ts", startTime: 0, endTime: 1 }] },
      { testResults: [{ name: "server/a.test.ts", startTime: 2, endTime: 1 }] },
      { testResults: [{ name: "server/a.test.ts", startTime: 0, endTime: "1" }] }]) {
      expect(() => serverDurationsFromReport(invalid, "/repo")).toThrow();
    }
  });

  it("refreshes the snapshot through the native CLI without modifying the repository", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "wiseeff-server-durations-"));
    try {
      for (const file of ["server-shard-plan.ts", "server-durations.json", "acceptance-shard-plan.ts", "acceptance-durations.json"]) {
        copyFileSync(path.resolve("scripts", file), path.join(directory, file));
      }
      const reportFile = path.join(directory, "report.json");
      writeFileSync(reportFile, JSON.stringify({ success: false, testResults: [{ name: "/coordinator/server/example.test.ts", startTime: 10, endTime: 30 }] }));
      execFileSync(process.execPath, ["--experimental-strip-types", path.join(directory, "server-shard-plan.ts"), "refresh", reportFile, "/coordinator"], { stdio: "pipe" });
      const snapshot = JSON.parse(readFileSync(path.join(directory, "server-durations.json"), "utf8"));
      expect(snapshot.fileDurationMs).toEqual({ "server/example.test.ts": 20 });
      expect(snapshot.source).toContain("success=false");
      expect(snapshot.source).toContain("sha256");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
