import type { CatalogSnapshot } from "../../catalog-kernel/interface";
import type {
  CatalogReleaseIdentity,
  DefinitionRevisionId,
  ParameterBindingId,
  ParameterDefinitionId,
  ProjectValueId,
  Result as ContractResult,
  SubjectRegistrationId,
  CatalogSubjectId,
} from "../../parameter-catalog-contract/index";
import type { Binding } from "../binding";
import type {
  ProjectValue,
  ProjectValuePayload,
  ProjectValueSource,
} from "../values";

export type Result<T, E> = ContractResult<T, E>;

export type ProtectedReferenceDto = {
  readonly kind: "canonical-pin";
  readonly bindingId: ParameterBindingId;
  readonly organizationId: string;
  readonly projectId: string;
  readonly logicalNodeId: string;
  readonly registrationId: SubjectRegistrationId;
  readonly subjectId: CatalogSubjectId;
  readonly definitionId: ParameterDefinitionId;
  readonly definitionRevisionId: DefinitionRevisionId;
  readonly currentValueId: ProjectValueId;
  readonly catalogRelease: CatalogReleaseIdentity;
  readonly source: ProjectValueSource;
  readonly valueDigest: string;
  readonly payload: ProjectValuePayload;
};

export type ProtectedReferenceWriteback = {
  readonly outcome: "committed" | "replayed";
  readonly pin: ProtectedReferenceDto;
  readonly value: ProjectValue;
  readonly currentTip: ProjectValueId;
};

export type ProtectedReferenceBlock =
  | { readonly kind: "typed-block"; readonly reason: "legacy-parameter-spec-id" }
  | { readonly kind: "typed-block"; readonly reason: "missing-binding" }
  | { readonly kind: "typed-block"; readonly reason: "missing-current-value" }
  | { readonly kind: "typed-block"; readonly reason: "revision-disagreement" }
  | { readonly kind: "typed-block"; readonly reason: "invalid-command"; readonly field: string }
  | {
      readonly kind: "typed-block";
      readonly reason: "cas-conflict";
      readonly bindingId: ParameterBindingId;
      readonly expectedTip: ProjectValueId;
      readonly actualTip: ProjectValueId;
    }
  | {
      readonly kind: "typed-block";
      readonly reason: "source-conflict";
      readonly bindingId: ParameterBindingId;
      readonly sourceReason: "source-mismatch" | "cross-binding";
      readonly existingSourceRef: string;
      readonly attemptedSourceRef: string;
    };

export type ProtectedReadCommand = {
  readonly snapshot: CatalogSnapshot;
  readonly binding: Binding | null;
  readonly definitionRevisionId: DefinitionRevisionId;
};

export type ProtectedWritebackCommand = {
  readonly snapshot: CatalogSnapshot;
  readonly binding: Binding | null;
  readonly definitionRevisionId: DefinitionRevisionId;
  readonly source: ProjectValueSource;
  readonly payload: ProjectValuePayload;
  readonly expectedTip: ProjectValueId;
};

export type ProtectedReferenceReadResult = Result<ProtectedReferenceDto, ProtectedReferenceBlock>;
export type ProtectedReferenceWritebackResult = Result<
  ProtectedReferenceWriteback,
  ProtectedReferenceBlock
>;

const camelLegacySpecKey = ["parameter", "Spec", "Id"].join("");
const snakeLegacySpecKey = ["parameter", "spec", "id"].join("_");

export const blocked = (
  error: ProtectedReferenceBlock,
): Result<never, ProtectedReferenceBlock> => ({
  ok: false,
  error,
});

export const hasLegacyParameterSpecId = (command: object): boolean =>
  Object.prototype.hasOwnProperty.call(command, camelLegacySpecKey) ||
  Object.prototype.hasOwnProperty.call(command, snakeLegacySpecKey);

const controlFree = (value: string): boolean =>
  value.length > 0 && value.trim() === value && !/[\u0000-\u001F\u007F-\u009F]/u.test(value);

export const toProtectedReferenceDto = (
  binding: Binding,
  value: ProjectValue,
): ProtectedReferenceDto => ({
  kind: "canonical-pin",
  bindingId: binding.id,
  organizationId: binding.organizationId,
  projectId: binding.projectId,
  logicalNodeId: binding.logicalNodeId,
  registrationId: binding.registrationId,
  subjectId: binding.subjectId,
  definitionId: binding.definitionId,
  definitionRevisionId: binding.effectiveRevisionId,
  currentValueId: value.id,
  catalogRelease: binding.catalogRelease,
  source: value.source,
  valueDigest: value.valueDigest,
  payload: value.payload,
});

export const agreeExactRevision = (
  binding: Binding,
  definitionRevisionId: DefinitionRevisionId,
  snapshot: CatalogSnapshot,
): Result<true, ProtectedReferenceBlock> => {
  if (definitionRevisionId !== binding.effectiveRevisionId) {
    return blocked({ kind: "typed-block", reason: "revision-disagreement" });
  }
  if (
    snapshot.release.id !== binding.catalogRelease.id ||
    snapshot.release.digest !== binding.catalogRelease.digest
  ) {
    return blocked({ kind: "typed-block", reason: "revision-disagreement" });
  }
  const revision = snapshot.getDefinitionRevision({
    definitionId: binding.definitionId,
    revisionId: definitionRevisionId,
  });
  if (revision.status !== "found") {
    return blocked({ kind: "typed-block", reason: "revision-disagreement" });
  }
  return { ok: true, value: true };
};

export const requireBinding = (
  command: ProtectedReadCommand | ProtectedWritebackCommand,
): Result<Binding, ProtectedReferenceBlock> => {
  if (hasLegacyParameterSpecId(command)) {
    return blocked({ kind: "typed-block", reason: "legacy-parameter-spec-id" });
  }
  if (command.binding === null) {
    return blocked({ kind: "typed-block", reason: "missing-binding" });
  }
  if (!controlFree(command.definitionRevisionId)) {
    return blocked({ kind: "typed-block", reason: "invalid-command", field: "definitionRevisionId" });
  }
  if (!controlFree(command.binding.id)) {
    return blocked({ kind: "typed-block", reason: "invalid-command", field: "bindingId" });
  }
  if (!controlFree(command.binding.currentValueId)) {
    return blocked({ kind: "typed-block", reason: "invalid-command", field: "currentValueId" });
  }
  const agreed = agreeExactRevision(
    command.binding,
    command.definitionRevisionId,
    command.snapshot,
  );
  if (!agreed.ok) {
    return agreed;
  }
  return { ok: true, value: command.binding };
};
