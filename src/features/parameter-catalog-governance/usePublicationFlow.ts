import { useRef, useState } from "react";

import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type {
  CatalogPublicationCandidateResponse,
  CatalogPublicationJobResponse,
} from "@/infrastructure/http/parameterCatalogDtos";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { catalogFailureReason } from "@/infrastructure/http/parameterCatalogClient";
import { createGovernanceIdempotencyKey } from "./governanceState";
import {
  clearStoredPublicationJob, readStoredPublicationJob, writeStoredPublicationJob,
  type StoredPublicationJob,
} from "./publicationJobStorage";
import {
  createPublicationSubmitGate, publicationFailureCopy, publicationJobIsPending, publicationSuccessKind,
  type PublicationSubmitGate,
} from "./publicationState";

type Candidate = CatalogPublicationCandidateResponse["item"];
type Job = CatalogPublicationJobResponse["item"];

/** Shared lifecycle for freezing, confirming, publishing and restoring publication jobs. */
export function usePublicationFlow(input: {
  catalog: ParameterCatalogRepository;
  catalogReleaseId: string;
  currentPersonId: string;
  organizationId: string;
  createIdempotencyKey?: () => string;
  onCompleted?: () => void;
  onRefreshEvidence?: () => void | Promise<void>;
}) {
  const { catalog, catalogReleaseId, currentPersonId, organizationId } = input;
  const gateRef = useRef<PublicationSubmitGate>(createPublicationSubmitGate());
  const pollRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [candidateVerified, setCandidateVerified] = useState(false);
  const [previewFingerprint, setPreviewFingerprint] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"preview" | "publish" | null>(null);

  const stopPolling = () => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    pollRef.current = null;
  };
  const applyJob = (next: Job) => {
    setJob(next);
    if (!publicationJobIsPending(next.status) || publicationSuccessKind(next)) {
      stopPolling();
      if (publicationSuccessKind(next) && !completedRef.current) {
        completedRef.current = true;
        clearStoredPublicationJob();
        input.onCompleted?.();
        void Promise.resolve().then(() => input.onRefreshEvidence?.())
          .catch((error: unknown) => setFailure(publicationFailureCopy(error)));
      }
    }
  };
  const pollJob = async (jobId: string) => {
    try {
      applyJob((await catalog.getPublication(jobId)).item);
    } catch (error) {
      setFailure(publicationFailureCopy(error));
    }
  };
  const startPolling = (jobId: string) => {
    stopPolling();
    void pollJob(jobId);
    pollRef.current = window.setInterval(() => { void pollJob(jobId); }, 1000);
  };
  const reset = () => {
    stopPolling();
    gateRef.current = createPublicationSubmitGate();
    completedRef.current = false;
    setCandidate(null);
    setCandidateVerified(false);
    setPreviewFingerprint(null);
    setJob(null);
    setIdempotencyKey(null);
    setPending(false);
    setFailure(null);
    setConfirm(null);
  };
  const restore = (markdownImport: boolean, fingerprint: (stored: StoredPublicationJob) => string | null) => {
    reset();
    const stored = readStoredPublicationJob({ userId: currentPersonId, organizationId });
    if (!stored || Boolean(stored.markdownImport) !== markdownImport) return null;
    setCandidate({
      id: stored.candidateId, expectedBaseReleaseId: stored.catalogReleaseId,
      expectedBaseReleaseDigest: "", riskClass: "low",
      impactSummary: { addedDefinitionCount: 1, changedDefinitionCount: 0, addedSubjectCount: 0,
        ...(Array.isArray(stored.addedSubjectIds) ? { addedSubjectIds: stored.addedSubjectIds.filter((id): id is string => typeof id === "string") } : {}) },
      capabilityContract: { revision: "", allowListId: "" },
    });
    setJob({
      id: stored.jobId, candidateId: stored.candidateId, status: "queued", attemptCount: 0,
      effective: false, isCurrent: false, currentness: null, failure: null,
    });
    setPreviewFingerprint(fingerprint(stored));
    setIdempotencyKey(stored.idempotencyKey);
    startPolling(stored.jobId);
    return stored;
  };
  const captureError = (error: unknown) => {
    const reason = error instanceof WiseEffApiError ? catalogFailureReason(error) : null;
    if (reason === "needs-rebase") {
      setFailure(null);
      setJob((current) => ({
        id: current?.id ?? "", candidateId: current?.candidateId || candidate?.id || "",
        status: "needs-rebase", attemptCount: current?.attemptCount ?? 0, effective: false,
        isCurrent: false, currentness: null, failure: { class: "candidate", reason: "needs-rebase" },
      }));
      return;
    }
    setFailure(reason === "release-drift"
      ? "目录已更新，请更新发布状态后重新预览。已填写内容会保留。"
      : publicationFailureCopy(error));
  };
  const preview = async (
    request: () => Promise<Candidate | null>,
    fingerprint: string,
    onError: (error: unknown) => void,
  ) => {
    if (!gateRef.current.begin()) return;
    setPending(true);
    try {
      setCandidate(await request());
      completedRef.current = false;
      setCandidateVerified(true);
      setPreviewFingerprint(fingerprint);
      setJob(null);
      setIdempotencyKey(null);
      setFailure(null);
    } catch (error) {
      onError(error);
    } finally {
      gateRef.current.finish();
      setPending(false);
      setConfirm(null);
    }
  };
  const publish = async (
    draft: StoredPublicationJob["draft"],
    markdownImport: boolean,
    onError: (error: unknown) => void,
  ) => {
    if (!candidate || !gateRef.current.begin()) return;
    setPending(true);
    const key = idempotencyKey ?? (input.createIdempotencyKey ?? createGovernanceIdempotencyKey)();
    setIdempotencyKey(key);
    try {
      const published = await catalog.publishPublicationCandidate(
        candidate.id, { idempotencyKey: key }, { catalogReleaseId },
      );
      writeStoredPublicationJob({
        jobId: published.item.id, candidateId: candidate.id, catalogReleaseId,
        userId: currentPersonId, organizationId, draft,
        ...(candidate.impactSummary.addedSubjectIds ? { addedSubjectIds: candidate.impactSummary.addedSubjectIds } : {}),
        ...(markdownImport ? { markdownImport: true } : {}), idempotencyKey: key,
      });
      applyJob(published.item);
      if (publicationJobIsPending(published.item.status)) startPolling(published.item.id);
      setFailure(null);
    } catch (error) {
      onError(error);
    } finally {
      gateRef.current.finish();
      setPending(false);
      setConfirm(null);
    }
  };
  return {
    candidate, setCandidate, candidateVerified, setCandidateVerified, previewFingerprint, setPreviewFingerprint,
    job, setJob, idempotencyKey, setIdempotencyKey, pending, setPending, failure, setFailure,
    confirm, setConfirm, gateRef, stopPolling, pollJob, reset, restore, preview, publish, captureError,
  };
}
