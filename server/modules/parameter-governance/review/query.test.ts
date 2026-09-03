import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  ReviewItemId,
} from "../../parameter-catalog-contract/index";

import {
  authorizeReviewQueueRead,
  groupReviewEvidence,
  projectReviewQueueItem,
  reviewQueueContract,
  reviewQueueContractFingerprint,
  THREAT_MATRIX,
} from "./index";
import type {
  ReviewEvidenceRecord,
  ReviewQueueTrustedContext,
} from "./types";

const dir = path.dirname(fileURLToPath(import.meta.url));

const productionFiles = [
  "authorize.ts",
  "fingerprint.ts",
  "group.ts",
  "index.ts",
  "query.ts",
  "threatMatrix.ts",
  "types.ts",
] as const;

const forbiddenWriteTokens = [
  "parameter_review_resolutions",
  "organization_subject_registrations",
  "subject_placements",
  "catalog_releases",
  "catalog_subjects",
  "catalog_state",
  "catalog_materializations",
  "resolveReviewItem",
] as const;

const pin = {
  id: CatalogReleaseId("crel_acme_1"),
  digest: CatalogReleaseDigest(`sha256:${"a".repeat(64)}`),
};

const orgAdmin = (
  organizationId = "org-s4-rev",
): ReviewQueueTrustedContext => ({
  actorKind: "org-admin",
  principalId: "user-org-admin",
  organizationId,
});

const evidenceRecord = (
  overrides: Partial<ReviewEvidenceRecord> & {
    evidence?: Partial<ReviewEvidenceRecord["evidence"]>;
  } = {},
): ReviewEvidenceRecord => {
  const { evidence: evidenceOverrides, ...rest } = overrides;
  return {
    id: "prev_one",
    organizationId: "org-s4-rev",
    reason: "unknown",
    candidateSafeDigest: "sha256:safe-one",
    rClass: null,
    sourceGraphRef: null,
    ...rest,
    evidence: {
      sourceIdentity: "occurrence:charger:iin_max",
      catalogReleaseId: pin.id,
      matcherRevision: "matcher-s4-rev-1",
      matcherOutput: "unknown",
      reason: "unknown",
      rClass: null,
      sourceGraphRef: null,
      payload: { propertyKey: "iin_max", secret: "raw-payload-bytes" },
      ...evidenceOverrides,
    },
  };
};

