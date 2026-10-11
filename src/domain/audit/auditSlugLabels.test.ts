import { describe, expect, it } from "vitest";
import { presentAuditAction, presentAuditKind } from "./auditSlugLabels";

describe("presentAuditKind", () => {
  it.each([
    "config-set", "debug-node-admin-delete", "definition-replacement", "definition-proposal",
    "catalog-publication-job", "catalog-activation", "mod-d02-comparison-capture", "parameter-catalog-governance", "project-value",
    "knowledge-definition-reference-add", "knowledge-definition-reference-remove",
    "knowledge-parameter-reference-remove", "legacy-surface-retired", "log-domain-webhook-config",
    "log-domain-webhook-test", "organization-update", "parameter-definition-reconciliation",
    "parameter-file-rollback", "parameter-source-permission-denied", "parameter-source-user-required",
    "plane-disposal", "product-feedback-progress", "product-feedback-submit", "project-delete-refused",
    "project-role-update", "reload-value-promoted-to-draft", "validation.gate",
    "dts-reload-run-start", "dts-reload-run-blocked", "dts-reload-run-validated",
    "dts-reload-run-deploy-started", "dts-reload-run-unverifiable", "dts-reload-run-verified",
    "dts-reload-run-contradicted", "dts-reload-run-failed", "dts-reload-restore-started",
    "dts-reload-restore-blocked", "dts-reload-restore-validated", "dts-reload-restore-deploy-started",
    "dts-reload-restore-unverifiable", "dts-reload-restore-verified", "dts-reload-restore-contradicted",
    "dts-reload-restore-failed"
  ])("labels production event kind %s (audit writers, SQL receipts and ReloadAuditKind)", (code) => {
    expect(presentAuditKind(code)).toEqual({ label: expect.stringMatching(/[\u4e00-\u9fff]/), isRaw: false });
  });
  it("maps known backend kind slugs to product Chinese", () => {
    expect(presentAuditKind("auth-event")).toEqual({ label: "认证事件", isRaw: false });
    expect(presentAuditKind("user-delete")).toEqual({ label: "注销用户", isRaw: false });
    expect(presentAuditKind("parameter-module-bindings-recomputed")).toEqual({ label: "模块绑定重算", isRaw: false });
    expect(presentAuditKind("log-upload-failed")).toEqual({ label: "日志上传失败", isRaw: false });
  });

  it("flags unknown slugs as raw so views render them in code style", () => {
    expect(presentAuditKind("some-future-kind")).toEqual({ label: "some-future-kind", isRaw: true });
  });

  it.each(["constructor", "toString", "__proto__"])("keeps unknown code %s verbatim", (code) => {
    expect(presentAuditKind(code)).toEqual({ label: code, isRaw: true });
    expect(presentAuditAction(code)).toEqual({ label: code, isRaw: true });
  });
});

describe("presentAuditAction", () => {
  it.each([
    "appended", "approval-executed", "approval-execution-failed", "approval-rejected", "approval-requested",
    "binding-edited", "deactivate", "definition-reference-add", "definition-reference-remove",
    "definition-replacement-advanced", "dispose-residue", "node-enablement-source-applied",
    "parameter-reference-remove", "promote", "reconcile", "rolled_back", "send-webhook-test", "set",
    "source-member-removed", "stage", "stale", "start", "started", "sweep", "update-knowledge-links",
    "update-roles", "update-webhook", "validated", "unverifiable", "contradicted", "job-failure",
    "review-item-resolved", "review-resolution-refused", "project-value-appended",
    "file", "config-set", "member_changed", "online-publication", "adopted-preexisting", "capture-pre-activation",
    "spec-review-resolved", "spec-review-dismissed", "spec-draft-created", "spec-activated", "spec-updated",
    "spec-deprecated", "spec-restored", "spec-reattributed", "spec-property-key-changed",
    "spec-property-key-cutover-started", "spec-property-key-cutover-prepared", "spec-property-key-cutover-finalized",
    "spec-version-cutover-prepared", "spec-version-cutover-finalized", "identity-mapping-resolved",
    "identity-mapping-dismissed", "identity-mapping-new-identity", "identity-mapping-reopened",
    "config-revision-validated", "value-drafted", "value-draft-removed", "value-change-submitted",
    "value-change-reviewed", "value-change-applied", "value-change-withdrawn", "enablement-changed",
    "baseline-mutated", "identity-migrated", "proposal-create-draft", "proposal-submit-existing",
    "proposal-submit", "proposal-withdraw", "proposal-accept", "proposal-reject",
    "proposal-create-draft-refused", "proposal-submit-existing-refused", "proposal-submit-refused",
    "proposal-withdraw-refused", "proposal-accept-refused", "proposal-reject-refused",
    "Canonical project history must be retained; deletion refused."
  ])("labels production action %s (audit writers, governance, proposal and SQL receipts)", (code) => {
    expect(presentAuditAction(code)).toEqual({ label: expect.stringMatching(/[\u4e00-\u9fff]/), isRaw: false });
  });
  it.each([
    ["value-change-applied", "参数值变更已应用"],
    ["project-value-appended", "新增项目参数值"],
    ["spec-draft-created", "新建定义草稿"]
  ])("presents production action %s in Chinese", (code, label) => {
    expect(presentAuditAction(code)).toEqual({ label, isRaw: false });
  });
  it("maps known action slugs to product Chinese", () => {
    expect(presentAuditAction("recompute")).toEqual({ label: "重算影响", isRaw: false });
    expect(presentAuditAction("login")).toEqual({ label: "登录", isRaw: false });
    expect(presentAuditAction("replace-roles")).toEqual({ label: "调整角色", isRaw: false });
  });

  it("passes through Chinese free-form actions from mock data", () => {
    expect(presentAuditAction("更新 CPU 频率")).toEqual({ label: "更新 CPU 频率", isRaw: false });
  });

  it("flags unknown slugs as raw", () => {
    expect(presentAuditAction("spec-quantum-entangle")).toEqual({ label: "spec-quantum-entangle", isRaw: true });
  });
});
