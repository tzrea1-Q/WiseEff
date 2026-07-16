type ReviewTaskEvidence = {
  propertyKey?: string;
  configRevisionId?: string;
  projectId?: string;
  nodeLocator?: string;
};

export type ReviewTaskLike = {
  id: string;
  propertyKey?: string | null;
  configRevisionId?: string;
  sourceEvidence?: ReviewTaskEvidence;
  candidateSchemas?: Array<{ id: string; propertyKey?: string; label?: string }>;
  candidates?: Array<{ id: string; propertyKey?: string | null; label?: string }>;
};

export type MappingTaskLike = {
  id: string;
  configRevisionId?: string;
  evidence?: {
    candidates?: Array<{ logicalNodeId: string; nodeLocator: string }>;
  };
};

function reviewPropertyKey(task: ReviewTaskLike): string | undefined {
  const value = task.propertyKey ?? task.sourceEvidence?.propertyKey;
  return value ?? undefined;
}

function reviewConfigRevisionId(task: ReviewTaskLike): string | undefined {
  return task.configRevisionId ?? task.sourceEvidence?.configRevisionId;
}

function reviewProjectId(task: ReviewTaskLike): string | undefined {
  return task.sourceEvidence?.projectId;
}

function reviewNodeLocator(task: ReviewTaskLike): string | undefined {
  return task.sourceEvidence?.nodeLocator;
}

function formatTaskIds(items: Array<{ id: string }>): string {
  return items.length > 0 ? items.map((item) => item.id).join(",") : "(none)";
}

export function requireReviewTask<T extends ReviewTaskLike>(
  items: T[],
  criteria: {
    projectId?: string;
    configRevisionId?: string;
    propertyKey?: string;
    nodeLocator?: string;
  },
  label = "review task"
): T {
  const matches = items.filter((item) => {
    if (criteria.projectId && reviewProjectId(item) && reviewProjectId(item) !== criteria.projectId) {
      return false;
    }
    if (
      criteria.configRevisionId &&
      reviewConfigRevisionId(item) &&
      reviewConfigRevisionId(item) !== criteria.configRevisionId
    ) {
      return false;
    }
    if (criteria.propertyKey && reviewPropertyKey(item) !== criteria.propertyKey) {
      return false;
    }
    if (criteria.nodeLocator && reviewNodeLocator(item) && reviewNodeLocator(item) !== criteria.nodeLocator) {
      return false;
    }
    return true;
  });

  if (matches.length === 1) {
    return matches[0]!;
  }

  if (matches.length === 0) {
    throw new Error(
      [
        `Missing target ${label}.`,
        `projectId=${criteria.projectId ?? "(any)"}`,
        `configRevisionId=${criteria.configRevisionId ?? "(any)"}`,
        `propertyKey=${criteria.propertyKey ?? "(any)"}`,
        `locator=${criteria.nodeLocator ?? "(any)"}`,
        `actualTaskIds=[${formatTaskIds(items)}]`
      ].join(" ")
    );
  }

  throw new Error(
    [
      `Ambiguous ${label}.`,
      `projectId=${criteria.projectId ?? "(any)"}`,
      `configRevisionId=${criteria.configRevisionId ?? "(any)"}`,
      `propertyKey=${criteria.propertyKey ?? "(any)"}`,
      `locator=${criteria.nodeLocator ?? "(any)"}`,
      `matchedTaskIds=[${formatTaskIds(matches)}]`
    ].join(" ")
  );
}

export function requireMappingTask<T extends MappingTaskLike>(
  items: T[],
  criteria: { projectId?: string; configRevisionId: string },
  label = "identity mapping task"
): T {
  const matches = items.filter((item) => item.configRevisionId === criteria.configRevisionId);
  if (matches.length === 1) {
    return matches[0]!;
  }
  if (matches.length === 0) {
    throw new Error(
      [
        `Missing target ${label}.`,
        `projectId=${criteria.projectId ?? "(any)"}`,
        `configRevisionId=${criteria.configRevisionId}`,
        `actualTaskIds=[${formatTaskIds(items)}]`
      ].join(" ")
    );
  }
  throw new Error(
    [
      `Ambiguous ${label}.`,
      `projectId=${criteria.projectId ?? "(any)"}`,
      `configRevisionId=${criteria.configRevisionId}`,
      `matchedTaskIds=[${formatTaskIds(matches)}]`
    ].join(" ")
  );
}

export function requireMappingCandidate(
  task: MappingTaskLike,
  predicate: (candidate: { logicalNodeId: string; nodeLocator: string }) => boolean,
  label: string
): { logicalNodeId: string; nodeLocator: string } {
  const candidates = task.evidence?.candidates ?? [];
  const match = candidates.find(predicate);
  if (!match) {
    throw new Error(
      [
        `Missing mapping candidate for ${label}.`,
        `taskId=${task.id}`,
        `candidates=[${candidates.map((c) => `${c.logicalNodeId}:${c.nodeLocator}`).join(",") || "(none)"}]`
      ].join(" ")
    );
  }
  return match;
}

export function pickReviewCandidate(
  task: ReviewTaskLike,
  criteria: { propertyKey?: string; nodeLocator?: string }
): { id: string; propertyKey?: string; label?: string } {
  const candidates = task.candidateSchemas ?? task.candidates ?? [];
  if (candidates.length === 0) {
    throw new Error(`task ${task.id} must expose candidates`);
  }

  const propertyKey = criteria.propertyKey ?? reviewPropertyKey(task);
  const nodeLocator = criteria.nodeLocator ?? reviewNodeLocator(task);

  const match =
    candidates.find((candidate) => candidate.propertyKey && candidate.propertyKey === propertyKey) ??
    candidates.find(
      (candidate) =>
        nodeLocator &&
        (candidate.label?.includes(nodeLocator) ||
          candidate.id.toLowerCase().includes(nodeLocator.split("/").pop()?.toLowerCase() ?? ""))
    );

  if (!match) {
    throw new Error(
      [
        `No review candidate matched task ${task.id}.`,
        `propertyKey=${propertyKey ?? "(any)"}`,
        `locator=${nodeLocator ?? "(any)"}`,
        `candidateIds=[${candidates.map((c) => c.id).join(",")}]`
      ].join(" ")
    );
  }
  return match;
}
