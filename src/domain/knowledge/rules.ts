import type { KnowledgeEntry, KnowledgeStatus } from "./types";

export type KnowledgeCapability = {
  /** knowledge:view — read published entries and see knowledge surfaces (member default). */
  canView: boolean;
  canEdit: boolean;
  canManage: boolean;
  userId: string;
};

type EntryResponsibility = Pick<KnowledgeEntry, "createdByUserId" | "responsibleUserId">;
function responsibleUserId(entry: EntryResponsibility) {
  return entry.responsibleUserId === undefined ? entry.createdByUserId : entry.responsibleUserId;
}

/** Publishing is the single trust gate into retrieval (design D13). */
export function isSearchable(entry: Pick<KnowledgeEntry, "status">): boolean {
  return entry.status === "published";
}

/** Draft entries are visible to their owner and to knowledge managers only. */
export function canSeeEntry(entry: EntryResponsibility & Pick<KnowledgeEntry, "status">, capability: KnowledgeCapability): boolean {
  if (entry.status !== "draft") {
    return true;
  }
  return capability.canManage || responsibleUserId(entry) === capability.userId;
}

/** Publisher accountability (D18): edit governs own entries; manage governs any. */
export function canGovernEntry(
  entry: EntryResponsibility,
  capability: KnowledgeCapability
): boolean {
  if (capability.canManage) {
    return true;
  }
  return capability.canEdit && responsibleUserId(entry) === capability.userId;
}

export function canEditContent(
  entry: EntryResponsibility & Pick<KnowledgeEntry, "status">,
  capability: KnowledgeCapability
): boolean {
  return canGovernEntry(entry, capability);
}

export function allowedTransitions(status: KnowledgeStatus): KnowledgeStatus[] {
  switch (status) {
    case "draft":
      return ["published", "archived"];
    case "published":
      return ["archived"];
    case "archived":
      return ["published"];
  }
}

export function canPublish(entry: EntryResponsibility & Pick<KnowledgeEntry, "status">, capability: KnowledgeCapability) {
  return entry.status === "draft" && canGovernEntry(entry, capability);
}

export function canArchive(entry: EntryResponsibility & Pick<KnowledgeEntry, "status">, capability: KnowledgeCapability) {
  return entry.status !== "archived" && canGovernEntry(entry, capability);
}

export function canRestore(entry: EntryResponsibility & Pick<KnowledgeEntry, "status">, capability: KnowledgeCapability) {
  return entry.status === "archived" && canGovernEntry(entry, capability);
}

/** Hard delete stays a manage-level act regardless of ownership. */
export function canHardDelete(capability: KnowledgeCapability) {
  return capability.canManage;
}

export function collectKnownTags(entries: Array<Pick<KnowledgeEntry, "tags">>): string[] {
  return Array.from(new Set(entries.flatMap((entry) => entry.tags))).sort((a, b) => a.localeCompare(b, "zh-CN"));
}
