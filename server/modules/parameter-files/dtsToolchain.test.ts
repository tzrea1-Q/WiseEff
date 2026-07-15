import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDtsToolchainRunner,
  loadPinnedToolchainVersions,
  type DtsToolchainConfigSet,
  type DtsToolchainProbe
} from "./dtsToolchain";

type FakeChild = ChildProcess & {
  stdoutEmitter: EventEmitter;
  stderrEmitter: EventEmitter;
};

function createFakeChild(): FakeChild {
  const proc = new EventEmitter() as unknown as FakeChild;
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  proc.stdoutEmitter = stdoutEmitter;
  proc.stderrEmitter = stderrEmitter;
  (proc as unknown as { stdout: EventEmitter }).stdout = stdoutEmitter;
  (proc as unknown as { stderr: EventEmitter }).stderr = stderrEmitter;
  (proc as unknown as { kill: (signal?: string) => void }).kill = vi.fn(() => {
    proc.emit("close", null);
  });
  return proc;
}

function fakeSpawnScript(
  handler: (command: string, args: string[]) => { stdout?: string; stderr?: string; code?: number; hang?: boolean }
): typeof nodeSpawn {
  return ((command: string, args: readonly string[] = []) => {
    const plan = handler(command, [...args]);
    const proc = createFakeChild();
    if (plan.hang) {
      return proc;
    }
    setImmediate(() => {
      if (plan.stdout) proc.stdoutEmitter.emit("data", Buffer.from(plan.stdout));
      if (plan.stderr) proc.stderrEmitter.emit("data", Buffer.from(plan.stderr));
      proc.emit("close", plan.code ?? 0);
    });
    return proc;
  }) as unknown as typeof nodeSpawn;
}

