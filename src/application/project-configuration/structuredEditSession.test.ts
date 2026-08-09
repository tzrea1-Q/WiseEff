import { describe, expect, it, vi } from "vitest";

import type { DtsStructuralNode } from "@/application/ports/DtsStructuredRepository";
import { SESSION_DRAFT_STORAGE_KEY } from "./sessionDraftStorage";
import { createStructuredEditSession } from "./structuredEditSession";

function createMemoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    }
  };
}

const SCOPE = {
  userId: "user-1",
  organizationId: "org-1",
  projectId: "proj-1",
  configSetId: "cs-1",
  fileId: "file-board",
  baseVersionId: "ver-1"
};

const NODES: DtsStructuralNode[] = [
  {
    nodePath: "board",
    name: "board",
    labels: [],
    properties: [
      {
        name: "model",
        valueType: "string-list",
        rawText: '"Aurora"',
        normalizedValue: "Aurora",
        source: {
          startOffset: 0,
          endOffset: 10,
          startLine: 2,
          startColumn: 1,
          endLine: 2,
          endColumn: 10
        }
      },
      {
        name: "compatible",
        valueType: "string-list",
        rawText: '"wiseeff,aurora"',
        normalizedValue: "wiseeff,aurora"
      }
    ],
    phandleRefs: []
  }
];

