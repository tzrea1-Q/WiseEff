import { SelectControl } from "@/components/common/SelectControl";
import { useEffect, useId, useRef, useState } from "react";

import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import type { CatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import { listAllCanonicalPages } from "@/components/parameter-admin-next/CanonicalSubjectPlacementPanel";
import type {
  CatalogPublicationCandidateResponse,
  CatalogPublicationJobResponse,
  CatalogSubjectResponse
} from "@/infrastructure/http/parameterCatalogDtos";
import { catalogSubjectTypeLabel } from "@/features/parameter-catalog/catalogPresentation";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { catalogFailureReason } from "@/infrastructure/http/parameterCatalogClient";
import "@/features/parameter-catalog/parameter-catalog.css";

import { createGovernanceIdempotencyKey } from "./governanceState";
import {
  clearStoredPublicationJob,
  readStoredPublicationJob,
  writeStoredPublicationJob
} from "./publicationJobStorage";
import { publicationSurfaceAdvisory, type PublicationSurfaceItem } from "./publicationSurface";
import {
  buildPublicationChangeSet,
  definitionContentOf,
  canExecutePublicationAction,
  canSavePublicationDraft,
  createPublicationSubmitGate,
  emptyPublicationDraft,
  fingerprintPublicationDraft,
  publicationApprovalCopy,
  publicationCopy,
  publicationDialogTitle,
  publicationDriverCardinalities,
  publicationDriverNatures,
  publicationFailureCopy,
  publicationFieldError,
  publicationJobIsPending,
  publicationMustRePreview,
  publicationPreviewIsStale,
  publicationStatusCopy,
  publicationSuccessKind,
  publicationSupportedUnits,
  publicationValueTypeLabel,
  publicationSupportedValueTypes,
  type PublicationDraft,
  type PublicationSubjectKind,
  type PublicationSubmitGate,
  type PublicationValueType
} from "./publicationState";

type SubjectItem = CatalogSubjectResponse["item"];
type ConfirmKind = "preview" | "publish";
type FollowupStatus = "idle" | "failed" | "succeeded";

export type PublicationDialogProps = {
  open: boolean;
  actor: CatalogActorKind;
  sessionPermissions?: readonly string[] | null;
  domainState: CatalogDomainState;
  catalog: ParameterCatalogRepository;
  governance: ParameterCatalogGovernanceRepository;
  catalogReleaseId: string;
  currentPersonId: string;
  organizationId: string;
  publicationSurface?: PublicationSurfaceItem | null;
  createIdempotencyKey?: () => string;
  onOpenChange: (open: boolean) => void;
  onCompleted?: () => void;
  onRefreshEvidence?: () => void | Promise<void>;
};

export function PublicationDialog({
  open,
  actor,
  sessionPermissions,
  domainState,
  catalog,
  governance,
  catalogReleaseId,
  currentPersonId,
  organizationId,
  publicationSurface,
  createIdempotencyKey,
  onOpenChange,
  onCompleted,
  onRefreshEvidence
}: PublicationDialogProps) {
  const surfaceAllowsAuthoring = publicationSurface?.authoringAllowed === true;
  const surfaceAllowsPublishing = publicationSurface?.publishingAllowed === true;
  // A healthy surface carries no advisory: it stays silent instead of restating
  // that publishing is enabled.
  const publicationAdvisory = publicationSurface
    ? publicationSurfaceAdvisory(publicationSurface)
    : null;
  const canPreview =
    surfaceAllowsAuthoring &&
    canExecutePublicationAction(actor, "preview-publication", domainState, sessionPermissions);
  const canSaveDraft =
    surfaceAllowsAuthoring && canSavePublicationDraft(actor, domainState, sessionPermissions);
  const canPublish =
    surfaceAllowsPublishing &&
    canExecutePublicationAction(actor, "publish-publication", domainState, sessionPermissions);
  const gateRef = useRef<PublicationSubmitGate>(createPublicationSubmitGate());
  const pollRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const formId = useId();
  const [draft, setDraft] = useState<PublicationDraft>(emptyPublicationDraft);
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [subjectReadEpoch, setSubjectReadEpoch] = useState(0);
  const [followup, setFollowup] = useState<FollowupStatus>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<CatalogPublicationCandidateResponse["item"] | null>(null);
  const [candidateVerified, setCandidateVerified] = useState(false);
  const [previewFingerprint, setPreviewFingerprint] = useState<string | null>(null);
  const [job, setJob] = useState<CatalogPublicationJobResponse["item"] | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ input: keyof PublicationDraft; message: string } | null>(
    null
  );
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);

  const previewStale = publicationPreviewIsStale(previewFingerprint, draft) ||
    Boolean(candidate && (!candidateVerified || candidate.expectedBaseReleaseId !== catalogReleaseId));
  const selectedSubject = subjects.find((item) => item.id === draft.subjectId) ?? null;
  const publishedSubjects = subjects.filter((item) => item.membership.status === "active" && item.registration.status !== "retired");
  const publishedSubjectIds = new Set(publishedSubjects.map((item) => item.id));
  const targetAllowed = !loading && !loadError && (draft.mode === "create-subject" ||
    (draft.mode === "create-definition" && publishedSubjectIds.has(draft.subjectId)));
  const targetUnavailable = !loading && !loadError && draft.mode === "create-definition" &&
    Boolean(draft.subjectId) && !targetAllowed;
  useEffect(() => {
    if (!targetAllowed) setConfirm(null);
  }, [targetAllowed]);
  const mustRePreview = publicationMustRePreview({
    previewStale,
    jobStatus: job?.status,
    failureReason: job?.failure?.reason
  });
  const succeeded = job ? publicationSuccessKind(job) : null;
  const draftDirty =
    draft.mode !== "revise-definition" && !succeeded &&
    fingerprintPublicationDraft(draft) !== fingerprintPublicationDraft(emptyPublicationDraft());

  useEffect(() => {
    if (!open || !draftDirty) {
      return undefined;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [open, draftDirty]);

  const requestClose = () => {
    if (draftDirty && !leaveConfirm) {
      setLeaveConfirm(true);
      return;
    }
    setLeaveConfirm(false);
    onOpenChange(false);
  };

  const patchDraft = (patch: Partial<PublicationDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setFailure(null);
    setFieldError(null);
  };

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const applyJob = (next: CatalogPublicationJobResponse["item"]) => {
    setJob(next);
    if (!publicationJobIsPending(next.status) || publicationSuccessKind(next)) {
      stopPolling();
      if (publicationSuccessKind(next) && !completedRef.current) {
        completedRef.current = true;
        clearStoredPublicationJob();
        onCompleted?.();
      }
    }
  };

  const pollJob = async (jobId: string) => {
    try {
      const response = await catalog.getPublication(jobId);
      applyJob(response.item);
    } catch (error) {
      setFailure(publicationFailureCopy(error));
    }
  };

  const startPolling = (jobId: string) => {
    stopPolling();
    void pollJob(jobId);
    pollRef.current = window.setInterval(() => {
      void pollJob(jobId);
    }, 1000);
  };

  useEffect(() => {
    if (!open) {
      stopPolling();
      return undefined;
    }
    gateRef.current = createPublicationSubmitGate();
    completedRef.current = false;
    setFailure(null);
    setFieldError(null);
    setConfirm(null);
    setPending(false);
    setCandidateVerified(false);
    setProposalId(null);
    setDraftSaved(false);
    setFollowup("idle");
    const stored = readStoredPublicationJob({ userId: currentPersonId, organizationId });
    if (stored) {
      const restoredDraft = { ...emptyPublicationDraft(), ...stored.draft };
      setDraft(restoredDraft);
      setCandidate({
        id: stored.candidateId, expectedBaseReleaseId: stored.catalogReleaseId,
        expectedBaseReleaseDigest: "", riskClass: "low",
        impactSummary: { addedDefinitionCount: 1, changedDefinitionCount: 0, addedSubjectCount: 0 },
        capabilityContract: { revision: "", allowListId: "" }
      });
      setJob({
        id: stored.jobId, candidateId: stored.candidateId, status: "queued", attemptCount: 0,
        effective: false, isCurrent: false, currentness: null, failure: null
      });
      setPreviewFingerprint(fingerprintPublicationDraft(restoredDraft));
      setIdempotencyKey(stored.idempotencyKey);
      startPolling(stored.jobId);
    } else {
      setDraft(emptyPublicationDraft());
      setCandidate(null);
      setPreviewFingerprint(null);
      setJob(null);
      setIdempotencyKey(null);
    }
    return stopPolling;
  }, [open, catalog, currentPersonId, organizationId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSubjects([]);
    void (async () => {
      try {
        const listed = await listAllCanonicalPages((query) => catalog.listSubjects(query), { catalogReleaseId });
        if (!cancelled) setSubjects(listed);
      } catch {
        if (!cancelled) {
          setLoadError("主体列表加载失败，请稍后重试。");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, catalog, catalogReleaseId, subjectReadEpoch]);

  useEffect(() => {
    setProposalId(null);
    setDraftSaved(false);
  }, [catalogReleaseId]);

  const retryPublicationState = async () => {
    setPending(true);
    try {
      await onRefreshEvidence?.();
      setFailure(null);
      setSubjectReadEpoch((value) => value + 1);
    } catch (error) {
      setFailure(publicationFailureCopy(error));
    } finally {
      setPending(false);
    }
  };

  const captureError = (error: unknown) => {
    const reason = error instanceof WiseEffApiError ? catalogFailureReason(error) : null;
    setFieldError(publicationFieldError(error));
    if (reason === "needs-rebase") {
      setFailure(null);
      setJob((current) => ({
        id: current?.id ?? "",
        candidateId: current?.candidateId || candidate?.id || "",
        status: "needs-rebase",
        attemptCount: current?.attemptCount ?? 0,
        effective: false,
        isCurrent: false,
        currentness: null,
        failure: { class: "candidate", reason: "needs-rebase" }
      }));
      return;
    }
    setFailure(reason === "release-drift"
      ? "目录已更新，请更新发布状态后重新预览。已填写内容会保留。"
      : publicationFailureCopy(error));
  };

  const saveDraft = async () => {
    if (!canSaveDraft || !targetAllowed || pending || !draft.propertyKey.trim() || !draft.reason.trim()) {
      return;
    }
    if (draft.mode === "create-definition" && !draft.subjectId) {
      return;
    }
    if (draft.mode === "revise-definition" && !draft.definitionId) {
      return;
    }
    if (draft.mode === "create-subject" && !draft.selectorValue.trim()) {
      return;
    }
    if (!gateRef.current.begin()) {
      return;
    }
    setPending(true);
    try {
      const created = await governance.createProposal(
        {
          base: { catalogReleaseId },
          requestedChange: {
            kind:
              draft.mode === "create-subject"
                ? "create-subject-with-definitions"
                : draft.mode === "revise-definition"
                  ? "revise-definition"
                  : "create-definition",
            ...(draft.mode === "create-definition" ? { subjectId: draft.subjectId } : {}),
            ...(draft.mode === "revise-definition" ? { definitionId: draft.definitionId } : {}),
            propertyKey: draft.propertyKey.trim(),
            content: definitionContentOf(draft)
          },
          reason: draft.reason.trim()
        },
        {
          catalogReleaseId,
          idempotencyKey: (createIdempotencyKey ?? createGovernanceIdempotencyKey)()
        }
      );
      setProposalId(created.item.id);
      setDraftSaved(true);
      setFailure(null);
    } catch (error) {
      captureError(error);
    } finally {
      gateRef.current.finish();
      setPending(false);
    }
  };

  const runPreview = async () => {
    if (!canPreview || !targetAllowed || pending || !draft.propertyKey.trim() || !draft.displayName.trim()) {
      return;
    }
    if (draft.mode === "create-definition" && !draft.subjectId) {
      return;
    }
    if (draft.mode === "revise-definition" && !draft.definitionId) {
      return;
    }
    if (draft.mode === "create-subject" && !draft.selectorValue.trim()) {
      return;
    }
    if (!gateRef.current.begin()) {
      return;
    }
    setPending(true);
    try {
      const created = await catalog.createPublicationCandidate(
        {
          changeSet: buildPublicationChangeSet(draft),
          ...(proposalId ? { proposalId } : {})
        },
        { catalogReleaseId }
      );
      setCandidate(created.item);
      completedRef.current = false;
      setCandidateVerified(true);
      setPreviewFingerprint(fingerprintPublicationDraft(draft));
      setJob(null);
      setIdempotencyKey(null);
      setFailure(null);
      setFieldError(null);
    } catch (error) {
      captureError(error);
    } finally {
      gateRef.current.finish();
      setPending(false);
      setConfirm(null);
    }
  };

  const runPublish = async () => {
    if (
      !canPublish ||
      !targetAllowed ||
      pending ||
      !candidate ||
      publicationMustRePreview({
        previewStale,
        jobStatus: job?.status,
        failureReason: job?.failure?.reason
      })
    ) {
      return;
    }
    if (!gateRef.current.begin()) {
      return;
    }
    setPending(true);
    const key = idempotencyKey ?? (createIdempotencyKey ?? createGovernanceIdempotencyKey)();
    setIdempotencyKey(key);
    try {
      const published = await catalog.publishPublicationCandidate(
        candidate.id,
        { idempotencyKey: key },
        { catalogReleaseId }
      );
      writeStoredPublicationJob({
        jobId: published.item.id,
        candidateId: candidate.id,
        catalogReleaseId,
        userId: currentPersonId,
        organizationId,
        draft,
        idempotencyKey: key
      });
      applyJob(published.item);
      if (publicationJobIsPending(published.item.status)) {
        startPolling(published.item.id);
      }
      setFailure(null);
    } catch (error) {
      captureError(error);
    } finally {
      gateRef.current.finish();
      setPending(false);
      setConfirm(null);
    }
  };

  const runRegistrationFollowup = async () => {
    const subjectId = candidate?.impactSummary.addedSubjectIds?.[0];
    if (!subjectId || pending || !job || !publicationSuccessKind(job)) {
      return;
    }
    if (!gateRef.current.begin()) {
      return;
    }
    setPending(true);
    try {
      await governance.createRegistration(
        organizationId,
        {
          subjectId,
          placement: { mode: "use-default" },
          reason: draft.reason.trim() || "目录发布后登记"
        },
        {
          catalogReleaseId,
          idempotencyKey: (createIdempotencyKey ?? createGovernanceIdempotencyKey)()
        }
      );
      setFollowup("succeeded");
      setFailure(null);
    } catch {
      setFollowup("failed");
    } finally {
      gateRef.current.finish();
      setPending(false);
    }
  };

  const status = job ? publicationStatusCopy(job) : null;
  const catalogSucceeded = job ? publicationSuccessKind(job) : null;
  const addedSubjectId = candidate?.impactSummary.addedSubjectIds?.[0] ?? null;
  const describedById = `${formId}-help`;
  const fieldMessageId = `${formId}-field`;

  return (
    <>
      <ModalDialog
        open={open}
        onDismiss={pending ? undefined : requestClose}
        className="confirm-dialog governance-confirm-dialog parameter-catalog-publication-dialog"
        backdropClassName="param-admin-modal-backdrop"
        describedBy
      >
        {({ titleId, descriptionId }) => (
          <>
            <h2 id={titleId}>{draft.mode === "revise-definition" ? "历史发布任务" : publicationDialogTitle(draft.mode)}</h2>
            <div className="confirm-dialog__scroll">
              <div id={descriptionId} className="governance-confirm-dialog__body">
                <p id={describedById}>{publicationCopy.noInternalIds}</p>
                <p>{publicationCopy.requiredApproval}</p>
                {publicationAdvisory ? (
                  <p role="status" data-tone={publicationAdvisory.tone}>
                    {publicationAdvisory.message}
                  </p>
                ) : null}
                {status ? (
                  <p
                    role="status"
                    data-publication-status={job?.status}
                    data-tone={status.tone}
                    className={
                      status.tone === "danger"
                        ? "governance-confirm-dialog__error"
                        : "parameter-catalog-publication-dialog__status"
                    }
                  >
                    {status.message}
                  </p>
                ) : null}
                {failure ? (
                  <p
                    className="governance-confirm-dialog__error"
                    role="alert"
                    data-preserve-input="true"
                    data-silent-retry="false"
                  >
                    {failure}
                  </p>
                ) : null}
                {loadError ? (
                  <p className="governance-confirm-dialog__error" role="alert">
                    {loadError}
                    <button type="button" className="button ghost sm" disabled={loading || pending}
                      onClick={() => setSubjectReadEpoch((value) => value + 1)}>重试</button>
                  </p>
                ) : null}
                {targetUnavailable ? <p role="alert" className="governance-confirm-dialog__error">
                  所选主体当前不可编写，可能已退役、登记已退役或无法核实有效状态。请重新选择有效主体，或切换为新增主体。
                </p> : null}
                {!loading && draft.mode === "create-definition" && publishedSubjects.length === 0 ? (
                  <p>{publicationCopy.unpublishedEmpty}</p>
                ) : null}
                {draft.mode === "revise-definition" ? <p role="status">
                  此处仅跟踪已有发布任务。修改已有定义，请关闭此窗口后使用目录列表中的“编辑”。
                </p> : null}
                {canPreview && draft.mode !== "revise-definition" ? (
                  <div className="parameter-catalog-publication-dialog__form">
                    <fieldset className="parameter-catalog-publication-dialog__modes">
                      <legend>{publicationCopy.mode}</legend>
                      <label>
                        <input
                          type="radio"
                          name={`${formId}-mode`}
                          value="create-definition"
                          checked={draft.mode === "create-definition"}
                          onChange={() => patchDraft({ mode: "create-definition" })}
                        />
                        {publicationCopy.modeCreateDefinition}
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`${formId}-mode`}
                          value="create-subject"
                          checked={draft.mode === "create-subject"}
                          onChange={() => patchDraft({ mode: "create-subject", subjectId: "", unit: "mA" })}
                        />
                        {publicationCopy.modeCreateSubject}
                      </label>
                    </fieldset>
                    {draft.mode === "create-subject" ? (
                      <>
                        <label>
                          {publicationCopy.subjectKindPick}
                          <SelectControl
                            ariaLabel={publicationCopy.subjectKindPick}
                            value={draft.subjectKind}
                            onValueChange={(value) =>
                              patchDraft({ subjectKind: value as PublicationSubjectKind })
                            }
                            options={[{ value: "driver", label: publicationCopy.driver }, { value: "node-type", label: publicationCopy.nodeType }]}
                          />
                        </label>
                        <label>
                          {publicationCopy.selectorValue}
                          <input
                            aria-label={publicationCopy.selectorValue}
                            value={draft.selectorValue}
                            onChange={(event) => patchDraft({ selectorValue: event.target.value })}
                          />
                        </label>
                        {draft.subjectKind === "driver" ? (
                          <>
                            <label>
                              {publicationCopy.nature}
                              <SelectControl
                                ariaLabel={publicationCopy.nature}
                                value={draft.nature}
                                onValueChange={(value) =>
                                  patchDraft({ nature: value as PublicationDraft["nature"] })
                                }
                                options={publicationDriverNatures.map((nature) => ({
                                  value: nature,
                                  label: nature === "physical-device" ? publicationCopy.naturePhysical : publicationCopy.natureLogical
                                }))}
                              />
                            </label>
                            <label>
                              {publicationCopy.cardinality}
                              <SelectControl
                                ariaLabel={publicationCopy.cardinality}
                                value={draft.cardinality}
                                onValueChange={(value) =>
                                  patchDraft({
                                    cardinality: value as PublicationDraft["cardinality"]
                                  })
                                }
                                options={publicationDriverCardinalities.map((cardinality) => ({
                                  value: cardinality,
                                  label: cardinality === "multiple" ? publicationCopy.cardinalityMultiple : publicationCopy.cardinalitySingleton
                                }))}
                              />
                            </label>
                          </>
                        ) : null}
                        <p>{publicationCopy.neverLowCreate}</p>
                      </>
                    ) : (
                    <label>
                      {publicationCopy.subject}
                      <SelectControl
                        ariaLabel={publicationCopy.subject}
                        value={draft.subjectId}
                        ariaInvalid={fieldError?.input === "subjectId"}
                        ariaDescribedBy={fieldError?.input === "subjectId" ? fieldMessageId : describedById}
                        onValueChange={(value) => patchDraft({ subjectId: value })}
                        options={[{ value: "", label: "选择主体" },
                          ...(draft.subjectId && !publishedSubjectIds.has(draft.subjectId) ? [{ value: draft.subjectId, label: `${selectedSubject?.canonicalName || "原主体"}（当前不可编写）`, disabled: true }] : []),
                          ...publishedSubjects.map((item) => ({ value: item.id, label: item.canonicalName }))]}
                      />
                    </label>
                    )}
                    {selectedSubject && draft.mode === "create-definition" ? (
                      <dl className="parameter-catalog-publication-dialog__meta">
                        <div>
                          <dt>{publicationCopy.subjectKind}</dt>
                          <dd>{catalogSubjectTypeLabel(selectedSubject.type)}</dd>
                        </div>
                        <div>
                          <dt>{publicationCopy.subjectSelector}</dt>
                          <dd>{selectedSubject.canonicalName}</dd>
                        </div>
                        <div>
                          <dt>{publicationCopy.scope}</dt>
                          <dd>{publicationCopy.sharedScope}</dd>
                        </div>
                      </dl>
                    ) : null}
                    <label>
                      {publicationCopy.propertyKey}
                      <input
                        aria-label={publicationCopy.propertyKey}
                        value={draft.propertyKey}
                        aria-invalid={fieldError?.input === "propertyKey"}
                        aria-describedby={fieldError?.input === "propertyKey" ? fieldMessageId : describedById}
                        onChange={(event) => patchDraft({ propertyKey: event.target.value })}
                      />
                    </label>
                    <label>
                      {publicationCopy.displayName}
                      <input
                        aria-label={publicationCopy.displayName}
                        value={draft.displayName}
                        aria-invalid={fieldError?.input === "displayName"}
                        onChange={(event) => patchDraft({ displayName: event.target.value })}
                      />
                    </label>
                    <label>
                      {publicationCopy.documentation}
                      <textarea
                        aria-label={publicationCopy.documentation}
                        value={draft.documentation}
                        aria-invalid={fieldError?.input === "documentation"}
                        onChange={(event) => patchDraft({ documentation: event.target.value })}
                      />
                    </label>
                    <label>
                      {publicationCopy.valueType}
                      <SelectControl
                        ariaLabel={publicationCopy.valueType}
                        value={draft.valueType}
                        onValueChange={(value) =>
                          patchDraft({ valueType: value as PublicationValueType })
                        }
                        options={publicationSupportedValueTypes.map((type) => ({ value: type, label: publicationValueTypeLabel(type) }))}
                      />
                    </label>
                    {draft.valueType === "integer" || draft.valueType === "number" ? (
                      <>
                        <label>
                          {publicationCopy.minimum}
                          <input
                            aria-label={publicationCopy.minimum}
                            inputMode="decimal"
                            value={draft.minimum}
                            onChange={(event) => patchDraft({ minimum: event.target.value })}
                          />
                        </label>
                        <label>
                          {publicationCopy.maximum}
                          <input
                            aria-label={publicationCopy.maximum}
                            inputMode="decimal"
                            value={draft.maximum}
                            onChange={(event) => patchDraft({ maximum: event.target.value })}
                          />
                        </label>
                      </>
                    ) : null}
                    <label>
                      {publicationCopy.unit}
                      <input
                        aria-label={publicationCopy.unit}
                        list="publication-unit-options"
                        value={draft.unit}
                        onChange={(event) => patchDraft({ unit: event.target.value })}
                        placeholder={publicationCopy.unitNone}
                      />
                      <datalist id="publication-unit-options">
                        {publicationSupportedUnits.map((unit) => (
                          <option key={unit} value={unit} />
                        ))}
                      </datalist>
                    </label>
                    <label>
                      {publicationCopy.examples}
                      <input
                        aria-label={publicationCopy.examples}
                        value={draft.examples}
                        onChange={(event) => patchDraft({ examples: event.target.value })}
                      />
                    </label>
                    <label>
                      {publicationCopy.reason}
                      <textarea
                        aria-label={publicationCopy.reason}
                        value={draft.reason}
                        onChange={(event) => patchDraft({ reason: event.target.value })}
                      />
                    </label>
                  </div>
                ) : !canPreview ? (
                  <p>{publicationCopy.authorRequired}</p>
                ) : null}
                {fieldError ? (
                  <p id={fieldMessageId} className="governance-confirm-dialog__error" role="alert">
                    {fieldError.message}
                  </p>
                ) : null}
                {draftSaved ? <p>{publicationCopy.draftSaved}</p> : null}
                {previewStale && candidate ? <p>{publicationCopy.previewStale}</p> : null}
                {candidate && !previewStale ? (
                  <dl className="parameter-catalog-publication-dialog__preview" aria-label="发布预览">
                    <div>
                      <dt>{publicationCopy.added}</dt>
                      <dd>{candidate.impactSummary.addedDefinitionCount}</dd>
                    </div>
                    <div>
                      <dt>{publicationCopy.changed}</dt>
                      <dd>{candidate.impactSummary.changedDefinitionCount}</dd>
                    </div>
                    <div>
                      <dt>{publicationCopy.addedSubjects}</dt>
                      <dd>{candidate.impactSummary.addedSubjectCount}</dd>
                    </div>
                    <div>
                      <dt>{publicationCopy.risk}</dt>
                      <dd>
                        {candidate.riskClass === "high" ? publicationCopy.riskHigh : publicationCopy.riskLow}
                      </dd>
                    </div>
                    <div>
                      <dt>{publicationCopy.approval}</dt>
                      <dd>{publicationApprovalCopy(candidate.riskClass)}</dd>
                    </div>
                    <div>
                      <dt>{publicationCopy.scope}</dt>
                      <dd>{publicationCopy.sharedScope}</dd>
                    </div>
                  </dl>
                ) : null}
                {candidate && !previewStale && candidate.riskClass === "high" && candidate.impactSummary.addedSubjectCount > 0 ? (
                  <p>{publicationCopy.fallbackImpact}</p>
                ) : null}
                {candidate && !previewStale && draft.mode === "revise-definition" && draft.reviseClass === "semantic" ? (
                  <p>{publicationCopy.catalogNotAdopted}</p>
                ) : null}
                {catalogSucceeded && addedSubjectId ? (
                  <p data-registration-followup={followup}>
                    {followup === "failed"
                      ? publicationCopy.registerFollowupFailed
                      : followup === "succeeded"
                        ? publicationCopy.registerFollowupSuccess
                        : publicationCopy.registerFollowupHint}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="dialog-actions">
              {draft.mode === "revise-definition" && job && !publicationJobIsPending(job.status) ? (
                <button type="button" className="button primary sm" onClick={() => {
                  clearStoredPublicationJob();
                  stopPolling();
                  completedRef.current = false;
                  setDraft(emptyPublicationDraft());
                  setCandidate(null);
                  setCandidateVerified(false);
                  setPreviewFingerprint(null);
                  setJob(null);
                  setIdempotencyKey(null);
                  setFailure(null);
                }}>结束跟踪并开始新增</button>
              ) : null}
              {canSaveDraft && draft.mode !== "revise-definition" ? (
                <button
                  type="button"
                  className="button subtle sm"
                  disabled={!targetAllowed || pending || !draft.reason.trim() || !draft.propertyKey.trim()}
                  onClick={() => void saveDraft()}
                >
                  {pending ? publicationCopy.processing : publicationCopy.saveDraft}
                </button>
              ) : null}
              {canPreview && draft.mode !== "revise-definition" ? (
                <button
                  type="button"
                  className="button sm"
                  disabled={
                    pending ||
                    !targetAllowed ||
                    !draft.propertyKey.trim() ||
                    !draft.displayName.trim() ||
                    (draft.mode === "create-definition" && !draft.subjectId) ||
                    (draft.mode === "create-subject" && !draft.selectorValue.trim())
                  }
                  onClick={() => setConfirm("preview")}
                >
                  {mustRePreview ? publicationCopy.rebase : publicationCopy.preview}
                </button>
              ) : null}
              {canPublish && draft.mode !== "revise-definition" ? (
                <button
                  type="button"
                  className="button primary sm"
                  disabled={
                    pending ||
                    !targetAllowed ||
                    !candidate ||
                    mustRePreview ||
                    publicationJobIsPending(job?.status ?? "cancelled")
                  }
                  title={!canPublish ? "缺少发布权限" : undefined}
                  onClick={() => setConfirm("publish")}
                >
                  {pending ? publicationCopy.processing : publicationCopy.publish}
                </button>
              ) : null}
              {catalogSucceeded && addedSubjectId && followup !== "succeeded" ? (
                <button
                  type="button"
                  className="button sm"
                  disabled={pending}
                  onClick={() => void runRegistrationFollowup()}
                >
                  {followup === "failed" ? publicationCopy.registerFollowupRetry : publicationCopy.registerFollowup}
                </button>
              ) : null}
              {job && publicationJobIsPending(job.status) ? (
                <button
                  type="button"
                  className="button ghost sm"
                  onClick={() => void pollJob(job.id)}
                >
                  {publicationCopy.refreshJob}
                </button>
              ) : null}
              {onRefreshEvidence && (failure || job?.status === "needs-rebase" || job?.failure?.reason === "needs-rebase" || publicationAdvisory) && draft.mode !== "revise-definition" ? (
                <button
                  type="button"
                  className="button ghost sm"
                  disabled={pending}
                  onClick={() => void retryPublicationState()}
                >
                  更新发布状态
                </button>
              ) : null}
              <button
                type="button"
                className="button ghost sm"
                disabled={pending}
                onClick={requestClose}
              >
                关闭
              </button>
            </div>
          </>
        )}
      </ModalDialog>
      <ConfirmDialog
        open={confirm !== null && targetAllowed && (confirm === "publish" ? canPublish : canPreview)}
        title={confirm === "publish" ? publicationCopy.confirmPublishTitle : publicationCopy.confirmPreviewTitle}
        description={
          <p>{confirm === "publish" ? publicationCopy.requiredApproval : publicationCopy.noInternalIds}</p>
        }
        confirmLabel={confirm === "publish" ? publicationCopy.confirmPublish : publicationCopy.confirmPreview}
        pending={pending}
        pendingLabel={publicationCopy.processing}
        acknowledgement={confirm === "publish" ? publicationCopy.publishAck : publicationCopy.previewAck}
        onConfirm={() => {
          if (confirm === "publish") {
            void runPublish();
            return;
          }
          void runPreview();
        }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={leaveConfirm}
        title="离开未保存的编写"
        description={<p>当前正文尚未发布。离开将保留本机定位，但不把未保存内容当作已生效。</p>}
        confirmLabel="离开"
        cancelLabel="继续编写"
        onConfirm={() => {
          setLeaveConfirm(false);
          onOpenChange(false);
        }}
        onCancel={() => setLeaveConfirm(false)}
      />
    </>
  );
}
