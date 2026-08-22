import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  captureGate0SourceOutputs,
  restoreAndArchiveGate0SourceOutputs,
} from "./gate0-source-outputs";

describe("Gate0 source-worktree outputs", () => {
  it("archives and removes only run-created files while restoring exact pre-run bytes", () => {
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

    const manifestPath = restoreAndArchiveGate0SourceOutputs(snapshot);

    expect(readFileSync(path.join(snapshotsRoot, "existing.png"), "utf8")).toBe("pre-run-image");
    expect(readFileSync(generatedDoc, "utf8")).toBe("pre-run-doc\n");
    expect(existsSync(path.join(snapshotsRoot, "created.png"))).toBe(false);
    expect(
      readFileSync(
        path.join(runRoot, "artifacts", "source-worktree-output", "e2e", "quality", "snapshots", "created.png"),
        "utf8",
      ),
    ).toBe("created-image");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      files: Array<{ relativePath: string; existedBefore: boolean; action: string }>;
    };
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: "e2e/quality/snapshots/created.png", existedBefore: false, action: "removed-created" }),
        expect.objectContaining({ relativePath: "docs/generated/evidence.md", existedBefore: true, action: "restored" }),
      ]),
    );
  });
});
