import { createHash, randomUUID } from "node:crypto";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, fstatSync: vi.fn(actual.fstatSync), readSync: vi.fn(actual.readSync) };
});

import { implementationRoot, SOURCE_PATHS, taskSpec } from "./run";
import { captureDirectoryIdentities, parseReportArgs, parseRunRecord, readOwned, readRecordedReport, renderRecordedReport, verifyDirectoryIdentities, type RecordedReport } from "./report";

const RUN_ID = "00000000-0000-4000-8000-000000000000";

function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }

function sourceDigest(entries: Array<[string, Buffer]>): string {
  const digest = createHash("sha256");
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(nameBytes.length));
    digest.update(length).update(nameBytes);
    length.writeBigUInt64BE(BigInt(data.length));
    digest.update(length).update(data);
  }
  return digest.digest("hex");
}

function forgedRecord(directory: string): Record<string, unknown> {
  const sources = SOURCE_PATHS.map((relative) => [relative, readFileSync(path.join(implementationRoot, relative))] as [string, Buffer]);
  const spec = taskSpec("ci-changed-paths");
  const files = spec.files.map((file) => path.join(implementationRoot, file));
  const vitest = path.join(implementationRoot, "node_modules/vitest/vitest.mjs");
  const common = ["--config", path.join(implementationRoot, spec.config), ...files];
  const phase = { startedAt: new Date(0).toISOString(), finishedAt: new Date(1).toISOString(), wallMs: 1, exitCode: 0, signal: null, stdoutBytes: 0, stderrBytes: 0, lifecycleSettled: true };
  const nativeBytes = Buffer.from("{\"forged\":true}\n");
  return {
    schemaVersion: 1,
    complete: true,
    scope: "fresh-local-feedback",
    runId: path.basename(directory),
    root: implementationRoot,
    taskId: "ci-changed-paths",
    acceptedBase: "a".repeat(40),
    head: "b".repeat(40),
    tree: "c".repeat(40),
    executedSha: "d".repeat(40),
    headTree: "e".repeat(40),
    sourceDigest: sourceDigest(sources),
    sourceFiles: sources.map(([file, data]) => ({ path: file, bytes: data.length, sha256: sha256(data) })),
    policyDigest: "f".repeat(64),
    nodeVersion: process.version,
    dependencies: { packageVersion: "0.1.0", vitestVersion: "4.1.5", packageJsonSha256: "1".repeat(64), vitestPackageSha256: "2".repeat(64), vitestEntrySha256: "3".repeat(64) },
    childEnvRuntimeMode: "api",
    testConfigRuntimeMode: null,
    discoveryArgv: [vitest, "list", "--filesOnly", "--json", ...common],
    runArgv: [vitest, "run", ...common, "--reporter=default", "--reporter=json", `--outputFile=${path.join(directory, "native-report.json")}`],
    discovery: phase,
    execution: phase,
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(1).toISOString(),
    wallMs: 1,
    activityBudgetMs: 1,
    exitCode: 0,
    signal: null,
    native: { discoveredFiles: files, files: 1, passed: 1, skipped: 0, reportSha256: sha256(nativeBytes) },
    logs: { stdoutSha256: sha256(Buffer.alloc(0)), stderrSha256: sha256(Buffer.alloc(0)), stdoutBytes: 0, stderrBytes: 0 },
    claimedStatus: "passed",
    error: null,
    memo: "disabled",
    acceptancePending: true,
    tokenUsage: null,
  };
}

function validRecord(discovery: Record<string, unknown> = phase()): Record<string, unknown> {
  const spec = taskSpec("ci-changed-paths");
  const files = spec.files.map((file) => `${implementationRoot}/${file}`);
  const argv = ["/repo/vitest.mjs", "list", "--filesOnly", "--json"];
  return {
    schemaVersion: 1,
    complete: true,
    scope: "fresh-local-feedback",
    runId: RUN_ID,
    root: implementationRoot,
    taskId: "ci-changed-paths",
    acceptedBase: "a".repeat(40),
    head: "b".repeat(40),
    tree: "c".repeat(40),
    executedSha: "d".repeat(40),
    headTree: "e".repeat(40),
    sourceDigest: "f".repeat(64),
    sourceFiles: SOURCE_PATHS.map((path) => ({ path, bytes: 1, sha256: "0".repeat(64) })),
    policyDigest: "1".repeat(64),
    nodeVersion: "v22.0.0",
    dependencies: { packageVersion: "0.1.0", vitestVersion: "4.1.5", packageJsonSha256: "2".repeat(64), vitestPackageSha256: "3".repeat(64), vitestEntrySha256: "4".repeat(64) },
    childEnvRuntimeMode: "mock",
    testConfigRuntimeMode: null,
    discoveryArgv: argv,
    runArgv: [...argv, "run"],
    discovery,
    execution: phase(),
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(1).toISOString(),
    wallMs: 1,
    activityBudgetMs: 1,
    exitCode: 0,
    signal: null,
    native: { discoveredFiles: files, files: 1, passed: 1, skipped: 0, reportSha256: "5".repeat(64) },
    logs: { stdoutSha256: "6".repeat(64), stderrSha256: "7".repeat(64), stdoutBytes: 0, stderrBytes: 0 },
    claimedStatus: "passed",
    error: null,
    memo: "disabled",
    acceptancePending: true,
    tokenUsage: null,
  };
}

