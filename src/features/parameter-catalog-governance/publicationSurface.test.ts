import { describe, expect, it } from "vitest";

import {
  publicationSurfaceAllowsAuthoring,
  publicationSurfaceAllowsPublishing,
  publicationSurfaceCopy,
  publicationSurfaceAdvisory
} from "./publicationSurface";
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
    expect(publicationSurfaceAdvisory({ ...base(), blockers: ["publication-policy-disabled"] }).message).toContain(
      "策略已关闭"
    );
    expect(publicationSurfaceAdvisory({ ...base(), blockers: ["publication-frozen"] }).message).toContain("冻结");
    expect(publicationSurfaceAdvisory({ ...base(), blockers: ["catalog-not-adopted"] }).message).toContain("接管");
  });

  it("keeps author-only distinct from missing capability", () => {
    const authorOnly = publicationSurfaceAdvisory({
      ...base(),
      publishingAllowed: false,
      blockers: []
    });
    expect(authorOnly.message).toContain("保存草稿");
    expect(publicationSurfaceAdvisory({ ...base(), blockers: ["publication-capability-missing"] }).message).toContain(
      "权限"
    );
  });

  it("keeps fetch-failed copy distinct from an advisory", () => {
    expect(publicationSurfaceCopy.fetchFailed).toContain("无法读取发布状态");
  });

  it("stays silent when the surface is enabled and unblocked", () => {
    // Issue #847 follow-up: a healthy surface shows no banner and no publish-dialog
    // status line, so "policy enabled / catalog adopted" is never restated.
    expect(publicationSurfaceAdvisory(base())).toBeNull();
  });
});

describe("publication surface permission gates", () => {
  it("mirrors the server rather than the client's own idea of authority", () => {
    const denied = {
      publicationEnabled: false,
      lowRiskSingleActorPublish: false,
      policyRevision: 1,
      frozen: false,
      adopted: false,
      currentReleaseId: "crel_1",
      authoringAllowed: false,
      publishingAllowed: false,
      reviewHighRiskAllowed: false,
      blockers: ["publication-policy-disabled"]
    } as const;
    expect(publicationSurfaceAllowsAuthoring(denied)).toBe(false);
    expect(publicationSurfaceAllowsPublishing(denied)).toBe(false);

    const allowed = { ...denied, authoringAllowed: true, publishingAllowed: true, blockers: [] };
    expect(publicationSurfaceAllowsAuthoring(allowed)).toBe(true);
    expect(publicationSurfaceAllowsPublishing(allowed)).toBe(true);

    // An absent or failed surface read grants nothing.
    expect(publicationSurfaceAllowsAuthoring(null)).toBe(false);
    expect(publicationSurfaceAllowsAuthoring(undefined)).toBe(false);
    expect(publicationSurfaceAllowsPublishing(null)).toBe(false);
  });
});
