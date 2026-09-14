export type PublicationJobView = {
  readonly id?: string;
  readonly candidateId?: string;
  readonly status?: string;
  readonly effective?: boolean;
  readonly isCurrent?: boolean;
  readonly currentness?: string | null;
  readonly catalogReleaseId?: string;
  readonly releaseDigest?: string;
};

export type CatalogDocumentView = {
  readonly catalogReleaseId?: string;
  readonly digest?: string;
  readonly item?: { readonly catalogReleaseId?: string; readonly digest?: string };
};

export type CatalogDefinitionView = {
  readonly id?: string;
  readonly subjectId?: string;
  readonly subject?: { readonly id?: string };
  readonly propertyKey?: string;
  readonly currentRevisionId?: string;
  readonly currentRevision?: { readonly id?: string };
};

export type ProjectBindingView = {
  readonly id?: string;
  readonly projectId?: string;
  readonly logicalNodeId?: string;
  readonly definitionId?: string;
  readonly effectiveRevisionId?: string;
  readonly currentValueId?: string;
  readonly propertyKey?: string;
  readonly rawValue?: string | number | null;
  readonly effectiveValue?: unknown;
};

export type CatalogIdentityChain = {
  readonly candidateId: string;
  readonly jobId: string;
  readonly receiptEffective: true;
  readonly releaseId: string;
  readonly releaseDigest: string;
  readonly predecessorReleaseId: string;
  readonly subjectId: string;
  readonly definitionId: string;
  readonly revisionId: string;
  readonly propertyKey: string;
  readonly projectId: string;
  readonly logicalNodeId: string;
  readonly bindingId: string;
  readonly projectValueId: string;
};

export class IdentityChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityChainError";
  }
}

const required = (value: string | undefined, label: string): string => {
  if (!value || value.trim().length === 0) {
    throw new IdentityChainError(`missing ${label}`);
  }
  return value;
};

export function assertJobSucceeded(
  job: PublicationJobView,
  expected: { readonly jobId: string; readonly candidateId: string },
): void {
  if (job.id !== expected.jobId) {
    throw new IdentityChainError(`job id mismatch: ${job.id} != ${expected.jobId}`);
  }
  if (job.candidateId !== expected.candidateId) {
    throw new IdentityChainError(`candidate id mismatch: ${job.candidateId} != ${expected.candidateId}`);
  }
  if (job.effective !== true) {
    throw new IdentityChainError(`job effective is ${String(job.effective)}, required true (receipt missing or unmatched)`);
  }
  if (job.currentness !== "active") {
    throw new IdentityChainError(`job currentness is ${String(job.currentness)}, required active`);
  }
  if (job.isCurrent !== true) {
    throw new IdentityChainError(`job isCurrent is ${String(job.isCurrent)}, required true`);
  }
  if (job.status !== "active") {
    throw new IdentityChainError(`job status is ${String(job.status)}, required active`);
  }
}

export function assertJobSuperseded(
  job: PublicationJobView,
  expected: { readonly jobId: string; readonly candidateId: string },
): void {
  if (job.id !== expected.jobId) {
    throw new IdentityChainError(`superseded job id mismatch: ${job.id} != ${expected.jobId}`);
  }
  if (job.candidateId !== expected.candidateId) {
    throw new IdentityChainError(`superseded candidate mismatch`);
  }
  if (job.effective !== true) {
    throw new IdentityChainError(`superseded job must remain effective=true (receipt retained)`);
  }
  if (job.currentness !== "active-superseded") {
    throw new IdentityChainError(`job currentness is ${String(job.currentness)}, required active-superseded`);
  }
  if (job.isCurrent !== false) {
    throw new IdentityChainError(`superseded job isCurrent must be false`);
  }
}

export function catalogReleaseOf(document: CatalogDocumentView): { readonly id: string; readonly digest: string } {
  const id = document.item?.catalogReleaseId ?? document.catalogReleaseId;
  const digest = document.item?.digest ?? document.digest;
  return { id: required(id, "catalogReleaseId"), digest: required(digest, "catalog digest") };
}

