import { useEffect, useId, useRef, useState } from "react";

import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import type { CatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
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
import {
  buildCreateDefinitionChangeSet,
  canExecutePublicationAction,
  createPublicationSubmitGate,
  emptyPublicationDraft,
  fingerprintPublicationDraft,
  publicationApprovalCopy,
  publicationCopy,
  publicationFailureCopy,
  publicationFieldError,
  publicationJobIsPending,
  publicationMustRePreview,
  publicationPreviewIsStale,
  publicationStatusCopy,
  publicationSuccessKind,
  publicationSupportedUnits,
  publicationSupportedValueTypes,
  type PublicationDraft,
  type PublicationSubmitGate,
  type PublicationUnit,
  type PublicationValueType
} from "./publicationState";

type SubjectItem = CatalogSubjectResponse["item"];
type ConfirmKind = "preview" | "publish";

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
  createIdempotencyKey,
  onOpenChange,
  onCompleted,
  onRefreshEvidence
}: PublicationDialogProps) {
  const canPreview = canExecutePublicationAction(
    actor,
    "preview-publication",
    domainState,
    sessionPermissions
  );
  const canPublish = canExecutePublicationAction(
    actor,
    "publish-publication",
    domainState,
    sessionPermissions
  );
  const gateRef = useRef<PublicationSubmitGate>(createPublicationSubmitGate());
  const pollRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const formId = useId();
  const [draft, setDraft] = useState<PublicationDraft>(emptyPublicationDraft);
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<CatalogPublicationCandidateResponse["item"] | null>(null);
  const [previewFingerprint, setPreviewFingerprint] = useState<string | null>(null);
  const [job, setJob] = useState<CatalogPublicationJobResponse["item"] | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ input: keyof PublicationDraft; message: string } | null>(
    null
  );
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);

  const previewStale = publicationPreviewIsStale(previewFingerprint, draft);
  const selectedSubject = subjects.find((item) => item.id === draft.subjectId) ?? null;
  const publishedSubjects = subjects.filter((item) => item.membership.status === "active");
  const mustRePreview = publicationMustRePreview({
    previewStale,
    jobStatus: job?.status,
    failureReason: job?.failure?.reason
  });

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
    setFailure(null);
    setFieldError(null);
    setConfirm(null);
    setPending(false);
    let cancelled = false;
    void (async () => {
      try {
        const listed = await catalog.listSubjects({ catalogReleaseId });
        if (cancelled) {
          return;
        }
        setSubjects([...listed.items]);
        setLoadError(listed.items.length === 0 ? publicationCopy.unpublishedEmpty : null);
        const stored = readStoredPublicationJob({
          userId: currentPersonId,
          organizationId
        });
        if (stored && stored.catalogReleaseId === catalogReleaseId) {
          setDraft(stored.draft);
          setCandidate({
            id: stored.candidateId,
            expectedBaseReleaseId: stored.catalogReleaseId,
            expectedBaseReleaseDigest: "",
            riskClass: "low",
            impactSummary: { addedDefinitionCount: 1, changedDefinitionCount: 0, addedSubjectCount: 0 },
            capabilityContract: { revision: "", allowListId: "" }
          });
          setJob({
            id: stored.jobId,
            candidateId: stored.candidateId,
            status: "queued",
            attemptCount: 0,
            effective: false,
            isCurrent: false,
            currentness: null,
            failure: null
          });
          setPreviewFingerprint(fingerprintPublicationDraft(stored.draft));
          setIdempotencyKey(stored.idempotencyKey);
          startPolling(stored.jobId);
          return;
        }
        setDraft(emptyPublicationDraft());
        setProposalId(null);
        setCandidate(null);
        setPreviewFingerprint(null);
        setJob(null);
        setIdempotencyKey(null);
        setDraftSaved(false);
      } catch {
        if (!cancelled) {
          setLoadError("主体列表加载失败，请稍后重试。");
        }
      }
    })();
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [open, catalog, catalogReleaseId, currentPersonId, organizationId]);

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
    setFailure(publicationFailureCopy(error));
  };

  const saveDraft = async () => {
    if (!canPreview || pending || !draft.subjectId || !draft.propertyKey.trim() || !draft.reason.trim()) {
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
            kind: "create-definition",
            subjectId: draft.subjectId,
            propertyKey: draft.propertyKey.trim(),
            content: buildCreateDefinitionChangeSet(draft)[0]?.content
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
    if (!canPreview || pending || !draft.subjectId || !draft.propertyKey.trim()) {
      return;
    }
    if (!gateRef.current.begin()) {
      return;
    }
    setPending(true);
    try {
      const created = await catalog.createPublicationCandidate(
        {
          changeSet: buildCreateDefinitionChangeSet(draft),
          ...(proposalId ? { proposalId } : {})
        },
        { catalogReleaseId }
      );
      setCandidate(created.item);
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
      applyJob(published.item);
      writeStoredPublicationJob({
        jobId: published.item.id,
        candidateId: candidate.id,
        catalogReleaseId,
        userId: currentPersonId,
        organizationId,
        draft,
        idempotencyKey: key
      });
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

  const status = job ? publicationStatusCopy(job) : null;
  const describedById = `${formId}-help`;
  const fieldMessageId = `${formId}-field`;

  return (
    <>
      <ModalDialog
        open={open}
        onDismiss={pending ? undefined : () => onOpenChange(false)}
        className="confirm-dialog governance-confirm-dialog parameter-catalog-publication-dialog"
        backdropClassName="param-admin-modal-backdrop"
        describedBy
      >
        {({ titleId, descriptionId }) => (
          <>
            <h2 id={titleId}>{publicationCopy.title}</h2>
            <div className="confirm-dialog__scroll">
              <div id={descriptionId} className="governance-confirm-dialog__body">
                <p id={describedById}>{publicationCopy.noInternalIds}</p>
                <p>{publicationCopy.requiredApproval}</p>
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
                  </p>
                ) : null}
                {publishedSubjects.length === 0 ? (
                  <p>{publicationCopy.unpublishedEmpty}</p>
                ) : canPreview ? (
                  <div className="parameter-catalog-publication-dialog__form">
                    <label>
                      {publicationCopy.subject}
                      <select
                        aria-label={publicationCopy.subject}
                        value={draft.subjectId}
                        aria-invalid={fieldError?.input === "subjectId"}
                        aria-describedby={fieldError?.input === "subjectId" ? fieldMessageId : describedById}
                        onChange={(event) => patchDraft({ subjectId: event.target.value })}
                      >
                        <option value="">选择主体</option>
                        {publishedSubjects.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.canonicalName}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedSubject ? (
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
                      <select
                        aria-label={publicationCopy.valueType}
                        value={draft.valueType}
                        onChange={(event) =>
                          patchDraft({ valueType: event.target.value as PublicationValueType })
                        }
                      >
                        {publicationSupportedValueTypes.map((type) => (
                          <option key={type} value={type}>
                            {type === "integer"
                              ? publicationCopy.valueTypeInteger
                              : type === "number"
                                ? publicationCopy.valueTypeNumber
                                : publicationCopy.valueTypeString}
                          </option>
                        ))}
                      </select>
                    </label>
                    {draft.valueType !== "string" ? (
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
                      <select
                        aria-label={publicationCopy.unit}
                        value={draft.unit}
                        onChange={(event) =>
                          patchDraft({ unit: event.target.value as "" | PublicationUnit })
                        }
                      >
                        <option value="">{publicationCopy.unitNone}</option>
                        {publicationSupportedUnits.map((unit) => (
                          <option key={unit} value={unit}>
                            {unit}
                          </option>
                        ))}
                      </select>
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
                ) : (
                  <p>{publicationCopy.authorRequired}</p>
                )}
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
              </div>
            </div>
            <div className="dialog-actions">
              {canPreview ? (
                <button
                  type="button"
                  className="button subtle sm"
                  disabled={pending || !draft.reason.trim() || !draft.propertyKey.trim()}
                  onClick={() => void saveDraft()}
                >
                  {pending ? publicationCopy.processing : publicationCopy.saveDraft}
                </button>
              ) : null}
              {canPreview ? (
                <button
                  type="button"
                  className="button sm"
                  disabled={pending || !draft.subjectId || !draft.propertyKey.trim() || !draft.displayName.trim()}
                  onClick={() => setConfirm("preview")}
                >
                  {mustRePreview ? publicationCopy.rebase : publicationCopy.preview}
                </button>
              ) : null}
              {canPublish ? (
                <button
                  type="button"
                  className="button primary sm"
                  disabled={
                    pending ||
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
              {job && publicationJobIsPending(job.status) ? (
                <button
                  type="button"
                  className="button ghost sm"
                  onClick={() => void pollJob(job.id)}
                >
                  {publicationCopy.refreshJob}
                </button>
              ) : null}
              {onRefreshEvidence ? (
                <button
                  type="button"
                  className="button ghost sm"
                  disabled={pending}
                  onClick={() => void onRefreshEvidence()}
                >
                  刷新证据
                </button>
              ) : null}
              <button
                type="button"
                className="button ghost sm"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                关闭
              </button>
            </div>
          </>
        )}
      </ModalDialog>
      <ConfirmDialog
        open={confirm !== null}
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
    </>
  );
}
