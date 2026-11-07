import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { WiseEffApiError, type ApiClient } from "@/infrastructure/http/apiClient";
import { ModuleStructureImport } from "./ModuleStructureImport";
import { importDiagnostic, ModuleStructureImportError } from "./ModuleStructureImportError";

it("accepts formatted files over 4 MiB but rejects content over 4 MiB", async () => {
  const user = userEvent.setup();
  render(<ModuleStructureImport apiClient={{ post: vi.fn() } as unknown as ApiClient} organizationId="org-a" canImport />);
  await user.click(screen.getByRole("button", { name: "导入结构" }));
  const input = screen.getByLabelText("JSON 文件");
  const boundary = { value: "x".repeat(4 * 1024 * 1024 - 12) };
  expect(new TextEncoder().encode(JSON.stringify(boundary))).toHaveLength(4 * 1024 * 1024);
  await user.upload(input, new File([JSON.stringify(boundary, null, 2)], "formatted.json", { type: "application/json" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "预览" })).toBeEnabled());
  await user.upload(input, new File([JSON.stringify({ value: "中".repeat(1_400_000) })], "large.json", { type: "application/json" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("JSON 内容不能超过 4 MiB");
  expect(screen.getByRole("button", { name: "预览" })).toBeDisabled();
  await user.upload(input, new File([" ".repeat(32 * 1024 * 1024 + 1)], "oversized.json", { type: "application/json" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("JSON 文件不能超过 32 MiB");
});

it("re-previews conflict choices and preserves the request key for a failed apply retry", async () => {
  const post = vi.fn().mockResolvedValueOnce({ changes: [], conflicts: [{ key: "a:name", moduleId: "a", field: "name", baseline: "old", file: "file", current: "current" }], token: "one" })
    .mockResolvedValueOnce({ changes: [{ moduleId: "a", field: "name", before: "current", after: "file" }], conflicts: [], token: "two" })
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce({ id: "receipt", organizationId: "org-a", changedModules: 1, changedFields: 1 });
  const user = userEvent.setup();
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canImport />);
  await user.click(screen.getByRole("button", { name: "导入结构" }));
  await user.upload(screen.getByLabelText("JSON 文件"), new File(['{"source":{"organizationId":"org-a"}}'], "edit.json", { type: "application/json" }));
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  await user.click(screen.getByRole("button", { name: "预览" }));
  expect(await screen.findByText('old')).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "确认提交" })).toBeDisabled();
  await user.click(screen.getByLabelText("a:name 的冲突选择"));
  await user.click(screen.getByRole("option", { name: "采用文件" }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  await user.type(screen.getByLabelText("变更原因"), "reviewed");
  await user.click(await screen.findByRole("button", { name: "确认提交" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("网络连接失败");
  await user.click(screen.getByRole("button", { name: "确认提交" }));
  expect(await screen.findByText(/回执 receipt/)).toBeInTheDocument();
  expect(post.mock.calls[2][1].idempotencyKey).toBe(post.mock.calls[3][1].idempotencyKey);
  const cleanUnload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(cleanUnload);
  expect(cleanUnload.defaultPrevented).toBe(false);
});

it("reports a no-op receipt", async () => {
  const post = vi.fn().mockResolvedValueOnce({ changes: [], conflicts: [], token: "no-op" })
    .mockResolvedValueOnce({ id: "unchanged", organizationId: "org-a", changedModules: 0, changedFields: 0 });
  const user = userEvent.setup();
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canImport />);
  await user.click(screen.getByRole("button", { name: "导入结构" }));
  await user.upload(screen.getByLabelText("JSON 文件"), new File(["{}"], "same.json", { type: "application/json" }));
  await user.click(screen.getByRole("button", { name: "预览" }));
  await user.type(await screen.findByLabelText("变更原因"), "unchanged");
  await user.click(screen.getByRole("button", { name: "确认提交" }));
  expect(await screen.findByRole("status")).toHaveTextContent("没有领域数据变更");
});

it("requires an explicit target mapping before confirming a copy", async () => {
  const suggestion = { ref: "source", selected: null, frozen: false, candidates: [{ id: "target", name: "Power", suggested: true }] };
  const post = vi.fn().mockResolvedValueOnce({ changes: [], conflicts: [{ key: "mapping:source", field: "mapping" }], mappings: [suggestion], targets: [{ id: "target", name: "Power (target)" }], token: "one" })
    .mockResolvedValueOnce({ changes: [], conflicts: [], mappings: [{ ...suggestion, selected: "target" }], targets: [], token: "two" })
    .mockResolvedValueOnce({ id: "copied", organizationId: "target-org", changedModules: 0, changedFields: 0 });
  const user = userEvent.setup();
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="target-org" canImport />);
  await user.click(screen.getByRole("button", { name: "导入结构" }));
  await user.click(screen.getByLabelText("导入模式")); await user.click(screen.getByRole("option", { name: "复制到当前组织" }));
  await user.upload(screen.getByLabelText("JSON 文件"), new File(['{"source":{"organizationId":"source-org"},"modules":[{"ref":"source","name":"Power"}]}'], "copy.json", { type: "application/json" }));
  await user.click(screen.getByRole("button", { name: "预览" }));
  expect(await screen.findByText(/来源组织：source-org；目标组织：target-org/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "确认提交" })).toBeDisabled();
  await user.click(screen.getByLabelText("source 的目标模块")); await user.click(screen.getByRole("option", { name: "建议：复用 Power" }));
  await user.type(await screen.findByLabelText("变更原因"), "Reviewed copy");
  await user.click(screen.getByRole("button", { name: "确认提交" }));
  expect(await screen.findByText(/回执 copied/)).toBeInTheDocument();
  expect(post.mock.calls[1][1]).toMatchObject({ mode: "copy", mappings: { source: "target" } });
  expect(post.mock.calls[2][1]).toMatchObject({ mode: "copy", mappings: { source: "target" }, token: "two" });
});

it("shows the full placement path, unset and affected projects", async () => {
  const post = vi.fn().mockResolvedValue({ changes: [{ moduleId: "subject:driver", field: "placement",
    before: { kind: "unset" }, after: { kind: "module", moduleRef: "child" } }], conflicts: [],
    impact: [{ subjectId: "driver", projectId: "project-a", bindingCount: 2, definitions: ["definition-a"] }], token: "preview" });
  const user = userEvent.setup();
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canImport />);
  await user.click(screen.getByRole("button", { name: "导入结构" }));
  await user.upload(screen.getByLabelText("JSON 文件"), new File([JSON.stringify({ modules: [
    { ref: "root", name: "电源", parentRef: null }, { ref: "child", name: "充电", parentRef: "root" },
  ] })], "edit.json", { type: "application/json" }));
  await user.click(screen.getByRole("button", { name: "预览" }));
  expect(await screen.findByText(/未设置归属 → 电源 \/ 充电/)).toBeInTheDocument();
  expect(screen.getByText(/主体 driver · 项目 project-a · 绑定 2 · 定义 definition-a/)).toBeInTheDocument();
});

it("groups subject changes and explains recognition settings field by field", async () => {
  const post = vi.fn().mockResolvedValue({ token: "preview", conflicts: [], changes: [
    { moduleId: "subject:driver", field: "state", before: "active", after: "retired" },
    { moduleId: "driver", field: "recognition", before: { mode: "inherit", effective: { compatibles: ["old"], driverNature: "physical-device" } },
      after: { overridden: true, compatibles: ["new"], driverNature: "physical-device" } },
  ] });
  const user = userEvent.setup();
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canImport />);
  await user.click(screen.getByRole("button", { name: "导入结构" }));
  await user.upload(screen.getByLabelText("JSON 文件"), new File([JSON.stringify({ subjects: [{ subjectId: "driver", displayAlias: "充电驱动", kind: "driver" }] })], "edit.json", { type: "application/json" }));
  await user.click(screen.getByRole("button", { name: "预览" }));
  expect(await screen.findByText("充电驱动")).toBeInTheDocument();
  expect(screen.getByText(/启用 → 停用/)).toBeInTheDocument();
  expect(screen.getByText(/继承目录设置 → 自定义覆盖/)).toBeInTheDocument();
  expect(screen.getByText(/old → new/)).toBeInTheDocument();
});

const readonlyFailure = () => new WiseEffApiError("VALIDATION_FAILED", "Unsupported changes outside module metadata.", {
  reason: "readonly-module-structure-fields", issues: [
    { path: "document.counts.modules", code: "readonly_field", message: "导出数量是只读信息。", expected: 3, received: 4, hint: "恢复原始导出的数量，不要根据编辑结果重新计算。" },
    { path: "document.references.0.name", code: "readonly_field", message: "引用名称已变化。", expected: "原始引用", received: "新引用" },
  ], truncated: true, issueLimit: 50,
}, "request-import-123", 400);

it("shows field differences and copies actionable diagnostics without the uploaded document", async () => {
  const user = userEvent.setup();
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const post = vi.fn().mockRejectedValue(readonlyFailure());
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canImport />);
  await user.click(screen.getByRole("button", { name: "导入结构" }));
  await user.upload(screen.getByLabelText("JSON 文件"), new File([JSON.stringify({
    source: { organizationId: "org-a", exportId: "export-1" }, modules: [{ description: "private-content-not-needed-for-diagnostics" }],
  })], "agent-edited.json", { type: "application/json" }));
  await user.click(screen.getByRole("button", { name: "预览" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("导入文件修改了只读的导出信息");
  expect(alert).toHaveTextContent("document.counts.modules");
  expect(alert).toHaveTextContent("期望值：3");
  expect(alert).toHaveTextContent("文件值：4");
  expect(alert).toHaveTextContent("恢复原始导出的数量");
  expect(alert).toHaveTextContent("当前仅显示前 2 条");
  await user.click(screen.getByRole("button", { name: "复制诊断信息" }));
  expect(await screen.findByRole("status")).toHaveTextContent("诊断信息已复制");
  const copied = String(writeText.mock.calls[0][0]);
  expect(JSON.parse(copied)).toMatchObject({ fileName: "agent-edited.json", mode: "update", phase: "preview", exportId: "export-1",
    sourceOrganizationId: "org-a", targetOrganizationId: "org-a", requestId: "request-import-123", code: "VALIDATION_FAILED", message: "Unsupported changes outside module metadata.",
    reason: "readonly-module-structure-fields", status: 400 });
  expect(copied).not.toContain("private-content-not-needed-for-diagnostics");
  expect(screen.getByRole("button", { name: "确认提交" })).toBeDisabled();
});

it("identifies the subject and exact invalid field with allowed values and a clearly illustrative repair example", async () => {
  const user = userEvent.setup();
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const issue = {
    path: "document.subjects.32.recognition.override.driverNature", jsonPointer: "/subjects/32/recognition/override/driverNature",
    code: "invalid_enum_value", message: "driverNature 不在允许的枚举值中。",
    subject: { subjectId: "csub_charge", kind: "driver", displayAlias: "无线充电", index: 32 },
    received: "physical", allowedValues: ["physical-device", "logical-service"],
    rule: "驱动类型必须使用允许的枚举字符串。", hint: "按主体实际含义选择 physical-device 或 logical-service。", example: "physical-device",
  };
  const post = vi.fn().mockRejectedValue(new WiseEffApiError("VALIDATION_FAILED", "识别规则校验失败。", { issues: [issue] }, "request-recognition", 400));
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canImport />);
  await user.click(screen.getByRole("button", { name: "导入结构" }));
  await user.upload(screen.getByLabelText("JSON 文件"), new File(["{}"], "recognition.json", { type: "application/json" }));
  await user.click(screen.getByRole("button", { name: "预览" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("无线充电 · csub_charge · 驱动主体（driver） · subjects[32]（第 33 个主体）");
  expect(alert).toHaveTextContent(issue.path);
  expect(alert).toHaveTextContent(issue.jsonPointer);
  expect(alert).toHaveTextContent('文件值："physical"');
  expect(alert).toHaveTextContent('允许值：["physical-device","logical-service"]');
  expect(alert).toHaveTextContent(`校验规则：${issue.rule}`);
  expect(alert).toHaveTextContent(`修复建议：${issue.hint}`);
  expect(alert).toHaveTextContent('格式示例（仅示意，请按实际业务填写）："physical-device"');
  await user.click(screen.getByRole("button", { name: "复制诊断信息" }));
  expect(JSON.parse(String(writeText.mock.calls[0][0])).issues).toEqual([expect.objectContaining(issue)]);
  expect(screen.getByRole("button", { name: "确认提交" })).toBeDisabled();
});

it("keeps rich legacy path diagnostics and displays falsy values without inventing rules", async () => {
  const user = userEvent.setup();
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const diagnostic = importDiagnostic(new WiseEffApiError("VALIDATION_FAILED", "排序值不合法。", {
    path: "modules.0.sortOrder", jsonPointer: "/modules/0/sortOrder", module: { ref: "power", sourceId: "module-power", name: "电源", index: 0 },
    expected: 0, received: null, example: false, allowedValues: [0, null, false],
    unrelated: "private-detail-do-not-copy",
  }, "request-legacy", 400), "预览失败。", "preview");
  render(<ModuleStructureImportError diagnostic={diagnostic} context={{ fileName: "edit.json", mode: "update" }} />);
  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent("模块：电源 · power · modules[0]（第 1 个模块）");
  expect(alert).toHaveTextContent("期望值：0");
  expect(alert).toHaveTextContent("文件值：null");
  expect(alert).toHaveTextContent("允许值：[0,null,false]");
  expect(alert).toHaveTextContent("格式示例（仅示意，请按实际业务填写）：false");
  expect(alert).not.toHaveTextContent("校验规则：");
  await user.click(screen.getByRole("button", { name: "复制诊断信息" }));
  const report = String(writeText.mock.calls[0][0]);
  expect(JSON.parse(report).issues[0]).toMatchObject({ expected: 0, received: null, example: false, allowedValues: [0, null, false],
    module: { ref: "power", sourceId: "module-power", name: "电源", index: 0 } });
  expect(report).not.toContain("private-detail-do-not-copy");
});

it("bounds rich issue identities, repair data and the issue count without forwarding unknown fields", () => {
  const oversized = "x".repeat(5000);
  const issue = { path: "subjects.0.recognition.override", jsonPointer: oversized, message: "无效规则。", rule: oversized,
    subject: { subjectId: oversized, kind: oversized, displayAlias: oversized, index: 0, private: "do-not-copy" },
    module: { ref: oversized, sourceId: oversized, name: oversized, index: -1, private: "do-not-copy" },
    allowedValues: [oversized], example: { value: oversized }, private: "do-not-copy" };
  const diagnostic = importDiagnostic(new WiseEffApiError("VALIDATION_FAILED", "校验失败。", { issues: Array.from({ length: 51 }, () => issue) }, "request-rich-bounded", 400), "失败。", "preview");
  expect(diagnostic.issues).toHaveLength(50);
  expect(diagnostic.truncated).toBe(true);
  expect(diagnostic.issues[0]).toMatchObject({ allowedValuesTruncated: true, exampleTruncated: true, subject: { index: 0 } });
  expect(diagnostic.issues[0].module).not.toHaveProperty("index");
  for (const value of [diagnostic.issues[0].jsonPointer, diagnostic.issues[0].rule, diagnostic.issues[0].subject?.subjectId,
    diagnostic.issues[0].subject?.kind, diagnostic.issues[0].subject?.displayAlias, diagnostic.issues[0].module?.ref,
    diagnostic.issues[0].module?.sourceId, diagnostic.issues[0].module?.name, diagnostic.issues[0].allowedValues, diagnostic.issues[0].example]) {
    expect(String(value)).toContain("已截断");
    expect(String(value).length).toBeLessThan(2100);
  }
  expect(JSON.stringify(diagnostic)).not.toContain("do-not-copy");
});

it.each(["unavailable", "rejected"])("offers selected diagnostic text when clipboard is %s", async availability => {
  const user = userEvent.setup();
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: availability === "unavailable" ? undefined : { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
  try {
    render(<ModuleStructureImport apiClient={{ post: vi.fn().mockRejectedValue(readonlyFailure()) } as unknown as ApiClient} organizationId="org-a" canImport />);
    await user.click(screen.getByRole("button", { name: "导入结构" }));
    await user.upload(screen.getByLabelText("JSON 文件"), new File(["{}"], "edit.json", { type: "application/json" }));
    await user.click(screen.getByRole("button", { name: "预览" }));
    await user.click(await screen.findByRole("button", { name: "复制诊断信息" }));
    expect(await screen.findByRole("status")).toHaveTextContent("自动复制不可用");
    const text = screen.getByRole("textbox", { name: "导入诊断信息" }) as HTMLTextAreaElement;
    expect(text).toBeVisible();
    expect(text).toHaveFocus();
    expect(text.selectionStart).toBe(0);
    expect(text.selectionEnd).toBe(text.value.length);
    expect(text.value).toContain("document.counts.modules");
  } finally {
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});

it("retains the precise apply conflict and clears old diagnostics when changing mode or file", async () => {
  const post = vi.fn().mockResolvedValueOnce({ changes: [], conflicts: [], token: "preview" })
    .mockRejectedValueOnce(new WiseEffApiError("CONFLICT", "Placement destination is unavailable.", { path: "subjects.0.placement" }, "request-conflict", 409))
    .mockRejectedValueOnce(readonlyFailure());
  const user = userEvent.setup();
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canImport />);
  await user.click(screen.getByRole("button", { name: "导入结构" }));
  await user.upload(screen.getByLabelText("JSON 文件"), new File(["{}"], "edit.json", { type: "application/json" }));
  await user.click(screen.getByRole("button", { name: "预览" }));
  await user.type(await screen.findByLabelText("变更原因"), "reviewed");
  await user.click(screen.getByRole("button", { name: "确认提交" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Placement destination is unavailable.");
  expect(screen.getByRole("alert")).toHaveTextContent("subjects.0.placement");
  expect(screen.getByRole("alert")).toHaveTextContent("request-conflict");
  expect(screen.getByRole("button", { name: "确认提交" })).toBeDisabled();
  await user.click(screen.getByLabelText("导入模式"));
  await user.click(screen.getByRole("option", { name: "复制到当前组织" }));
  expect(screen.queryByLabelText("导入错误诊断")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "预览" }));
  await screen.findByRole("alert");
  await user.upload(screen.getByLabelText("JSON 文件"), new File(["{}"], "fixed.json", { type: "application/json" }));
  expect(screen.queryByLabelText("导入错误诊断")).not.toBeInTheDocument();
});

it("includes JSON parser details and legacy schema issues in diagnostics", async () => {
  const user = userEvent.setup();
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const post = vi.fn().mockRejectedValue(new WiseEffApiError("VALIDATION_FAILED", "Invalid module structure document.", {
    issues: [{ path: ["document", "modules", 0, "sortOrder"], message: "Expected number, received string" }],
  }, "request-schema", 400));
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canImport />);
  await user.click(screen.getByRole("button", { name: "导入结构" }));
  await user.upload(screen.getByLabelText("JSON 文件"), new File(['{"modules":}'], "invalid.json", { type: "application/json" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("JSON 格式无效");
  expect(screen.getByRole("alert")).toHaveTextContent(/JSON|Unexpected|position/i);
  expect(screen.getByRole("button", { name: "预览" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "复制诊断信息" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  expect(JSON.parse(String(writeText.mock.calls[0][0]))).toMatchObject({ code: "INVALID_JSON", phase: "read", fileName: "invalid.json" });
  expect(JSON.parse(String(writeText.mock.calls[0][0])).message).toMatch(/JSON|Unexpected|position/i);
  await user.upload(screen.getByLabelText("JSON 文件"), new File(["{}"], "schema.json", { type: "application/json" }));
  await user.click(screen.getByRole("button", { name: "预览" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("document.modules.0.sortOrder");
  expect(screen.getByRole("alert")).toHaveTextContent("Expected number, received string");
});

it("bounds imported metadata and error values while preserving the truncation warning", async () => {
  const user = userEvent.setup();
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const post = vi.fn().mockRejectedValue(new WiseEffApiError("VALIDATION_FAILED", "Unsupported changes outside module metadata.", {
    reason: "r".repeat(5000), issues: [{ path: "document.references.0.name", message: "引用名称已变化。", expected: "original", received: "x".repeat(5000), receivedTruncated: true }],
  }, "request-bounded", 400));
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canImport />);
  await user.click(screen.getByRole("button", { name: "导入结构" }));
  await user.upload(screen.getByLabelText("JSON 文件"), new File([JSON.stringify({ source: { organizationId: "org-a", exportId: "e".repeat(5000) } })], "edited.json", { type: "application/json" }));
  await user.click(screen.getByRole("button", { name: "预览" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("仅显示部分值");
  await user.click(screen.getByRole("button", { name: "复制诊断信息" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  const report = JSON.parse(String(writeText.mock.calls[0][0]));
  expect(report.exportId.length).toBeLessThan(3000);
  expect(report.exportId).toContain("已截断");
  expect(report.reason).toContain("已截断");
  expect(report.issues[0].received).toContain("已截断");
  expect(report.issues[0].receivedTruncated).toBe(true);
});
