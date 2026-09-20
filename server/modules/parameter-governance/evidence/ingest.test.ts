import { describe, expect, it } from "vitest";

import { CatalogReleaseId } from "../../parameter-catalog-contract/index";

import {
  evidenceIngestContract,
  evidenceIngestContractFingerprint,
  planEvidenceIngest,
} from "./index";
import type { IngestEvidenceCommand } from "./types";

const release = CatalogReleaseId("crel_acme_2");

const provenance = {
  projectId: "project-s4-evd",
  logicalNodeId: "logical-s4-evd",
  configRevisionId: "config-s4-evd-1",
  sourceOccurrenceId: "src-occ-s4-evd",
  sourceLocator: {
    kind: "dts-property",
    propertyOccurrenceId: "property-s4-evd",
    nodeOccurrenceId: "node-s4-evd",
    fileVersionId: "version-s4-evd",
    propertyName: "iin_max",
  },
};

const matchedCommand = (
  overrides: Partial<IngestEvidenceCommand> = {},
): IngestEvidenceCommand => ({
  organizationId: "org-s4-evd",
  sourceIdentity: "occurrence:charger:iin_max",
  catalogReleaseId: release,
  matcherRevision: "matcher-s4-evd-1",
  matcherOutput: { status: "matched" },
  provenance,
  ...overrides,
});

