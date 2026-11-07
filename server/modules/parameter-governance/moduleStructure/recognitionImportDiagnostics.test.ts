import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "../../../shared/http/errors";
import { prefixSubjectSchemaIssues, recognitionShapeError, recognitionShapeIssues, withRecognitionImportContext } from "./recognitionImportDiagnostics";

describe("recognition import diagnostics", () => {
  it("preserves path segments and prefixes nested copy-schema union errors", () => {
    const parsed = z.array(z.object({ placement: z.union([
      z.object({ kind: z.literal("module"), moduleRef: z.string() }).strict(),
      z.object({ kind: z.literal("unset") }).strict(),
    ]) })).safeParse([{ placement: { kind: "module", "bad.key/~": true } }]);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issue = prefixSubjectSchemaIssues(parsed.error.issues)[0];
    expect(issue.path).toEqual(["document", "subjects", 0, "placement"]);
    expect(issue.unionErrors).toEqual(expect.arrayContaining([expect.objectContaining({ issues: expect.arrayContaining([
      expect.objectContaining({ path: ["document", "subjects", 0, "placement", "moduleRef"] }),
      expect.objectContaining({ path: ["document", "subjects", 0, "placement"], keys: ["bad.key/~"] }),
    ]) })]));
  });
  it("keeps precise parser failures and identifies the actual imported Subject without copying its snapshot", async () => {
    const subject = { subjectId: "csub_battery_checker", kind: "node-type" as const, displayAlias: "电池检查节点", recognition: { unwanted: "full snapshot" } };
    const original = new ApiError("VALIDATION_FAILED", "识别标识格式无效。", {
      reason: "invalid-recognition-rule", truncated: false, issueLimit: 50,
      issues: [{ path: "nodeTypeName", code: "unit-address-present", received: "battery_checker@0", message: "节点类型名不能包含 @地址。", rule: "使用不带地址的节点类型名。", hint: "移除 @地址。", example: "battery_checker" }],
    });
    const error = await withRecognitionImportContext(32, subject, "override", async () => { throw original; }).catch(value => value);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.details).toMatchObject({ reason: "invalid-recognition-rule", path: "subjects.32.recognition.override", issueLimit: 50,
      issues: [{ path: "document.subjects.32.recognition.override.nodeTypeName", received: "battery_checker@0", example: "battery_checker", code: "unit-address-present" }] });
    expect(error.details.issues[0].subject).toEqual({ index: 32, subjectId: subject.subjectId, kind: "node-type", displayAlias: "电池检查节点" });
    expect(JSON.stringify(error.details)).not.toContain("full snapshot");
  });

  it("preserves multiple compatible item errors and does not prefix an already contextualized path twice", async () => {
    const original = new ApiError("VALIDATION_FAILED", "invalid", { truncated: true, issues: [
      { path: ["compatibles", 1], code: "wildcard-forbidden", received: "acme,*" },
      { path: "document.subjects.5.recognition.override.compatibles.2", code: "surrounding-whitespace", received: " acme,power" },
    ] });
    const error = await withRecognitionImportContext(5, { subjectId: "driver", kind: "driver" }, "override", async () => { throw original; }).catch(value => value);
    expect(error.details.truncated).toBe(true);
    expect(error.details.issues.map((issue: { path: string }) => issue.path)).toEqual([
      "document.subjects.5.recognition.override.compatibles.1", "document.subjects.5.recognition.override.compatibles.2",
    ]);
  });

  it("retains capacity conflicts and explains the inherited read-only field rather than reporting a format error", async () => {
    const error = await withRecognitionImportContext(0, { subjectId: "driver", kind: "driver" }, "effective", async () => {
      throw new ApiError("CONFLICT", "已有项目实例超过单例容量。");
    }).catch(value => value);
    expect(error.code).toBe("CONFLICT");
    expect(error.details.issues[0]).toMatchObject({ path: "document.subjects.0.recognition.effective.instanceCardinality", received: "singleton-per-project",
      hint: expect.stringContaining("effective 不可直接修改") });
  });

  it("does not convert unexpected or permission errors into public validation diagnostics", async () => {
    for (const original of [new Error("internal"), new ApiError("FORBIDDEN", "denied")]) {
      await expect(withRecognitionImportContext(0, { subjectId: "driver" }, "override", async () => { throw original; })).rejects.toBe(original);
    }
  });

  it("explains mismatched kind fields while retaining legal neutral snapshot fields", () => {
    const driver = { mode: "override" as const, override: { compatibles: ["acme,power"], driverNature: "physical-device", instanceCardinality: "multiple", nodeTypeName: null } };
    const node = { mode: "override" as const, override: { compatibles: [], driverNature: null, instanceCardinality: null, nodeTypeName: "battery_checker" } };
    expect(recognitionShapeIssues("driver", driver, "copy")).toEqual([]);
    expect(recognitionShapeIssues("node-type", node, "copy")).toEqual([]);
    expect(recognitionShapeIssues("driver", { ...driver, override: { ...driver.override, nodeTypeName: "battery_checker" } }, "copy")).toEqual([
      expect.objectContaining({ path: "override.nodeTypeName", expected: null, received: "battery_checker", code: "recognition-field-kind-mismatch" }),
    ]);
    expect(recognitionShapeIssues("node-type", { ...node, override: { ...node.override, compatibles: ["acme,power"] } }, "copy")).toEqual([
      expect.objectContaining({ path: "override.compatibles", expected: [], received: ["acme,power"] }),
    ]);
  });

  it("distinguishes required values, inherited overrides and read-only new-registration fields", () => {
    expect(recognitionShapeIssues("driver", { mode: "override", override: { driverNature: null, instanceCardinality: null } }, "new")).toEqual([
      expect.objectContaining({ path: "override.driverNature", allowedValues: ["physical-device", "logical-service"] }),
      expect.objectContaining({ path: "override.instanceCardinality", allowedValues: ["multiple", "singleton-per-project"] }),
    ]);
    expect(recognitionShapeIssues("node-type", { mode: "inherit", override: { nodeTypeName: "battery_checker" }, effective: {} }, "new")).toEqual([
      expect.objectContaining({ path: "effective", hint: expect.stringContaining("删除 recognition.effective") }),
      expect.objectContaining({ path: "override", expected: null }),
    ]);
    expect(recognitionShapeIssues("driver", { mode: "override", override: { compatibles: ["acme,power"] } }, "new")).toEqual([]);
  });

  it("locates configuration-schema recognition and missing mode failures at the actionable field", () => {
    const issues = recognitionShapeIssues("configuration-schema", { mode: "override", override: { compatibles: ["acme,power"] } }, "new");
    const error = recognitionShapeError(2, { subjectId: "schema", kind: "configuration-schema" }, "invalid", issues);
    expect(error.details.issues).toEqual([expect.objectContaining({ path: "document.subjects.2.recognition", expected: null,
      subject: { index: 2, subjectId: "schema", kind: "configuration-schema" } })]);
    expect(recognitionShapeIssues("driver", { override: { compatibles: ["acme,power"] } }, "new")).toEqual([
      expect.objectContaining({ path: "mode", allowedValues: ["inherit", "override"] }),
    ]);
  });
});
