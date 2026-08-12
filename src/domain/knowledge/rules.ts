import type { KnowledgeEntry, KnowledgeStatus } from "./types";

export type KnowledgeCapability = {
  canEdit: boolean;
  canManage: boolean;
  userId: string;
};

/** Publishing is the single trust gate into retrieval (design D13). */
export function isSearchable(entry: Pick<KnowledgeEntry, "status">): boolean {
  return entry.status === "published";
}

/** Draft entries are visible to their owner and to knowledge managers only. */
export function canSeeEntry(entry: Pick<KnowledgeEntry, "status" | "createdByUserId">, capability: KnowledgeCapability): boolean {
  if (entry.status !== "draft") {
    return true;
  }
  return capability.canManage || entry.createdByUserId === capability.userId;
}

/** Publisher accountability (D18): edit governs own entries; manage governs any. */
export function canGovernEntry(
  entry: Pick<KnowledgeEntry, "createdByUserId">,
  capability: KnowledgeCapability
): boolean {
  if (capability.canManage) {
    return true;
  }
  return capability.canEdit && entry.createdByUserId === capability.userId;
}

export function canEditContent(
  entry: Pick<KnowledgeEntry, "status" | "createdByUserId">,
  capability: KnowledgeCapability
): boolean {
  return entry.status !== "archived" && canGovernEntry(entry, capability);
}

export function allowedTransitions(status: KnowledgeStatus): KnowledgeStatus[] {
  switch (status) {
    case "draft":
      return ["published"];
    case "published":
      return ["archived"];
    case "archived":
      return ["published"];
  }
}

export function canPublish(entry: Pick<KnowledgeEntry, "status" | "createdByUserId">, capability: KnowledgeCapability) {
  return entry.status === "draft" && canGovernEntry(entry, capability);
}

export function canArchive(entry: Pick<KnowledgeEntry, "status" | "createdByUserId">, capability: KnowledgeCapability) {
  return entry.status === "published" && canGovernEntry(entry, capability);
}

export function canRestore(entry: Pick<KnowledgeEntry, "status" | "createdByUserId">, capability: KnowledgeCapability) {
  return entry.status === "archived" && canGovernEntry(entry, capability);
}

/** Hard delete stays a manage-level act regardless of ownership. */
export function canHardDelete(capability: KnowledgeCapability) {
  return capability.canManage;
}

export function collectKnownTags(entries: Array<Pick<KnowledgeEntry, "tags">>): string[] {
  return Array.from(new Set(entries.flatMap((entry) => entry.tags))).sort((a, b) => a.localeCompare(b, "zh-CN"));
}
