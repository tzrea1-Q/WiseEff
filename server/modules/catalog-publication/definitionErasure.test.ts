import { describe, expect, it } from "vitest";

import { validCatalogReleaseBundle } from "../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { compileCatalogRelease } from "../catalog-kernel/compiler/index";
import type { CatalogReleaseBundle, CatalogReleaseDefinitionDocument } from "../catalog-kernel/compiler/types";
import { encodeBundleBytes, parseBundleBytes, refreshSuccessorSource } from "./builder/bundleCodec";
import { buildCompleteSuccessor } from "./builder/completeSuccessor";
import { allocationFor, frozenPageIdentity, pageIntegerChange } from "./builder/predecessorHarness";
import { rebuildCatalogForDefinitionErasure } from "./definitionErasure";

const ERASED = "pdef_acme_power_iin_max";

const fixture = (): CatalogReleaseBundle => {
  let previous: CatalogReleaseBundle["releases"][number] | undefined;
  const original = validCatalogReleaseBundle();
  const releases = original.releases.map((node) => {
    const definition = node.documents.find((document): document is CatalogReleaseDefinitionDocument => document.kind === "definition")!;
    const retained: CatalogReleaseDefinitionDocument = {
      ...definition,
      content: {
        ...definition.content,
        id: "pdef_acme_power_retained",
        propertyKey: "retained",
        revision: {
          ...definition.content.revision,
          id: "drev_acme_power_retained_1",
          displayName: "Unrelated retained definition",
          matching: { ...definition.content.revision.matching, sourceProperty: "retained" },
        },
      },
    };
    previous = refreshSuccessorSource({
      ...node,
      documents: [...node.documents, structuredClone(retained)],
      manifest: {
        ...node.manifest,
        release: {
          ...node.manifest.release,
          predecessor: previous ? { id: previous.manifest.release.id, digest: previous.manifest.release.digest } : null,
        },
      },
    });
    return previous;
  });
  return { ...original, releases };
};

const stored = (bundle: CatalogReleaseBundle, id = "cart_erasure") => {
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
  return { id, artifact_digest: compiled.value.aggregateDigest, artifact_bytes: encodeBundleBytes(bundle) };
};
const installed = (bundle: CatalogReleaseBundle) => bundle.releases.map((node) => ({
  id: node.manifest.release.id,
  release_digest: node.manifest.release.digest,
}));

describe("Catalog definition erasure reconstruction", () => {
  it("erases every historical document and embedded source while retaining other revisions", async () => {
    const bundle = fixture();
    const first = { ...bundle, targetReleaseId: bundle.releases[0]!.manifest.release.id, releases: [bundle.releases[0]!] };
    const plan = rebuildCatalogForDefinitionErasure([stored(first, "cart_first"), stored(bundle)], installed(bundle), ERASED);
    expect(plan.releases).toHaveLength(2);
    expect(plan.artifacts).toHaveLength(2);
    expect(plan.revisions).toEqual([]);
    const latest = plan.artifacts.find((artifact) => artifact.id === "cart_erasure")!;
    const parsed = parseBundleBytes(Buffer.from(latest.artifactBytesBase64, "base64"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const [index, node] of parsed.bundle.releases.entries()) {
      expect(node.manifest.release.id).toBe(bundle.releases[index]!.manifest.release.id);
      expect(node.documents.some((document) => document.content.id === ERASED)).toBe(false);
      expect(Buffer.from(node.sources[0]!.bytes, "base64").toString()).not.toContain(ERASED);
      const retained = node.documents.find((document) => document.content.id === "pdef_acme_power_retained");
      expect(retained?.content).toEqual(bundle.releases[index]!.documents.find((document) => document.content.id === "pdef_acme_power_retained")!.content);
      const historical = compileCatalogRelease({ ...parsed.bundle, targetReleaseId: node.manifest.release.id, releases: parsed.bundle.releases.slice(0, index + 1) });
      expect(historical.ok).toBe(true);
      if (historical.ok) {
        expect(plan.releases[index]!.materializationFingerprint).toBe(historical.value.materializationFingerprint);
        expect(plan.releases[index]!.newDigest).toBe(historical.value.aggregateDigest);
      }
    }
    const next = await buildCompleteSuccessor({
      predecessorArtifact: { digest: latest.newDigest, bytes: Buffer.from(latest.artifactBytesBase64, "base64") },
      changeSet: [pageIntegerChange("after_purge", "Created after purge")],
      frozenIdentity: frozenPageIdentity([allocationFor("after_purge")], "purge", "1.2.0"),
    });
    expect(next.ok).toBe(true);
    if (next.ok && next.value.kind === "successor") {
      expect(next.value.artifact.bundle.releases.flatMap((node) => node.documents).some((document) => document.content.id === ERASED)).toBe(false);
    }
  });

  it("leaves existing hashes untouched when a definition is absent", () => {
    const bundle = fixture();
    expect(rebuildCatalogForDefinitionErasure([stored(bundle)], installed(bundle), "pdef_absent")).toEqual({
      definitionId: "pdef_absent", releases: [], artifacts: [], revisions: [],
    });
  });

  it("removes a surviving revision's link to the erased definition without deleting that revision", () => {
    const original = fixture();
    let previous: CatalogReleaseBundle["releases"][number] | undefined;
    const bundle: CatalogReleaseBundle = {
      ...original,
      releases: original.releases.map((node) => {
        previous = refreshSuccessorSource({
          ...node,
          documents: node.documents.map((document) => document.kind === "definition" && document.content.id !== ERASED ? {
            ...document,
            content: {
              ...document.content,
              revision: { ...document.content.revision, lifecycle: "deprecated", successorDefinitionId: ERASED },
            },
          } : document),
          manifest: {
            ...node.manifest,
            release: { ...node.manifest.release, predecessor: previous ? { id: previous.manifest.release.id, digest: previous.manifest.release.digest } : null },
          },
        });
        return previous;
      }),
    };
    const plan = rebuildCatalogForDefinitionErasure([stored(bundle)], installed(bundle), ERASED);
    expect(plan.revisions).toHaveLength(1);
    expect(plan.revisions[0]).toMatchObject({ id: "drev_acme_power_retained_1", content: { lifecycle: "retired", displayName: "Unrelated retained definition" } });
    expect(plan.revisions[0]!.content).not.toHaveProperty("successorDefinitionId");
    expect(plan.revisions[0]!.contentDigest).not.toBe(plan.revisions[0]!.oldContentDigest);
  });

  it("rejects incomplete or conflicting source artifacts before producing a partial plan", () => {
    const bundle = fixture();
    expect(() => rebuildCatalogForDefinitionErasure([], installed(bundle), ERASED)).toThrow("verified source artifact");
    expect(() => rebuildCatalogForDefinitionErasure([{ ...stored(bundle), artifact_digest: `sha256:${"f".repeat(64)}` }], installed(bundle), ERASED)).toThrow("conflicting digest");
  });
});
