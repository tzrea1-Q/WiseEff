import { describe, expect, it } from "vitest";

import { publicationSurfaceMessage } from "./publicationSurface";
import type { PublicationSurfaceItem } from "./publicationSurface";

const base = (): PublicationSurfaceItem => ({
  publicationEnabled: true,
  lowRiskSingleActorPublish: false,
  policyRevision: 1,
  frozen: false,
  adopted: true,
  currentReleaseId: "crel_1",
  authoringAllowed: true,
  publishingAllowed: true,
  reviewHighRiskAllowed: false,
  blockers: []
});

describe("publication surface copy", () => {
  it("explains policy, freeze, and adoption separately", () => {
    expect(publicationSurfaceMessage({ ...base(), blockers: ["publication-policy-disabled"] }).message).toContain(
      "策略已关闭"
    );
    expect(publicationSurfaceMessage({ ...base(), blockers: ["publication-frozen"] }).message).toContain("冻结");
    expect(publicationSurfaceMessage({ ...base(), blockers: ["catalog-not-adopted"] }).message).toContain("接管");
  });

  it("keeps author-only distinct from missing capability", () => {
    const authorOnly = publicationSurfaceMessage({
      ...base(),
      publishingAllowed: false,
      blockers: []
    });
    expect(authorOnly.message).toContain("保存草稿");
    expect(publicationSurfaceMessage({ ...base(), blockers: ["publication-capability-missing"] }).message).toContain(
      "权限"
    );
  });
});