describe("createStructuredEditSession", () => {
  it("hydrates compatible drafts from storage and reports isDirty / rows", async () => {
    const storage = createMemoryStorage({
      [SESSION_DRAFT_STORAGE_KEY]: JSON.stringify({
        version: 1,
        buckets: [
          {
            scope: SCOPE,
            drafts: {
              "file-board::board::model": {
                rawText: '"Aurora-X"',
                normalizedValue: "Aurora-X",
                valid: true
              }
            },
            selectedKeys: ["file-board::board::model"],
            reason: "bump",
            updatedAt: "2026-08-01T00:00:00.000Z"
          }
        ]
      })
    });
    const session = createStructuredEditSession({ storage });
    session.setStructure(NODES, "file-board");
    await session.hydrate(SCOPE);

    expect(session.isDirty).toBe(true);
    expect(session.isStaleBase).toBe(false);
    expect(session.reason).toBe("bump");
    expect(session.rows).toHaveLength(1);
    expect(session.rows[0]?.propertyName).toBe("model");
    expect(session.selectedKeys.has("file-board::board::model")).toBe(true);
  });

  it("marks recovered drafts stale-base and blocks validate/submit until recover()", async () => {
    const storage = createMemoryStorage({
      [SESSION_DRAFT_STORAGE_KEY]: JSON.stringify({
        version: 1,
        buckets: [
          {
            scope: { ...SCOPE, baseVersionId: "ver-old" },
            drafts: {
              "file-board::board::model": {
                rawText: '"Aurora-X"',
                normalizedValue: "Aurora-X",
                valid: true
              }
            },
            selectedKeys: ["file-board::board::model"],
            reason: "bump",
            updatedAt: "2026-08-01T00:00:00.000Z"
          }
        ]
      })
    });
    const session = createStructuredEditSession({ storage });
    session.setStructure(NODES, "file-board");
    await session.hydrate(SCOPE);

    expect(session.isStaleBase).toBe(true);
    expect(session.validate().ok).toBe(false);
    expect(session.validate().message).toMatch(/基线版本已变更/);

    const submitStructuredEdits = vi.fn();
    await expect(
      session.submit({
        projectId: SCOPE.projectId,
        fileId: SCOPE.fileId,
        fileName: "aurora-board.dts",
        dtsRepository: { submitStructuredEdits }
      })
    ).rejects.toThrow(/基线版本已变更/);
    expect(submitStructuredEdits).not.toHaveBeenCalled();

    session.recover();
    expect(session.isStaleBase).toBe(false);
    expect(session.validate().ok).toBe(true);
  });

  it("ignores late hydrate recovery from a previous scope generation", async () => {
    const storage = createMemoryStorage();
    const session = createStructuredEditSession({ storage });
    session.setStructure(NODES, "file-board");

    const first = session.hydrate(SCOPE);
    session.change(
      { fileId: "file-board", nodePath: "board", propertyName: "model" },
      { rawText: '"live"', normalizedValue: "live", valid: true }
    );
    await session.hydrate({ ...SCOPE, fileId: "file-other" });
    await first;

    expect(session.drafts["file-board::board::model"]).toBeUndefined();
    expect(Object.keys(session.drafts)).toHaveLength(0);
  });

  it("validates and submits a selected subset via narrow submitStructuredEdits Pick", async () => {
    const session = createStructuredEditSession({ storage: createMemoryStorage() });
    session.setStructure(NODES, "file-board");
    await session.hydrate(SCOPE);

    session.change(
      { fileId: "file-board", nodePath: "board", propertyName: "model" },
      { rawText: '"Aurora-X"', normalizedValue: "Aurora-X", valid: true }
    );
    session.change(
      { fileId: "file-board", nodePath: "board", propertyName: "compatible" },
      { rawText: '"wiseeff,aurora-v2"', normalizedValue: "wiseeff,aurora-v2", valid: true }
    );
    session.selectSubset(["file-board::board::model"]);
    session.setReason("board model bump");

    expect(session.validate()).toEqual({ ok: true, message: "校验通过：1 项" });

    const submitStructuredEdits = vi.fn().mockResolvedValue({
      id: "round-1",
      projectId: SCOPE.projectId,
      status: "submitted",
      items: []
    });
    const round = await session.submit({
      projectId: SCOPE.projectId,
      fileId: SCOPE.fileId,
      fileName: "aurora-board.dts",
      dtsRepository: { submitStructuredEdits }
    });

    expect(round.id).toBe("round-1");
    expect(submitStructuredEdits).toHaveBeenCalledWith(
      SCOPE.projectId,
      expect.objectContaining({
        edits: [
          expect.objectContaining({
            fileId: "file-board",
            nodePath: "board",
            propertyName: "model",
            rawText: expect.stringMatching(/Aurora-X/),
            reason: "board model bump"
          })
        ],
        reason: "board model bump"
      })
    );
    expect(submitStructuredEdits.mock.calls[0][1].edits).toHaveLength(1);
    expect(session.rows.map((row) => row.propertyName)).toEqual(["compatible"]);
    expect(session.submitStatus).toMatch(/已提交变更请求/);
  });

  it("preserves drafts when submitStructuredEdits fails", async () => {
    const session = createStructuredEditSession({ storage: createMemoryStorage() });
    session.setStructure(NODES, "file-board");
    await session.hydrate(SCOPE);
    session.change(
      { fileId: "file-board", nodePath: "board", propertyName: "model" },
      { rawText: '"Aurora-X"', normalizedValue: "Aurora-X", valid: true }
    );
    session.setReason("fail me");

    const submitStructuredEdits = vi.fn().mockRejectedValue(new Error("submit failed"));
    await expect(
      session.submit({
        projectId: SCOPE.projectId,
        fileId: SCOPE.fileId,
        fileName: "aurora-board.dts",
        dtsRepository: { submitStructuredEdits }
      })
    ).rejects.toThrow("submit failed");

    expect(session.rows).toHaveLength(1);
    expect(session.submitError).toBe("submit failed");
  });

  it("discard clears memory and storage bucket", async () => {
    const storage = createMemoryStorage();
    const session = createStructuredEditSession({ storage });
    session.setStructure(NODES, "file-board");
    await session.hydrate(SCOPE);
    session.change(
      { fileId: "file-board", nodePath: "board", propertyName: "model" },
      { rawText: '"Aurora-X"', normalizedValue: "Aurora-X", valid: true }
    );
    // Allow persist effect path
    await Promise.resolve();
    await Promise.resolve();

    expect(storage.getItem(SESSION_DRAFT_STORAGE_KEY)).toBeTruthy();
    session.discard();
    expect(session.isDirty).toBe(false);
    expect(storage.getItem(SESSION_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("does not restore drafts when hydrate scope userId differs from stored bucket", async () => {
    const storage = createMemoryStorage({
      [SESSION_DRAFT_STORAGE_KEY]: JSON.stringify({
        version: 1,
        buckets: [
          {
            scope: SCOPE,
            drafts: {
              "file-board::board::model": {
                rawText: '"Aurora-UserA"',
                normalizedValue: "Aurora-UserA",
                valid: true
              }
            },
            selectedKeys: ["file-board::board::model"],
            reason: "user-a only",
            updatedAt: "2026-08-01T00:00:00.000Z"
          }
        ]
      })
    });
    const session = createStructuredEditSession({ storage });
    session.setStructure(NODES, "file-board");
    await session.hydrate({ ...SCOPE, userId: "user-b" });

    expect(session.isDirty).toBe(false);
    expect(session.rows).toHaveLength(0);
    expect(storage.getItem(SESSION_DRAFT_STORAGE_KEY)).toBeTruthy();
  });
});
