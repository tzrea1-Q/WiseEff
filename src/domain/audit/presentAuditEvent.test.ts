import { describe, expect, it } from "vitest";
import { presentAuditEvent } from "./presentAuditEvent";
import type { AuditEventView } from "./types";

const baseEvent: AuditEventView = {
  id: "ae-1",
  app: "parameter-management",
  kind: "parameter-merge",
  action: "merge",
  severity: "High",
  actor: "Liu Min",
  actorType: "user",
  timeLabel: "9 小时前",
  createdAt: "2026-06-17T08:42:31.000Z",
  traceId: "trace-1",
  targetType: "parameter-change-request",
  targetId: "request-1",
  metadata: {
    fromStatus: "software_merge",
    toStatus: "merged",
    parameterName: "fast_charge_current_limit_ma",
    module: "Charging Policy",
    currentValue: "3200",
    targetValue: "3800",
    risk: "High",
    submitter: "Wang Jie",
    participants: [
      { role: "提交人", name: "Wang Jie", action: "提交变更" },
      { role: "硬件 Committer 检视", name: "Sun Mei", action: "推进流程" }
    ]
  }
};

describe("presentAuditEvent", () => {
  it.each([
    ["issue", "签发集成凭据"], ["rotate", "轮换集成凭据"], ["revoke", "撤销集成凭据"]
  ])("uses readable credential action and metadata name for %s", (kind, action) => {
    const presentation = presentAuditEvent({ ...baseEvent, app: "log-analysis", kind: `log-integration-credential-${kind}`,
      action, targetType: "log-integration-credential", targetId: "credential-uuid",
      metadata: { name: "Factory pipeline", skillId: "skill-1", skillName: "Charging" } });
    expect(presentation.headline).toBe(action);
    expect(presentation.targetLabel).toBe("Factory pipeline");
  });

  it("builds human-readable parameter change and participants", () => {
    const presentation = presentAuditEvent(baseEvent);

    expect(presentation.headline).toContain("fast_charge_current_limit_ma");
    expect(presentation.parameterChange).toMatchObject({
      name: "fast_charge_current_limit_ma",
      previousValue: "3200",
      newValue: "3800"
    });
    expect(presentation.statusChange).toMatchObject({
      from: "软件开发人员合入",
      to: "已合入"
    });
    expect(presentation.participants).toHaveLength(2);
    expect(presentation.technical.some((row) => row.label === "Trace ID")).toBe(true);
  });

  it("falls back to previous/new value metadata", () => {
    const presentation = presentAuditEvent({
      ...baseEvent,
      kind: "parameter-update",
      action: "更新 fast_charge_current_limit_ma 推荐值",
      metadata: { previousValue: "3800", newValue: "3200" }
    });

    expect(presentation.parameterChange).toMatchObject({
      name: "fast_charge_current_limit_ma",
      previousValue: "3800",
      newValue: "3200"
    });
  });

  it("labels parameter-file and candidate kinds in product language", () => {
    const presentation = presentAuditEvent({
      ...baseEvent,
      kind: "parameter-file-candidate-create",
      action: "create",
      targetType: "project-parameter-file-candidate",
      targetId: "cand-1",
      metadata: { fileName: "board.dts", status: "ready" }
    });
    expect(presentation.kindLabel).toBe("创建候选文件版本");
    expect(presentation.headline).toContain("创建");
  });

  it("shows object context and the recorded action without inventing historical values", () => {
    const presentation = presentAuditEvent({
      ...baseEvent, app: "parameters", kind: "parameter-topology-governance", action: "value-change-applied", severity: "info",
      actor: "System", actorType: "system", targetName: "充电电流", projectName: "演示项目", projectCode: "DEMO",
      metadata: { bindingId: "binding-1", valueId: "value-1", requestId: "request-1", canonicalRevision: 3, secretToken: "must-not-render" }
    });
    expect(presentation).toMatchObject({ headline: "参数值变更已应用", targetLabel: "充电电流", projectLabel: "演示项目 · DEMO", actor: { name: "系统" } });
    expect(presentation.parameterChange).toBeUndefined();
    expect(presentation.participants).toEqual([]);
    expect(presentation.technical).toContainEqual({ label: "绑定 ID", value: "binding-1" });
    expect(presentation.technical).not.toContainEqual(expect.objectContaining({ value: "must-not-render" }));
  });

  it("renders numeric, boolean, null and structured immutable evidence", () => {
    for (const [previousValue, newValue, expectedPrevious, expectedNew] of [
      [0, false, "0", "false"],
      [null, { enabled: true }, "null", '{\n  "enabled": true\n}'],
      [[1, 2], "", '[\n  1,\n  2\n]', '""']
    ]) {
      const presentation = presentAuditEvent({ ...baseEvent, metadata: {}, evidence: { previousValue, newValue } });
      expect(presentation.parameterChange).toMatchObject({ previousValue: expectedPrevious, newValue: expectedNew });
    }
  });

  it("does not repeat a lone actor as a participant", () => {
    expect(presentAuditEvent({ ...baseEvent, metadata: { participants: [{ role: "操作人", name: baseEvent.actor }] } }).participants).toEqual([]);
    expect(presentAuditEvent({ ...baseEvent, metadata: { submitter: baseEvent.actor } }).participants).toEqual([]);
  });

  it("keeps write execution distinct from ordinary readback observation", () => {
    expect(presentAuditEvent({ ...baseEvent, metadata: { writeOutcome: "executed", readbackOutcome: "observed" } }).outcomes).toEqual([
      { label: "写命令", value: "写入已执行" }, { label: "写后回读", value: "已回读（仅观测）" }
    ]);
  });

  it("pairs named parameter evidence by target and retains one-sided values", () => {
    const presentation = presentAuditEvent({ ...baseEvent, evidence: {
      previousValue: [{ target: "充电电流", value: 5000 }, { target: "开关", value: false }],
      newValue: [{ target: "开关", value: true }, { target: "充电电流", value: 6000 }, { target: "新增值", value: null }]
    } });
    expect(presentation.parameterChange?.entries).toEqual([
      { name: "充电电流", previousValue: "5000", newValue: "6000" },
      { name: "开关", previousValue: "false", newValue: "true" },
      { name: "新增值", previousValue: "未记录", newValue: "null" }
    ]);
  });

  it("does not pair duplicate target names or override authoritative source-only evidence", () => {
    const duplicate = presentAuditEvent({ ...baseEvent, evidence: {
      previousValue: [{ target: "同名参数", value: 1 }, { target: "同名参数", value: 2 }],
      newValue: [{ target: "同名参数", value: 3 }, { target: "同名参数", value: 4 }]
    } });
    expect(duplicate.parameterChange?.entries).toBeUndefined();
    expect(duplicate.parameterChange?.previousValue).toContain('"value": 2');
    const sourceOnly = presentAuditEvent({ ...baseEvent, evidence: { sourceLabel: "值未发生变化" } });
    expect(sourceOnly.parameterChange).toBeUndefined();
    expect(sourceOnly.evidenceSource).toBe("值未发生变化");
  });

  it("preserves persisted deletion and restoration states even when retained payloads match", () => {
    const deleted = presentAuditEvent({ ...baseEvent, metadata: {}, evidence: {
      previousValue: 5000, newValue: 5000, previousValueState: "present", newValueState: "deleted"
    } });
    expect(deleted.parameterChange).toMatchObject({ previousValue: "5000", newValue: "5000", previousValueState: "present", newValueState: "deleted" });
    expect(deleted.summary).toContain("已删除");
    const restored = presentAuditEvent({ ...baseEvent, metadata: {}, evidence: {
      previousValue: [{ target: "充电电流", value: 5000, valueState: "deleted" }],
      newValue: [{ target: "充电电流", value: 5000, valueState: "present" }]
    } });
    expect(restored.parameterChange?.entries).toEqual([
      { name: "充电电流", previousValue: "5000", newValue: "5000", previousValueState: "deleted", newValueState: "present" }
    ]);
  });
});
