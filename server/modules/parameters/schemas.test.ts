import { describe, expect, it } from "vitest";

import { initializationSnapshotItemSchema, submitRoundBodySchema } from "./schemas";

it("requires an immutable canonical value identity for an initialization snapshot", () => {
  const item = {
    id: "preview-1", sourceProjectId: "source", sourceProjectParameterBindingId: "binding-1",
    sourceRole: "primary", parameterSpecId: "definition-1", parameterSpecVersionId: "revision-1",
    propertyKey: "limit", moduleId: "module-1", risk: null, effectiveValue: 36.5, rawValue: "36.5",
    currentValueState: "pending_project_confirmation", alternativeSourceBindingIds: [],
    needsEffectiveValueConfirmation: false
  };
  expect(initializationSnapshotItemSchema.safeParse(item).success).toBe(false);
  expect(initializationSnapshotItemSchema.parse({ ...item, sourceProjectValueId: "value-1" }))
    .toMatchObject({ sourceProjectValueId: "value-1", sourceProjectParameterBindingId: "binding-1" });
});

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

describe("submitRoundBodySchema enablement draft actions", () => {
  const enablementIdentity = {
    draftId: "draft-enablement",
    editSubjectKind: "node-enablement" as const,
    logicalNodeId: "logical-charging-core",
    reason: "Disable charging_core for bring-up"
  };

  it("parses enablement set submissions", () => {
    const parsed = submitRoundBodySchema.parse({
      projectId: "project-aurora",
      items: [{ ...enablementIdentity, action: "set", targetValue: '"disabled"' }]
    });

    expect(parsed.items[0]).toEqual({
      ...enablementIdentity,
      action: "set",
      targetValue: '"disabled"'
    });
  });

  it("preserves enablement delete tombstones", () => {
    const parsed = submitRoundBodySchema.parse({
      projectId: "project-aurora",
      items: [{ ...enablementIdentity, action: "delete", targetValue: "" }]
    });

    expect(parsed.items[0]).toEqual({
      ...enablementIdentity,
      action: "delete",
      targetValue: ""
    });
  });
});