describe("S4-REV public read contract", () => {
  it("fingerprints the frozen Review Queue read contract", () => {
    expect(reviewQueueContract.commandFamily).toBe("review-queue-read");
    expect(reviewQueueContract.groupsOpenItemsBy).toEqual([
      "organization_id",
      "matcher_revision",
      "evidence_fingerprint",
    ]);
    expect(reviewQueueContract.redactsRawEvidenceByDefault).toBe(true);
    expect(reviewQueueContract.staleCapturedPinFailsClosed).toBe(true);
    expect(reviewQueueContractFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(THREAT_MATRIX).toHaveLength(7);
  });

  it("does not export a resolution writer, repository, or unit of work", async () => {
    const exported = await import("./index");
    expect("resolveReviewItem" in exported).toBe(false);
    expect(Object.keys(exported).some((key) => /repository/i.test(key))).toBe(false);
    expect(Object.keys(exported).some((key) => /unitOfWork|UnitOfWork|transaction/i.test(key))).toBe(
      false,
    );
  });
});

describe("S4-REV authorization", () => {
  it("authorizes an Org Admin for the same Organization", () => {
    const result = authorizeReviewQueueRead({
      organizationId: "org-s4-rev",
      context: orgAdmin(),
    });
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("denies an agent without disclosing another Organization's items", () => {
    const result = authorizeReviewQueueRead({
      organizationId: "org-s4-rev",
      context: { actorKind: "agent", principalId: "agent-1" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("permission-denied");
    expect(JSON.stringify(result.error)).not.toContain("raw-payload-bytes");
  });

  it("denies a cross-organization Org Admin", () => {
    const result = authorizeReviewQueueRead({
      organizationId: "org-s4-rev",
      context: orgAdmin("org-other"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("permission-denied");
  });
});

describe("S4-REV grouping and redaction", () => {
  it("groups repeated evidence for the same identity/key once", () => {
    const first = evidenceRecord({
      id: "prev_a",
      candidateSafeDigest: "sha256:safe-a",
      evidence: {
        sourceIdentity: "occurrence:a:iin_max",
        payload: { propertyKey: "iin_max", secret: "raw-a" },
      },
    });
    const second = evidenceRecord({
      id: "prev_b",
      candidateSafeDigest: "sha256:safe-b",
      evidence: {
        sourceIdentity: "occurrence:b:iin_max",
        payload: { propertyKey: "iin_max", secret: "raw-b" },
      },
    });
    const grouped = groupReviewEvidence([first, second], pin);
    expect(grouped.ok).toBe(true);
    if (!grouped.ok) return;
    expect(grouped.value).toHaveLength(1);
    expect(grouped.value[0]?.identityKey).toBe("property:iin_max");
    expect(grouped.value[0]?.evidence).toHaveLength(2);
  });

  it("keeps same-key R6 and R8 as distinct groups", () => {
    const r6 = evidenceRecord({
      id: "prev_r6",
      reason: "unknown",
      rClass: "R6",
      candidateSafeDigest: "sha256:r6",
      evidence: {
        sourceIdentity: "wf671-platform-subjectless-draft",
        reason: "unknown",
        rClass: "R6",
        payload: { propertyKey: "synthetic.legacy-twin", secret: "raw-r6" },
      },
    });
    const r8 = evidenceRecord({
      id: "prev_r8",
      reason: "unknown",
      rClass: "R8",
      candidateSafeDigest: "sha256:r8",
      evidence: {
        sourceIdentity: "wf671-org-manual-node-draft",
        reason: "unknown",
        rClass: "R8",
        payload: { propertyKey: "synthetic.legacy-twin", secret: "raw-r8" },
      },
    });
    const grouped = groupReviewEvidence([r6, r8], pin);
    expect(grouped.ok).toBe(true);
    if (!grouped.ok) return;
    expect(grouped.value).toHaveLength(2);
    expect(new Set(grouped.value.map((group) => group.rClass))).toEqual(new Set(["R6", "R8"]));
  });

  it("fails closed when two open groups share the same grouping fingerprint", () => {
    const record = evidenceRecord();
    const fingerprint = groupedFingerprintFor(record);
    const grouped = groupReviewEvidence([record], pin, {
      existingOpenItems: [
        { id: "prit_dup_a", groupingFingerprint: fingerprint },
        { id: "prit_dup_b", groupingFingerprint: fingerprint },
      ],
    });
    expect(grouped.ok).toBe(false);
    if (grouped.ok) return;
    expect(grouped.error.kind).toBe("duplicate-group");
  });

  it("redacts raw evidence payload from the default projection", () => {
    const grouped = groupReviewEvidence([evidenceRecord()], pin);
    expect(grouped.ok).toBe(true);
    if (!grouped.ok) return;
    const item = projectReviewQueueItem(grouped.value[0]!, {
      capturedRelease: pin,
      candidateState: { status: "current", capturedRelease: pin },
      persisted: {
        id: ReviewItemId("prit_test"),
        etagVersion: 1,
      },
    });
    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain("raw-payload-bytes");
    expect(serialized).not.toContain("\"payload\"");
    expect(item.evidenceRefs[0]?.candidateSafeDigest).toBe("sha256:safe-one");
    expect(item.candidateState.status).toBe("current");
  });

  it("changes the ReviewItem ETag when grouped evidence changes and keeps it stable otherwise", () => {
    const first = evidenceRecord({ id: "prev_stable" });
    const groupedOnce = groupReviewEvidence([first], pin);
    expect(groupedOnce.ok).toBe(true);
    if (!groupedOnce.ok) return;
    const firstItem = projectReviewQueueItem(groupedOnce.value[0]!, {
      capturedRelease: pin,
      candidateState: { status: "current", capturedRelease: pin },
      persisted: { id: ReviewItemId("prit_stable"), etagVersion: 1 },
    });
    const replay = projectReviewQueueItem(groupedOnce.value[0]!, {
      capturedRelease: pin,
      candidateState: { status: "current", capturedRelease: pin },
      persisted: { id: ReviewItemId("prit_stable"), etagVersion: 1 },
    });
    expect(replay.etag).toBe(firstItem.etag);

    const extra = evidenceRecord({
      id: "prev_extra",
      candidateSafeDigest: "sha256:safe-extra",
      evidence: { sourceIdentity: "occurrence:extra:iin_max" },
    });
    const groupedTwice = groupReviewEvidence([first, extra], pin);
    expect(groupedTwice.ok).toBe(true);
    if (!groupedTwice.ok) return;
    const changed = projectReviewQueueItem(groupedTwice.value[0]!, {
      capturedRelease: pin,
      candidateState: { status: "current", capturedRelease: pin },
      persisted: { id: ReviewItemId("prit_stable"), etagVersion: 1 },
    });
    expect(changed.etag).not.toBe(firstItem.etag);
  });
});

describe("S4-REV production isolation", () => {
  it("never mentions Catalog structural rows or a resolution writer", () => {
    const sources = productionFiles.map((file) => ({
      file,
      source: readFileSync(path.join(dir, file), "utf8"),
    }));
    for (const { file, source } of sources) {
      expect(source, file).not.toContain("parameter_definitions");
      for (const token of forbiddenWriteTokens) {
        expect(source, `${file} must not mention ${token}`).not.toContain(token);
      }
      expect(source, file).not.toMatch(/\bresolveReviewItem\b/);
    }

    const query = sources.find((entry) => entry.file === "query.ts");
    expect(query).toBeDefined();
    const identifiers = [...(query?.source.matchAll(/parameter_catalog\.([A-Za-z_][A-Za-z0-9_]*)/g) ?? [])].map(
      (match) => match[1],
    );
    for (const identifier of identifiers) {
      expect(["parameter_review_evidence", "parameter_review_items"]).toContain(identifier);
    }
  });
});

function groupedFingerprintFor(record: ReviewEvidenceRecord): string {
  const grouped = groupReviewEvidence([record], pin);
  if (!grouped.ok) throw new Error("expected a single group");
  return grouped.value[0]!.groupingFingerprint;
}
