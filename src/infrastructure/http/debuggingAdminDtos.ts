import type {
  DebugConnectionProtocol,
  DebugNodeProtocolBinding,
  DebugNodeRegistryEntry,
  DebugParameterAccessMode
} from "@/domain/debugging/types";
import { legacyModuleIdFromName, type FlatModuleNode } from "@/domain/modules/moduleTree";
import type { ParameterModuleDraft } from "@/powerManagementConfig";

export type DebugAdminBindingDto = {
  protocol: DebugConnectionProtocol;
  nodePath: string;
  accessMode: DebugParameterAccessMode;
  enabled: boolean;
  isSmokeDefault?: boolean;
  notes?: string | null;
};

export type DebugAdminBindingWriteDto = {
  nodePath: string;
  accessMode: DebugParameterAccessMode;
  enabled: boolean;
  notes?: string;
};

export type DebugAdminNodeBindingWriteDto = DebugAdminBindingWriteDto & {
  protocol: DebugConnectionProtocol;
};

export type DebugAdminNodeDto = {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  detailedDescription?: string;
  writeFormatExample?: string;
  writeFormatHint?: string;
  module: string;
  moduleId?: string;
  modulePath?: string[];
  enabled: boolean;
  archivedAt: string | null;
  archivedBy: string | null;
  archiveReason: string | null;
  bindings?: DebugAdminBindingDto[];
};

export type DebugAdminNodeWriteDto = {
  name: string;
  description?: string;
  detailedDescription?: string;
  writeFormatExample?: string;
  writeFormatHint?: string;
  module?: string;
  moduleId?: string;
  enabled: boolean;
  bindings?: DebugAdminNodeBindingWriteDto[];
};

export type DebugAdminModuleDto = FlatModuleNode;

export function debugAdminModuleFromDto(dto: DebugAdminModuleDto): FlatModuleNode {
  const id = dto.id ?? legacyModuleIdFromName(dto.name);
  return {
    ...dto,
    id,
    parentId: dto.parentId ?? null,
    path: dto.path ?? id,
    depth: dto.depth ?? (dto.parentId ? 1 : 0)
  };
}

export function debugAdminModuleToDto(
  draft: ParameterModuleDraft & { parentId?: string | null; sortOrder?: number }
): Pick<DebugAdminModuleDto, "name" | "description" | "scope" | "parentId" | "sortOrder"> {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    scope: draft.scope.trim(),
    parentId: draft.parentId ?? null,
    sortOrder: draft.sortOrder
  };
}

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
    name: dto.name,
    description: dto.description,
    detailedDescription: dto.detailedDescription ?? "",
    writeFormatExample: dto.writeFormatExample ?? "",
    writeFormatHint: dto.writeFormatHint ?? "",
    module: dto.module,
    moduleId: dto.moduleId,
    modulePath: dto.modulePath,
    enabled: dto.enabled,
    bindings: dto.bindings?.map(debugAdminNodeBindingFromDto) ?? []
  };
}
