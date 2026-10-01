import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { loadAllowlistIndex, loadBoundaryViolationFixture } from "./index";
import { applyReviewedIssue903KnowledgeSuccessor } from "./issue903KnowledgeSuccessor";
import { verifyIssue904LogRetirement } from "./issue904LogRetirement";
import { projectIssue1008KnowledgeSuccessor } from "./issue1008KnowledgeSuccessor";
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
    const current = raw.find((entry) => entry.file === "server/modules/knowledge/parameterReferences.ts")!;
    await expect(applyReviewedIssue903KnowledgeSuccessor(
      repoRoot, fixture, allowances, prebound,
      raw.map((entry) => entry.id === current.id ? { ...entry, id: entry.id.replace(/.$/, entry.id.endsWith("0") ? "1" : "0") } : entry),
    )).rejects.toThrow(/exact source and destination/);
    await expect(applyReviewedIssue903KnowledgeSuccessor(
      repoRoot, fixture, [...allowances, current], prebound, raw,
    )).rejects.toThrow(/no current successor allowance/);
    await expect(applyReviewedIssue903KnowledgeSuccessor(
      repoRoot, fixture, allowances, prebound,
      raw.map((entry) => entry.id === current.id ? { ...entry, byteStart: entry.byteStart + 1 } : entry),
    )).rejects.toThrow(/current endpoint/);
    const tamperedRoot = await mkdtemp(join(tmpdir(), "issue1008-successor-tamper-"));
    try {
      const path = "docs/exec-plans/active/849-inventory/issue-903-legacy-read-error-observations.json";
      const bytes = await readFile(join(repoRoot, path));
      const record = JSON.parse(bytes.toString());
      for (const file of [path, ...record.candidateSourceBlobs.map((item: { path: string }) => item.path)]) {
        await mkdir(dirname(join(tamperedRoot, file)), { recursive: true });
        await writeFile(join(tamperedRoot, file), await readFile(join(repoRoot, file)));
      }
      await writeFile(join(tamperedRoot, ".git"), `gitdir: ${execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
        cwd: repoRoot, encoding: "utf8",
      }).trim()}\n`);
      const successorPath = "server/modules/knowledge/definitionReferences.integration.test.ts";
      const successorBytes = await readFile(join(repoRoot, successorPath));
      for (const offset of [14243, 0]) {
        const tampered = Buffer.from(successorBytes);
        tampered[offset] ^= 1;
        await writeFile(join(tamperedRoot, successorPath), tampered);
        await expect(projectIssue1008KnowledgeSuccessor(tamperedRoot, raw)).rejects.toThrow(/whole-file blob/);
      }
      await writeFile(join(tamperedRoot, successorPath), successorBytes);
      const exportPath = "server/testing/parameterCatalog/index.ts";
      const exportBytes = await readFile(join(repoRoot, exportPath));
      for (const offset of [1299, 0]) {
        const changed = Buffer.from(exportBytes);
        changed[offset] ^= 1;
        await writeFile(join(tamperedRoot, exportPath), changed);
        await expect(projectIssue1008KnowledgeSuccessor(tamperedRoot, raw)).rejects.toThrow(/whole-file blob/);
      }
      await writeFile(join(tamperedRoot, exportPath), exportBytes);
      await writeFile(join(tamperedRoot, current.file), Buffer.concat([await readFile(join(repoRoot, current.file)), Buffer.from("\n")]));
      await expect(projectIssue1008KnowledgeSuccessor(tamperedRoot, raw)).rejects.toThrow(/whole-file blob/);
      await writeFile(join(tamperedRoot, path), Buffer.concat([bytes, Buffer.from("\n")]));
      await expect(projectIssue1008KnowledgeSuccessor(tamperedRoot, raw)).rejects.toThrow(/pinned C handoff/);
    } finally {
      await rm(tamperedRoot, { recursive: true, force: true });
    }
  });

  it("#1011 retains all 23 Knowledge endpoints and rejects changed or incomplete identities", async () => {
    const raw = getRaw();
    const current = raw.find((entry) => entry.file === "server/modules/knowledge/parameterReferences.ts")!;
    const result = await projectIssue1008KnowledgeSuccessor(repoRoot, raw);
    expect(result.currentForOld.size).toBe(23);
    expect(raw.filter((entry) => entry.file === "server/modules/knowledge/definitionReferences.integration.test.ts"))
      .toEqual([]);
    await expect(projectIssue1008KnowledgeSuccessor(repoRoot, raw.filter((entry) => entry.id !== current.id)))
      .rejects.toThrow(/exact source and destination/);
    await expect(projectIssue1008KnowledgeSuccessor(repoRoot, [...raw, current]))
      .rejects.toThrow(/duplicate observed ID/);
    const changedId = current.id.replace(/.$/, current.id.endsWith("0") ? "1" : "0");
    await expect(projectIssue1008KnowledgeSuccessor(repoRoot, raw.map((entry) => entry.id === current.id
      ? { ...entry, id: changedId } : entry))).rejects.toThrow(/exact source and destination/);
    await expect(projectIssue1008KnowledgeSuccessor(repoRoot, raw.map((entry) => entry.id === current.id
      ? { ...entry, trustedBlobOid: "0000000000000000000000000000000000000000" } : entry)))
      .rejects.toThrow(/current endpoint/);
    await expect(projectIssue1008KnowledgeSuccessor(repoRoot, [...raw, {
      ...current, id: changedId, file: "server/modules/knowledge/definitionReferences.integration.test.ts",
    }])).rejects.toThrow(/no unmatched current observation/);
    const oldId = [...result.currentForOld].find(([, entry]) => entry.id === current.id)![0];
    await expect(projectIssue1008KnowledgeSuccessor(repoRoot, [...raw, {
      ...current, id: oldId, file: "unwatched-collision-fixture.ts",
    }])).rejects.toThrow(/projected ID collision/);
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
