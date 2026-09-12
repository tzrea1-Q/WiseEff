import type { PublicationDraft } from "./publicationState";

export const PUBLICATION_JOB_STORAGE_KEY = "wiseeff.catalog.publication-job";

export type StoredPublicationJob = {
  jobId: string;
  candidateId: string;
  catalogReleaseId: string;
  userId: string;
  organizationId: string;
  draft: PublicationDraft;
  idempotencyKey: string;
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readStoredPublicationJob(input: {
  userId: string;
  organizationId: string;
}): StoredPublicationJob | null {
  if (!canUseStorage()) {
    return null;
  }
  const raw = window.localStorage.getItem(PUBLICATION_JOB_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as StoredPublicationJob;
    if (
      parsed.userId !== input.userId ||
      parsed.organizationId !== input.organizationId ||
      !parsed.jobId ||
      !parsed.candidateId
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredPublicationJob(record: StoredPublicationJob): void {
  if (!canUseStorage()) {
    return;
  }
  window.localStorage.setItem(PUBLICATION_JOB_STORAGE_KEY, JSON.stringify(record));
}

export function clearStoredPublicationJob(): void {
  if (!canUseStorage()) {
    return;
  }
  window.localStorage.removeItem(PUBLICATION_JOB_STORAGE_KEY);
}
