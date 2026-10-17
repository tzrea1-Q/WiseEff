import { describe, expect, it, vi } from "vitest";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";

import type { ConfigRevisionSummary, ValidationRun } from "@/domain/parameter-topology/types";
import {
  createConfigRevisionGateSession,
  presentRevisionValidation
} from "./configRevisionGateSession";

const REVISIONS: ConfigRevisionSummary[] = [
  {
    id: "rev-cs-2",
    configSetId: "cs-1",
    revisionNumber: 2,
    status: "resolved",
    createdAt: "2026-08-17T10:00:00.000Z"
  },
  {
    id: "rev-cs-1",
    configSetId: "cs-1",
    revisionNumber: 1,
    status: "validated",
    createdAt: "2026-08-16T10:00:00.000Z"
  }
];

function passedRun(overrides: Partial<ValidationRun> = {}): ValidationRun {
  return {
    id: "run-1",
    status: "passed",
    stage: "toolchain",
    ...overrides
  };
}

describe("createConfigRevisionGateSession", () => {
  it.each(["project", "config-set"])("clears the previous %s revision and validation before the next scope finishes loading", async (changed) => {
    const session = createConfigRevisionGateSession();
    await session.load("project-1", "cs-1", { listConfigRevisions: async () => REVISIONS });
    await session.validate("project-1", { validateRevision: async () => passedRun({ requiresConfirmation: true }) });
    let resolveNext!: (items: ConfigRevisionSummary[]) => void;
    const pending = session.load(changed === "project" ? "project-2" : "project-1", changed === "config-set" ? "cs-2" : "cs-1", {
      listConfigRevisions: () => new Promise((resolve) => { resolveNext = resolve; })
    });
    expect(session.loading).toBe(true);
    expect(session.revisions).toEqual([]);
    expect(session.selectedRevisionId).toBeNull();
    expect(session.lastRun).toBeNull();
    expect(session.requiresConfirmation).toBe(false);
    resolveNext([{ ...REVISIONS[0]!, id: "new-revision", configSetId: changed === "config-set" ? "cs-2" : "cs-1" }]);
    await pending;
    expect(session.selectedRevisionId).toBe("new-revision");
  });

  it("preserves a valid selected revision and its validation when refreshing the same scope", async () => {
    const session = createConfigRevisionGateSession();
    await session.load("project-1", "cs-1", { listConfigRevisions: async () => REVISIONS });
    session.select("rev-cs-1");
    await session.validate("project-1", { validateRevision: async () => passedRun() });
    let resolveNext!: (items: ConfigRevisionSummary[]) => void;
    const pending = session.load("project-1", "cs-1", {
      listConfigRevisions: () => new Promise((resolve) => { resolveNext = resolve; })
    });
    expect(session.selectedRevisionId).toBe("rev-cs-1");
    expect(session.lastRun?.id).toBe("run-1");
    resolveNext(REVISIONS);
    await pending;
    expect(session.selectedRevisionId).toBe("rev-cs-1");
    expect(session.lastRun?.id).toBe("run-1");
  });

  it.each(["success", "failure"])("ignores a late validation %s after changing scope", async (outcome) => {
    const session = createConfigRevisionGateSession();
    await session.load("project-1", "cs-1", { listConfigRevisions: async () => REVISIONS });
    let resolveOld!: (run: ValidationRun) => void;
    let rejectOld!: (cause: Error) => void;
    const pending = session.validate("project-1", { validateRevision: () => new Promise((resolve, reject) => {
      resolveOld = resolve;
      rejectOld = reject;
    }) });
    await session.load("project-2", "cs-2", { listConfigRevisions: async () => [{ ...REVISIONS[0]!, id: "new-revision", configSetId: "cs-2" }] });
    expect(session.validating).toBe(false);
    await session.validate("project-2", { validateRevision: async () => passedRun({ id: "new-run" }) });
    if (outcome === "success") resolveOld(passedRun({ id: "old-run", requiresConfirmation: true }));
    else rejectOld(new Error("old validation failed"));
    expect(await pending).toBeNull();
    expect(session.lastRun?.id).toBe("new-run");
    expect(session.actionError).toBe("");
    expect(session.requiresConfirmation).toBe(false);
  });

  it("ignores the previous revision's validation after selecting another revision in the same scope", async () => {
    const session = createConfigRevisionGateSession();
    await session.load("project-1", "cs-1", { listConfigRevisions: async () => REVISIONS });
    let resolveOld!: (run: ValidationRun) => void;
    const pending = session.validate("project-1", { validateRevision: () => new Promise((resolve) => { resolveOld = resolve; }) });
    session.select("rev-cs-1");
    expect(session.validating).toBe(false);
    resolveOld(passedRun({ requiresConfirmation: true }));
    expect(await pending).toBeNull();
    expect(session.lastRun).toBeNull();
    expect(session.selectedRevisionId).toBe("rev-cs-1");
  });

  it("surfaces the pinned revision refusal from the validation API", async () => {
    const session = createConfigRevisionGateSession();
    await session.load("project-1", "cs-1", { listConfigRevisions: vi.fn(async () => REVISIONS) });
    const error = new WiseEffApiError("CONFLICT", "Pinned source graph is immutable", {
      reason: "pinned-source-graph-immutable"
    }, "req-pin");
    await expect(session.validate("project-1", { validateRevision: vi.fn(async () => { throw error; }) }))
      .rejects.toBe(error);
    expect(session.actionError).toBe("该配置修订已被规范来源值固定，来源图不可更改。请创建后继修订后再校验。");
    expect(session.validating).toBe(false);
    expect(session.lastRun).toBeNull();
  });
  it("loads listed revisions and auto-selects the latest real id, never a teaching fallback", async () => {
    const listConfigRevisions = vi.fn(async () => REVISIONS);
    const session = createConfigRevisionGateSession();

    await session.load("project-1", "cs-1", { listConfigRevisions });

    expect(listConfigRevisions).toHaveBeenCalledWith("project-1", "cs-1");
    expect(session.revisions.map((item) => item.id)).toEqual(["rev-cs-2", "rev-cs-1"]);
    expect(session.selectedRevisionId).toBe("rev-cs-2");
    expect(session.selectedRevisionId).not.toBe("revision-teaching-1");
    expect(session.revisions.some((item) => item.id === "revision-teaching-1")).toBe(false);
  });

  it("validateRevision uses the selected listed id", async () => {
    const listConfigRevisions = vi.fn(async () => REVISIONS);
    const validateRevision = vi.fn(async () => passedRun({ requiresConfirmation: true }));
    const session = createConfigRevisionGateSession();
    await session.load("project-1", "cs-1", { listConfigRevisions });

    await session.validate("project-1", { validateRevision });

    expect(validateRevision).toHaveBeenCalledWith("project-1", "rev-cs-2");
    expect(session.requiresConfirmation).toBe(true);
    expect(session.lastRun?.id).toBe("run-1");
  });

  it("refuses to select an id that was not listed", async () => {
    const session = createConfigRevisionGateSession();
    await session.load("project-1", "cs-1", { listConfigRevisions: async () => REVISIONS });

    session.select("revision-teaching-1");

    expect(session.selectedRevisionId).toBe("rev-cs-2");
    expect(session.selectedRevisionId).not.toBe("revision-teaching-1");
  });

  it("does not invent a revision id when the list is empty", async () => {
    const validateRevision = vi.fn();
    const session = createConfigRevisionGateSession();
    await session.load("project-1", "cs-1", { listConfigRevisions: async () => [] });

    expect(session.selectedRevisionId).toBeNull();
    await session.validate("project-1", { validateRevision });
    expect(validateRevision).not.toHaveBeenCalled();
    expect(session.actionError).toBe("请先选择配置修订。");
  });
});

describe("presentRevisionValidation", () => {
  it("uses product language for pass, confirmation, and failure", () => {
    expect(presentRevisionValidation(passedRun())).toMatchObject({
      tone: "ok",
      summary: "修订校验通过。"
    });
    expect(presentRevisionValidation(passedRun({ requiresConfirmation: true }))).toMatchObject({
      tone: "warn",
      summary: "修订校验未硬性通过，发布前需确认该风险。"
    });
    expect(presentRevisionValidation(passedRun({ status: "failed" }))).toMatchObject({
      tone: "fail",
      summary: "修订校验未通过，不能当作已放行。"
    });
  });
});
