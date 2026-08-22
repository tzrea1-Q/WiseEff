import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  captureGate0SourceOutputs,
  restoreAndArchiveGate0SourceOutputs,
} from "./gate0-source-outputs";

describe("Gate0 source-worktree outputs", () => {
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
