import { beforeEach, describe, expect, it } from "vitest";

import {
  clearUnsavedParameterWork,
  reportUnsavedParameterWork,
  resetUnsavedParameterWork,
  unsavedParameterWorkCount
} from "./unsavedParameterWork";

describe("unsavedParameterWork", () => {
  beforeEach(() => {
    resetUnsavedParameterWork();
  });

  it("sums counts across sources and drops zeroed or cleared sources", () => {
    reportUnsavedParameterWork("topology-pending-drafts", 2);
    reportUnsavedParameterWork("workbench-local-draft-bag", 1);
    expect(unsavedParameterWorkCount()).toBe(3);

    reportUnsavedParameterWork("workbench-local-draft-bag", 0);
    expect(unsavedParameterWorkCount()).toBe(2);

    clearUnsavedParameterWork("topology-pending-drafts");
    expect(unsavedParameterWorkCount()).toBe(0);
  });

  it("replaces a source count instead of accumulating it", () => {
    reportUnsavedParameterWork("topology-pending-drafts", 5);
    reportUnsavedParameterWork("topology-pending-drafts", 1);
    expect(unsavedParameterWorkCount()).toBe(1);
  });
});
