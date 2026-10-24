import { SelectControl } from "@/components/common/SelectControl";
import { useEffect, useRef, useState } from "react";

import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import { catalogStateFromFailure, type CatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import type { SettingsLeaveRequest } from "@/application/settingsFormNavigation";
import { presentError } from "@/infrastructure/http/presentError";

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

/**
 * A real organization module target.  The catalog placement intent still
 * describes the parent/display-name choice; the destination module is the
 * canonical owner selected by the caller and is sent as an optional wire
 * extension when the server supports it.
 */
export type RegistrationModuleOption = PlacementOption & {
  kind?: string;
  impactSummary?: string;
};

export type RegistrationSubjectImpact = {
  activeDefinitionCount: number;
  bindingCount: number | null;
  projectCount: number | null;
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
  moduleOptions?: RegistrationModuleOption[];
  newDestinationParents?: RegistrationModuleOption[];
  initialDestinationModuleId?: string;
  subjectImpact?: RegistrationSubjectImpact;
  currentModuleName?: string;
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
  moduleOptions = [],
  newDestinationParents = [],
  initialDestinationModuleId = "",
  subjectImpact,
  currentModuleName,
  createIdempotencyKey,
  onOpenChange,
  onCompleted,
  onRefreshEvidence
}: RegistrationDialogProps) {
  const allowed = canExecuteGovernanceAction(actor, intent, domainState);
  const gateRef = useRef<GovernanceSubmitGate>(createGovernanceSubmitGate());
  const wasOpen = useRef(false);
  const openedSubject = useRef("");
  const [placementMode, setPlacementMode] = useState<"use-default" | "choose-parent">("use-default");
  const [parentPlacementId, setParentPlacementId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [destinationModuleId, setDestinationModuleId] = useState(initialDestinationModuleId);
  const [newParentId, setNewParentId] = useState("");
  const [newModuleName, setNewModuleName] = useState("");
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [writeFailure, setWriteFailure] = useState<CatalogDomainState | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [evidenceRefreshed, setEvidenceRefreshed] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveDecision = useRef<{ promise: Promise<boolean>; resolve: (allowed: boolean) => void } | null>(null);

  useEffect(() => {
    const subjectKey = `${organizationId}:${subjectId}:${intent}`;
    const opened = open && (!wasOpen.current || openedSubject.current !== subjectKey);
    wasOpen.current = open;
    if (!opened) {
      return;
    }
    gateRef.current = createGovernanceSubmitGate();
    openedSubject.current = subjectKey;
    setPlacementMode("use-default");
    setParentPlacementId(placementOptions[0]?.id ?? "");
    setDisplayName(placementOptions[0]?.displayName ?? "");
    // A missing target is an explicit choice the caller must resolve.  Never
    // silently pick the first module: module identity is canonical data.
    setDestinationModuleId(initialDestinationModuleId);
    setNewParentId("");
    setNewModuleName("");
    setReason("");
    setConfirmOpen(false);
    setPending(false);
    setWriteFailure(undefined);
    setRefreshing(false);
    setRefreshError("");
    setEvidenceRefreshed(false);
    setLeaveOpen(false);
  }, [open, intent, subjectId, organizationId, placementOptions, initialDestinationModuleId, moduleOptions]);
  const dirty = Boolean(reason.trim() || newParentId || newModuleName) || destinationModuleId !== initialDestinationModuleId || placementMode !== "use-default";
  const busy = pending || refreshing;
  const inputDisabled = busy || !allowed;
  const requestClose = () => {
    if (busy) return;
    if (dirty) setLeaveOpen(true);
    else onOpenChange(false);
  };
  const finishLeave = (allowed: boolean) => {
    const navigation = leaveDecision.current;
    leaveDecision.current = null;
    navigation?.resolve(allowed);
    setLeaveOpen(false);
    if (allowed && !navigation) onOpenChange(false);
  };
  useEffect(() => {
    if (!open || (!dirty && !busy)) return;
    const guardLeave = (event: Event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (busy) return;
      if (!leaveDecision.current) {
        let resolve!: (allowed: boolean) => void;
        const promise = new Promise<boolean>((complete) => { resolve = complete; });
        leaveDecision.current = { promise, resolve };
      }
      (event as CustomEvent<SettingsLeaveRequest>).detail.decision = leaveDecision.current.promise;
      setLeaveOpen(true);
    };
    const guardUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("wiseeff:settings-before-leave", guardLeave);
    window.addEventListener("beforeunload", guardUnload);
    return () => {
      window.removeEventListener("wiseeff:settings-before-leave", guardLeave);
      window.removeEventListener("beforeunload", guardUnload);
      leaveDecision.current?.resolve(false);
      leaveDecision.current = null;
    };
  }, [open, dirty, busy]);
  const refreshEvidence = async () => {
    if (!onRefreshEvidence || busy) return;
    setConfirmOpen(false);
    setRefreshing(true);
    setRefreshError("");
    try {
      await onRefreshEvidence();
      gateRef.current.reset();
      setWriteFailure(undefined);
      setEvidenceRefreshed(true);
    } catch (error) {
      setRefreshError(presentError(error, "证据刷新失败，请重试。"));
    } finally { setRefreshing(false); }
  };

  const choice: PlacementChoice =
    placementMode === "use-default"
      ? { mode: "use-default" }
      : { mode: "choose-parent", parentPlacementId, displayName };
  const placementReady =
    choice.mode === "use-default" ||
    (choice.parentPlacementId.trim().length > 0 && choice.displayName.trim().length > 0);
  const initializing = intent === "register-subject" && moduleOptions.length === 0 && newDestinationParents.length > 0;
  const destinationReady = initializing
    ? newDestinationParents.some((option) => option.id === newParentId) && Boolean(newModuleName.trim())
    : moduleOptions.length === 0 || moduleOptions.some((option) => option.id === destinationModuleId);
  const selectedDestinationName =
    (initializing ? `${newDestinationParents.find((option) => option.id === newParentId)?.displayName ?? "未选择业务分类"} / ${newModuleName.trim() || "未填写模块名称"}` : moduleOptions.find((option) => option.id === destinationModuleId)?.displayName) ??
    (destinationModuleId || "未选择目标模块");
  const title = intent === "register-subject" ? governanceCopy.registerTitle : governanceCopy.placementTitle;
  const confirmTitle =
    intent === "register-subject" ? governanceCopy.confirmRegisterTitle : governanceCopy.confirmPlacementTitle;
  const confirmLabel =
    intent === "register-subject" ? governanceCopy.confirmRegister : governanceCopy.confirmPlacement;

  const submit = async () => {
    if (!allowed || !placementReady || !destinationReady || busy || writeFailure?.kind === "conflict") {
      return;
    }
    let ownsSubmission = false;
    try {
      const prepared = gateRef.current.begin({
        actor,
        action: intent,
        state: domainState,
        catalogReleaseId,
        ifMatch,
        draftFingerprint: fingerprintGovernanceDraft({ intent, choice, reason, destinationModuleId, newParentId, newModuleName }),
        createIdempotencyKey
      });
      if (prepared.status !== "ready") {
        return;
      }
      ownsSubmission = true;
      setPending(true);
      const placement = placementIntentFromChoice(choice);
      const destination = initializing ? { newDestination: { parentModuleId: newParentId, name: newModuleName.trim() } } : destinationModuleId.trim()
        ? { destinationModuleId: destinationModuleId.trim() }
        : {};
      if (intent === "register-subject") {
        await repository.createRegistration(
          organizationId,
          // Pass the exact selected canonical module identity to the owner.
          withOptionalReason({ subjectId, placement, ...destination }, reason),
          prepared.context
        );
      } else if (registrationId) {
        await repository.updatePlacement(
          organizationId,
          registrationId,
          { placement, ...destination },
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
      if (ownsSubmission) setPending(false);
    }
  };

  return (
    <>
      <ModalDialog
        open={open}
        onDismiss={busy ? undefined : requestClose}
        className="confirm-dialog governance-confirm-dialog"
        backdropClassName="param-admin-modal-backdrop"
        describedBy
      >
        {({ titleId, descriptionId }) => (
          <>
            <h2 id={titleId}>{title}</h2>
            <div className="confirm-dialog__scroll">
              <div id={descriptionId} className="governance-confirm-dialog__body">
                {actor === "org-admin" || actor === "platform-admin" ? (
                  <fieldset className="registration-dialog-fields" disabled={inputDisabled}>
                    {moduleOptions.length === 0 && !initializing ? (
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
                        {placementOptions.length > 0 ? (
                          <label>
                            <input
                              type="radio"
                              name="catalog-placement-mode"
                              checked={placementMode === "choose-parent"}
                              onChange={() => setPlacementMode("choose-parent")}
                            />
                            {governanceCopy.chooseParentPlacement}
                          </label>
                        ) : null}
                      </fieldset>
                    ) : null}
                    {placementMode === "choose-parent" ? (
                      <>
                        <label>
                          {governanceCopy.parentPlacement}
                          <SelectControl
                            ariaLabel={governanceCopy.parentPlacement}
                            disabled={inputDisabled}
                            value={parentPlacementId}
                            onValueChange={(value) => {
                              const nextId = value;
                              setParentPlacementId(nextId);
                              const option = placementOptions.find((item) => item.id === nextId);
                              if (option) {
                                setDisplayName(option.displayName);
                              }
                            }}
                            options={placementOptions.map((option) => ({ value: option.id, label: option.displayName }))}
                          />
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
                    {moduleOptions.length > 0 ? (
                      <label>
                        目标模块
                        <SelectControl
                          ariaLabel="目标模块"
                          disabled={inputDisabled}
                          value={destinationModuleId}
                          onValueChange={(value) => setDestinationModuleId(value)}
                          options={[{ value: "", label: "请选择目标模块" }, ...moduleOptions.map((option) => ({
                            value: option.id,
                            label: option.impactSummary ? `${option.displayName} · ${option.impactSummary}` : option.displayName
                          }))]}
                        />
                      </label>
                    ) : null}
                    {initializing ? <>
                      <p>当前没有同类型目标模块。选择业务分类并命名，确认后将创建模块并完成登记。</p>
                      <label>业务分类<SelectControl ariaLabel="新模块业务分类" value={newParentId} disabled={inputDisabled}
                        onValueChange={setNewParentId} options={[{ value: "", label: "请选择业务分类" }, ...newDestinationParents.map((option) => ({ value: option.id, label: option.displayName }))]} /></label>
                      <label>模块名称<input aria-label="新模块名称" value={newModuleName} maxLength={120} onChange={(event) => setNewModuleName(event.target.value)} /></label>
                    </> : null}
                    {subjectImpact ? (
                      <p className="governance-confirm-dialog__impact" role="status">
                        本主体 {subjectImpact.activeDefinitionCount} 个有效定义、
                        {subjectImpact.bindingCount === null ? "参数绑定数量暂不可用" : `${subjectImpact.bindingCount} 个参数绑定`}、
                        {subjectImpact.projectCount === null ? "项目数量暂不可用" : `${subjectImpact.projectCount} 个项目`}，
                        {intent === "update-placement"
                          ? `从 ${currentModuleName ?? "当前归属"} → ${selectedDestinationName}`
                          : `登记至 ${selectedDestinationName}`}。仅调整归属，不改参数值。
                      </p>
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
                  </fieldset>
                ) : (
                  <p>{governanceCopy.agentReadOnly}</p>
                )}
                {(actor === "org-admin" || actor === "platform-admin") && !allowed && !refreshing ? <p role="status">当前目录状态暂不允许修改，请刷新证据后重试。</p> : null}
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
                {refreshError ? <p role="alert" className="governance-confirm-dialog__error">{refreshError}</p> : null}
                {refreshing ? <p role="status">正在刷新当前归属与影响数据…</p> : evidenceRefreshed ? <p role="status">证据已刷新，请重新核对归属与影响并确认。</p> : null}
              </div>
            </div>
            <div className="dialog-actions">
              <button
                className="button subtle"
                type="button"
                disabled={busy}
                onClick={requestClose}
              >
                取消
              </button>
              {allowed ? (
                <button
                  className="button primary"
                  type="button"
                  disabled={busy || !placementReady || !destinationReady || writeFailure?.kind === "conflict"}
                  onClick={() => setConfirmOpen(true)}
                >
                  {governanceCopy.continueConfirm}
                </button>
              ) : null}
              {writeFailure && onRefreshEvidence ? (
                <button
                  className="button ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => void refreshEvidence()}
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
            {initializing ? `新建目标模块并登记：${selectedDestinationName}` : destinationModuleId.trim()
              ? `目标模块：${selectedDestinationName}`
              : choice.mode === "use-default"
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
      <ConfirmDialog open={leaveOpen} title="放弃未保存的归属修改？" description="关闭将丢失当前目标模块和原因。"
        confirmLabel="放弃修改" cancelLabel="继续编辑" onConfirm={() => finishLeave(true)} onCancel={() => finishLeave(false)} />
    </>
  );
}
