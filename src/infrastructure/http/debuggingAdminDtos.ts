import type {
  DebugAdminParameterDraft,
  DebugConnectionProtocol,
  DebugNodeProtocolBinding,
  DebugNodeRegistryEntry,
  DebugParameter,
  DebugParameterAccessMode,
  DebugParameterNodeBinding,
  ParameterReloadBinding
} from "@/domain/debugging/types";
import { resolveDebugValueMetadata } from "@/debugValueKind";
import type {
  DebugNormalizationMode,
  DebugValueFormat,
  DebugValueKind
} from "@/debugValueKind";
import type { RiskLevel } from "@/domain/parameters/types";
import type { ParameterModuleDraft, PowerManagementParameterModule } from "@/powerManagementConfig";

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
  valueKind?: DebugValueKind;
  valueFormat?: DebugValueFormat;
  normalizationMode?: DebugNormalizationMode;
  maxValueBytes?: number | null;
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
  valueKind?: DebugValueKind;
  valueFormat?: DebugValueFormat;
  normalizationMode?: DebugNormalizationMode;
  maxValueBytes?: number | null;
};

function preferredBinding(dto: DebugAdminParameterDto) {
  if (dto.selectedBinding?.enabled) return dto.selectedBinding;
  const bindings = dto.bindings ?? [];
  return bindings.find((binding) => binding.enabled) ?? bindings[0];
}

export function debugAdminParameterFromDto(dto: DebugAdminParameterDto): DebugParameter {
  const binding = preferredBinding(dto);
  const valueMetadata = resolveDebugValueMetadata(dto);

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
    bindings: dto.bindings?.map(debugAdminBindingFromDto) ?? [],
    valueKind: valueMetadata.valueKind,
    valueFormat: valueMetadata.valueFormat,
    normalizationMode: valueMetadata.normalizationMode,
    maxValueBytes: valueMetadata.maxValueBytes ?? null
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
  const valueMetadata = resolveDebugValueMetadata(draft);

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
    valueKind: valueMetadata.valueKind,
    valueFormat: valueMetadata.valueFormat,
    normalizationMode: valueMetadata.normalizationMode,
    maxValueBytes: valueMetadata.maxValueBytes ?? null,
    bindings: draft.bindings.map((binding) => ({
      protocol: binding.protocol,
      nodePath: binding.nodePath,
      accessMode: binding.accessMode,
      enabled: binding.enabled,
      notes: binding.notes
    }))
  };
}

export type DebugAdminNodeDto = {
  id: string;
  organizationId: string;
  projectId: string | null;
  name: string;
  description: string;
  detailedDescription?: string;
  module: string;
  enabled: boolean;
  archivedAt: string | null;
  archivedBy: string | null;
  archiveReason: string | null;
  bindings?: DebugAdminBindingDto[];
};

export type DebugAdminNodeWriteDto = {
  projectId: string | null;
  name: string;
  description?: string;
  detailedDescription?: string;
  module: string;
  enabled: boolean;
  bindings?: DebugAdminParameterBindingWriteDto[];
};

export type DebugAdminModuleDto = {
  name: string;
  description: string;
  scope: string;
};

export function debugAdminModuleFromDto(dto: DebugAdminModuleDto): PowerManagementParameterModule {
  return {
    name: dto.name,
    description: dto.description,
    scope: dto.scope
  };
}

export function debugAdminModuleToDto(draft: ParameterModuleDraft): DebugAdminModuleDto {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    scope: draft.scope.trim()
  };
}

export type DebugAdminReloadBindingDto = {
  id: string;
  organizationId: string;
  projectId: string;
  parameterDefinitionId: string;
  protocol: DebugConnectionProtocol;
  nodePath: string;
  accessMode: DebugParameterAccessMode;
  enabled: boolean;
  parameterName?: string;
  parameterKey?: string;
  module?: string;
  unit?: string;
  risk?: RiskLevel;
  notes?: string | null;
};

export type DebugAdminReloadBindingWriteDto = {
  projectId: string;
  parameterDefinitionId: string;
  protocol: DebugConnectionProtocol;
  nodePath: string;
  accessMode: DebugParameterAccessMode;
  enabled: boolean;
};

export function debugAdminNodeBindingFromDto(dto: DebugAdminBindingDto): DebugNodeProtocolBinding {
  return {
    protocol: dto.protocol,
    nodePath: dto.nodePath,
    accessMode: dto.accessMode,
    enabled: dto.enabled,
    notes: dto.notes ?? undefined
  };
}

export function debugAdminNodeFromDto(dto: DebugAdminNodeDto): DebugNodeRegistryEntry {
  return {
    id: dto.id,
    projectId: dto.projectId,
    name: dto.name,
    description: dto.description,
    detailedDescription: dto.detailedDescription ?? "",
    module: dto.module,
    enabled: dto.enabled,
    bindings: dto.bindings?.map(debugAdminNodeBindingFromDto) ?? []
  };
}

export function debugAdminReloadBindingFromDto(dto: DebugAdminReloadBindingDto): ParameterReloadBinding {
  return {
    id: dto.id,
    projectId: dto.projectId,
    parameterDefinitionId: dto.parameterDefinitionId,
    parameterName: dto.parameterName,
    module: dto.module,
    unit: dto.unit,
    risk: dto.risk,
    protocol: dto.protocol,
    nodePath: dto.nodePath,
    accessMode: dto.accessMode,
    enabled: dto.enabled,
    notes: dto.notes ?? undefined
  };
}
