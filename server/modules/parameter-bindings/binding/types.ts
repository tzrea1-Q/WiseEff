import type { CatalogSnapshot } from "../../catalog-kernel/interface";
import type {
  CatalogReleaseIdentity,
  CatalogSubjectId,
  DefinitionRevisionId,
  ParameterBindingId,
  ParameterDefinitionId,
  ProjectValueId,
  Result as ContractResult,
  SubjectRegistrationId,
} from "../../parameter-catalog-contract/index";

export type Result<T, E> = ContractResult<T, E>;

export type Binding = {
  readonly id: ParameterBindingId;
  readonly organizationId: string;
  readonly projectId: string;
  readonly logicalNodeId: string;
  readonly registrationId: SubjectRegistrationId;
  readonly subjectId: CatalogSubjectId;
  readonly definitionId: ParameterDefinitionId;
  readonly effectiveRevisionId: DefinitionRevisionId;
  readonly catalogRelease: CatalogReleaseIdentity;
  readonly currentValueId: ProjectValueId;
};

export type StabilizeBindingCommand = {
  readonly snapshot: CatalogSnapshot;
  readonly organizationId: string;
  readonly projectId: string;
  readonly logicalNodeId: string;
  readonly registrationId: SubjectRegistrationId;
  readonly definitionId: ParameterDefinitionId;
  readonly effectiveRevisionId: DefinitionRevisionId;
  readonly expectedEffectiveRevisionId: DefinitionRevisionId | null;
};

export type BindingResult = {
  readonly outcome: "committed" | "replayed";
  readonly binding: Binding;
};

export type BindingAgreementConflictReason =
  | "module-identity"
  | "latest-head"
  | "revision-unavailable"
  | "definition-unknown"
  | "registration-inactive"
  | "registration-not-found"
  | "subject-mismatch"
  | "project-owner-mismatch"
  | "legacy-unproven";

export type BindingConflict =
  | {
      readonly kind: "agreement-conflict";
      readonly reason: BindingAgreementConflictReason;
    }
  | {
      readonly kind: "owner-conflict";
      readonly bindingId: ParameterBindingId;
      readonly existingOrganizationId: string;
      readonly attemptedOrganizationId: string;
    }
  | {
      readonly kind: "cas-mismatch";
      readonly bindingId: ParameterBindingId;
      readonly expectedEffectiveRevisionId: DefinitionRevisionId;
      readonly actualEffectiveRevisionId: DefinitionRevisionId;
    }
  | {
      readonly kind: "invalid-command";
      readonly reason: string;
    };
