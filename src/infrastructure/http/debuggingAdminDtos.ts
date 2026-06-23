import type {
  DebugAdminParameterDraft,
  DebugConnectionProtocol,
  DebugParameter,
  DebugParameterAccessMode,
  DebugParameterNodeBinding
} from "@/domain/debugging/types";
import type { RiskLevel } from "@/domain/parameters/types";

export type DebugAdminBindingDto = {
  protocol: DebugConnectionProtocol;
  nodePath: string;
  accessMode: DebugParameterAccessMode;
  enabled: boolean;
  isSmokeDefault?: boolean;
  notes?: string | null;
};

export type DebugAdminParameterDto = {
  id: string;
  projectId: string | null;
  name: string;
  key: string;
  description: string;
  module: string;
  nodePath?: string;
  accessMode?: DebugParameterAccessMode;
  unit: string;
  range: string;
  minValue?: number | null;
  maxValue?: number | null;
  risk: RiskLevel;
  currentValue: string;
  targetValue: string;
  sortOrder?: number;
  enabled?: boolean;
  archivedAt?: string | null;
  archivedBy?: string | null;
  archiveReason?: string | null;
  selectedBinding?: DebugAdminBindingDto | null;
  bindings?: DebugAdminBindingDto[];
};

export type DebugAdminBindingWriteDto = {
  nodePath: string;
  accessMode: DebugParameterAccessMode;
  enabled: boolean;
  notes?: string;
};

export type DebugAdminParameterBindingWriteDto = DebugAdminBindingWriteDto & {
  protocol: DebugConnectionProtocol;
};

export type DebugAdminParameterWriteDto = {
  projectId: string | null;
  name: string;
  key: string;
  description: string;
  module: string;
  nodePath: string;
  accessMode: DebugParameterAccessMode;
  unit: string;
  range: string;
  minValue: number | null;
  maxValue: number | null;
  risk: RiskLevel;
  currentValue: string;
  targetValue: string;
  sortOrder: number;
  enabled: boolean;
  bindings: DebugAdminParameterBindingWriteDto[];
};

function preferredBinding(dto: DebugAdminParameterDto) {
  if (dto.selectedBinding?.enabled) return dto.selectedBinding;
  const bindings = dto.bindings ?? [];
  return bindings.find((binding) => binding.enabled) ?? bindings[0];
}

export function debugAdminParameterFromDto(dto: DebugAdminParameterDto): DebugParameter {
  const binding = preferredBinding(dto);

  return {
    id: dto.id,
    projectId: dto.projectId,
    name: dto.name,
    key: dto.key,
    description: dto.description,
    module: dto.module,
    currentValue: dto.currentValue,
    targetValue: dto.targetValue,
    unit: dto.unit,
    range: dto.range,
    minValue: dto.minValue,
    maxValue: dto.maxValue,
    risk: dto.risk,
    status: "已同步",
    nodePath: binding?.nodePath ?? dto.nodePath ?? "",
    accessMode: binding?.accessMode ?? dto.accessMode ?? "RO",
    sortOrder: dto.sortOrder,
    enabled: dto.enabled,
    archivedAt: dto.archivedAt,
    archivedBy: dto.archivedBy,
    archiveReason: dto.archiveReason,
    selectedProtocol: binding?.protocol,
    bindings: dto.bindings?.map(debugAdminBindingFromDto) ?? []
  };
}

export function debugAdminBindingFromDto(dto: DebugAdminBindingDto): DebugParameterNodeBinding {
  return {
    protocol: dto.protocol,
    nodePath: dto.nodePath,
    accessMode: dto.accessMode,
    enabled: dto.enabled,
    isSmokeDefault: dto.isSmokeDefault,
    notes: dto.notes ?? undefined
  };
}

export function debugAdminParameterToDto(draft: DebugAdminParameterDraft): DebugAdminParameterWriteDto {
  return {
    projectId: draft.projectId ?? null,
    name: draft.name,
    key: draft.key,
    description: draft.description,
    module: draft.module,
    nodePath: draft.nodePath,
    accessMode: draft.accessMode,
    unit: draft.unit,
    range: draft.range,
    minValue: draft.minValue ?? null,
    maxValue: draft.maxValue ?? null,
    risk: draft.risk,
    currentValue: draft.currentValue,
    targetValue: draft.targetValue,
    sortOrder: draft.sortOrder,
    enabled: draft.enabled,
    bindings: draft.bindings.map((binding) => ({
      protocol: binding.protocol,
      nodePath: binding.nodePath,
      accessMode: binding.accessMode,
      enabled: binding.enabled,
      notes: binding.notes
    }))
  };
}
