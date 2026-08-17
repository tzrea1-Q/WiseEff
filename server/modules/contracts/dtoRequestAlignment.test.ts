import { describe, expect, it } from "vitest";

import { patchXiaozeThreadBodySchema } from "../agent/xiaoze/threadSchemas";
import { createLogFileBodySchema } from "../logs/schemas";
import { saveDraftBodySchema } from "../parameters/schemas";

describe("frontend request payloads against backend request schemas", () => {
  it("accepts the log-file upload body the HTTP client sends", () => {
    expect(
      createLogFileBodySchema.parse({
        fileName: "diagnostics.csv",
        contentType: "text/csv",
        contentBase64: Buffer.from("timestamp,message\n1,ok").toString("base64"),
        analysisQuestion: "Why did charging slow?",
        relatedParameterId: "fast-charge-current"
      }).fileName
    ).toBe("diagnostics.csv");
  });

  it("accepts the parameter draft body the HTTP client sends", () => {
    expect(
      saveDraftBodySchema.parse({
        projectId: "aurora",
        parameterId: "aurora-fast-charge-current",
        targetValue: "3200",
        reason: "Reduce thermal risk."
      }).projectId
    ).toBe("aurora");
  });

  it("accepts the Xiaoze thread title patch body", () => {
    expect(patchXiaozeThreadBodySchema.parse({ title: "charge current" }).title).toBe("charge current");
  });
});
