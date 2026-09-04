import { useEffect, useRef, useState } from "react";

import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import { catalogStateFromFailure, type CatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";

import {
  canExecuteGovernanceAction,
  createGovernanceSubmitGate,
  fingerprintGovernanceDraft,
  governanceCopy,
  governanceFailureMessage,
  placementIntentFromChoice,
  withOptionalReason,
  type GovernanceSubmitGate,
  type PlacementChoice
} from "./governanceState";

export type PlacementOption = {
  id: string;
  displayName: string;
};

export type RegistrationDialogProps = {
  open: boolean;
  intent: "register-subject" | "update-placement";
  actor: CatalogActorKind;
  domainState: CatalogDomainState;
  repository: ParameterCatalogGovernanceRepository;
  organizationId: string;
  subjectId: string;
  catalogReleaseId: string;
  registrationId?: string;
  ifMatch?: string;
  placementOptions?: PlacementOption[];
  createIdempotencyKey?: () => string;
  onOpenChange: (open: boolean) => void;
  onCompleted?: () => void;
  onRefreshEvidence?: () => void | Promise<void>;
};

export function RegistrationDialog({
  open,
  intent,
  actor,
  domainState,
  repository,
  organizationId,
  subjectId,
  catalogReleaseId,
  registrationId,
  ifMatch,
  placementOptions = [],
  createIdempotencyKey,
  onOpenChange,
  onCompleted,
  onRefreshEvidence
}: RegistrationDialogProps) {
  const allowed = canExecuteGovernanceAction(actor, intent, domainState);
  const gateRef = useRef<GovernanceSubmitGate>(createGovernanceSubmitGate());
  const wasOpen = useRef(false);
  const [placementMode, setPlacementMode] = useState<"use-default" | "choose-parent">("use-default");
  const [parentPlacementId, setParentPlacementId] = useState("");
  const [displayName, setDisplayName] = useState("");
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
    setPlacementMode("use-default");
    setParentPlacementId(placementOptions[0]?.id ?? "");
    setDisplayName(placementOptions[0]?.displayName ?? "");
    setReason("");
    setConfirmOpen(false);
    setPending(false);
    setWriteFailure(undefined);
  }, [open, intent, subjectId, placementOptions]);

  const choice: PlacementChoice =
    placementMode === "use-default"
      ? { mode: "use-default" }
      : { mode: "choose-parent", parentPlacementId, displayName };
  const placementReady =
    choice.mode === "use-default" ||
    (choice.parentPlacementId.trim().length > 0 && choice.displayName.trim().length > 0);
  const title = intent === "register-subject" ? governanceCopy.registerTitle : governanceCopy.placementTitle;
  const confirmTitle =
    intent === "register-subject" ? governanceCopy.confirmRegisterTitle : governanceCopy.confirmPlacementTitle;
  const confirmLabel =
    intent === "register-subject" ? governanceCopy.confirmRegister : governanceCopy.confirmPlacement;

  const submit = async () => {
    if (!allowed || !placementReady || pending) {
      return;
    }
    const prepared = gateRef.current.begin({
      actor,
      action: intent,
      state: domainState,
      catalogReleaseId,
      ifMatch,
      draftFingerprint: fingerprintGovernanceDraft({ intent, choice, reason }),
      createIdempotencyKey
    });
    if (prepared.status !== "ready") {
      return;
    }
    setPending(true);
    try {
      const placement = placementIntentFromChoice(choice);
      if (intent === "register-subject") {
        await repository.createRegistration(
          organizationId,
          withOptionalReason({ subjectId, placement }, reason),
          prepared.context
        );
      } else if (registrationId) {
        await repository.updatePlacement(
          organizationId,
          registrationId,
          { placement },
          {
            catalogReleaseId: prepared.context.catalogReleaseId,
            idempotencyKey: prepared.context.idempotencyKey,
            ifMatch: "ifMatch" in prepared.context ? prepared.context.ifMatch : ""
          }
        );
      } else {
        gateRef.current.fail();
        setPending(false);
        return;
      }
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
            <h2 id={titleId}>{title}</h2>
            <div className="confirm-dialog__scroll">
              <div id={descriptionId} className="governance-confirm-dialog__body">
                {allowed ? (
                  <>
                    <fieldset>
                      <legend>{governanceCopy.placementMode}</legend>
                      <label>
                        <input
                          type="radio"
                          name="catalog-placement-mode"
                          checked={placementMode === "use-default"}
                          onChange={() => setPlacementMode("use-default")}
                        />
                        {governanceCopy.useDefaultPlacement}
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="catalog-placement-mode"
                          checked={placementMode === "choose-parent"}
                          onChange={() => setPlacementMode("choose-parent")}
                        />
                        {governanceCopy.chooseParentPlacement}
                      </label>
                    </fieldset>
                    {placementMode === "choose-parent" ? (
                      <>
                        <label>
                          {governanceCopy.parentPlacement}
                          <select
                            aria-label={governanceCopy.parentPlacement}
                            value={parentPlacementId}
                            onChange={(event) => {
                              const nextId = event.target.value;
                              setParentPlacementId(nextId);
                              const option = placementOptions.find((item) => item.id === nextId);
                              if (option) {
                                setDisplayName(option.displayName);
                              }
                            }}
                          >
                            {placementOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.displayName}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          {governanceCopy.placementDisplayName}
                          <input
                            aria-label={governanceCopy.placementDisplayName}
                            value={displayName}
                            onChange={(event) => setDisplayName(event.target.value)}
                          />
                        </label>
                      </>
                    ) : null}
                    {intent === "register-subject" ? (
                      <label>
                        {governanceCopy.reason}
                        <textarea
                          aria-label={governanceCopy.reason}
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                        />
                      </label>
                    ) : null}
                  </>
                ) : (
                  <p>{governanceCopy.agentReadOnly}</p>
                )}
                {writeFailure ? (
                  <p
                    className="governance-confirm-dialog__error"
                    role="alert"
                    data-preserve-input={writeFailure.kind === "conflict" ? "true" : undefined}
                    data-silent-retry="false"
                  >
                    {governanceFailureMessage(writeFailure)}
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
                  disabled={pending || !placementReady}
                  onClick={() => setConfirmOpen(true)}
                >
                  {governanceCopy.continueConfirm}
                </button>
              ) : null}
              {writeFailure && onRefreshEvidence ? (
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
        title={confirmTitle}
        description={
          <p>
            {choice.mode === "use-default"
              ? governanceCopy.useDefaultPlacement
              : `${governanceCopy.chooseParentPlacement}：${choice.displayName}`}
          </p>
        }
        confirmLabel={confirmLabel}
        pending={pending}
        pendingLabel={governanceCopy.pending}
        acknowledgement={governanceCopy.registerAck}
        error={writeFailure ? governanceFailureMessage(writeFailure) : ""}
        onConfirm={() => void submit()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
