import { describe, expect, it } from "vitest";
import { presentAuditAction, presentAuditKind } from "./auditSlugLabels";

describe("presentAuditKind", () => {
  it("maps known backend kind slugs to product Chinese", () => {
    expect(presentAuditKind("auth-event")).toEqual({ label: "认证事件", isRaw: false });
    expect(presentAuditKind("parameter-module-bindings-recomputed")).toEqual({ label: "模块绑定重算", isRaw: false });
    expect(presentAuditKind("log-upload-failed")).toEqual({ label: "日志上传失败", isRaw: false });
  });

  it("flags unknown slugs as raw so views render them in code style", () => {
    expect(presentAuditKind("some-future-kind")).toEqual({ label: "some-future-kind", isRaw: true });
  });
});

describe("presentAuditAction", () => {
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
