import type { DefinitionProposalStatus } from "../../parameter-catalog-contract/index";

import type {
  CatalogQueryEmptyReason,
  CatalogQueryView,
  ObservationRecognition,
  RegistrationHttpMethod,
  RegistrationHttpStatus,
} from "./types";

const REGISTRATION_METHOD_TO_HTTP = {
  explicit: "explicit",
  automatic: "automatic",
  review: "review",
} as const satisfies Record<string, RegistrationHttpMethod>;

const REGISTRATION_STATUS_TO_HTTP = {
  active: "active",
  retired: "retired",
} as const satisfies Record<string, RegistrationHttpStatus>;

const PROPOSAL_STATUS_TO_HTTP = {
  draft: "draft",
  submitted: "submitted",
  accepted: "accepted",
  rejected: "rejected",
  withdrawn: "withdrawn",
} as const satisfies Record<string, DefinitionProposalStatus>;

const RECOGNITION_TO_HTTP = {
  matched: "matched",
  unknown: "unknown",
  ambiguous: "ambiguous",
  "retired-registration-observed": "retired",
  "placement-conflict": "unknown",
  retired: "retired",
} as const satisfies Record<string, ObservationRecognition>;

export function mapRegistrationMethod(value: string): RegistrationHttpMethod | null {
  return Object.prototype.hasOwnProperty.call(REGISTRATION_METHOD_TO_HTTP, value)
    ? REGISTRATION_METHOD_TO_HTTP[value as keyof typeof REGISTRATION_METHOD_TO_HTTP]
    : null;
}

export function mapRegistrationStatus(value: string): RegistrationHttpStatus | null {
  return Object.prototype.hasOwnProperty.call(REGISTRATION_STATUS_TO_HTTP, value)
    ? REGISTRATION_STATUS_TO_HTTP[value as keyof typeof REGISTRATION_STATUS_TO_HTTP]
    : null;
}

export function mapProposalStatus(value: string): DefinitionProposalStatus | null {
  return Object.prototype.hasOwnProperty.call(PROPOSAL_STATUS_TO_HTTP, value)
    ? PROPOSAL_STATUS_TO_HTTP[value as keyof typeof PROPOSAL_STATUS_TO_HTTP]
    : null;
}

export function mapObservationRecognition(value: string): ObservationRecognition | null {
  return Object.prototype.hasOwnProperty.call(RECOGNITION_TO_HTTP, value)
    ? RECOGNITION_TO_HTTP[value as keyof typeof RECOGNITION_TO_HTTP]
    : null;
}

export function emptyReasonForView(
  view: CatalogQueryView,
  itemCount: number,
  filtered: boolean,
): CatalogQueryEmptyReason | undefined {
  if (itemCount > 0) {
    return undefined;
  }
  if (filtered) {
    return "no-filter-match";
  }
  if (view === "registrations") {
    return "no-registrations";
  }
  if (view === "definitions") {
    return "no-definitions";
  }
  if (view === "reviews") {
    return "no-review-work";
  }
  return "no-filter-match";
}
