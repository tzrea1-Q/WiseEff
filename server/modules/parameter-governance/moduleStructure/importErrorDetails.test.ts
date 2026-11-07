import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "../../../shared/http/errors";
import { moduleStructureUpdateDocumentSchema } from "../../contracts/dtoSchemas/moduleStructure";
import { enrichModuleStructureError } from "./importErrorDetails";

function diagnostics(error: ApiError, raw: unknown) {
  return (enrichModuleStructureError(error, raw) as ApiError).details as { issues: Record<string, unknown>[]; truncated: boolean };
}
function schemaDiagnostics(schema: z.ZodTypeAny, raw: unknown) {
  const parsed = schema.safeParse(raw);
  if (parsed.success) throw new Error("Expected schema failure");
  return diagnostics(new ApiError("VALIDATION_FAILED", "Invalid module structure document.", { issues: parsed.error.issues }), raw);
}

describe("import diagnostic context", () => {
  it("preserves null and missing root values and uses the empty file-root pointer", () => {
    const schema = z.object({ document: z.object({ modules: z.array(z.unknown()) }) });
    expect(schemaDiagnostics(schema, { document: null }).issues[0]).toMatchObject({
      path: "document", jsonPointer: "", received: null, rule: "类型必须为 object。",
    });
    expect(schemaDiagnostics(schema, {}).issues[0]).toMatchObject({ path: "document", jsonPointer: "", received: "（字段缺失）" });
    expect(schemaDiagnostics(schema, { document: false }).issues[0]).toMatchObject({ jsonPointer: "", received: false });
  });
  it("locates a subject by identity and exact file pointer without copying the entire document", () => {
    const raw = { document: { subjects: [{ subjectId: "csub_battery", kind: "node-type", displayAlias: "电池检查节点",
      recognition: { override: { nodeTypeName: "battery_checker@0" } } }], unrelated: "not-in-report" } };
    const result = diagnostics(new ApiError("VALIDATION_FAILED", "Invalid recognition", { issues: [{
      path: "document.subjects.0.recognition.override.nodeTypeName", code: "unit-address-present", message: "节点类型名包含地址。",
      rule: "不得包含 @ 地址", hint: "移除 @ 地址后缀", example: "battery_checker",
    }] }), raw);
    expect(result.issues[0]).toMatchObject({ path: "document.subjects.0.recognition.override.nodeTypeName",
      jsonPointer: "/subjects/0/recognition/override/nodeTypeName", received: "battery_checker@0",
      subject: { index: 0, subjectId: "csub_battery", kind: "node-type", displayAlias: "电池检查节点" },
      rule: "不得包含 @ 地址", example: "battery_checker" });
    expect(JSON.stringify(result)).not.toContain("not-in-report");
  });

  it("enriches old path-only module errors and preserves domain values", () => {
    const raw = { document: { modules: [{ ref: "module-1", name: "充电", sortOrder: false }] } };
    const result = diagnostics(new ApiError("VALIDATION_FAILED", "Invalid", { path: "modules.0.sortOrder" }), raw);
    expect(result.issues[0]).toMatchObject({ received: false, jsonPointer: "/modules/0/sortOrder", module: { ref: "module-1", name: "充电", index: 0 } });
    const existing = diagnostics(new ApiError("VALIDATION_FAILED", "Invalid", { issues: [{ path: "document.modules.0.sortOrder", expected: 0, received: null }] }), raw);
    expect(existing.issues[0]).toMatchObject({ expected: 0, received: null });
  });

  it("explains enum and type failures with actual values rather than Zod type names", () => {
    const schema = z.object({ document: z.object({ subjects: z.array(z.object({ subjectId: z.string(),
      recognition: z.object({ override: z.object({ driverNature: z.enum(["physical-device", "logical-service"]), compatibles: z.array(z.string()) }) }) })) }) });
    const raw = { document: { subjects: [{ subjectId: "driver-1", recognition: { override: { driverNature: "physical", compatibles: "acme,power" } } }] } };
    const result = schemaDiagnostics(schema, raw);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "document.subjects.0.recognition.override.driverNature", received: "physical",
        allowedValues: ["physical-device", "logical-service"], hint: expect.any(String) }),
      expect.objectContaining({ path: "document.subjects.0.recognition.override.compatibles", received: "acme,power", rule: expect.stringContaining("array") }),
    ]));
  });

  it("points unknown keys to their exact JSON Pointer with escaped key segments", () => {
    const result = schemaDiagnostics(z.object({ document: z.object({ "valid": z.string() }).strict() }), { document: { valid: "yes", "x/y~z.key": false } });
    expect(result.issues[0]).toMatchObject({ jsonPointer: "/x~1y~0z.key", received: false, hint: expect.stringContaining("删除") });
  });

  it("selects the relevant placement union branch and lists valid kind values", () => {
    const schema = z.object({ document: z.object({ subjects: z.array(moduleStructureUpdateDocumentSchema.shape.subjects.element) }) });
    const missing = schemaDiagnostics(schema, { document: { subjects: [{ subjectId: "driver-1", placement: { kind: "module" } }] } });
    expect(missing.issues).toHaveLength(1);
    expect(missing.issues[0]).toMatchObject({ path: "document.subjects.0.placement.moduleRef", received: "（字段缺失）", rule: expect.stringContaining("string") });
    const wrongKind = schemaDiagnostics(schema, { document: { subjects: [{ subjectId: "driver-1", placement: { kind: "business" } }] } });
    expect(wrongKind.issues[0]).toMatchObject({ path: "document.subjects.0.placement.kind", received: "business", allowedValues: ["unset", "unclassified", "module", "reference"] });
  });

  it("preserves failure bounds, authorized identity and permission error behavior", () => {
    const raw = { document: { subjects: [{ subjectId: "s".repeat(3000), kind: "spoofed", recognition: { override: "x".repeat(4000) } }] } };
    const result = diagnostics(new ApiError("VALIDATION_FAILED", "Invalid", { issues: Array.from({ length: 51 }, () => ({
      path: "subjects.0.recognition.override", subject: { subjectId: "actual-subject", kind: "driver" }, received: "x".repeat(4000),
    })) }), raw);
    expect(result.issues).toHaveLength(50);
    expect(result.truncated).toBe(true);
    expect(result.issues[0]).toMatchObject({ receivedTruncated: true, subject: { subjectId: "actual-subject", kind: "driver" } });
    expect(String(result.issues[0].received).length).toBeLessThan(1100);
    const forbidden = new ApiError("FORBIDDEN", "Denied", { path: "subjects.0" });
    expect(enrichModuleStructureError(forbidden, raw)).toBe(forbidden);
  });
});
