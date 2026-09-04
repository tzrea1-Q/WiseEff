import { useEffect, useRef, useState } from "react";

import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import { catalogStateFromFailure, type CatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type {
  CatalogResolveReviewItemRequest,
  CatalogReviewItemResponse
} from "@/infrastructure/http/parameterCatalogDtos";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";

import {
  canExecuteGovernanceAction,
  createGovernanceSubmitGate,
  fingerprintGovernanceDraft,
  governanceCopy,
  governanceFailureMessage,
  placementIntentFromChoice,
  reviewItemGovernanceState,
  reviewResolutionLabels,
  type GovernanceSubmitGate,
  type PlacementChoice
} from "./governanceState";
import type { PlacementOption } from "./RegistrationDialog";

export type ReviewResolutionDialogProps = {
  open: boolean;
  actor: CatalogActorKind;
  domainState: CatalogDomainState;
  repository: ParameterCatalogGovernanceRepository;
  organizationId: string;
  catalogReleaseId: string;
  item: CatalogReviewItemResponse["item"];
  placementOptions?: PlacementOption[];
  defaultRegistrationId?: string;
  createIdempotencyKey?: () => string;
  onOpenChange: (open: boolean) => void;
  onCompleted?: () => void;
  onRefreshEvidence?: () => void | Promise<void>;
};

type ResolutionType = CatalogResolveReviewItemRequest["resolution"]["type"];

export function ReviewResolutionDialog({
  open,
  actor,
  domainState,
  repository,
  organizationId,
  catalogReleaseId,
  item,
  placementOptions = [],
  defaultRegistrationId,
  createIdempotencyKey,
  onOpenChange,
  onCompleted,
  onRefreshEvidence
}: ReviewResolutionDialogProps) {
  const itemState = reviewItemGovernanceState(item, domainState);
  const stale = itemState.kind === "conflict";
  const allowed = !stale && canExecuteGovernanceAction(actor, "resolve-review-item", domainState);
  const gateRef = useRef<GovernanceSubmitGate>(createGovernanceSubmitGate());
  const wasOpen = useRef(false);
  const allowedResolutions = item.allowedResolutions;
  const [resolutionType, setResolutionType] = useState<ResolutionType>(
    allowedResolutions[0] ?? "mark-out-of-scope"
  );
  const [placementMode, setPlacementMode] = useState<"use-default" | "choose-parent">("use-default");
  const [parentPlacementId, setParentPlacementId] = useState(placementOptions[0]?.id ?? "");
  const [displayName, setDisplayName] = useState(placementOptions[0]?.displayName ?? "");
  const [registrationId, setRegistrationId] = useState(defaultRegistrationId ?? "");
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [writeFailure, setWriteFailure] = useState<CatalogDomainState | undefined>();

  useEffect(() => {
    const opened = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opened) {
      return;
    }
    gateRef.current = createGovernanceSubmitGate();
    setResolutionType(item.allowedResolutions[0] ?? "mark-out-of-scope");
    setPlacementMode("use-default");
    setParentPlacementId(placementOptions[0]?.id ?? "");
    setDisplayName(placementOptions[0]?.displayName ?? "");
    setRegistrationId(defaultRegistrationId ?? "");
    setReason("");
    setConfirmOpen(false);
    setPending(false);
    setWriteFailure(undefined);
  }, [open, item, defaultRegistrationId, placementOptions]);

  const choice: PlacementChoice =
    placementMode === "use-default"
      ? { mode: "use-default" }
      : { mode: "choose-parent", parentPlacementId, displayName };
  const reasonReady = reason.trim().length > 0;
  const placementReady =
    resolutionType !== "register-subject" ||
    choice.mode === "use-default" ||
    (choice.parentPlacementId.trim().length > 0 && choice.displayName.trim().length > 0);
  const restoreReady = resolutionType !== "restore-registration" || registrationId.trim().length > 0;
  const canContinue = allowed && reasonReady && placementReady && restoreReady;

  const buildBody = (): CatalogResolveReviewItemRequest => {
    if (resolutionType === "register-subject") {
      return {
        resolution: {
          type: "register-subject",
          subjectId: item.candidates[0]?.subjectId ?? "",
          placement: placementIntentFromChoice(choice)
        },
        reason: reason.trim()
      };
    }
    if (resolutionType === "restore-registration") {
      return {
        resolution: { type: "restore-registration", registrationId: registrationId.trim() },
        reason: reason.trim()
      };
    }
    if (resolutionType === "open-definition-proposal") {
      return { resolution: { type: "open-definition-proposal" }, reason: reason.trim() };
    }
    return { resolution: { type: "mark-out-of-scope" }, reason: reason.trim() };
  };

  const submit = async () => {
    if (!canContinue || pending) {
      return;
    }
    const body = buildBody();
    const prepared = gateRef.current.begin({
      actor,
      action: "resolve-review-item",
      state: domainState,
      catalogReleaseId,
      ifMatch: item.etag,
      draftFingerprint: fingerprintGovernanceDraft(body),
      createIdempotencyKey
    });
    if (prepared.status !== "ready") {
      return;
    }
    setPending(true);
    try {
      await repository.resolveReviewItem(organizationId, item.id, body, {
        catalogReleaseId: prepared.context.catalogReleaseId,
        idempotencyKey: prepared.context.idempotencyKey,
        ifMatch: "ifMatch" in prepared.context ? prepared.context.ifMatch : ""
      });
      gateRef.current.succeed();
      setConfirmOpen(false);
      onCompleted?.();
      onOpenChange(false);
    } catch (error) {
      gateRef.current.fail();
      setWriteFailure(catalogStateFromFailure(error));
      setConfirmOpen(false);
    } finally {
      setPending(false);
    }
  };

  const failureState = stale ? itemState : writeFailure;

  return (
    <>
      <ModalDialog
        open={open}
        onDismiss={pending ? undefined : () => onOpenChange(false)}
        className="confirm-dialog governance-confirm-dialog"
        backdropClassName="param-admin-modal-backdrop"
        describedBy
      >
        {({ titleId, descriptionId }) => (
          <>
            <h2 id={titleId}>{governanceCopy.resolveTitle}</h2>
            <div className="confirm-dialog__scroll">
              <div id={descriptionId} className="governance-confirm-dialog__body">
                {allowed ? (
                  <>
                    <fieldset>
                      <legend>{governanceCopy.resolveTitle}</legend>
                      {allowedResolutions.map((resolution) => (
                        <label key={resolution}>
                          <input
                            type="radio"
                            name="catalog-review-resolution"
                            checked={resolutionType === resolution}
                            onChange={() => setResolutionType(resolution)}
                          />
                          {reviewResolutionLabels[resolution]}
                        </label>
                      ))}
                    </fieldset>
                    {resolutionType === "register-subject" ? (
                      <fieldset>
                        <legend>{governanceCopy.placementMode}</legend>
                        <label>
                          <input
                            type="radio"
                            name="catalog-review-placement"
                            checked={placementMode === "use-default"}
                            onChange={() => setPlacementMode("use-default")}
                          />
                          {governanceCopy.useDefaultPlacement}
                        </label>
                        <label>
                          <input
                            type="radio"
                            name="catalog-review-placement"
                            checked={placementMode === "choose-parent"}
                            onChange={() => setPlacementMode("choose-parent")}
                          />
                          {governanceCopy.chooseParentPlacement}
                        </label>
                      </fieldset>
                    ) : null}
                    {resolutionType === "restore-registration" ? (
                      <label>
                        登记标识
                        <input
                          aria-label="登记标识"
                          value={registrationId}
                          onChange={(event) => setRegistrationId(event.target.value)}
                        />
                      </label>
                    ) : null}
                    <label>
                      {governanceCopy.reason}
                      <textarea
                        aria-label={governanceCopy.reason}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                      />
                    </label>
                  </>
                ) : (
                  <p>{stale ? governanceCopy.staleReview : governanceCopy.agentReadOnly}</p>
                )}
                {failureState ? (
                  <p
                    className="governance-confirm-dialog__error"
                    role="alert"
                    data-preserve-input={failureState.kind === "conflict" ? "true" : undefined}
                    data-silent-retry="false"
                  >
                    {stale ? governanceCopy.staleReview : governanceFailureMessage(failureState)}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="dialog-actions">
              <button
                className="button subtle"
                type="button"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                取消
              </button>
              {allowed ? (
                <button
                  className="button primary"
                  type="button"
                  disabled={pending || !canContinue}
                  onClick={() => setConfirmOpen(true)}
                >
                  {governanceCopy.continueConfirm}
                </button>
              ) : null}
              {failureState && onRefreshEvidence ? (
                <button
                  className="button ghost"
                  type="button"
                  disabled={pending}
                  onClick={() => void onRefreshEvidence()}
                >
                  {governanceCopy.refreshEvidence}
                </button>
              ) : null}
            </div>
          </>
        )}
      </ModalDialog>
      <ConfirmDialog
        open={open && confirmOpen && allowed}
        title={governanceCopy.confirmResolveTitle}
        description={<p>{reviewResolutionLabels[resolutionType]}</p>}
        confirmLabel={governanceCopy.confirmResolve}
        pending={pending}
        pendingLabel={governanceCopy.pending}
        acknowledgement={governanceCopy.resolveAck}
        onConfirm={() => void submit()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
