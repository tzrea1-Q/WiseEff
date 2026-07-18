import { describe, expect, it } from "vitest";

import { submitRoundBodySchema } from "./schemas";

describe("submitRoundBodySchema binding draft actions", () => {
  const exactIdentity = {
    draftId: "draft-delete",
    projectParameterBindingId: "binding-gpio-int",
    parameterSpecId: "spec-gpio-int",
    reason: "Remove the board override"
  };

  it("preserves an explicit delete action with an empty target tombstone", () => {
    const parsed = submitRoundBodySchema.parse({
      projectId: "project-aurora",
      items: [{ ...exactIdentity, action: "delete", targetValue: "" }]
    });

    expect(parsed.items[0]).toEqual({ ...exactIdentity, action: "delete", targetValue: "" });
  });

  it("defaults existing exact set submissions to set and keeps their non-empty target", () => {
    const parsed = submitRoundBodySchema.parse({
      projectId: "project-aurora",
      items: [{ ...exactIdentity, targetValue: "<&gpio13 30 0>" }]
    });

    expect(parsed.items[0]).toEqual({
      ...exactIdentity,
      action: "set",
      targetValue: "<&gpio13 30 0>"
    });
  });

  it("rejects contradictory set/delete target shapes", () => {
    expect(() =>
      submitRoundBodySchema.parse({
        projectId: "project-aurora",
        items: [{ ...exactIdentity, action: "delete", targetValue: "<&gpio13 30 0>" }]
      })
    ).toThrow();
    expect(() =>
      submitRoundBodySchema.parse({
        projectId: "project-aurora",
        items: [{ ...exactIdentity, action: "set", targetValue: "" }]
      })
    ).toThrow();
  });
});
