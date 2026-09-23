import { describe, expect, it } from "vitest";
import { bindingCompareListResponseSchema, bindingHistoryListResponseSchema } from "./parameterCatalog";

describe("canonical topology query wire", () => {
  const identity = {
    bindingId: "pbind-instance-a",
    definitionId: "pdef-current-limit",
    effectiveRevisionId: "drev-2",
    definitionRevisionId: "drev-1",
    currentValueId: "pval-a"
  };

  it("accepts the instance query envelope without inventing a shared Catalog release or pagination", () => {
    const response = { items: [{ ...identity, projectId: "project-a", projectName: "Project A", rawValue: "<1000>",
      sourceOccurrenceId: "occurrence-a", sourceLocator: { nodePath: "/charger0", propertyName: "iin_max" } }] };
    expect(bindingCompareListResponseSchema.parse(response)).toEqual(response);
    expect(bindingCompareListResponseSchema.safeParse({ items: [{ ...response.items[0], definitionRevisionId: undefined }] }).success).toBe(false);
    expect(bindingCompareListResponseSchema.safeParse({ items: [{ ...response.items[0], parameterSpecId: "legacy" }] }).success).toBe(false);
  });

  it("retains exact event identities and permits a revision event before the first value", () => {
    const response = { items: [{ ...identity, currentValueId: undefined, id: "event-a", changedAt: "2026-09-23T00:00:00Z",
      recordedAt: "2026-09-23T00:00:00Z", oldDefinitionRevisionId: null, newDefinitionRevisionId: "drev-2",
      oldCurrentValueId: null, newCurrentValueId: null, fromRawValue: null, toRawValue: null, valueState: null }] };
    expect(bindingHistoryListResponseSchema.parse(response)).toEqual(response);
    expect(bindingHistoryListResponseSchema.safeParse({ items: [{ ...response.items[0], bindingId: undefined }] }).success).toBe(false);
    expect(bindingHistoryListResponseSchema.safeParse({ ...response, unexpected: true }).success).toBe(false);
  });
});
