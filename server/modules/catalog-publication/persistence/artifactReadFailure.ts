import type { CatalogPublicationStoreError } from "./types";

export type ArtifactReadFailure =
  | { readonly kind: "artifact-missing" | "artifact-unreadable" | "artifact-scalar-too-large" }
  | { readonly kind: "artifact-read-failed"; readonly retryable: boolean };

export function artifactDecodeFailure(detail: string): "artifact-scalar-too-large" | "artifact-unreadable" {
  return detail === "catalog-release-bundle-scalar-too-large" ? "artifact-scalar-too-large" : "artifact-unreadable";
}

export function artifactReadFailure(error: CatalogPublicationStoreError): ArtifactReadFailure {
  if (error.kind === "not-found") return { kind: "artifact-missing" };
  if (error.kind === "invalid-input") return { kind: artifactDecodeFailure(error.reason) };
  // Permission and integrity failures need operator intervention. Connection,
  // resource and concurrency failures can use the manager's normal retry budget.
  const retryable = error.kind === "constraint-violation" &&
    /^(08|40|53|55P03$|57P0[123]$)/u.test(error.sqlstate);
  return { kind: "artifact-read-failed", retryable };
}
