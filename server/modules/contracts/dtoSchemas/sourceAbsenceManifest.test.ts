import { describe, expect, it } from "vitest";
import { canonicalSourceManifestSchema, catalogBindingExportDtoSchema } from "./parameterCatalog";

const digest = `sha256:${"a".repeat(64)}`;
const manifest = {
  organizationId: "org", projectId: "project", bindingId: "binding", definitionId: "definition", projectValueId: "deleted-value",
  sourcePinId: "absence-pin", sourceOccurrenceId: "occurrence", configSetId: "set", configRevisionId: "after-revision",
  fileId: "file", fileVersionId: "after-version", format: "dts", valueState: "deleted", baseSourcePinId: "before-pin", deleteRequestId: "request",
  logicalNodeId: "logical-node", configurationInstanceId: null, configurationSchemaSubjectId: null, rootPointer: null,
  entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [], members: [],
  locator: { kind: "dts-source-absence", basePropertyOccurrenceId: "before-property", baseNodeOccurrenceId: "before-node",
    baseFileVersionId: "before-version", fileVersionId: "after-version", propertyName: "iin_max", logicalNodeId: "logical-node" },
  deleteProof: { kind: "dts-source-absence-v1", scannerVersion: "dts-config-v1", beforeValueDigest: digest, beforeSourceDigest: digest, afterSourceDigest: digest }
};

describe("whole-source absence export contract", () => {
  it("retains before-occurrence anchors and explicit proof in historical Binding exports", () => {
    expect(canonicalSourceManifestSchema.parse(manifest)).toEqual(manifest);
    const exported = { bindingId: "binding", projectId: "project", definitionId: "definition", definitionRevisionId: "definition-revision",
      catalogReleaseId: "release", configRevisionId: "after-revision", currentValueId: "deleted-value", valueState: "deleted", configSetId: "set",
      sourceRef: "source", files: [], manifest };
    expect(catalogBindingExportDtoSchema.parse(exported).manifest).toEqual(manifest);
  });

  it("rejects mixed state/format, foreign node/version, missing anchors and malformed digest proofs", () => {
    for (const changed of [
      { ...manifest, valueState: "present" }, { ...manifest, format: "json" }, { ...manifest, baseSourcePinId: null },
      { ...manifest, deleteRequestId: null }, { ...manifest, logicalNodeId: null },
      { ...manifest, locator: { ...manifest.locator, logicalNodeId: "other-node" } },
      { ...manifest, locator: { ...manifest.locator, fileVersionId: "other-version" } },
      { ...manifest, locator: { ...manifest.locator, basePropertyOccurrenceId: "" } },
      { ...manifest, locator: { ...manifest.locator, extra: true } },
      { ...manifest, deleteProof: { ...manifest.deleteProof, scannerVersion: "dts-cst-v1" } },
      { ...manifest, deleteProof: { ...manifest.deleteProof, afterSourceDigest: "a".repeat(64) } },
      { ...manifest, deleteProof: { ...manifest.deleteProof, kind: "dts-delete-v1" } },
      { ...manifest, deleteProof: { ...manifest.deleteProof, extra: true } }
    ]) expect(canonicalSourceManifestSchema.safeParse(changed).success).toBe(false);
  });
});
