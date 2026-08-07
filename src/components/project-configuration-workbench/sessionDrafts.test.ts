import { describe, expect, it } from "vitest";

import {
  aggregateSessionDraftSubset,
  clearSubmittedDrafts,
  listSessionDraftRows,
  propertyIdentity,
  sessionDraftKey,
  type SessionPropertyDraft
} from "./sessionDrafts";

const nodes = [
  {
    nodePath: "board",
    name: "board",
    labels: [],
    properties: [
      {
        name: "model",
        valueType: "string-list" as const,
        rawText: '"Aurora"',
        normalizedValue: "Aurora",
        source: {
          startOffset: 20,
          endOffset: 28,
          startLine: 2,
          startColumn: 3,
          endLine: 2,
          endColumn: 11
        }
      },
      {
        name: "compatible",
        valueType: "string-list" as const,
        rawText: '"wiseeff,board"',
        normalizedValue: "wiseeff,board",
        source: {
          startOffset: 40,
          endOffset: 56,
          startLine: 3,
          startColumn: 3,
          endLine: 3,
          endColumn: 19
        }
      }
    ],
    phandleRefs: [],
    source: {
      startOffset: 10,
      endOffset: 60,
      startLine: 1,
      startColumn: 1,
      endLine: 4,
      endColumn: 2
    }
  }
];

describe("sessionDrafts helpers", () => {
  it("builds a stable property identity shared by dock, tree, and gutter", () => {
    expect(propertyIdentity("board", "model")).toBe("board::model");
    expect(
      sessionDraftKey({ fileId: "file-board", nodePath: "board", propertyName: "model" })
    ).toBe("file-board::board::model");
  });

  it("lists draft rows with source line markers for gutter identity", () => {
    const drafts: Record<string, SessionPropertyDraft> = {
      "file-board::board::model": {
        rawText: '"Aurora-X"',
        normalizedValue: "Aurora-X",
        valid: true
      }
    };
    const rows = listSessionDraftRows({ fileId: "file-board", nodes, drafts });
    expect(rows).toEqual([
      expect.objectContaining({
        identity: "board::model",
        key: "file-board::board::model",
        startLine: 2,
        rawText: '"Aurora-X"',
        beforeRawText: '"Aurora"'
      })
    ]);
  });

  it("aggregates only the selected subset and preserves rawText fidelity", () => {
    const drafts: Record<string, SessionPropertyDraft> = {
      "file-board::board::model": {
        rawText: '"Aurora-X"',
        normalizedValue: "Aurora-X"
      },
      "file-board::board::compatible": {
        rawText: '"wiseeff,board-v2"',
        normalizedValue: "wiseeff,board-v2"
      }
    };
    const rows = listSessionDraftRows({ fileId: "file-board", nodes, drafts });
    const aggregate = aggregateSessionDraftSubset({
      fileId: "file-board",
      fileName: "aurora-board.dts",
      rows,
      selectedKeys: new Set(["file-board::board::model"]),
      reason: "workbench edit"
    });
    expect(aggregate.edits).toEqual([
      expect.objectContaining({
        fileId: "file-board",
        nodePath: "board",
        propertyName: "model",
        rawText: '"Aurora-X"',
        reason: "workbench edit"
      })
    ]);
    expect(aggregate.edits).toHaveLength(1);
  });

  it("clears only submitted draft keys", () => {
    const drafts: Record<string, SessionPropertyDraft> = {
      "file-board::board::model": { rawText: '"A"', normalizedValue: "A" },
      "file-board::board::compatible": { rawText: '"B"', normalizedValue: "B" }
    };
    expect(clearSubmittedDrafts(drafts, ["file-board::board::model"])).toEqual({
      "file-board::board::compatible": { rawText: '"B"', normalizedValue: "B" }
    });
  });
});
