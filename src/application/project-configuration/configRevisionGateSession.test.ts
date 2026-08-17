import { describe, expect, it, vi } from "vitest";

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
