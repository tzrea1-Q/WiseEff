import { randomUUID } from "node:crypto";
import pg from "pg";

import {
  CatalogArtifactId,
  CatalogReleaseDigest,
  CatalogReleaseId,
  type CatalogReleasePin,
  type Result,
} from "../../parameter-catalog-contract/index";
import {
  CATALOG_PUBLICATION_COORDINATOR_ROLE,
  quoteIdent,
} from "../../catalog-kernel/security/catalogRoleManifest";
import type { AdoptedPreexistingEvidence } from "../../catalog-kernel/interface";
import { compileCatalogRelease, isCatalogReleaseBundle } from "../../catalog-kernel/compiler/index";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import {
  readCurrentCatalogPointer,
} from "../../catalog-kernel/install/currentPointer";
import type {
  CatalogInstallError,
  CatalogInstallOutcome,
} from "../../catalog-kernel/install/publicationTypes";
import { persistArtifact } from "../persistence/store";
import { asQueryable } from "../../catalog-kernel/install/publicationActivation";

export type AdoptionEvidenceKind = "synthetic-fixture" | "target-host";

export type AdoptPreexistingCatalogInput = {
  readonly expectedCurrent: CatalogReleasePin;
  readonly actorPrincipalId: string;
  readonly sourceBytes: Uint8Array;
  readonly artifactDigest: string;
  readonly adoptionEvidence: AdoptedPreexistingEvidence;
  readonly evidenceKind: AdoptionEvidenceKind;
  readonly toolchain?: { readonly [key: string]: string };
};

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;

const fail = (
  error: CatalogInstallError,
): Result<never, CatalogInstallError> => ({ ok: false, error });

const invalid = (detail: string): Result<never, CatalogInstallError> =>
  fail({ kind: "adoption-evidence-invalid", detail });

/**
 * Saves a verified exact source bundle then calls the unique synchronizer
 * adoption command. Does not advance the Catalog pointer. Synthetic fixtures
 * must set evidenceKind: "synthetic-fixture" and are not target-host evidence.
 */
export const adoptPreexistingCatalog = async (
  pool: pg.Pool,
  input: AdoptPreexistingCatalogInput,
): Promise<Result<CatalogInstallOutcome, CatalogInstallError>> => {
  if (input.evidenceKind !== "synthetic-fixture" && input.evidenceKind !== "target-host") {
    return invalid("adoption evidence kind is required");
  }
  if (!SHA256_DIGEST.test(input.artifactDigest)) {
    return invalid("artifact digest is not sha256");
  }
  if (input.artifactDigest !== input.expectedCurrent.digest) {
    return invalid("adoption artifact digest does not match the expected current pin");
  }
  if (input.adoptionEvidence.source_bundle_digest !== input.expectedCurrent.digest) {
    return invalid("adoption evidence pin does not match the expected current digest");
  }
  if (input.sourceBytes.byteLength === 0) {
    return invalid("adoption source bytes are missing");
  }

  let bundle;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(input.sourceBytes);
    const parsed: unknown = JSON.parse(text);
    if (!isCatalogReleaseBundle(parsed)) {
      return invalid("adoption source bytes are not a catalog release bundle");
    }
    bundle = parsed;
  } catch {
    return invalid("adoption source bytes are unreadable");
  }
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) {
    return invalid("adoption source bytes failed to compile");
  }
  if (
    compiled.value.aggregateDigest !== input.artifactDigest ||
    compiled.value.release.id !== input.expectedCurrent.id ||
    compiled.value.release.digest !== input.expectedCurrent.digest ||
    compiled.value.aggregateDigest !== input.expectedCurrent.digest
  ) {
    return invalid("compiled adoption artifact does not match the expected current pin");
  }

  const pointer = await readCurrentCatalogPointer(pool);
  if (
    pointer.kind !== "installed" ||
    pointer.current.id !== input.expectedCurrent.id ||
    pointer.current.digest !== input.expectedCurrent.digest
  ) {
    return invalid("adoption target is not the current catalog pin");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${quoteIdent(CATALOG_PUBLICATION_COORDINATOR_ROLE)}`);
    const stored = await persistArtifact(asQueryable(client), {
      id: CatalogArtifactId(`cart_${randomUUID()}`),
      artifactDigest: input.artifactDigest,
      artifactBytes: input.sourceBytes,
      sourceKind: "adopted-preexisting",
      targetReleaseId: CatalogReleaseId(input.expectedCurrent.id),
      targetReleaseDigest: CatalogReleaseDigest(input.expectedCurrent.digest),
      predecessorReleaseId: null,
      predecessorReleaseDigest: null,
      toolchain: input.toolchain ?? { adapter: "catalog-publication/runtime/adoption" },
    });
    if (!stored.ok) {
      await client.query("rollback");
      return invalid(`adoption artifact persist failed: ${stored.error.kind}`);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const installed = await installPublishedRelease(pool, {
    mode: "adopted-preexisting",
    expectedCurrent: input.expectedCurrent,
    actorPrincipalId: input.actorPrincipalId,
    adoptionEvidence: input.adoptionEvidence,
  });
  if (!installed.ok) {
    return installed;
  }

  const after = await readCurrentCatalogPointer(pool);
  if (
    after.kind !== "installed" ||
    after.current.id !== input.expectedCurrent.id ||
    after.current.digest !== input.expectedCurrent.digest
  ) {
    return invalid("adoption advanced the catalog pointer");
  }
  return installed;
};

