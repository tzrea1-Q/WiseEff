import { describe, expect, it, vi } from "vitest";

import type {
  DtsCompareBaselineResult,
  DtsReleaseBaseline,
  DtsReleaseReadiness,
  DtsRestorePreviewResult,
  DtsRollbackBaselineResult,
  DtsStructuredRepository
} from "@/application/ports/DtsStructuredRepository";
import { createReleaseBaselineSession } from "./releaseBaselineSession";

function baseline(overrides: Partial<DtsReleaseBaseline> = {}): DtsReleaseBaseline {
  return {
    id: "bl-1",
    organizationId: "org-1",
    configSetId: "cs-1",
    name: "v1",
    status: "draft",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides
  };
}

function readiness(overrides: Partial<DtsReleaseReadiness> = {}): DtsReleaseReadiness {
  return {
    available: true,
    level: "ready",
    blockers: [],
    warnings: [],
    gateToken: "gate-fresh",
    evaluatedAt: "2026-08-09T00:00:00.000Z",
    configSetId: "cs-1",
    projectId: "proj-1",
    canCreateBaseline: true,
    canRelease: true,
    ...overrides
  };
}

describe("createReleaseBaselineSession", () => {
  it("loadBaselines populates list and releasedTip prefers newest released", async () => {
    const listBaselines = vi.fn(async () => [
      baseline({ id: "old", status: "released", createdAt: "2026-07-01T00:00:00.000Z", name: "old" }),
      baseline({ id: "tip", status: "released", createdAt: "2026-08-01T00:00:00.000Z", name: "tip" }),
      baseline({ id: "draft", status: "draft", name: "draft" })
    ]);
    const session = createReleaseBaselineSession();

    await session.loadBaselines("proj-1", "cs-1", { listBaselines });

    expect(listBaselines).toHaveBeenCalledWith("proj-1", "cs-1");
    expect(session.baselines).toHaveLength(3);
    expect(session.releasedTip?.id).toBe("tip");
    expect(session.baselinesLoading).toBe(false);
  });

  it("create refreshes readiness and passes fresh gateToken with acknowledged warnings", async () => {
    const getReleaseReadiness = vi.fn(async () => readiness({ gateToken: "gate-create" }));
    const createBaseline = vi.fn(async () => baseline({ id: "bl-new", name: "release-a" }));
    const session = createReleaseBaselineSession();
    session.acknowledgeWarning("warn-1");

    const created = await session.create(
      "proj-1",
      "cs-1",
      { name: "release-a", localSessionDirty: false },
      { getReleaseReadiness, createBaseline }
    );

    expect(created.id).toBe("bl-new");
    expect(getReleaseReadiness).toHaveBeenCalledWith("proj-1", "cs-1", {
      acknowledgedWarningIds: ["warn-1"]
    });
    expect(createBaseline).toHaveBeenCalledWith("proj-1", "cs-1", {
      name: "release-a",
      gateToken: "gate-create",
      acknowledgedWarningIds: ["warn-1"]
    });
    expect(session.baselines[0]?.id).toBe("bl-new");
    expect(session.actionError).toBe("");
  });

  it("create fail-closes when local session is dirty without calling createBaseline", async () => {
    const getReleaseReadiness = vi.fn(async () => readiness());
    const createBaseline = vi.fn();
    const session = createReleaseBaselineSession();

    await expect(
      session.create(
        "proj-1",
        "cs-1",
        { name: "x", localSessionDirty: true },
        { getReleaseReadiness, createBaseline }
      )
    ).rejects.toThrow(/未保存的本机会话/);
    expect(createBaseline).not.toHaveBeenCalled();
    expect(session.actionError).toMatch(/未保存/);
  });

  it("create fail-closes when readiness blocks create", async () => {
    const getReleaseReadiness = vi.fn(async () =>
      readiness({
        canCreateBaseline: false,
        available: false,
        unavailableReason: "open conflict"
      })
    );
    const createBaseline = vi.fn();
    const session = createReleaseBaselineSession();

    await expect(
      session.create(
        "proj-1",
        "cs-1",
        { name: "x", localSessionDirty: false },
        { getReleaseReadiness, createBaseline }
      )
    ).rejects.toThrow(/open conflict/);
    expect(createBaseline).not.toHaveBeenCalled();
  });

  it("release uses fresh gateToken, maps prior tip to historical, and requires warning ack", async () => {
    const session = createReleaseBaselineSession();
    await session.loadBaselines("proj-1", "cs-1", {
      listBaselines: vi.fn(async () => [
        baseline({ id: "draft-1", status: "draft" }),
        baseline({ id: "tip-old", status: "released", name: "old-tip" })
      ])
    });
    session.selectBaseline("draft-1");

    const getReleaseReadiness = vi.fn(async () =>
      readiness({
        warnings: [
          {
            id: "w1",
            severity: "warning",
            code: "policy",
            message: "needs ack",
            acknowledgementRequired: true,
            remediation: { kind: "acknowledge-warning", label: "Ack" }
          }
        ]
      })
    );
    const releaseBaseline = vi.fn();

    await expect(
      session.release(
        "proj-1",
        "cs-1",
        { localSessionDirty: false },
        { getReleaseReadiness, releaseBaseline }
      )
    ).rejects.toThrow(/确认策略允许的警告/);
    expect(releaseBaseline).not.toHaveBeenCalled();

    session.acknowledgeWarning("w1");
    const releasedItem = baseline({ id: "draft-1", status: "released", name: "draft-1" });
    releaseBaseline.mockResolvedValue({
      item: releasedItem,
      gate: {
        ok: true,
        mode: "off",
        requiresConfirmation: false,
        diagnostics: []
      }
    });

    const result = await session.release(
      "proj-1",
      "cs-1",
      { localSessionDirty: false },
      { getReleaseReadiness, releaseBaseline }
    );

    expect(releaseBaseline).toHaveBeenCalledWith("proj-1", "draft-1", {
      gateToken: "gate-fresh",
      acknowledgedWarningIds: ["w1"]
    });
    expect(result.item.status).toBe("released");
    expect(session.baselines.find((item) => item.id === "tip-old")?.status).toBe("historical");
    expect(session.releasedTip?.id).toBe("draft-1");
  });

  it("compare and restore preview/restore go through narrow repository picks", async () => {
    const session = createReleaseBaselineSession();
    session.selectBaseline("bl-1");

    const comparePayload: DtsCompareBaselineResult = {
      baselineId: "bl-1",
      against: "working",
      members: [{ fileId: "f1", status: "unchanged" }]
    };
    const compareBaseline = vi.fn(async () => comparePayload);
    await session.compare("proj-1", "working", { compareBaseline });
    expect(session.compareResult?.baselineId).toBe("bl-1");
    expect(session.compareAgainst).toBe("working");

    const preview: DtsRestorePreviewResult = {
      baselineId: "bl-1",
      configSetId: "cs-1",
      releasedBaselineUnchanged: true,
      members: [],
      driftedCount: 0
    };
    const previewRestoreBaseline = vi.fn(async () => preview);
    await session.previewRestore("proj-1", { previewRestoreBaseline });
    expect(session.restorePreview?.baselineId).toBe("bl-1");

    await session.loadBaselines("proj-1", "cs-1", {
      listBaselines: vi.fn(async () => [
        baseline({ id: "bl-1", status: "draft" }),
        baseline({ id: "tip", status: "released", createdAt: "2026-08-02T00:00:00.000Z" })
      ])
    });

    const rollback: DtsRollbackBaselineResult = { baselineId: "bl-1", restored: 2 };
    const rollbackBaseline = vi.fn(async () => rollback);
    const { tipUnchanged } = await session.restore("proj-1", "cs-1", {
      rollbackBaseline,
      listBaselines: vi.fn(async () => [
        baseline({ id: "bl-1", status: "draft" }),
        baseline({ id: "tip", status: "released", createdAt: "2026-08-02T00:00:00.000Z" })
      ])
    });
    expect(rollbackBaseline).toHaveBeenCalledWith("proj-1", "bl-1");
    expect(tipUnchanged).toBe(true);
    expect(session.restorePreview).toBeNull();
  });

  it("refreshReadiness skips when not admin; acknowledge toggles ids for next refresh", async () => {
    const getReleaseReadiness = vi.fn(async () => readiness());
    const session = createReleaseBaselineSession();

    await session.refreshReadiness("proj-1", "cs-1", { canAdmin: false }, { getReleaseReadiness });
    expect(getReleaseReadiness).not.toHaveBeenCalled();
    expect(session.readiness).toBeNull();

    session.acknowledgeWarning("w1");
    expect(session.acknowledgedWarningIds.has("w1")).toBe(true);
    session.acknowledgeWarning("w1");
    expect(session.acknowledgedWarningIds.has("w1")).toBe(false);

    session.acknowledgeWarning("w1");
    await session.refreshReadiness("proj-1", "cs-1", { canAdmin: true }, { getReleaseReadiness });
    expect(getReleaseReadiness).toHaveBeenCalledWith("proj-1", "cs-1", {
      acknowledgedWarningIds: ["w1"]
    });
  });

  it("loadPinnedMembers maps getBaseline members for selected baseline", async () => {
    const session = createReleaseBaselineSession();
    session.selectBaseline("bl-1");
    const getBaseline = vi.fn(async () => ({
      item: baseline(),
      members: [{ baselineId: "bl-1", fileId: "f1", fileVersionId: "v1", versionNumber: 3 }]
    })) as DtsStructuredRepository["getBaseline"];

    await session.loadPinnedMembers("proj-1", { getBaseline });
    expect(session.pinnedMembers).toEqual([{ fileId: "f1", fileVersionId: "v1", versionNumber: 3 }]);
  });
});
