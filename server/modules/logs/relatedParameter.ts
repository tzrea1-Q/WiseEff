import type pg from "pg";

import { ApiError } from "../../shared/http/errors";
import type { TrustedInvocationContext } from "../auth/trustedInvocation";
import { readProjectProtectedParameters } from "../parameter-bindings/adapters";
import { loadOwnedProjectValueSourcePin } from "../parameter-bindings/values/service";
import type { CanonicalValueSourcePin } from "../parameter-bindings/values/types";
import type { ProjectProtectedParameter } from "../parameter-bindings/adapters/projectReadAdapter";
import type { ProtectedReferenceDto } from "../parameter-bindings/adapters/dto";
import type { DefinitionRevisionSnapshot } from "../catalog-kernel/interface";

export type RelatedParameterSelection = {
  readonly kind: "canonical-pin";
  readonly projectId: string;
  readonly bindingId: string;
  readonly definitionId?: string;
  readonly definitionRevisionId?: string;
};

export type AuthorizedRelatedParameter = ProjectProtectedParameter & {
  readonly sourcePin: CanonicalValueSourcePin;
};

/** Exact current parameter inputs frozen by the API for one analysis run. */
export type RelatedParameterRunSnapshot = {
  readonly schemaVersion: 1;
  readonly pin: ProtectedReferenceDto;
  readonly propertyKey: string;
  readonly revision: DefinitionRevisionSnapshot;
  readonly sourcePin: CanonicalValueSourcePin;
};

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Resolve the current canonical value for an explicitly scoped related Binding.
 * The caller supplies a trusted principal and project; client pin claims are
 * checked against the resolved current identity and are never used to select it.
 */
export async function resolveAuthorizedRelatedParameter(
  pool: pg.Pool,
  input: {
    readonly invocation: TrustedInvocationContext;
    readonly projectId: string;
    readonly bindingId: string;
    readonly definitionId?: string;
    readonly definitionRevisionId?: string;
  }
): Promise<AuthorizedRelatedParameter> {
  async function findParameter() {
    const parameters = await readProjectProtectedParameters(pool, {
      invocation: input.invocation,
      projectId: input.projectId
    });
    return parameters.find(({ pin }) => pin.bindingId === input.bindingId);
  }

  const first = await findParameter();
  if (!first) {
    throw new ApiError("NOT_FOUND", "Related parameter Binding was not found in the authorized project.", {
      projectId: input.projectId,
      bindingId: input.bindingId
    });
  }
  const firstSourcePin = await loadOwnedProjectValueSourcePin(pool, {
    organizationId: first.pin.organizationId,
    projectId: first.pin.projectId,
    bindingId: first.pin.bindingId,
    projectValueId: first.pin.currentValueId
  });
  const second = await findParameter();
  const sourcePin = second && await loadOwnedProjectValueSourcePin(pool, {
    organizationId: second.pin.organizationId,
    projectId: second.pin.projectId,
    bindingId: second.pin.bindingId,
    projectValueId: second.pin.currentValueId
  });
  // Catalog resolution itself uses an adapter-owned read transaction. Verify its
  // output and the separately loaded source pin agree across a second full read;
  // do not claim a caller-owned transaction spans those adapter transactions.
  if (!second || !firstSourcePin || !sourcePin || !sameJson(first.pin, second.pin) || !sameJson(first.revision, second.revision) || !sameJson(firstSourcePin, sourcePin)) {
    throw new ApiError("CONFLICT", "Related parameter changed while its run snapshot was being prepared.", {
      projectId: input.projectId,
      bindingId: input.bindingId
    });
  }
  if (
    (input.definitionId !== undefined && input.definitionId !== second.pin.definitionId) ||
    (input.definitionRevisionId !== undefined && input.definitionRevisionId !== second.pin.definitionRevisionId)
  ) {
    throw new ApiError("CONFLICT", "Related parameter selection no longer matches the current Binding pin.", {
      projectId: input.projectId,
      bindingId: input.bindingId
    });
  }
  if (
    sourcePin.bindingId !== second.pin.bindingId ||
    sourcePin.projectId !== second.pin.projectId ||
    sourcePin.projectValueId !== second.pin.currentValueId ||
    sourcePin.definitionId !== second.pin.definitionId ||
    sourcePin.configRevisionId !== second.pin.source.configRevisionId
  ) {
    throw new ApiError("CONFLICT", "Related parameter source pin is unavailable at the current value.", {
      projectId: input.projectId,
      bindingId: input.bindingId,
      currentValueId: second.pin.currentValueId
    });
  }
  return { ...second, sourcePin };
}

export function toRelatedParameterRunSnapshot(
  parameter: AuthorizedRelatedParameter
): RelatedParameterRunSnapshot {
  return {
    schemaVersion: 1,
    pin: parameter.pin,
    propertyKey: parameter.propertyKey,
    revision: parameter.revision,
    sourcePin: parameter.sourcePin
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reject absent, legacy, partial, or internally inconsistent persisted run pins. */
export function requireRelatedParameterRunSnapshot(
  value: unknown,
  expected: { organizationId: string; projectId: string; bindingId: string }
): RelatedParameterRunSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.pin) || !isRecord(value.revision) || !isRecord(value.sourcePin)) {
    throw new Error("Canonical related-parameter run snapshot is unavailable or invalid.");
  }
  const { pin, revision, sourcePin } = value;
  const release = pin.catalogRelease;
  const payload = pin.payload;
  const publishedIn = revision.publishedIn;
  const revisionContent = revision.content;
  if (
    pin.kind !== "canonical-pin" ||
    pin.organizationId !== expected.organizationId ||
    pin.projectId !== expected.projectId ||
    pin.bindingId !== expected.bindingId ||
    typeof pin.definitionId !== "string" ||
    typeof pin.definitionRevisionId !== "string" ||
    typeof pin.currentValueId !== "string" ||
    typeof pin.valueDigest !== "string" ||
    typeof pin.source !== "object" || pin.source === null ||
    !isRecord(release) || typeof release.id !== "string" || typeof release.digest !== "string" ||
    !isRecord(payload) || typeof payload.kind !== "string" || !("value" in payload) ||
    typeof value.propertyKey !== "string" ||
    revision.id !== pin.definitionRevisionId ||
    revision.definitionId !== pin.definitionId ||
    !isRecord(publishedIn) || publishedIn.id !== release.id || publishedIn.digest !== release.digest ||
    !isRecord(revisionContent) ||
    sourcePin.organizationId !== expected.organizationId ||
    sourcePin.projectId !== expected.projectId ||
    sourcePin.bindingId !== expected.bindingId ||
    sourcePin.definitionId !== pin.definitionId ||
    sourcePin.projectValueId !== pin.currentValueId ||
    sourcePin.configRevisionId !== (pin.source as Record<string, unknown>).configRevisionId ||
    typeof sourcePin.sourcePinId !== "string" ||
    typeof sourcePin.fileVersionId !== "string"
  ) {
    throw new Error("Canonical related-parameter run snapshot is unavailable or invalid.");
  }
  return value as unknown as RelatedParameterRunSnapshot;
}
