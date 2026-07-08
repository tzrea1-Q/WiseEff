import { describe, expect, it } from "vitest";
import { actionableReviewStatusesForRole, resolvePersonalRoleLevel } from "./personalMetrics";

describe("personalMetrics", () => {
  it("maps role ids to personal role levels", () => {
    expect(resolvePersonalRoleLevel("hardware-committer")).toBe("committer");
    expect(resolvePersonalRoleLevel("admin")).toBe("admin");
    expect(resolvePersonalRoleLevel("software-user")).toBe("user");
  });

  it("returns actionable review statuses for workflow roles", () => {
    expect(actionableReviewStatusesForRole("hardware-committer")).toEqual(["hardware_review"]);
    expect(actionableReviewStatusesForRole("software-committer")).toEqual(["software_review"]);
    expect(actionableReviewStatusesForRole("software-user")).toEqual(["software_merge"]);
  });
});
