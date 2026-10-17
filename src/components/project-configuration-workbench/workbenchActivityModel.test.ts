import { describe, expect, it } from "vitest";

import type { AuditEventView } from "@/domain/audit/types";
import {
  presentWorkbenchActivity,
  resolveWorkbenchActivityTarget,
  workbenchActivityApps
} from "./workbenchActivityModel";

function event(overrides: Partial<AuditEventView> = {}): AuditEventView {
  return {
    id: "evt-1",
    app: "parameters",
    kind: "parameter-file-candidate-create",
    action: "create",
    severity: "Medium",
    actor: "Ada Admin",
    actorType: "user",
    timeLabel: "2 分钟前",
    createdAt: "2026-08-07T04:00:00.000Z",
    targetType: "project-parameter-file-candidate",
    targetId: "cand-1",
    metadata: {
      fileName: "aurora-board.dts",
      fileId: "file-board",
      status: "ready"
    },
    ...overrides
  };
}

describe("workbenchActivityModel", () => {
  it("scopes activity apps to parameter governance surfaces", () => {
    expect(workbenchActivityApps()).toEqual([
      "parameter-management",
      "parameter-admin",
      "parameters"
    ]);
  });

  it("presents actor, action, target, outcome, and time in product language", () => {
    const row = presentWorkbenchActivity(event());
    expect(row.actor).toBe("Ada Admin");
    expect(row.action).toBe("创建");
    expect(row.targetLabel).toContain("候选文件版本");
    expect(row.targetLabel).toContain("aurora-board.dts");
    expect(row.outcome).toBe("成功");
    expect(row.timeLabel).toBeTruthy();
    expect(row.absoluteTime).toBeTruthy();
    expect(row.createdAtIso).toBe("2026-08-07T04:00:00.000Z");
    expect(row.action).not.toMatch(/parameter-file-candidate-create/);
  });

  it("maps abandoned and failed statuses to product outcomes", () => {
    expect(presentWorkbenchActivity(event({ metadata: { status: "abandoned" } })).outcome).toBe(
      "已放弃"
    );
    expect(presentWorkbenchActivity(event({ metadata: { status: "failed" } })).outcome).toBe("失败");
    expect(presentWorkbenchActivity(event({ metadata: { status: "blocked" } })).outcome).toBe(
      "已阻断"
    );
  });

  it("uses known object and related file names while retaining IDs for evidence and navigation", () => {
    const names = new Map([["file-board", "board.dts"], ["cs-1", "设备配置"], ["bl-1", "稳定版"]]);
    const file = presentWorkbenchActivity(event({ targetType: "project-parameter-file", targetId: "file-board", metadata: {} }), names);
    expect(file.targetLabel).toBe("参数文件 · board.dts");
    expect(file.targetId).toBe("file-board");
    expect(presentWorkbenchActivity(event({ targetType: "dts-config-set", targetId: "cs-1", metadata: {} }), names).targetLabel).toBe("配置 · 设备配置");
    expect(presentWorkbenchActivity(event({ targetType: "dts-release-baseline", targetId: "bl-1", metadata: {} }), names).targetLabel).toBe("发布基线 · 稳定版");
    expect(presentWorkbenchActivity(event({ targetType: "project-parameter-value-change-request", targetId: "request-uuid", metadata: { fileId: "file-board" } }), names).targetLabel).toBe("参数变更审核 · board.dts");
  });

  it("uses compact business object names without exposing IDs or unknown type slugs", () => {
    expect(presentWorkbenchActivity(event({ targetType: "project-parameter-value-change-request", targetId: "request-uuid", metadata: {} })).targetLabel).toBe("参数变更审核");
    const row = presentWorkbenchActivity(event({ targetType: "future-internal-slug", targetId: "raw-uuid", metadata: {} }));
    expect(row.targetLabel).toBe("配置对象");
    expect(row.targetId).toBe("raw-uuid");
    expect(row.targetType).toBe("future-internal-slug");
  });

  it("resolves file and candidate targets when they still exist", () => {
    const catalog = {
      configSetIds: new Set(["cs-1"]),
      fileIds: new Set(["file-board"]),
      candidateIds: new Set(["cand-1"]),
      baselineIds: new Set(["bl-1"])
    };
    expect(resolveWorkbenchActivityTarget(event(), catalog)).toMatchObject({
      kind: "candidate",
      candidateId: "cand-1",
      fileId: "file-board",
      missing: false
    });
    expect(
      resolveWorkbenchActivityTarget(
        event({
          kind: "parameter-file-upload",
          action: "upload",
          targetType: "project-parameter-file",
          targetId: "file-board",
          metadata: { fileName: "aurora-board.dts" }
        }),
        catalog
      )
    ).toMatchObject({ kind: "file", fileId: "file-board", missing: false });
  });

  it("marks missing historical targets without inventing navigation", () => {
    const catalog = {
      configSetIds: new Set(["cs-1"]),
      fileIds: new Set(["file-board"]),
      candidateIds: new Set<string>(),
      baselineIds: new Set<string>()
    };
    const resolved = resolveWorkbenchActivityTarget(event({ targetId: "cand-gone" }), catalog);
    expect(resolved.missing).toBe(true);
    expect(resolved.missingReason).toMatch(/候选/);
    expect(resolved.candidateId).toBe("cand-gone");
  });

  it("restores node/property targets from metadata when the file remains", () => {
    const catalog = {
      configSetIds: new Set(["cs-1"]),
      fileIds: new Set(["file-board"]),
      candidateIds: new Set<string>(),
      baselineIds: new Set<string>(),
      knownNodePathsByFileId: new Map([["file-board", new Set(["board"])]])
    };
    expect(
      resolveWorkbenchActivityTarget(
        event({
          targetType: "project-parameter-file",
          targetId: "file-board",
          metadata: { nodePath: "board", propertyName: "model" }
        }),
        catalog
      )
    ).toMatchObject({
      kind: "property",
      fileId: "file-board",
      nodePath: "board",
      propertyName: "model",
      missing: false
    });
  });
});
