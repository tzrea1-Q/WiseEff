import { describe, expect, it } from "vitest";

import { xiaozeAgUiRunRequestSchema } from "@wiseeff/dto-schemas";

describe("Xiaoze AG-UI run request contract", () => {
  it("accepts a run envelope with threadId and messages", () => {
    expect(
      xiaozeAgUiRunRequestSchema.parse({
        threadId: "thread-1",
        runId: "run-1",
        messages: [{ id: "m1", role: "user", content: "hello" }],
        forwardedProps: { command: { resume: { decision: "approve" } } }
      })
    ).toMatchObject({ threadId: "thread-1", runId: "run-1" });
  });
});
