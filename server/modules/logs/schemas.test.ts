import { describe, expect, it } from "vitest";

import { createLogFileBodySchema, listLogsQuerySchema, logFeedbackBodySchema } from "./schemas";

describe("log schemas", () => {
  it("accepts valid base64 log file content", () => {
    const result = createLogFileBodySchema.safeParse({
      projectId: "aurora",
      fileName: "pack-controller.log",
      contentType: "text/plain",
      contentBase64: Buffer.from("abc").toString("base64")
    });

    expect(result.success).toBe(true);
  });

  it("rejects empty or invalid base64 log file content", () => {
    expect(
      createLogFileBodySchema.safeParse({
        projectId: "aurora",
        fileName: "pack-controller.log",
        contentType: "text/plain",
        contentBase64: ""
      }).success
    ).toBe(false);
    expect(
      createLogFileBodySchema.safeParse({
        projectId: "aurora",
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

  it("rejects invalid feedback rating and long feedback notes", () => {
    expect(logFeedbackBodySchema.safeParse({ rating: "ok" }).success).toBe(false);
    expect(logFeedbackBodySchema.safeParse({ rating: "helpful", note: "a".repeat(2001) }).success).toBe(false);
  });
});
