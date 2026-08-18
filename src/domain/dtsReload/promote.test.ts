import { describe, expect, it } from "vitest";

import { isReloadRunPromotable } from "./promote";
import type { DtsReloadRunPurpose, DtsReloadRunStatus } from "./types";

function run(status: DtsReloadRunStatus, purpose: DtsReloadRunPurpose = "ordinary") {
  return { status, purpose };
}

describe("isReloadRunPromotable", () => {
  it("allows ordinary verified and unverifiable runs", () => {
    expect(isReloadRunPromotable(run("verified"))).toBe(true);
    expect(isReloadRunPromotable(run("unverifiable"))).toBe(true);
  });

  it("hides restore-baseline, contradicted, failed, and non-terminal runs", () => {
    expect(isReloadRunPromotable(run("verified", "restore-baseline"))).toBe(false);
    expect(isReloadRunPromotable(run("contradicted"))).toBe(false);
    expect(isReloadRunPromotable(run("failed"))).toBe(false);
    expect(isReloadRunPromotable(run("validated"))).toBe(false);
    expect(isReloadRunPromotable(run("blocked"))).toBe(false);
  });
});