describe("evidence ingest contract", () => {
  it("fingerprints the frozen ingest contract", () => {
    expect(evidenceIngestContract.r6AndR8SamePropertyKeyRemainDistinct).toBe(true);
    expect(evidenceIngestContract.commandFamily).toBe("evidence-ingest");
    expect(evidenceIngestContract.replayKey).toEqual([
      "organization_id",
      "project_id",
      "source_occurrence_id",
      "config_revision_id",
      "parameter_locator_digest",
      "catalog_release_id",
      "matcher_revision",
    ]);
    expect(evidenceIngestContractFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("plans a unique matched occurrence as an observation", () => {
    const planned = planEvidenceIngest(matchedCommand());
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.kind).toBe("observation");
    expect(planned.value.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it.each(["", "/", "/a~1b/~0/", "/温度/值", "/~01"])("accepts the exact JSON Pointer %j", (pointer) => {
    expect(planEvidenceIngest(matchedCommand({ provenance: {
      ...provenance, logicalNodeId: null,
      sourceLocator: { kind: "json-pointer", fileVersionId: "json-version", pointer },
    } })).ok).toBe(true);
  });

  it.each(["a/b", "/a/~", "/a/~2", "/a~x/b"])("rejects the invalid JSON Pointer %j", (pointer) => {
    expect(planEvidenceIngest(matchedCommand({ provenance: {
      ...provenance, logicalNodeId: null,
      sourceLocator: { kind: "json-pointer", fileVersionId: "json-version", pointer },
    } }))).toEqual({ ok: false, error: { kind: "missing-source-provenance", missing: ["provenance.sourceLocator"] } });
  });

  it("replays the same observation fingerprint for canonical key order", () => {
    const first = planEvidenceIngest(matchedCommand());
    const reordered = planEvidenceIngest(
      matchedCommand({
        provenance: {
          configRevisionId: provenance.configRevisionId,
          logicalNodeId: provenance.logicalNodeId,
          projectId: provenance.projectId,
          sourceOccurrenceId: provenance.sourceOccurrenceId,
          sourceLocator: {
            propertyName: "iin_max",
            fileVersionId: "version-s4-evd",
            nodeOccurrenceId: "node-s4-evd",
            propertyOccurrenceId: "property-s4-evd",
            kind: "dts-property",
          },
        },
      }),
    );
    expect(first.ok && reordered.ok).toBe(true);
    if (!first.ok || !reordered.ok) return;
    expect(reordered.value.fingerprint).toBe(first.value.fingerprint);
  });

  it("keeps two exact parameter locators under one occurrence distinct", () => {
    const first = planEvidenceIngest(matchedCommand());
    const second = planEvidenceIngest(
      matchedCommand({
        provenance: {
          ...provenance,
          sourceLocator: {
            kind: "dts-property",
            propertyOccurrenceId: "property-s4-evd-2",
            nodeOccurrenceId: "node-s4-evd",
            fileVersionId: "version-s4-evd",
            propertyName: "iin_max_2",
          },
        },
      }),
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.kind).toBe("observation");
    expect(second.value.kind).toBe("observation");
    if (first.value.kind === "observation" && second.value.kind === "observation") {
      expect(second.value.parameterLocatorDigest).not.toBe(first.value.parameterLocatorDigest);
      expect(second.value.fingerprint).not.toBe(first.value.fingerprint);
    }
  });

  it("requires an owned occurrence and a typed exact locator for matched observations", () => {
    const planned = planEvidenceIngest(
      matchedCommand({
        provenance: {
          ...provenance,
          sourceOccurrenceId: undefined,
          sourceLocator: { path: "/soc/charger", property: "iin_max" },
        },
      }),
    );
    expect(planned).toEqual({
      ok: false,
      error: {
        kind: "missing-source-provenance",
        missing: ["provenance.sourceOccurrenceId", "provenance.sourceLocator"],
      },
    });
  });

  it("fails closed when source provenance is missing", () => {
    const planned = planEvidenceIngest(
      matchedCommand({
        sourceIdentity: "",
        provenance: null,
      }),
    );
    expect(planned).toEqual({
      ok: false,
      error: {
        kind: "missing-source-provenance",
        missing: ["sourceIdentity", "provenance"],
      },
    });
  });

  it.each(["unknown", "ambiguous"] as const)(
    "plans a %s matcher output as review evidence, not an observation",
    (status) => {
      const planned = planEvidenceIngest(
        matchedCommand({
          matcherOutput: { status },
          provenance,
        }),
      );
      expect(planned.ok).toBe(true);
      if (!planned.ok) return;
      expect(planned.value.kind).toBe("review-evidence");
      if (planned.value.kind === "review-evidence") {
        expect(planned.value.reason).toBe(status);
        expect(planned.value.rClass).toBeNull();
      }
    },
  );

  it("keeps same-key R6 and R8 as distinct review-evidence plans", () => {
    const propertyKey = "synthetic.legacy-twin";
    const r6 = planEvidenceIngest(
      matchedCommand({
        sourceIdentity: "wf671-platform-subjectless-draft",
        matcherOutput: { status: "unknown" },
        classification: { rClass: "R6" },
        evidence: { propertyKey, specId: "wf671-platform-subjectless-draft" },
        provenance: null,
      }),
    );
    const r8 = planEvidenceIngest(
      matchedCommand({
        sourceIdentity: "wf671-org-manual-node-draft",
        matcherOutput: { status: "unknown" },
        classification: { rClass: "R8" },
        evidence: { propertyKey, specId: "wf671-org-manual-node-draft" },
        provenance: null,
      }),
    );
    expect(r6.ok && r8.ok).toBe(true);
    if (!r6.ok || !r8.ok) return;
    expect(r6.value.kind).toBe("review-evidence");
    expect(r8.value.kind).toBe("review-evidence");
    expect(r6.value.fingerprint).not.toBe(r8.value.fingerprint);
    if (r6.value.kind === "review-evidence" && r8.value.kind === "review-evidence") {
      expect(r6.value.rClass).toBe("R6");
      expect(r8.value.rClass).toBe("R8");
      expect(r6.value.sourceGraphRef).toBeNull();
      expect(r8.value.sourceGraphRef).toBeNull();
      expect(r6.value.model.sourceIdentity).toBe("wf671-platform-subjectless-draft");
      expect(r8.value.model.sourceIdentity).toBe("wf671-org-manual-node-draft");
    }
  });

  it("does not plan an observation for a matched matcher that carries an R6 class", () => {
    const planned = planEvidenceIngest(
      matchedCommand({
        sourceIdentity: "wf671-platform-subjectless-draft",
        classification: { rClass: "R6" },
        evidence: { propertyKey: "synthetic.legacy-twin" },
      }),
    );
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.kind).toBe("review-evidence");
  });

  it("does not treat source_graph_ref as the review-evidence replay identity", () => {
    const planned = planEvidenceIngest(
      matchedCommand({
        matcherOutput: { status: "unknown" },
        classification: { rClass: "R6", sourceGraphRef: "shared-graph" },
        evidence: { propertyKey: "synthetic.legacy-twin" },
        provenance: null,
      }),
    );
    expect(planned.ok).toBe(true);
    if (!planned.ok || planned.value.kind !== "review-evidence") return;
    expect(planned.value.sourceGraphRef).toBe("shared-graph");
    expect(planned.value.model.sourceIdentity).toBe("occurrence:charger:iin_max");
    expect(planned.value.evidence.sourceIdentity).toBe("occurrence:charger:iin_max");
  });
});
