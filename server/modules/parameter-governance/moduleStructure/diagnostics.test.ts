import { describe, expect, it } from "vitest";
import { ApiError } from "../../../shared/http/errors";
import { assertReadonlyModuleStructure } from "./diagnostics";

const envelope = () => ({
  source: { exportId: "export-one", organizationId: "org-one", catalogReleaseId: "release-one" },
  limits: { maxBytes: 4194304, maxEntries: 10000 },
  counts: { modules: 3, subjects: 2 },
  references: [{ sourceId: "reserved", parentId: null, name: "未分类", kind: "unclassified", archived: false }],
});
const detailsFor = (document: ReturnType<typeof envelope>, baseline = envelope()) => {
  try { assertReadonlyModuleStructure(document, baseline); }
  catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.code).toBe("VALIDATION_FAILED");
    return apiError.details as { issues: { path: string; expected: unknown; received: unknown; hint: string; receivedTruncated?: boolean }[]; truncated: boolean; issueLimit: number };
  }
  throw new Error("Expected validation failure");
};

describe("module structure read-only diagnostics", () => {
  it("reports all protected sections with leaf paths and original values without mutating input", () => {
    const document = envelope();
    document.source.catalogReleaseId = "another-release";
    document.limits.maxBytes++;
    document.counts.modules++;
    document.references[0].name = "edited";
    const before = structuredClone(document);
    const details = detailsFor(document);
    expect(details.issues.map(issue => issue.path)).toEqual([
      "document.source.catalogReleaseId", "document.limits.maxBytes", "document.counts.modules", "document.references.0.name",
    ]);
    expect(details.issues[2]).toMatchObject({ expected: 3, received: 4, hint: expect.stringContaining("不要重新计算") });
    expect(details.truncated).toBe(false);
    expect(document).toEqual(before);
  });

  it("ignores object property order but diagnoses reference ordering and length", () => {
    const baseline = envelope();
    const document = { ...baseline, source: { catalogReleaseId: "release-one", exportId: "export-one", organizationId: "org-one" } };
    expect(() => assertReadonlyModuleStructure(document, baseline)).not.toThrow();
    baseline.references.push({ ...baseline.references[0], sourceId: "second", name: "Second" });
    const reversed = structuredClone(baseline);
    reversed.references.reverse();
    expect(detailsFor(reversed, baseline).issues).toContainEqual(expect.objectContaining({ path: "document.references.0.sourceId", expected: "reserved", received: "second" }));
    expect(detailsFor({ ...baseline, references: [] }, baseline).issues).toEqual([
      expect.objectContaining({ path: "document.references.length", expected: 2, received: 0 }),
    ]);
  });

  it("caps diagnostics and marks omitted issues, but does not mark an exactly full result", () => {
    for (const length of [50, 51]) {
      const baseline = envelope();
      baseline.references = Array.from({ length }, (_, i) => ({ ...baseline.references[0], sourceId: String(i) }));
      const document = structuredClone(baseline);
      document.references.forEach(reference => { reference.name = "changed"; });
      const details = detailsFor(document, baseline);
      expect(details.issues).toHaveLength(50);
      expect(details.issueLimit).toBe(50);
      expect(details.truncated).toBe(length > 50);
    }
  });

  it("bounds long values and explicitly identifies previews as truncated", () => {
    const document = envelope();
    document.references[0].name = "中".repeat(10000);
    const issue = detailsFor(document).issues[0];
    expect(issue.receivedTruncated).toBe(true);
    expect(String(issue.received).length).toBeLessThanOrEqual(1001);
    expect(issue.expected).toBe("未分类");
  });
});
