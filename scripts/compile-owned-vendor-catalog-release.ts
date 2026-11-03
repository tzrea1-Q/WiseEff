import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileCatalogRelease } from "../server/modules/catalog-kernel/compiler/index";
import { importVendorCatalog } from "../server/modules/catalog-publication/import/vendorAdapter";
import { serializeContract, type ContractJsonValue } from "../server/modules/parameter-catalog-contract/index";
import { compileLocalizedVendorCatalogSuccessor } from "./compile-vendor-catalog-release";

export const VENDOR_OWNED_RELEASE_ID = "crel_vendor_catalog_4";
export const VENDOR_OWNED_AGGREGATE_DIGEST =
  "sha256:6b11c722e8822e1b7d20aab835fadfa09aa9615cec7487514556a4565a5f460c";

/** Add reviewed child ownership without rewriting any published seed release or Definition. */
export async function compileOwnedVendorCatalogSuccessor(
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
) {
  const previous = compileLocalizedVendorCatalogSuccessor(root);
  const imported = await importVendorCatalog({
    predecessorArtifact: {
      digest: previous.compiled.aggregateDigest,
      bytes: new TextEncoder().encode(serializeContract(previous.bundle as unknown as ContractJsonValue)),
    },
    schemasRoot: path.join(root, "schemas/dts"),
    authorPrincipalId: "seed-owned-vendor",
    identity: {
      candidateId: "ccand_vendor_owned_4", artifactId: "cart_vendor_owned_4",
      releaseId: VENDOR_OWNED_RELEASE_ID, releaseVersion: "1.3.0", publishedAt: "2026-11-03T00:00:00Z",
      allocateId: (kind) => { throw new Error(`catalog-owned-seed-unexpected-allocation:${kind}`); },
    },
  });
  if (!imported.ok || imported.value.kind !== "successor" || imported.value.built.kind !== "successor") {
    throw new Error(`catalog-owned-seed-build:${JSON.stringify(imported)}`);
  }
  if (imported.value.changeSet.some((change) => change.op !== "declare-subject-owner")) {
    throw new Error("catalog-owned-seed-unexpected-change");
  }
  const bundle = imported.value.built.artifact.bundle;
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok || compiled.value.aggregateDigest !== VENDOR_OWNED_AGGREGATE_DIGEST) {
    throw new Error("catalog-owned-seed-digest-drift");
  }
  return { bundle, compiled: compiled.value, predecessor: previous.compiled.release };
}
