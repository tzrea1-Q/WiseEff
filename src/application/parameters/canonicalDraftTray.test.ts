import { describe, expect, it } from "vitest";

import { canonicalDraftsToTrayDrafts, type CanonicalPendingDraft } from "./canonicalDraftTray";

const draft = (overrides: Partial<CanonicalPendingDraft> = {}): CanonicalPendingDraft => ({
  id: "pvd_01K",
  bindingId: "pbind_01K",
  definitionId: "pdef_01K",
  effectiveRevisionId: "drev_01K",
  baseRevisionId: "config-revision-01K",
  targetValue: "2000",
  reason: "raise published input current",
  updatedAt: "2026-09-15T00:00:00.000Z",
  ...overrides,
});

describe("canonicalDraftsToTrayDrafts", () => {
  it("maps a canonical pending draft onto the tray's hydration shape", () => {
    expect(canonicalDraftsToTrayDrafts("atlas", [draft()])).toEqual([
      {
        id: "pvd_01K",
        projectId: "atlas",
        targetValue: "2000",
        reason: "raise published input current",
        updatedAt: "2026-09-15T00:00:00.000Z",
        action: "set",
        projectParameterBindingId: "pbind_01K",
        candidateConfigRevisionId: "config-revision-01K",
        baseRevisionId: "config-revision-01K"
      }
    ]);
  });

  it("never invents a parameter identity for a canonical draft", () => {
    const [mapped] = canonicalDraftsToTrayDrafts("atlas", [draft()]);
    // The canonical model has no parameter record, so the field is absent rather
    // than filled with an id that belongs to a different entity.
    expect(mapped).not.toHaveProperty("parameterId");
    expect(mapped?.parameterId).toBeUndefined();
  });

  it("keeps the author's reason and the recency stamp across a reload", () => {
    const mapped = canonicalDraftsToTrayDrafts("aurora", [
      draft({ id: "a", reason: "first", updatedAt: "2026-09-14T00:00:00.000Z" }),
      draft({ id: "b", reason: "second", updatedAt: "2026-09-15T00:00:00.000Z" })
    ]);
    expect(mapped.map((entry) => `${entry.id}:${entry.reason}:${entry.updatedAt}`)).toEqual([
      "a:first:2026-09-14T00:00:00.000Z",
      "b:second:2026-09-15T00:00:00.000Z"
    ]);
  });

  it("preserves a canonical delete action for the review tray", () => {
    const [mapped] = canonicalDraftsToTrayDrafts("atlas", [draft({
      action: "delete",
      targetValue: ""
    })]);
    expect(mapped).toMatchObject({ action: "delete", targetValue: "" });
  });

  it("returns an empty tray for an empty canonical list", () => {
    expect(canonicalDraftsToTrayDrafts("nebula", [])).toEqual([]);
  });
});
