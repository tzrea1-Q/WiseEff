import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  type CatalogReleasePin,
} from "../../parameter-catalog-contract/index";
import type { ActivationReceiptKind } from "../persistence/types";

export type CatalogPublicationDataMode = "new-empty" | "populated";

export type DualFactNotReadyReason =
  | "unpublished"
  | "legacy-d1-without-receipt"
  | "missing-receipt"
  | "receipt-pin-mismatch"
  | "artifact-pin-mismatch"
  | "unsupported-catalog-capability"
  | "application-pin-absent"
  | "application-pin-catalog-mismatch";

export type ApplicationFact =
  | {
      readonly kind: "new-empty-without-p13";
      readonly claimsP13Retired: false;
    }
  | {
      readonly kind: "approved-runtime-pin";
      readonly reportDigest: string;
      readonly purpose: "post-retirement-runtime";
      readonly catalogPin: CatalogReleasePin;
    }
  | {
      readonly kind: "combo-catalog-publication-runtime";
      readonly reportDigest: string;
      readonly purpose: "catalog-publication-runtime";
      readonly catalogPin: CatalogReleasePin;
    };

export type CatalogPublicationFact = {
  readonly pin: CatalogReleasePin;
  readonly receiptKind: ActivationReceiptKind;
  readonly receiptId: string;
  readonly artifactPresent: boolean;
  readonly capabilityContractRevision: string;
};

export type DualFactReadiness =
  | {
      readonly status: "ready";
      readonly onlinePublicationReady: true;
      readonly application: ApplicationFact;
      readonly catalog: CatalogPublicationFact;
    }
  | {
      readonly status: "unpublished";
      readonly onlinePublicationReady: false;
    }
  | {
      readonly status: "not-ready";
      readonly onlinePublicationReady: false;
      readonly reasons: readonly DualFactNotReadyReason[];
      readonly application?: ApplicationFact;
      readonly catalog?: CatalogPublicationFact;
      readonly currentPin?: CatalogReleasePin | null;
    };

export const pinOf = (id: string, digest: string): CatalogReleasePin => ({
  id: CatalogReleaseId(id),
  digest: CatalogReleaseDigest(digest),
});
