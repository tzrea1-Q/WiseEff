import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  captureGate0SourceOutputs,
  restoreAndArchiveGate0SourceOutputs,
  stageGate0VisualBaselines,
} from "./gate0-source-outputs";

const pngFixture = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("deterministic-baseline"),
]);

function createCommittedVisualBaseline(worktreeRoot: string, platform = "darwin") {
  const canonicalRoot = path.join(
    worktreeRoot,
    "e2e",
    "quality",
    "visual.quality.spec.ts-snapshots",
    platform,
  );
  mkdirSync(canonicalRoot, { recursive: true });
  writeFileSync(path.join(canonicalRoot, "home-shell.png"), pngFixture);
  execFileSync("git", ["init", "-q"], { cwd: worktreeRoot });
  execFileSync("git", ["config", "user.email", "gate0@example.invalid"], { cwd: worktreeRoot });
  execFileSync("git", ["config", "user.name", "Gate0 Test"], { cwd: worktreeRoot });
  execFileSync("git", ["add", "."], { cwd: worktreeRoot });
  execFileSync("git", ["commit", "-qm", "baseline"], { cwd: worktreeRoot });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktreeRoot, encoding: "utf8" }).trim();
}

describe("Gate0 source-worktree outputs", () => {
  it("stages byte-exact visual baselines from the fixed source commit before the visual phase", async () => {
    const worktreeRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-baseline-"));
    const runRoot = path.join(worktreeRoot, "test-results", "owned-run");
    mkdirSync(runRoot, { recursive: true });
    const sourceCommit = createCommittedVisualBaseline(worktreeRoot);
    const canonical = path.join(
      worktreeRoot,
      "e2e",
      "quality",
      "visual.quality.spec.ts-snapshots",
      "darwin",
      "home-shell.png",
    );

    const manifestPath = await stageGate0VisualBaselines({
      worktreeRoot,
      runRoot,
      sourceCommit,
      platform: "darwin",
    });
    const staged = path.join(runRoot, "artifacts", "visual", "snapshots", "darwin", "home-shell.png");

    expect(readFileSync(staged)).toEqual(pngFixture);
    expect(readFileSync(canonical)).toEqual(pngFixture);
    expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toMatchObject({
      kind: "wiseeff-gate0-visual-baselines",
      sourceCommit,
      platform: "darwin",
      files: [{ relativePath: "home-shell.png" }],
    });
  });

  it("refuses to overwrite a non-empty run-owned snapshot root", async () => {
    const worktreeRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-baseline-existing-"));
    const runRoot = path.join(worktreeRoot, "test-results", "owned-run");
    const target = path.join(runRoot, "artifacts", "visual", "snapshots", "darwin");
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "forensic.png"), pngFixture);
    const sourceCommit = createCommittedVisualBaseline(worktreeRoot);

    await expect(stageGate0VisualBaselines({
      worktreeRoot,
      runRoot,
      sourceCommit,
      platform: "darwin",
    })).rejects.toThrow(/snapshot root.*empty/i);
    expect(readFileSync(path.join(target, "forensic.png"))).toEqual(pngFixture);
  });

  it("refuses a symlinked run-owned snapshot target", async () => {
    const worktreeRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-baseline-link-"));
    const runRoot = path.join(worktreeRoot, "test-results", "owned-run");
    const outside = path.join(worktreeRoot, "outside");
    const snapshots = path.join(runRoot, "artifacts", "visual", "snapshots");
    mkdirSync(path.dirname(snapshots), { recursive: true });
    mkdirSync(outside);
    symlinkSync(outside, snapshots);
    const sourceCommit = createCommittedVisualBaseline(worktreeRoot);

    await expect(stageGate0VisualBaselines({
      worktreeRoot,
      runRoot,
      sourceCommit,
      platform: "darwin",
    })).rejects.toThrow(/symlink/i);
    expect(existsSync(path.join(outside, "darwin", "home-shell.png"))).toBe(false);
  });

  it("restores exact pre-run bytes but retains and reports an unknown concurrent file", () => {
    const worktreeRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-source-"));
    const runRoot = path.join(worktreeRoot, "test-results", "owned-run");
    const snapshotsRoot = path.join(worktreeRoot, "e2e", "quality", "snapshots");
    const generatedDoc = path.join(worktreeRoot, "docs", "generated", "evidence.md");
    mkdirSync(snapshotsRoot, { recursive: true });
    mkdirSync(path.dirname(generatedDoc), { recursive: true });
    mkdirSync(runRoot, { recursive: true });
    writeFileSync(path.join(snapshotsRoot, "existing.png"), "pre-run-image");
    writeFileSync(generatedDoc, "pre-run-doc\n");

    const snapshot = captureGate0SourceOutputs({
      worktreeRoot,
      runRoot,
      directFiles: ["docs/generated/evidence.md"],
      recursiveRoots: ["e2e/quality/snapshots"],
    });
    writeFileSync(path.join(snapshotsRoot, "existing.png"), "changed-image");
    writeFileSync(path.join(snapshotsRoot, "created.png"), "created-image");
    writeFileSync(generatedDoc, "changed-doc\n");

    expect(() => restoreAndArchiveGate0SourceOutputs(snapshot)).toThrow(/unknown source-output/i);

    expect(readFileSync(path.join(snapshotsRoot, "existing.png"), "utf8")).toBe("pre-run-image");
    expect(readFileSync(generatedDoc, "utf8")).toBe("pre-run-doc\n");
    expect(existsSync(path.join(snapshotsRoot, "created.png"))).toBe(true);
    expect(
      readFileSync(
        path.join(runRoot, "artifacts", "source-worktree-output", "e2e", "quality", "snapshots", "created.png"),
        "utf8",
      ),
    ).toBe("created-image");
    const manifest = JSON.parse(readFileSync(path.join(runRoot, "source-worktree-output-manifest.json"), "utf8")) as {
      files: Array<{ relativePath: string; existedBefore: boolean; action: string }>;
    };
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: "e2e/quality/snapshots/created.png", existedBefore: false, action: "retained-unknown" }),
        expect.objectContaining({ relativePath: "docs/generated/evidence.md", existedBefore: true, action: "restored" }),
      ]),
    );
  });

  it("refuses a symlink in a watched root without removing its target", () => {
    const worktreeRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-source-link-"));
    const runRoot = path.join(worktreeRoot, "test-results", "owned-run");
    const watchedRoot = path.join(worktreeRoot, "watched");
    const outside = path.join(worktreeRoot, "outside.txt");
    mkdirSync(runRoot, { recursive: true });
    mkdirSync(watchedRoot);
    writeFileSync(outside, "sentinel");
    symlinkSync(outside, path.join(watchedRoot, "link.txt"));

    expect(() => captureGate0SourceOutputs({
      worktreeRoot,
      runRoot,
      directFiles: [],
      recursiveRoots: ["watched"],
    })).toThrow(/symlink/i);
    expect(readFileSync(outside, "utf8")).toBe("sentinel");
  });
});
