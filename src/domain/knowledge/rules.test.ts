import { describe, expect, it } from "vitest";

import {
  allowedTransitions,
  canArchive,
  canEditContent,
  canGovernEntry,
  canHardDelete,
  canPublish,
  canRestore,
  canSeeEntry,
  collectKnownTags,
  isSearchable
} from "./rules";

const owner = { userId: "user-1", canEdit: true, canManage: false };
const otherEditor = { userId: "user-2", canEdit: true, canManage: false };
const viewer = { userId: "user-3", canEdit: false, canManage: false };
const manager = { userId: "user-4", canEdit: true, canManage: true };

function entry(overrides: Partial<{ status: "draft" | "published" | "archived"; createdByUserId: string }> = {}) {
  return { status: "draft" as const, createdByUserId: "user-1", ...overrides };
}

describe("knowledge domain rules", () => {
  it("treats published as the only searchable status", () => {
    expect(isSearchable({ status: "published" })).toBe(true);
    expect(isSearchable({ status: "draft" })).toBe(false);
    expect(isSearchable({ status: "archived" })).toBe(false);
  });

  it("hides drafts from everyone but the owner and managers", () => {
    expect(canSeeEntry(entry(), owner)).toBe(true);
    expect(canSeeEntry(entry(), otherEditor)).toBe(false);
    expect(canSeeEntry(entry(), manager)).toBe(true);
    expect(canSeeEntry(entry({ status: "published" }), viewer)).toBe(true);
  });

  it("lets edit govern own entries only while manage governs any", () => {
    expect(canGovernEntry(entry(), owner)).toBe(true);
    expect(canGovernEntry(entry(), otherEditor)).toBe(false);
    expect(canGovernEntry(entry(), viewer)).toBe(false);
    expect(canGovernEntry(entry(), manager)).toBe(true);
  });

  it("blocks content edits on archived entries", () => {
    expect(canEditContent(entry({ status: "published" }), owner)).toBe(true);
    expect(canEditContent(entry({ status: "archived" }), owner)).toBe(false);
    expect(canEditContent(entry({ status: "archived" }), manager)).toBe(false);
  });

  it("models the draft -> published -> archived -> published lifecycle", () => {
    expect(allowedTransitions("draft")).toEqual(["published"]);
    expect(allowedTransitions("published")).toEqual(["archived"]);
    expect(allowedTransitions("archived")).toEqual(["published"]);

    expect(canPublish(entry(), owner)).toBe(true);
    expect(canPublish(entry({ status: "published" }), owner)).toBe(false);
    expect(canArchive(entry({ status: "published" }), owner)).toBe(true);
    expect(canArchive(entry(), owner)).toBe(false);
    expect(canRestore(entry({ status: "archived" }), owner)).toBe(true);
    expect(canRestore(entry({ status: "published" }), owner)).toBe(false);
  });

  it("keeps hard delete a manage-only capability", () => {
    expect(canHardDelete(owner)).toBe(false);
    expect(canHardDelete(manager)).toBe(true);
  });

  it("collects unique sorted tags", () => {
    expect(collectKnownTags([{ tags: ["b", "a"] }, { tags: ["a", "c"] }])).toEqual(["a", "b", "c"]);
  });
});
