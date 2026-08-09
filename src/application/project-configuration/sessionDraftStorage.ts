import type { SessionPropertyDraft } from "./sessionDrafts";

export const SESSION_DRAFT_STORAGE_KEY = "wiseeff.pcw.sessionDrafts.v1";

export type SessionDraftScope = {
  userId: string;
  organizationId: string;
  projectId: string;
  configSetId: string;
  fileId: string;
  baseVersionId: string;
};

export type PersistedSessionDraftBucket = {
  scope: SessionDraftScope;
  /** Property-keyed patches only — never full DTS source text. */
  drafts: Record<string, SessionPropertyDraft>;
  selectedKeys: string[];
  reason: string;
  updatedAt: string;
};

export type SessionDraftStoreSnapshot = {
  version: 1;
  buckets: PersistedSessionDraftBucket[];
};

export type SessionDraftRecoveryClassification = "compatible" | "stale-base" | "mismatch";

export type RecoverableSessionDraft = {
  classification: Exclude<SessionDraftRecoveryClassification, "mismatch">;
  bucket: PersistedSessionDraftBucket;
};

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function createEmptyStore(): SessionDraftStoreSnapshot {
  return { version: 1, buckets: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScope(value: unknown): value is SessionDraftScope {
  if (!isRecord(value)) return false;
  return (
    typeof value.userId === "string" &&
    typeof value.organizationId === "string" &&
    typeof value.projectId === "string" &&
    typeof value.configSetId === "string" &&
    typeof value.fileId === "string" &&
    typeof value.baseVersionId === "string"
  );
}

function isPropertyDraft(value: unknown): value is SessionPropertyDraft {
  if (!isRecord(value)) return false;
  return typeof value.rawText === "string" && typeof value.normalizedValue === "string";
}

function parseBucket(value: unknown): PersistedSessionDraftBucket | null {
  if (!isRecord(value) || !isScope(value.scope) || !isRecord(value.drafts)) return null;
  if (!Array.isArray(value.selectedKeys) || typeof value.reason !== "string") return null;
  if (typeof value.updatedAt !== "string") return null;
  const drafts: Record<string, SessionPropertyDraft> = {};
  for (const [key, draft] of Object.entries(value.drafts)) {
    if (!isPropertyDraft(draft)) return null;
    drafts[key] = {
      rawText: draft.rawText,
      normalizedValue: draft.normalizedValue,
      ...(typeof draft.valid === "boolean" ? { valid: draft.valid } : {}),
      ...(typeof draft.error === "string" ? { error: draft.error } : {}),
      ...(typeof draft.present === "boolean" ? { present: draft.present } : {})
    };
  }
  return {
    scope: { ...value.scope },
    drafts,
    selectedKeys: value.selectedKeys.filter((item): item is string => typeof item === "string"),
    reason: value.reason,
    updatedAt: value.updatedAt
  };
}

function identityKey(scope: Pick<SessionDraftScope, "userId" | "organizationId" | "projectId" | "configSetId" | "fileId">): string {
  return [scope.userId, scope.organizationId, scope.projectId, scope.configSetId, scope.fileId].join("::");
}

export function classifySessionDraftRecovery(
  stored: SessionDraftScope,
  current: SessionDraftScope
): SessionDraftRecoveryClassification {
  if (
    stored.userId !== current.userId ||
    stored.organizationId !== current.organizationId ||
    stored.projectId !== current.projectId ||
    stored.configSetId !== current.configSetId ||
    stored.fileId !== current.fileId
  ) {
    return "mismatch";
  }
  if (stored.baseVersionId !== current.baseVersionId) {
    return "stale-base";
  }
  return "compatible";
}

export function readSessionDraftStore(storage: ReadableStorage = localStorage): SessionDraftStoreSnapshot {
  try {
    const raw = storage.getItem(SESSION_DRAFT_STORAGE_KEY);
    if (!raw) return createEmptyStore();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.buckets)) {
      return createEmptyStore();
    }
    const buckets = parsed.buckets
      .map(parseBucket)
      .filter((bucket): bucket is PersistedSessionDraftBucket => bucket !== null);
    return { version: 1, buckets };
  } catch {
    return createEmptyStore();
  }
}

export function writeSessionDraftStore(
  snapshot: SessionDraftStoreSnapshot,
  storage: WritableStorage = localStorage
): void {
  try {
    if (snapshot.buckets.length === 0) {
      storage.removeItem(SESSION_DRAFT_STORAGE_KEY);
      return;
    }
    storage.setItem(SESSION_DRAFT_STORAGE_KEY, JSON.stringify({ version: 1, buckets: snapshot.buckets }));
  } catch {
    // Ignore storage failures; in-memory session state still works for the current tab.
  }
}

export function upsertSessionDraftBucket(
  bucket: PersistedSessionDraftBucket,
  storage: WritableStorage = localStorage
): void {
  const store = readSessionDraftStore(storage);
  const key = identityKey(bucket.scope);
  const nextBuckets = store.buckets.filter((item) => identityKey(item.scope) !== key);
  if (Object.keys(bucket.drafts).length > 0) {
    nextBuckets.push({
      scope: { ...bucket.scope },
      drafts: { ...bucket.drafts },
      selectedKeys: [...bucket.selectedKeys],
      reason: bucket.reason,
      updatedAt: bucket.updatedAt
    });
  }
  writeSessionDraftStore({ version: 1, buckets: nextBuckets }, storage);
}

export function removeSessionDraftBucket(
  scope: Pick<SessionDraftScope, "userId" | "organizationId" | "projectId" | "configSetId" | "fileId">,
  storage: WritableStorage = localStorage
): void {
  const store = readSessionDraftStore(storage);
  const key = identityKey(scope);
  writeSessionDraftStore(
    {
      version: 1,
      buckets: store.buckets.filter((item) => identityKey(item.scope) !== key)
    },
    storage
  );
}

export function findRecoverableSessionDraft(
  current: SessionDraftScope,
  storage: ReadableStorage = localStorage
): RecoverableSessionDraft | null {
  const store = readSessionDraftStore(storage);
  const key = identityKey(current);
  const bucket = store.buckets.find((item) => identityKey(item.scope) === key);
  if (!bucket || Object.keys(bucket.drafts).length === 0) return null;
  const classification = classifySessionDraftRecovery(bucket.scope, current);
  if (classification === "mismatch") return null;
  return { classification, bucket };
}

export function clearSessionDraftsForLogout(storage: WritableStorage = localStorage): void {
  writeSessionDraftStore(createEmptyStore(), storage);
}

export function formatSessionDraftCopyText(bucket: PersistedSessionDraftBucket): string {
  const lines = Object.entries(bucket.drafts).map(([key, draft]) => {
    return `${key}: ${draft.rawText}${draft.normalizedValue ? ` (${draft.normalizedValue})` : ""}`;
  });
  return [
    `scope: ${bucket.scope.projectId}/${bucket.scope.configSetId}/${bucket.scope.fileId}@${bucket.scope.baseVersionId}`,
    `reason: ${bucket.reason || "(none)"}`,
    ...lines
  ].join("\n");
}