export function assertUniqueDefinition(
  items: readonly CatalogDefinitionView[] | undefined,
  expected: { readonly propertyKey: string; readonly subjectId: string },
): CatalogDefinitionView {
  if (!items) {
    throw new IdentityChainError("definition list missing");
  }
  const matches = items.filter((item) => {
    const subjectId = item.subjectId ?? item.subject?.id;
    return item.propertyKey === expected.propertyKey && subjectId === expected.subjectId;
  });
  if (matches.length !== 1) {
    throw new IdentityChainError(
      `expected exactly one definition for ${expected.propertyKey}, found ${matches.length}`,
    );
  }
  const match = matches[0]!;
  required(match.id, "definitionId");
  const revisionId = match.currentRevisionId ?? match.currentRevision?.id;
  required(revisionId, "revisionId");
  return { ...match, currentRevisionId: revisionId, subjectId: expected.subjectId };
}

export function assertBindingGetOk(status: number): void {
  if (status !== 200) {
    throw new IdentityChainError(`binding GET status ${status}, required 200`);
  }
}

export function assertUniqueBinding(
  items: readonly ProjectBindingView[] | undefined,
  expected: { readonly propertyKey: string; readonly definitionId: string; readonly projectId: string },
): ProjectBindingView {
  if (!items || items.length === 0) {
    throw new IdentityChainError("binding list empty");
  }
  const matches = items.filter((item) => {
    if (item.definitionId !== expected.definitionId) {
      return false;
    }
    if (item.propertyKey && item.propertyKey !== expected.propertyKey) {
      return false;
    }
    return true;
  });
  if (matches.length === 0) {
    throw new IdentityChainError(
      `no binding for propertyKey=${expected.propertyKey} definitionId=${expected.definitionId} (unrelated rows=${items.length})`,
    );
  }
  const catalogMatches = matches.filter((item) => item.id?.startsWith("pbind_"));
  const unique = catalogMatches.length === 1 ? catalogMatches : matches;
  if (unique.length !== 1) {
    throw new IdentityChainError(`binding not unique for ${expected.propertyKey}`);
  }
  const match = unique[0]!;
  if (match.projectId !== expected.projectId) {
    throw new IdentityChainError(`binding projectId mismatch`);
  }
  required(match.id, "bindingId");
  required(match.logicalNodeId, "logicalNodeId");
  required(match.effectiveRevisionId, "effectiveRevisionId");
  required(match.currentValueId, "currentValueId");
  return match;
}

const valueText = (binding: ProjectBindingView): string => {
  if (binding.rawValue !== undefined && binding.rawValue !== null) {
    return String(binding.rawValue);
  }
  if (typeof binding.effectiveValue === "string" || typeof binding.effectiveValue === "number") {
    return String(binding.effectiveValue);
  }
  if (binding.effectiveValue && typeof binding.effectiveValue === "object") {
    return JSON.stringify(binding.effectiveValue);
  }
  return "";
};

export function assertOfficialProjectValue(
  binding: ProjectBindingView,
  expected: { readonly currentValueId: string; readonly revisionId: string; readonly value: string },
): void {
  if (!binding.currentValueId || binding.currentValueId !== expected.currentValueId) {
    throw new IdentityChainError("official ProjectValue was not saved (draft-only is not enough)");
  }
  if (binding.effectiveRevisionId !== expected.revisionId) {
    throw new IdentityChainError("binding effectiveRevisionId does not match the published revision");
  }
  const observed = valueText(binding);
  if (!observed.includes(expected.value)) {
    throw new IdentityChainError(`official ProjectValue content is ${observed}, required ${expected.value}`);
  }
}

export function buildIdentityChain(input: {
  readonly candidateId: string;
  readonly jobId: string;
  readonly releaseId: string;
  readonly releaseDigest: string;
  readonly predecessorReleaseId: string;
  readonly subjectId: string;
  readonly definition: CatalogDefinitionView;
  readonly binding: ProjectBindingView;
  readonly propertyKey: string;
}): CatalogIdentityChain {
  return {
    candidateId: required(input.candidateId, "candidateId"),
    jobId: required(input.jobId, "jobId"),
    receiptEffective: true,
    releaseId: required(input.releaseId, "releaseId"),
    releaseDigest: required(input.releaseDigest, "releaseDigest"),
    predecessorReleaseId: required(input.predecessorReleaseId, "predecessorReleaseId"),
    subjectId: required(input.subjectId, "subjectId"),
    definitionId: required(input.definition.id, "definitionId"),
    revisionId: required(input.definition.currentRevisionId, "revisionId"),
    propertyKey: required(input.propertyKey, "propertyKey"),
    projectId: required(input.binding.projectId, "projectId"),
    logicalNodeId: required(input.binding.logicalNodeId, "logicalNodeId"),
    bindingId: required(input.binding.id, "bindingId"),
    projectValueId: required(input.binding.currentValueId, "projectValueId"),
  };
}