function phase(): Record<string, unknown> {
  return { startedAt: new Date(0).toISOString(), finishedAt: new Date(1).toISOString(), wallMs: 1, exitCode: 0, signal: null, stdoutBytes: 0, stderrBytes: 0, lifecycleSettled: true };
}

function reportDirectory(prefix: string): string {
  const parent = path.join(implementationRoot, "work", "verification-runs");
  if (!fs.existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o755 });
  const stat = fs.lstatSync(parent);
  const uid = process.getuid?.();
  if (!stat.isDirectory() || stat.isSymbolicLink() || (uid !== undefined && stat.uid !== uid) || (stat.mode & 0o777) !== 0o755) throw new Error("UNSAFE_TEST_RUN_DIRECTORY");
  return mkdtempSync(path.join(parent, prefix));
}

describe("recorded local verification report", () => {
  it("accepts only a strict UUID run selector", () => {
    expect(parseReportArgs(["--run", "00000000-0000-4000-8000-000000000000"])).toEqual({
      runId: "00000000-0000-4000-8000-000000000000",
    });
    expect(() => parseReportArgs(["--run", RUN_ID, "--run", RUN_ID])).toThrow("DUPLICATE_ARGUMENT");
    expect(() => parseReportArgs(["--run", "../record.json"])).toThrow("INVALID_ARGUMENTS");
    expect(() => parseReportArgs(["--run", "00000000-0000-4000-8000-000000000000", "--fresh"])).toThrow("INVALID_ARGUMENTS");
  });

  it("labels a readable record as unverified data", () => {
    const report: RecordedReport = {
      version: 1,
      status: "record-readable",
      scope: "recorded-local-data",
      freshness: "unverified",
      acceptancePending: true,
      memo: "disabled",
      tokenUsage: null,
      runId: "00000000-0000-4000-8000-000000000000",
      taskId: "ci-changed-paths",
      claimedStatus: "passed",
      sourceSha: "a".repeat(40),
      tree: "b".repeat(40),
      sourceDigest: "c".repeat(64),
      native: { files: 1, passed: 8, skipped: 0 },
      observed: { startedAt: new Date(0).toISOString(), finishedAt: new Date(1).toISOString(), wallMs: 1, exitCode: 0, signal: null },
    };
    const output = JSON.parse(renderRecordedReport(report));
    expect(output.status).toBe("record-readable");
    expect(output.scope).toBe("recorded-local-data");
    expect(output.freshness).toBe("unverified");
    expect(output.claimedStatus).toBe("passed");
  });

  it("validates nested phase fields instead of trusting their shape", () => {
    const malformed = validRecord({ ...phase(), extra: "forged" });
    expect(() => parseRunRecord(malformed, RUN_ID)).toThrow("RECORD_SCHEMA");
  });

  it("keeps a self-consistent green claim visibly unverified", () => {
    const output = JSON.parse(renderRecordedReport({
      version: 1,
      status: "record-readable",
      scope: "recorded-local-data",
      freshness: "unverified",
      acceptancePending: true,
      memo: "disabled",
      tokenUsage: null,
      runId: RUN_ID,
      taskId: "ci-changed-paths",
      claimedStatus: "passed",
      sourceSha: "a".repeat(40),
      tree: "b".repeat(40),
      sourceDigest: "c".repeat(64),
      native: { files: 1, passed: 1, skipped: 0 },
      observed: { startedAt: new Date(0).toISOString(), finishedAt: new Date(1).toISOString(), wallMs: 1, exitCode: 0, signal: null },
    }));
    expect(output.claimedStatus).toBe("passed");
    expect(output.status).toBe("record-readable");
    expect(output.freshness).toBe("unverified");
  });

  it("reads the native file through one owned descriptor and rejects a mode change", () => {
    const directory = reportDirectory("eff04-report-");
    const file = path.join(directory, "native-report.json");
    try {
      writeFileSync(file, "{\"ok\":true}\n", { mode: 0o600 });
      expect(readOwned(file, 1024, 0o600)).toEqual(Buffer.from("{\"ok\":true}\n"));
      const hardlink = path.join(directory, "native-report-hardlink.json");
      linkSync(file, hardlink);
      expect(() => readOwned(file, 1024, 0o600)).toThrow("REPORT_FILE");
      unlinkSync(hardlink);
      chmodSync(file, 0o644);
      expect(() => readOwned(file, 1024, 0o600)).toThrow("REPORT_FILE");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a group/world-writable root snapshot and changed ancestor mode", () => {
    const root = reportDirectory("eff04-root-");
    const child = path.join(root, "child");
    try {
      mkdirSync(child, { mode: 0o755 });
      chmodSync(root, 0o777);
      expect(() => captureDirectoryIdentities(root, child, new Map([[root, 0o755]]))).toThrow("REPORT_FILE");
      chmodSync(root, 0o755);
      const observations = captureDirectoryIdentities(root, child, new Map([[root, 0o755]]));
      chmodSync(root, 0o700);
      expect(() => verifyDirectoryIdentities(observations)).toThrow("REPORT_CHANGED");
    } finally {
      chmodSync(root, 0o700);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads a self-consistent forged record only as unverified recorded data", () => {
    const runId = randomUUID();
    const directory = path.join(implementationRoot, "work", "verification-runs", runId);
    const nativeBytes = Buffer.from("{\"forged\":true}\n");
    try {
      mkdirSync(directory, { mode: 0o700 });
      writeFileSync(path.join(directory, "record.json"), `${JSON.stringify(forgedRecord(directory))}\n`, { mode: 0o600 });
      writeFileSync(path.join(directory, "stdout.log"), "", { mode: 0o600 });
      writeFileSync(path.join(directory, "stderr.log"), "", { mode: 0o600 });
      writeFileSync(path.join(directory, "native-report.json"), nativeBytes, { mode: 0o600 });
      const report = readRecordedReport(runId);
      expect(report.status).toBe("record-readable");
      expect(report.scope).toBe("recorded-local-data");
      expect(report.freshness).toBe("unverified");
      expect(report.claimedStatus).toBe("passed");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects oversize and uid changes through the real descriptor checks", () => {
    const directory = reportDirectory("eff04-read-checks-");
    const file = path.join(directory, "native-report.json");
    try {
      writeFileSync(file, "0123456789", { mode: 0o600 });
      expect(() => readOwned(file, 4, 0o600)).toThrow("REPORT_FILE");
      const fstatMock = fs.fstatSync as unknown as { getMockImplementation: () => typeof fs.fstatSync; mockImplementation: (implementation: typeof fs.fstatSync) => void };
      const originalFstat = fstatMock.getMockImplementation()!;
      const targetInode = fs.lstatSync(file).ino;
      fstatMock.mockImplementation(((fd: number) => {
        const stat = originalFstat(fd);
        return stat.ino === targetInode
          ? Object.assign({}, stat, { uid: stat.uid + 1, isFile: stat.isFile.bind(stat), isSymbolicLink: stat.isSymbolicLink.bind(stat) })
          : stat;
      }) as typeof fs.fstatSync);
      try { expect(() => readOwned(file, 1024, 0o600)).toThrow("REPORT_FILE"); }
      finally { fstatMock.mockImplementation(originalFstat); }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("rejects an active leaf replacement after a delegated fd read", () => {
    const directory = reportDirectory("eff04-leaf-race-");
    const file = path.join(directory, "native-report.json");
    const moved = `${file}.original`;
    try {
      writeFileSync(file, "{\"ok\":true}\n", { mode: 0o600 });
      const readMock = fs.readSync as unknown as { getMockImplementation: () => typeof fs.readSync; mockImplementation: (implementation: typeof fs.readSync) => void };
      const originalRead = readMock.getMockImplementation()!;
      let raced = false;
      readMock.mockImplementation(((fd: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
        const bytes = originalRead(fd, buffer, offset, length, position);
        if (!raced) { raced = true; renameSync(file, moved); writeFileSync(file, "foreign\n", { mode: 0o600 }); }
        return bytes;
      }) as typeof fs.readSync);
      try { expect(() => readOwned(file, 1024, 0o600)).toThrow("REPORT_CHANGED"); }
      finally { readMock.mockImplementation(originalRead); }
      expect(readFileSync(file, "utf8")).toBe("foreign\n");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("rejects an active ancestor replacement after a delegated fd read", () => {
    const root = reportDirectory("eff04-ancestor-race-");
    const ancestor = path.join(root, "child");
    const file = path.join(ancestor, "native-report.json");
    const moved = `${ancestor}.original`;
    try {
      mkdirSync(ancestor, { mode: 0o700 });
      writeFileSync(file, "{\"ok\":true}\n", { mode: 0o600 });
      const readMock = fs.readSync as unknown as { getMockImplementation: () => typeof fs.readSync; mockImplementation: (implementation: typeof fs.readSync) => void };
      const originalRead = readMock.getMockImplementation()!;
      let raced = false;
      readMock.mockImplementation(((fd: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
        const bytes = originalRead(fd, buffer, offset, length, position);
        if (!raced) {
          raced = true;
          renameSync(ancestor, moved);
          mkdirSync(ancestor, { mode: 0o700 });
          writeFileSync(file, "foreign\n", { mode: 0o600 });
        }
        return bytes;
      }) as typeof fs.readSync);
      try { expect(() => readOwned(file, 1024, 0o600)).toThrow("REPORT_CHANGED"); }
      finally { readMock.mockImplementation(originalRead); }
      expect(readFileSync(file, "utf8")).toBe("foreign\n");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
