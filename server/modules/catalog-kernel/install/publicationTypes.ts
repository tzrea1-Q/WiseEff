import type { PublicationAuthorizationReason } from "../../catalog-publication/authorization/types";
import type {
  CatalogActivationReceiptId,
  CatalogCandidateId,
  CatalogKernelError,
  CatalogMaterializationFingerprint,
  CatalogReleaseCounts,
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogReleaseIdentity,
  CatalogReleasePin,
  InstallResult,
  PublicationAuthorizationId,
  PublicationJobId,
} from "../../parameter-catalog-contract/index";

export type ActivationReceiptCurrentness = "active" | "active-superseded";

export type ActivationReceiptSummary = {
  readonly id: CatalogActivationReceiptId;
  readonly kind: "online-publication" | "adopted-preexisting" | "bootstrap";
  readonly releaseId: CatalogReleaseId;
  readonly releaseDigest: CatalogReleaseDigest;
  readonly predecessorReleaseId: CatalogReleaseId | null;
  readonly predecessorReleaseDigest: CatalogReleaseDigest | null;
  readonly publicationJobId: PublicationJobId | null;
  readonly authorizationId: PublicationAuthorizationId | null;
  readonly candidateId: CatalogCandidateId | null;
};

export type OnlinePublicationInstalledResult = {
  readonly status: "installed";
  readonly commandKind: "online-publication";
  readonly previous: CatalogReleasePin;
  readonly current: CatalogReleaseIdentity;
  readonly receipt: ActivationReceiptSummary;
  readonly currentness: "active";
  readonly materializationFingerprint: CatalogMaterializationFingerprint;
  readonly counts: CatalogReleaseCounts;
};

export type AdoptedPreexistingInstalledResult = {
  readonly status: "installed";
  readonly commandKind: "adopted-preexisting";
  readonly previous: CatalogReleasePin;
  readonly current: CatalogReleaseIdentity;
  readonly receipt: ActivationReceiptSummary;
  readonly currentness: "active";
  readonly materializationFingerprint: CatalogMaterializationFingerprint;
  readonly counts: CatalogReleaseCounts;
};

export type AlreadyRecordedResult = {
  readonly status: "already-recorded";
  readonly commandKind: "online-publication" | "adopted-preexisting";
  readonly currentness: ActivationReceiptCurrentness;
  readonly current: CatalogReleaseIdentity;
  readonly target: CatalogReleasePin;
  readonly base: CatalogReleasePin | null;
  readonly receipt: ActivationReceiptSummary;
  readonly materializationFingerprint: CatalogMaterializationFingerprint | null;
  readonly counts: CatalogReleaseCounts | null;
};

export type CatalogInstallOutcome =
  | InstallResult
  | OnlinePublicationInstalledResult
  | AdoptedPreexistingInstalledResult
  | AlreadyRecordedResult;

export type PublicationActivationError =
  | {
      readonly kind: "needs-rebase";
      readonly installed: CatalogReleaseIdentity | null;
      readonly target: CatalogReleaseIdentity;
      readonly expectedCurrent: CatalogReleasePin;
    }
  | {
      readonly kind: "publication-not-authorized";
      readonly reason: PublicationAuthorizationReason;
      readonly detail?: string;
    }
  | {
      readonly kind: "fencing-token-mismatch";
      readonly expected: number;
      readonly actual: number | null;
    }
  | {
      readonly kind: "activation-receipt-mismatch";
      readonly jobId: PublicationJobId;
      readonly detail: string;
    }
  | {
      readonly kind: "adoption-evidence-invalid";
      readonly detail: string;
    }
  | {
      readonly kind: "publication-regime-required";
      readonly receiptsPresent: true;
    }
  | {
      readonly kind: "artifact-missing";
      readonly detail?: string;
    }
  | {
      readonly kind: "predecessor-incomplete";
      readonly detail: string;
    };

export type CatalogInstallError = CatalogKernelError | PublicationActivationError;

export class PublicationActivationFailure extends Error {
  readonly activationError: PublicationActivationError;

  constructor(activationError: PublicationActivationError) {
    super(activationError.kind);
    this.name = "PublicationActivationFailure";
    this.activationError = activationError;
  }
}

export class CatalogInstallFailure extends Error {
  readonly installError: CatalogInstallError;

  constructor(installError: CatalogInstallError) {
    super(installError.kind);
    this.name = "CatalogInstallFailure";
    this.installError = installError;
  }
}
