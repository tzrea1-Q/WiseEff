import { createHash } from "node:crypto";

import { stableSemanticId } from "../parameter-topology/migration";

/** Display-only sanitize. Never feed this into unique identity hashes. */
export function sanitizeSpecSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.@+-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

/**
 * Lossless, unambiguous field encoding for hash inputs.
 * Distinct raw strings (e.g. "vendor,limit" vs "vendor-limit") never collapse.
 */
export function canonicalIdentityPart(field: string, value: string): string {
  return `${field}:${value.length}:${value}`;
}

function manualSpecificationKeyDigest(input: { propertyKey: string; driverModule: string }): string {
  return createHash("sha256")
    .update(
      [
        canonicalIdentityPart("driverModule", input.driverModule),
        canonicalIdentityPart("propertyKey", input.propertyKey),
      ].join("\u001f"),
    )
    .digest("hex")
    .slice(0, 24);
}

/** Legacy (lossy) hash formula used before Round 6 — for collision audits only. */
export function buildLegacyManualSpecIds(input: {
  organizationId: string;
  propertyKey: string;
  driverModule: string | null;
}): {
  schemaNamespace: string;
  specificationKey: string;
  parameterSpecId: string;
  parameterSpecVersionId: string;
  dtsPropertySpecId: string;
} {
  const schemaNamespace = sanitizeSpecSegment(input.driverModule ?? "manual");
  const propertySegment = sanitizeSpecSegment(input.propertyKey);
  const specificationKey = `${schemaNamespace}/${propertySegment}`;
  const parameterSpecId = stableSemanticId("parameter_spec", [
    input.organizationId,
    "manual",
    schemaNamespace,
    propertySegment,
  ]);
  const parameterSpecVersionId = stableSemanticId("parameter_spec_version", [parameterSpecId, "1"]);
  const dtsPropertySpecId = stableSemanticId("dts_property_spec", [parameterSpecId, propertySegment]);
  return {
    schemaNamespace,
    specificationKey,
    parameterSpecId,
    parameterSpecVersionId,
    dtsPropertySpecId,
  };
}

export function buildManualSpecIds(input: {
  organizationId: string;
  propertyKey: string;
  driverModule: string | null;
}): {
  schemaNamespace: string;
  specificationKey: string;
  parameterSpecId: string;
  parameterSpecVersionId: string;
  dtsPropertySpecId: string;
} {
  const rawDriver = input.driverModule ?? "";
  const schemaNamespace = sanitizeSpecSegment(input.driverModule ?? "manual");
  const propertySegment = sanitizeSpecSegment(input.propertyKey);
  // specification_key is also covered by a database uniqueness constraint. Keep
  // the readable prefix, but derive uniqueness from the same lossless raw tuple.
  const specificationKey = `${schemaNamespace}/${propertySegment}-${manualSpecificationKeyDigest({
    driverModule: rawDriver,
    propertyKey: input.propertyKey,
  })}`;
  const parameterSpecId = stableSemanticId("parameter_spec", [
    canonicalIdentityPart("organizationId", input.organizationId),
    "manual",
    canonicalIdentityPart("driverModule", rawDriver),
    canonicalIdentityPart("propertyKey", input.propertyKey),
  ]);
  const parameterSpecVersionId = stableSemanticId("parameter_spec_version", [
    canonicalIdentityPart("parameterSpecId", parameterSpecId),
    canonicalIdentityPart("version", "1"),
  ]);
  const dtsPropertySpecId = stableSemanticId("dts_property_spec", [
    canonicalIdentityPart("parameterSpecId", parameterSpecId),
    canonicalIdentityPart("propertyKey", input.propertyKey),
  ]);
  return {
    schemaNamespace,
    specificationKey,
    parameterSpecId,
    parameterSpecVersionId,
    dtsPropertySpecId,
  };
}

export type ManualSpecIdentityCollision = {
  left: { propertyKey: string; driverModule: string | null };
  right: { propertyKey: string; driverModule: string | null };
  legacyParameterSpecId: string;
  losslessLeftId: string;
  losslessRightId: string;
};

/**
 * Fail-closed collision audit: find distinct raw key pairs that share a legacy sanitize-hash ID.
 * Does not rewrite any stored IDs.
 */
export function findLegacyManualSpecIdentityCollisions(
  candidates: Array<{ propertyKey: string; driverModule: string | null; organizationId: string }>,
): ManualSpecIdentityCollision[] {
  const byLegacyId = new Map<string, Array<{ propertyKey: string; driverModule: string | null; organizationId: string }>>();
  for (const candidate of candidates) {
    const legacy = buildLegacyManualSpecIds(candidate);
    const list = byLegacyId.get(legacy.parameterSpecId) ?? [];
    list.push(candidate);
    byLegacyId.set(legacy.parameterSpecId, list);
  }

  const collisions: ManualSpecIdentityCollision[] = [];
  for (const [legacyParameterSpecId, group] of byLegacyId) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const left = group[i];
        const right = group[j];
        if (left.propertyKey === right.propertyKey && (left.driverModule ?? "") === (right.driverModule ?? "")) {
          continue;
        }
        collisions.push({
          left: { propertyKey: left.propertyKey, driverModule: left.driverModule },
          right: { propertyKey: right.propertyKey, driverModule: right.driverModule },
          legacyParameterSpecId,
          losslessLeftId: buildManualSpecIds(left).parameterSpecId,
          losslessRightId: buildManualSpecIds(right).parameterSpecId,
        });
      }
    }
  }
  return collisions;
}

/** Stable fingerprint for audit reports (not an entity id). */
export function collisionReportFingerprint(collision: ManualSpecIdentityCollision): string {
  return createHash("sha256")
    .update(
      [
        collision.legacyParameterSpecId,
        collision.left.propertyKey,
        collision.left.driverModule ?? "",
        collision.right.propertyKey,
        collision.right.driverModule ?? "",
      ].join("\u001f"),
    )
    .digest("hex")
    .slice(0, 16);
}