const tmpDirsCreated: string[] = [];
function trackingTmpDirFactory(): string {
  const dir = mkdtempSync(join(tmpdir(), "dts-toolchain-test-"));
  tmpDirsCreated.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirsCreated.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const BASE_DTS = `/dts-v1/;

/ {
	compatible = "wiseeff,test";
	model = "toolchain-fixture";
	amba: amba {
		compatible = "wiseeff,amba";
	};
};
`;

const OVERLAY_DTS = `/dts-v1/;
/plugin/;

&amba {
	status = "okay";
};
`;

function happyConfigSet(overrides: Partial<DtsToolchainConfigSet> = {}): DtsToolchainConfigSet {
  return {
    entryFile: "board.dts",
    includeSearchPaths: [],
    overlayOrder: ["power.dtso"],
    files: new Map([
      ["board.dts", { content: BASE_DTS }],
      ["power.dtso", { content: OVERLAY_DTS }]
    ]),
    ...overrides
  };
}

function pinnedProbe(overrides: Partial<DtsToolchainProbe> = {}): DtsToolchainProbe {
  return {
    dtc: { path: "dtc", version: "1.8.1" },
    fdtoverlay: { path: "fdtoverlay", version: "1.8.1" },
    dtschema: { path: "dt-validate", version: "2026.6" },
    ...overrides
  };
}

describe("loadPinnedToolchainVersions", () => {
  it("loads the pinned dtc commit and dtschema version", () => {
    const pinned = loadPinnedToolchainVersions();
    expect(pinned).toEqual({
      dtc: { version: "1.8.1", commit: "8f48565e5cfedc74d3f7512f1e0188e9d85dc1de" },
      dtschema: "2026.6"
    });
  });
});

describe("createDtsToolchainRunner", () => {
  it("compiles base+overlay, runs dt-validate, and returns artifact hashes in release mode", async () => {
    const spawnFn = fakeSpawnScript((command, args) => {
      if (command === "dtc" && args.includes("-O") && args.includes("dtb")) {
        const outIdx = args.indexOf("-o");
        const outPath = args[outIdx + 1];
        writeFileSync(outPath, Buffer.from(`dtb:${args.at(-1)}`));
        return { code: 0 };
      }
      if (command === "fdtoverlay") {
        const outIdx = args.indexOf("-o");
        writeFileSync(args[outIdx + 1], Buffer.from("effective-dtb-bytes"));
        return { code: 0 };
      }
      if (command === "dt-validate") {
        return { code: 0, stdout: "" };
      }
      return { code: 1, stderr: `unexpected ${command}` };
    });

    const runner = createDtsToolchainRunner({
      spawnFn,
      probeTools: async () => pinnedProbe(),
      tmpDirFactory: trackingTmpDirFactory
    });

    const result = await runner.validate(happyConfigSet(), { mode: "release" });
    expect(result).toMatchObject({
      ok: true,
      compiler: { dtc: "1.8.1", fdtoverlay: "1.8.1", dtschema: "2026.6" }
    });
    expect(result.artifacts.effectiveDtbSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.artifacts.effectiveDtbSha256).toBe(
      createHash("sha256").update(Buffer.from("effective-dtb-bytes")).digest("hex")
    );
  });

  it("fails closed in release mode when any toolchain binary is missing", async () => {
    const runner = createDtsToolchainRunner({
      spawnFn: fakeSpawnScript(() => ({ code: 0 })),
      probeTools: async () =>
        pinnedProbe({
          dtschema: { path: null, version: null }
        }),
      tmpDirFactory: trackingTmpDirFactory
    });

    const result = await runner.validate(happyConfigSet(), { mode: "release" });
    expect(result.ok).toBe(false);
    expect(result.failureCode).toBe("toolchain-unavailable");
    expect(result.compiler.dtschema).toBeNull();
  });

  it("allows warn/off local diagnostics when tools are missing but release does not", async () => {
    const runner = createDtsToolchainRunner({
      spawnFn: fakeSpawnScript(() => ({ code: 0 })),
      probeTools: async () =>
        pinnedProbe({
          dtc: { path: null, version: null },
          fdtoverlay: { path: null, version: null },
          dtschema: { path: null, version: null }
        }),
      tmpDirFactory: trackingTmpDirFactory
    });

    const warn = await runner.validate(happyConfigSet(), { mode: "warn" });
    expect(warn.ok).toBe(true);
    expect(warn.failureCode).toBe("toolchain-unavailable");

    const off = await runner.validate(happyConfigSet(), { mode: "off" });
    expect(off.ok).toBe(true);
    expect(off.diagnostics.some((d) => d.message.includes("mode=off"))).toBe(true);

    const release = await runner.validate(happyConfigSet(), { mode: "release" });
    expect(release.ok).toBe(false);
    expect(release.failureCode).toBe("toolchain-unavailable");
  });

  it("times out hung toolchain processes", async () => {
    const runner = createDtsToolchainRunner({
      spawnFn: fakeSpawnScript(() => ({ hang: true })),
      probeTools: async () => pinnedProbe(),
      tmpDirFactory: trackingTmpDirFactory
    });

    const result = await runner.validate(happyConfigSet(), { mode: "release", timeoutMs: 50 });
    expect(result.ok).toBe(false);
    expect(result.failureCode).toBe("timeout");
    expect(result.diagnostics.some((d) => /timed out/i.test(d.message))).toBe(true);
  });

  it("rejects path escape in logical file names", async () => {
    const runner = createDtsToolchainRunner({
      spawnFn: fakeSpawnScript(() => ({ code: 0 })),
      probeTools: async () => pinnedProbe(),
      tmpDirFactory: trackingTmpDirFactory
    });

    const result = await runner.validate(
      happyConfigSet({
        entryFile: "../escape.dts",
        files: new Map([["../escape.dts", { content: BASE_DTS }]]),
        overlayOrder: []
      }),
      { mode: "release" }
    );

    expect(result.ok).toBe(false);
    expect(result.failureCode).toBe("path-escape");
  });

  it("rejects invalid overlay order entries missing from the manifest", async () => {
    const runner = createDtsToolchainRunner({
      spawnFn: fakeSpawnScript(() => ({ code: 0 })),
      probeTools: async () => pinnedProbe(),
      tmpDirFactory: trackingTmpDirFactory
    });

    const result = await runner.validate(
      happyConfigSet({
        overlayOrder: ["missing.dtso"]
      }),
      { mode: "release" }
    );

    expect(result.ok).toBe(false);
    expect(result.failureCode).toBe("overlay-order");
  });

  it("surfaces dt-schema errors as release failures", async () => {
    const spawnFn = fakeSpawnScript((command, args) => {
      if (command === "dtc") {
        const outIdx = args.indexOf("-o");
        writeFileSync(args[outIdx + 1], Buffer.from("dtb"));
        return { code: 0 };
      }
      if (command === "fdtoverlay") {
        const outIdx = args.indexOf("-o");
        writeFileSync(args[outIdx + 1], Buffer.from("effective"));
        return { code: 0 };
      }
      if (command === "dt-validate") {
        return {
          code: 1,
          stderr: "effective.dtb: /: 'compatible' is a required property\n"
        };
      }
      return { code: 1, stderr: "unexpected" };
    });

    const runner = createDtsToolchainRunner({
      spawnFn,
      probeTools: async () => pinnedProbe(),
      tmpDirFactory: trackingTmpDirFactory
    });

    const result = await runner.validate(happyConfigSet(), { mode: "release" });
    expect(result.ok).toBe(false);
    expect(result.failureCode).toBe("schema-failed");
    expect(result.diagnostics.some((d) => d.severity === "error" && /compatible/i.test(d.message))).toBe(true);
  });

  it("keeps warning-policy soft under warn mode while release still fails on schema errors", async () => {
    const spawnFn = fakeSpawnScript((command, args) => {
      if (command === "dtc") {
        const outIdx = args.indexOf("-o");
        writeFileSync(args[outIdx + 1], Buffer.from("dtb"));
        return { code: 0, stderr: "board.dts:1.1-2: Warning (unit_address_vs_reg): demo\n" };
      }
      if (command === "fdtoverlay") {
        const outIdx = args.indexOf("-o");
        writeFileSync(args[outIdx + 1], Buffer.from("effective"));
        return { code: 0 };
      }
      if (command === "dt-validate") {
        return { code: 1, stderr: "schema boom\n" };
      }
      return { code: 1 };
    });

    const runner = createDtsToolchainRunner({
      spawnFn,
      probeTools: async () => pinnedProbe(),
      tmpDirFactory: trackingTmpDirFactory
    });

    const warn = await runner.validate(happyConfigSet(), { mode: "warn" });
    expect(warn.ok).toBe(true);
    expect(warn.diagnostics.some((d) => d.severity === "warning")).toBe(true);

    const release = await runner.validate(happyConfigSet(), { mode: "release" });
    expect(release.ok).toBe(false);
  });
});

describe("real dts toolchain (optional)", () => {
  it(
    "validates a tiny base+overlay set when host tools are present",
    async () => {
    const runner = createDtsToolchainRunner();
    const probe = await runner.probe();
    if (!probe.dtc.path || !probe.fdtoverlay.path || !probe.dtschema.path) {
      return;
    }

    const result = await runner.validate(happyConfigSet(), { mode: "release" });
    // Seed-like fixtures often fail vendor schema checks; accept compile success
    // when dt-validate only reports schema diagnostics without process failure.
    expect(result.compiler.dtc).toBeTruthy();
    expect(result.artifacts.effectiveDtbSha256 ?? "").toMatch(/^[a-f0-9]{64}$|^$/);
    if (result.failureCode === "schema-failed") {
      expect(result.ok).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    } else {
      expect(result.ok).toBe(true);
      expect(result.artifacts.effectiveDtbSha256).toMatch(/^[a-f0-9]{64}$/);
    }
    },
    30_000
  );
});
