import { describe, expect, it } from "vitest";

import {
  createLogBodySchema,
  createLogFileBodySchema,
  listLogsQuerySchema,
  logFeedbackBodySchema,
  scopedRelatedParameterId
} from "./schemas";

describe("log schemas", () => {
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
        bindingId: "binding-1",
        definitionRevisionId: "drev-1"
      }
    };
    expect(createLogFileBodySchema.safeParse(file).success).toBe(true);
    expect(
      createLogFileBodySchema.safeParse({
        ...file,
        relatedParameterPin: { kind: "canonical-pin", bindingId: "binding-other" }
      }).success
    ).toBe(false);
    expect(scopedRelatedParameterId(file)).toBe("binding-1");
    expect(
      createLogBodySchema.safeParse({
        fileObjectId: "file-1",
        fileName: "pack-controller.log",
        relatedParameterPin: { kind: "canonical-pin", bindingId: "binding-1" }
      }).success
    ).toBe(true);
  });

  it("rejects invalid feedback rating and long feedback notes", () => {
    expect(logFeedbackBodySchema.safeParse({ rating: "ok" }).success).toBe(false);
    expect(logFeedbackBodySchema.safeParse({ rating: "helpful", note: "a".repeat(2001) }).success).toBe(false);
  });
});
