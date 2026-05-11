import type { AuditEvent, AuditEventKind, PrototypeState, RiskLevel } from "./mockData";
import type { PowerManagementParameterTemplate, PowerManagementProject } from "./powerManagementConfig";

export type ParameterCoverage = "full" | "partial" | "orphan";

export function getCoverage(
  parameter: PowerManagementParameterTemplate,
  projects: readonly PowerManagementProject[]
): ParameterCoverage {
  const valuedCount = projects.filter((project) => {
    const entry = parameter.values?.[project.id];
    return typeof entry?.currentValue === "string" && entry.currentValue.trim().length > 0;
  }).length;

  if (valuedCount === 0) {
    return "orphan";
  }
  if (valuedCount < projects.length) {
    return "partial";
  }
  return "full";
}

export function selectDirtyCount(state: PrototypeState): number {
  const current = JSON.stringify(state.configDraft);
  if (current === state.lastExportedSnapshot) {
    return 0;
  }

  let lastDraft: Pick<PrototypeState["configDraft"], "parameterLibrary"> | null = null;
  try {
    lastDraft = JSON.parse(state.lastExportedSnapshot) as Pick<PrototypeState["configDraft"], "parameterLibrary">;
  } catch {
    return state.configDraft.parameterLibrary.length;
  }

  if (!Array.isArray(lastDraft.parameterLibrary)) {
    return state.configDraft.parameterLibrary.length;
  }

  const currentById = new Map(state.configDraft.parameterLibrary.map((parameter) => [parameter.id, parameter]));
  const lastById = new Map(lastDraft.parameterLibrary.map((parameter) => [parameter.id, parameter]));
  const dirtyIds = new Set<string>();

  for (const id of new Set([...currentById.keys(), ...lastById.keys()])) {
    const currentParameter = currentById.get(id);
    const lastParameter = lastById.get(id);
    if (!currentParameter || !lastParameter || JSON.stringify(currentParameter) !== JSON.stringify(lastParameter)) {
      dirtyIds.add(id);
    }
  }

  return Math.max(dirtyIds.size, 1);
}

export type ParameterRange = {
  min?: number;
  max?: number;
  raw: string;
};

export function migrateParameterRange(raw: string | null | undefined): ParameterRange {
  const safe = typeof raw === "string" ? raw : "";
  const matches = safe.match(/-?\d+(?:\.\d+)?/g) ?? [];

  if (matches.length >= 2) {
    const [min, max] = matches.map(Number);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return { min, max, raw: safe };
    }
  }

  return { raw: safe };
}

let auditSeq = 0;

function makeAuditId() {
  auditSeq += 1;
  return `audit-${Date.now().toString(36)}-${auditSeq.toString(36)}`;
}

export type BuildAuditInput = {
  kind: AuditEventKind;
  actor: string;
  action: string;
  severity: RiskLevel;
  parameterId?: string;
  batchId?: string;
  userId?: string;
  metadata?: AuditEvent["metadata"];
  viaAgent?: boolean;
  time?: string;
};

export function buildAuditEvent(input: BuildAuditInput): AuditEvent {
  return {
    id: makeAuditId(),
    app: "parameter-admin",
    actor: input.actor,
    action: input.action,
    kind: input.kind,
    severity: input.severity,
    time: input.time ?? new Date().toISOString(),
    parameterId: input.parameterId,
    batchId: input.batchId,
    userId: input.userId,
    metadata: input.metadata,
    viaAgent: input.viaAgent
  };
}
