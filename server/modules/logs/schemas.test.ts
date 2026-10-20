import { describe, expect, it, vi } from "vitest";
import { logValidationIssues } from "./validationMessages";
import { logSkillSpecSchema } from "./skillSpec";
import { defaultChargingRuleSet } from "./chargingSignalRules";

import {
  createLogBodySchema,
  createLogFileBodySchema,
  listLogsQuerySchema,
  logFeedbackBodySchema,
  replaceLogSkillSampleBodySchema,
  scopedRelatedParameterId
} from "./schemas";

describe("log schemas", () => {
  it("localizes default validation diagnostics without changing authored skill text or machine fields", () => {
    const invalid = createLogBodySchema.safeParse({ fileName: "device.log" });
    expect(invalid.success).toBe(false);
    if (!invalid.success) expect(logValidationIssues(invalid.error.issues)).toEqual([
      expect.objectContaining({ code: "invalid_type", path: ["fileObjectId"], message: "缺少必需字段（预期 string，实际 undefined）" })
    ]);
    const literal = logSkillSpecSchema.safeParse({ schemaVersion: "unsupported" });
    expect(literal.success).toBe(false);
    if (!literal.success) expect(logValidationIssues(literal.error.issues)).toContainEqual(
      expect.objectContaining({ code: "invalid_literal", message: "必须为 skill/v1" })
    );
    expect(logValidationIssues([{ code: "custom", path: ["pattern"], message: "syntax offset=17" }])[0].message)
      .toBe("配置无效：syntax offset=17");
    const authored = "Administrator-authored text remains unchanged.";
    const skill = logSkillSpecSchema.parse({ schemaVersion: "skill/v1", procedure: authored,
      signalRules: { ...defaultChargingRuleSet, noHit: { ...defaultChargingRuleSet.noHit, conclusion: authored } } });
    expect(skill.procedure).toBe(authored);
    expect(skill.signalRules?.noHit.conclusion).toBe(authored);
  });
  it("trims source version labels and rejects empty or oversized labels on both upload APIs", () => {
    for (const [schema, input] of [
      [createLogFileBodySchema, { fileName: "device.log", contentType: "text/plain", contentBase64: "YQ==" }],
      [createLogBodySchema, { fileObjectId: "file", fileName: "device.log" }]
    ] as const) {
      expect(schema.parse({ ...input, sourceVersion: " firmware-v7 " }).sourceVersion).toBe("firmware-v7");
      for (const sourceVersion of [" ", "x".repeat(201)])
        expect(schema.safeParse({ ...input, sourceVersion }).success).toBe(false);
    }
  });
  it("rejects an oversized sample before decoding base64", () => {
    const contentBase64 = "A".repeat(Math.ceil(2 * 1024 * 1024 * 4 / 3) + 5);
    const decode = vi.spyOn(Buffer, "from");
    try {
      const result = replaceLogSkillSampleBodySchema.safeParse({ fileName: "sample.log", contentBase64 });
      expect(result.success).toBe(false);
      expect(decode).not.toHaveBeenCalled();
    } finally { decode.mockRestore(); }
  });

  it("accepts a 2 MiB sample and rejects empty, malformed or noncanonical base64", () => {
    const parse = (contentBase64: string) => replaceLogSkillSampleBodySchema.safeParse({ fileName: "sample.log", contentBase64 });
    expect(parse(Buffer.alloc(2 * 1024 * 1024, 65).toString("base64")).success).toBe(true);
    for (const value of ["", "not base64!!!", "YQ=", "YR=="])
      expect(parse(value).success).toBe(false);
  });
  it("accepts valid base64 log file content", () => {
    const result = createLogFileBodySchema.safeParse({
      fileName: "pack-controller.log",
      contentType: "text/plain",
      contentBase64: Buffer.from("abc").toString("base64")
    });

    expect(result.success).toBe(true);
  });

  it("rejects empty or invalid base64 log file content", () => {
    expect(
      createLogFileBodySchema.safeParse({
        fileName: "pack-controller.log",
        contentType: "text/plain",
        contentBase64: ""
      }).success
    ).toBe(false);
    expect(
      createLogFileBodySchema.safeParse({
        fileName: "pack-controller.log",
        contentType: "text/plain",
        contentBase64: "not base64!!!"
      }).success
    ).toBe(false);
  });

  it("accepts includeArchived booleans and string booleans", () => {
    expect(listLogsQuerySchema.parse({ includeArchived: true }).includeArchived).toBe(true);
    expect(listLogsQuerySchema.parse({ includeArchived: false }).includeArchived).toBe(false);
    expect(listLogsQuerySchema.parse({ includeArchived: "true" }).includeArchived).toBe(true);
    expect(listLogsQuerySchema.parse({ includeArchived: "false" }).includeArchived).toBe(false);
  });

  it("rejects repeated query arrays for scalar filters", () => {
    expect(listLogsQuerySchema.safeParse({ status: ["complete"] }).success).toBe(false);
    expect(listLogsQuerySchema.safeParse({ timeWindow: ["7d"] }).success).toBe(false);
    expect(listLogsQuerySchema.safeParse({ includeArchived: ["true"] }).success).toBe(false);
  });

  it("rejects invalid status and time window filters", () => {
    expect(listLogsQuerySchema.safeParse({ status: "done" }).success).toBe(false);
    expect(listLogsQuerySchema.safeParse({ timeWindow: "90d" }).success).toBe(false);
  });

  it("accepts a matching relatedParameterPin and rejects a mismatched binding id", () => {
    const file = {
      fileName: "pack-controller.log",
      contentType: "text/plain",
      contentBase64: Buffer.from("abc").toString("base64"),
      relatedParameterId: "binding-1",
      relatedParameterPin: {
        kind: "canonical-pin" as const,
        projectId: "project-1",
        bindingId: "binding-1",
        definitionRevisionId: "drev-1"
      }
    };
    expect(createLogFileBodySchema.safeParse(file).success).toBe(true);
    expect(
      createLogFileBodySchema.safeParse({
        ...file,
        relatedParameterPin: { kind: "canonical-pin", projectId: "project-1", bindingId: "binding-other" }
      }).success
    ).toBe(false);
    expect(scopedRelatedParameterId(file)).toBe("binding-1");
    expect(
      createLogBodySchema.safeParse({
        fileObjectId: "file-1",
        fileName: "pack-controller.log",
        relatedParameterPin: { kind: "canonical-pin", projectId: "project-1", bindingId: "binding-1" }
      }).success
    ).toBe(true);
  });

  it("rejects invalid feedback rating and long feedback notes", () => {
    expect(logFeedbackBodySchema.safeParse({ rating: "ok" }).success).toBe(false);
    expect(logFeedbackBodySchema.safeParse({ rating: "helpful", note: "a".repeat(2001) }).success).toBe(false);
  });
});
