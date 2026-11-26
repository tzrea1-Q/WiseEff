import { describe, expect, it } from "vitest";
import { hashContractJson } from "../../parameter-catalog-contract/chunkedSerialization";
import type { ContractJsonValue } from "../../parameter-catalog-contract";
import {
  buildCatalogInstallProof, compileCatalogDefinitionAppend, compileCatalogRelease,
  INSTALL_CHAIN_COMPILER, INSTALL_CHAIN_SOURCE_FORMAT, isCatalogInstallProof, type CatalogReleaseNode,
} from "./index";
import {
  refreshAuthoritativeSource, refreshReleaseAggregateDigest, reorderCatalogReleaseBundle, validCatalogReleaseBundle,
} from "./__fixtures__/catalogReleaseBundle";
import { SUBJECT_RULES_CORRECTION } from "./subjectIdentity";

type MutableNode = Parameters<typeof refreshAuthoritativeSource>[0];
const copy = (node: CatalogReleaseNode) => structuredClone(node) as MutableNode;
function successor(base: CatalogReleaseNode, marked = true): MutableNode {
  const node = copy(base);
  const prior = base.manifest.release;
  const sequence = prior.sequence + 1;
  node.manifest.release = {
    ...prior, sequence, id: `crel_step_${sequence}`, version: `3.0.${sequence}`,
    predecessor: { id: prior.id, digest: prior.digest },
  };
  if (marked) node.manifest.toolchain = {
    ...node.manifest.toolchain, compiler: INSTALL_CHAIN_COMPILER, sourceFormat: INSTALL_CHAIN_SOURCE_FORMAT,
  };
  refreshReleaseAggregateDigest(node);
  return node;
}
function compile(releases: readonly CatalogReleaseNode[]) {
  const bundle = { schemaVersion: "1.0.0", targetReleaseId: releases.at(-1)!.manifest.release.id, releases };
  const result = compileCatalogRelease(reorderCatalogReleaseBundle(bundle));
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

describe("versioned installation chain", () => {
  it("matches a complete replay for legacy-to-v2 and v2-to-v2 changes across sequence 10", () => {
    const first = copy(validCatalogReleaseBundle().releases[0]!);
    const firstSubject = first.documents.find(doc => doc.kind === "subject")!;
    firstSubject.content.selector.provenance.source = SUBJECT_RULES_CORRECTION;
    refreshAuthoritativeSource(first);
    const history = [first];
    for (let sequence = 2; sequence < 10; sequence++) {
      const next = successor(history.at(-1)!, false);
      next.documents.find(doc => doc.kind === "subject")!.content.selector.provenance.source = "import-review";
      refreshAuthoritativeSource(next);
      history.push(next);
    }
    const legacy = compile(history);
    expect(legacy.modelReceipt).toBeUndefined();
    expect(legacy.compiledReleaseDigest).toBe(hashContractJson(legacy.model as unknown as ContractJsonValue));
    let proof = buildCatalogInstallProof(legacy);
    for (const sequence of [10, 11]) {
      const base = history.at(-1)!;
      const next = successor(base);
      const revised = next.documents.find(doc => doc.kind === "definition")!;
      revised.content.revision.number++;
      revised.content.revision.id = `drev_step_${sequence}`;
      revised.content.revision.documentation = `Revision from release ${sequence}`;
      if (sequence === 10) revised.content.revision.dtsExamples = ["iin_max = <3>;"];
      else delete revised.content.revision.dtsExamples;
      const added = structuredClone(revised);
      added.content.id = `pdef_extra_${sequence}`;
      added.content.propertyKey = `extra_${sequence}`;
      added.content.revision.matching.sourceProperty = added.content.propertyKey;
      added.content.revision.number = 1;
      added.content.revision.id = `drev_extra_${sequence}`;
      next.documents.push(added);
      refreshAuthoritativeSource(next);
      const warm = compileCatalogDefinitionAppend(JSON.parse(JSON.stringify(proof)), base, next);
      expect(warm).not.toBeNull();
      if (!warm) throw new Error("eligible successor rejected");
      history.push(next);
      const cold = compile(history);
      const { model, bytes, ...coldPins } = cold;
      const { model: endpoints, versionedSubjectIds, ...warmPins } = warm.compiled;
      expect(warmPins).toEqual(coldPins);
      expect(warm.proof).toEqual(buildCatalogInstallProof(cold));
      expect(isCatalogInstallProof(warm.proof)).toBe(true);
      expect(warm.proof.hasDtsExamples).toBe(true);
      expect(versionedSubjectIds).toEqual([firstSubject.content.id]);
      expect(new Set(warm.newRevisionIds)).toEqual(new Set([added.content.revision.id, revised.content.revision.id]));
      expect(endpoints.releases.map(node => node.release.id)).toEqual([base.manifest.release.id, next.manifest.release.id]);
      expect("bytes" in warm.compiled).toBe(false);
      expect("schemaVersion" in endpoints).toBe(false);
      expect(JSON.parse(bytes)).toEqual(model);
      expect(model.releases).toHaveLength(sequence);
      expect(cold.compiledReleaseDigest).toBe(hashContractJson(cold.modelReceipt as unknown as ContractJsonValue));
      expect(cold.compiledReleaseDigest).not.toBe(hashContractJson(model as unknown as ContractJsonValue));
      proof = warm.proof;
    }
    // Protect the receipt contract from accidental root framing, order or projection changes.
    expect(proof.compiledReleaseDigest).toMatchInlineSnapshot(`"sha256:0113d6184454d768bf353a76b4c4511cd2ae5c24dcbea1e945a358ae207278b3"`);
  });

  it("requires a marked aggregate, source authority, an exact pin and current validation contract", () => {
    const base = validCatalogReleaseBundle().releases[0]!;
    const proof = buildCatalogInstallProof(compile([base]));
    const unmarked = successor(base, false);
    expect(compileCatalogDefinitionAppend(proof, base, unmarked)).toBeNull();
    unmarked.manifest.toolchain.compiler = INSTALL_CHAIN_COMPILER;
    expect(compileCatalogDefinitionAppend(proof, base, unmarked)).toBeNull();
    refreshReleaseAggregateDigest(unmarked);
    const legacy = compile([base, unmarked]);
    expect(legacy.modelReceipt).toBeUndefined();
    expect(legacy.compiledReleaseDigest).toBe(hashContractJson(legacy.model as unknown as ContractJsonValue));
    unmarked.manifest.toolchain.sourceFormat = INSTALL_CHAIN_SOURCE_FORMAT;
    expect(compileCatalogDefinitionAppend(proof, base, unmarked)).toBeNull(); // marker not in the aggregate
    const next = successor(base);
    expect(compileCatalogDefinitionAppend({ ...proof, releaseId: "wrong" }, base, next)).toBeNull();
    expect(compileCatalogDefinitionAppend({ ...proof, sourceCompilerFingerprint: "old" }, base, next)).toBeNull();
    expect(compileCatalogDefinitionAppend(proof, base, {} as CatalogReleaseNode)).toBeNull();
    next.sources[0]!.bytes = "WA==";
    expect(compileCatalogDefinitionAppend(proof, base, next)).toBeNull();
  });

  it("requires full replay for subject changes and rejects omitted predecessor memberships", () => {
    const base = validCatalogReleaseBundle().releases[0]!;
    const proof = buildCatalogInstallProof(compile([base]));
    const changed = successor(base);
    changed.documents.find(d => d.kind === "subject")!.content.selector.provenance.source = "correction";
    refreshAuthoritativeSource(changed);
    expect(compile([base, changed]).release.id).toBe(changed.manifest.release.id);
    expect(compileCatalogDefinitionAppend(proof, base, changed)).toBeNull();
    const omitted = successor(base);
    omitted.documents = omitted.documents.filter(d => d.kind !== "definition");
    refreshAuthoritativeSource(omitted);
    expect(compileCatalogDefinitionAppend(proof, base, omitted)).toBeNull();
  });
});
