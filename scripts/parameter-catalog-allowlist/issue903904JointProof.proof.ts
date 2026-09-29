import { expect, it } from "vitest";

import { loadAllowlistIndex, loadBoundaryViolationFixture } from "./index";
import { applyReviewedIssue903KnowledgeSuccessor } from "./issue903KnowledgeSuccessor";
import { verifyIssue904LogRetirement } from "./issue904LogRetirement";
import type { BoundaryViolation } from "./schema";

const repoRoot = process.cwd();
const fixture = await loadBoundaryViolationFixture(repoRoot);
const allowances = (await loadAllowlistIndex(repoRoot)).entries;

/** Register both proofs beside Issue #913's same-tree Catalog scan. */
export function registerIssue903904JointProof(getRaw: () => readonly BoundaryViolation[]) {
  it("#903 connects every exact Knowledge successor to the historical A identity", async () => {
    const raw = getRaw();
    // The scanner's unchanged-position binding already recognizes this one initial fixture ID.
    const prebound = raw.map((entry) => entry.file === "src/infrastructure/http/knowledgeClient.test.ts"
      && entry.token === "route:/api/v1/knowledge/related-to-spec"
      ? fixture.violations.find((source) => source.id
        === "S12-KNW:legacy-catalog-route:768b6e9c6fd44cac:a979c2386e84f294")!
      : entry);
    const result = await applyReviewedIssue903KnowledgeSuccessor(
      repoRoot, fixture, allowances, prebound, raw,
    );
    expect(result.relocations).toHaveLength(33);
    expect(result.violations).toHaveLength(raw.length);
    expect(result.violations.some((entry) => entry.id
      === "S12-KNW:legacy-parameter-spec-identifier:7d722a7dd611c22b:35f177f136ca66bb"))
      .toBe(true);
    await expect(applyReviewedIssue903KnowledgeSuccessor(
      repoRoot, fixture, allowances.filter((entry) => entry.id
        !== "S12-KNW:legacy-catalog-raw-read:4b9d4b6636bcbc05:86361dec384f01b2"), prebound, raw,
    )).rejects.toThrow(/allowance status/);
    await expect(applyReviewedIssue903KnowledgeSuccessor(
      repoRoot, fixture, allowances, prebound,
      raw.filter((entry) => !(entry.file === "server/modules/knowledge/parameterReferences.ts"
        && entry.byteStart === 1621)),
    )).rejects.toThrow(/Knowledge successor rejected/);
    await expect(applyReviewedIssue903KnowledgeSuccessor(
      repoRoot, { ...fixture, violations: fixture.violations.map((entry) => entry.id
        === "S12-KNW:legacy-parameter-spec-identifier:8a7ee14a16ecfa7b:82395fc3bdb3885f"
        ? { ...entry, byteStart: entry.byteStart + 1, byteEnd: entry.byteEnd + 1 }
        : entry) }, allowances, prebound, raw,
    )).rejects.toThrow(/baseline position bridge/);
  });

  it("#904 rejects either revived Logs observation or old allowance", async () => {
    const raw = getRaw();
    await expect(verifyIssue904LogRetirement(repoRoot, fixture, allowances, raw)).resolves.toBeUndefined();
    const old = fixture.violations.find((entry) => entry.id
      === "S12-LOG:unresolved-boundary-expression:9809fb7c167c6968:1a70b383ae7e6440")!;
    await expect(verifyIssue904LogRetirement(repoRoot, fixture, allowances, [...raw, old]))
      .rejects.toThrow(/retired ID or allowance revived/);
    await expect(verifyIssue904LogRetirement(repoRoot, fixture, [
      ...allowances, { id: old.id, rule: old.rule, file: old.file, reason: old.reason },
    ], raw)).rejects.toThrow(/retired ID or allowance revived/);
  });
}
