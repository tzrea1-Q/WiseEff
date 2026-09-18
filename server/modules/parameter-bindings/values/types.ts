import type { CatalogSnapshot } from "../../catalog-kernel/interface";
import type {
  ContractJsonValue,
  DefinitionRevisionId,
  ParameterBindingId,
  ParameterDefinitionId,
  ProjectValueId,
  Result as ContractResult,
} from "../../parameter-catalog-contract/index";
import type { Binding } from "../binding";

export type CanonicalValueSourcePin = {
  organizationId: string; projectId: string; bindingId: string; definitionId: string;
  projectValueId: string; sourcePinId: string; sourceOccurrenceId: string;
  configSetId: string; configRevisionId: string; fileId: string; fileVersionId: string;
  format: "dts" | "json"; logicalNodeId: string | null; configurationInstanceId: string | null;
  configurationSchemaSubjectId: string | null; rootPointer: string | null;
  entryFile: string | null; includeSearchPaths: string[]; overlayOrder: string[];
  locator: Record<string, ContractJsonValue>;
};

export type CanonicalSourceBindingPin = {
  bindingId: string; oldValueId: string; sourcePinId: string; sourceOccurrenceId: string;
  definitionId: string; effectiveRevisionId: string; catalogReleaseId: string;
  locator: Record<string, ContractJsonValue>; valueKind: string; valueDigest: string; configSetId: string;
};

export type Result<T, E> = ContractResult<T, E>;

export type ProjectValueKind =
  | "string"
  | "number"
  | "boolean"
  | "string-array"
  | "number-array"
  | "json";

export type ProjectValuePayload =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "string-array"; readonly value: readonly string[] }
  | { readonly kind: "number-array"; readonly value: readonly number[] }
  | { readonly kind: "json"; readonly value: import("../../parameter-catalog-contract/index").ContractJsonValue };

export type ProjectValueSource = {
  readonly sourceRef: string;
  readonly configRevisionId: string;
};

export type ProjectValue = {
  readonly id: ProjectValueId;
  readonly bindingId: ParameterBindingId;
  readonly definitionId: ParameterDefinitionId;
  readonly definitionRevisionId: DefinitionRevisionId;
  readonly source: ProjectValueSource;
  readonly valueDigest: string;
  readonly payload: ProjectValuePayload;
  readonly createdAt: string;
};

export type AppendProjectValueCommand = {
  readonly snapshot: CatalogSnapshot;
  readonly binding: Binding;
  readonly definitionRevisionId: DefinitionRevisionId;
  readonly source: ProjectValueSource;
  readonly payload: ProjectValuePayload;
  readonly expectedTip: ProjectValueId;
  /** Internal approved source batch; the request freezes this Binding/base tip. */
  readonly sourceCommit?: { readonly requestId: string; readonly auditRef: string; readonly derived: boolean };
};

export type ProjectValueHistoryQuery = {
  readonly binding: Binding;
  readonly definitionRevisionId: DefinitionRevisionId;
};

export type MutateExistingProjectValueCommand = {
  readonly valueId: ProjectValueId;
  readonly mutation: "update" | "delete";
};

export type ProjectValueWriteResult = {
  readonly outcome: "committed" | "replayed";
  readonly value: ProjectValue;
  readonly currentTip: ProjectValueId;
};

export type ProjectValueConflict =
  | {
      readonly kind: "cas-mismatch";
      readonly bindingId: ParameterBindingId;
      readonly expectedTip: ProjectValueId;
      readonly actualTip: ProjectValueId;
    }
  | {
      readonly kind: "immutable-value";
      readonly valueId: ProjectValueId;
      readonly mutation: "update" | "delete";
    }
  | {
      readonly kind: "source-conflict";
      readonly reason: "source-mismatch" | "cross-binding";
      readonly bindingId: ParameterBindingId;
      readonly existingSourceRef: string;
      readonly attemptedSourceRef: string;
    }
  | {
      readonly kind: "owner-conflict";
      readonly bindingId: ParameterBindingId;
      readonly existingOrganizationId: string;
      readonly attemptedOrganizationId: string;
    }
  | {
      readonly kind: "agreement-conflict";
      readonly reason:
        | "revision-unavailable"
        | "revision-mismatch"
        | "definition-unknown"
        | "binding-not-found"
        | "binding-identity";
    }
  | {
      readonly kind: "invalid-command";
      readonly reason: string;
    };
