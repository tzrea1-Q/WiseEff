/**
 * Ensure instance-level parameter_modules rows exist during ingest and resolve
 * binding.module_id to the instance module (not only the driver group).
 */

import {
  BOARD_INSTANCE_MODULE_NAME,
  businessCategoryForNodePath,
  driverGroupDisplayNameFromCompatible,
  isModuleScaffoldingNode,
  isScaffoldingDriverLabel,
} from "./modulePlacement";
import { createParameterModule, getParameterModuleById } from "../parameters/parameterModuleRepository";
import type { Queryable } from "../../shared/database/client";
import {
  resolveModuleIdForBinding,
  unclassifiedModuleId,
  type ModuleBindingMatchKind,
} from "./resolveModuleForBinding";

const PROVISIONAL_UNCLASSIFIED_PREFIX = "未分类 · ";

function normalizeMatchValue(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}

function displayInstanceName(instanceName: string | null | undefined): string | null {
  if (!instanceName) return null;
  const trimmed = instanceName.trim();
  return trimmed === "" ? null : trimmed;
}

function parentLocator(locator: string | null | undefined): string | null {
  if (!locator) return null;
  const trimmed = locator.startsWith("/") ? locator.slice(1) : locator;
  if (!trimmed) return null;
  const idx = trimmed.lastIndexOf("/");
  if (idx < 0) return "/";
  return `/${trimmed.slice(0, idx)}`;
}

function leafSegment(locator: string): string {
  const trimmed = locator.startsWith("/") ? locator.slice(1) : locator;
  return trimmed.split("/").filter(Boolean).at(-1) ?? "";
}

function nodePathFromLocator(locator: string | null | undefined): string {
  if (!locator || locator === "/") return "";
  return locator.startsWith("/") ? locator.slice(1) : locator;
}

async function findMappedModuleId(
  db: Queryable,
  input: { organizationId: string; matchKind: ModuleBindingMatchKind; matchValue: string },
): Promise<string | null> {
  const result = await db.query<{ parameter_module_id: string }>(
    `
    select mm.parameter_module_id
    from parameter_module_mappings mm
    inner join parameter_modules pm
      on pm.id = mm.parameter_module_id and pm.organization_id = mm.organization_id
    where mm.organization_id = $1
      and mm.match_kind = $2
      and lower(mm.match_value) = $3
    order by mm.priority desc
    limit 1
    `,
    [input.organizationId, input.matchKind, input.matchValue],
  );
  return result.rows[0]?.parameter_module_id ?? null;
}

async function findModuleIdByName(
  db: Queryable,
  input: { organizationId: string; name: string; parentId?: string | null },
): Promise<string | null> {
  const parentId = input.parentId ?? null;
  const result = await db.query<{ id: string }>(
    `
    select id
    from parameter_modules
    where organization_id = $1
      and name = $2
      and coalesce(parent_id, '') = coalesce($3::text, '')
    limit 1
    `,
    [input.organizationId, input.name, parentId],
  );
  return result.rows[0]?.id ?? null;
}

async function ensureNamedModule(
  db: Queryable,
  input: {
    organizationId: string;
    name: string;
    parentId: string | null;
    description?: string;
    scope?: string;
  },
): Promise<string> {
  const existing = await findModuleIdByName(db, {
    organizationId: input.organizationId,
    name: input.name,
    parentId: input.parentId,
  });
  if (existing) return existing;

  const created = await createParameterModule(db, {
    organizationId: input.organizationId,
    name: input.name,
    parentId: input.parentId,
    description: input.description ?? "",
    scope: input.scope ?? "",
  });
  return created.id;
}

async function ensureBusinessLeafModuleId(
  db: Queryable,
  input: { organizationId: string; businessCategory: string },
): Promise<string> {
  const existing = await findModuleIdByName(db, {
    organizationId: input.organizationId,
    name: input.businessCategory,
  });
  if (existing) return existing;
  return resolveModuleIdForBinding(db, {
    organizationId: input.organizationId,
    driverModule: null,
    compatible: null,
    instanceName: null,
  });
}

async function ensureProvisionalUnclassifiedModule(
  db: Queryable,
  input: { organizationId: string; label: string },
): Promise<string> {
  await resolveModuleIdForBinding(db, {
    organizationId: input.organizationId,
    driverModule: null,
    compatible: null,
    instanceName: null,
  });
  const moduleName = `${PROVISIONAL_UNCLASSIFIED_PREFIX}${input.label}`;
  return ensureNamedModule(db, {
    organizationId: input.organizationId,
    name: moduleName,
    parentId: unclassifiedModuleId(input.organizationId),
    description: "待管理员配置模块归属的临时分组。",
    scope: input.label,
  });
}

async function resolveTypeCParentModuleId(
  db: Queryable,
  input: {
    organizationId: string;
    nodeLocator: string | null | undefined;
    instanceName: string | null;
  },
): Promise<string> {
  let cursor = parentLocator(input.nodeLocator);
  while (cursor) {
    if (cursor === "/") break;
    const segment = leafSegment(cursor);
    const nodePath = nodePathFromLocator(cursor);
    if (!isModuleScaffoldingNode({ name: segment, nodePath })) {
      return resolveBindingInstanceModuleId(db, {
        organizationId: input.organizationId,
        driverModule: null,
        compatible: null,
        instanceName: segment,
        nodeLocator: cursor,
      });
    }
    cursor = parentLocator(cursor);
  }

  const businessCategory = businessCategoryForNodePath(nodePathFromLocator(input.nodeLocator));
  return ensureBusinessLeafModuleId(db, {
    organizationId: input.organizationId,
    businessCategory,
  });
}

/**
 * Resolve (and when needed, create) the durable instance module for a binding write.
 */
export async function resolveBindingInstanceModuleId(
  db: Queryable,
  input: {
    organizationId: string;
    driverModule: string | null;
    compatible: string | null;
    instanceName: string | null;
    nodeLocator?: string | null;
  },
): Promise<string> {
  const normalizedInstance = normalizeMatchValue(input.instanceName);
  const displayInstance = displayInstanceName(input.instanceName);
  const normalizedCompatible = normalizeMatchValue(input.compatible);

  if (normalizedInstance) {
    const mappedInstance = await findMappedModuleId(db, {
      organizationId: input.organizationId,
      matchKind: "instance",
      matchValue: normalizedInstance,
    });
    if (mappedInstance) return mappedInstance;
  }

  if (normalizedCompatible) {
    const groupModuleId = await findMappedModuleId(db, {
      organizationId: input.organizationId,
      matchKind: "compatible",
      matchValue: normalizedCompatible,
    });
    if (groupModuleId) {
      const groupModule = await getParameterModuleById(db, {
        organizationId: input.organizationId,
        moduleId: groupModuleId,
      });
      const instanceModuleName = displayInstance ?? input.driverModule ?? "unknown";
      if (groupModule?.name === instanceModuleName) {
        return groupModuleId;
      }
      return ensureNamedModule(db, {
        organizationId: input.organizationId,
        name: instanceModuleName,
        parentId: groupModuleId,
        description: `${instanceModuleName} DTS 实例模块。`,
        scope: `实例 ${instanceModuleName}`,
      });
    }

    const label =
      driverGroupDisplayNameFromCompatible(normalizedCompatible) ||
      displayInstance ||
      input.driverModule ||
      "unknown";
    // Scaffolding drivers (amba/gic/gpio/spmi/…) are not a WiseEff parameter surface —
    // park on the org「未分类」root without creating「未分类 · {driver}」buckets.
    if (
      isScaffoldingDriverLabel(label) ||
      isScaffoldingDriverLabel(normalizedCompatible) ||
      isScaffoldingDriverLabel(input.driverModule) ||
      isModuleScaffoldingNode({
        name: displayInstance ?? input.driverModule ?? label,
        compatible: input.compatible,
        nodePath: nodePathFromLocator(input.nodeLocator),
      })
    ) {
      return resolveModuleIdForBinding(db, {
        organizationId: input.organizationId,
        driverModule: null,
        compatible: null,
        instanceName: null,
      });
    }
    return ensureProvisionalUnclassifiedModule(db, {
      organizationId: input.organizationId,
      label,
    });
  }

  if (displayInstance) {
    if (displayInstance === BOARD_INSTANCE_MODULE_NAME) {
      const boardParentId = await ensureBusinessLeafModuleId(db, {
        organizationId: input.organizationId,
        businessCategory: "Board Identity",
      });
      return ensureNamedModule(db, {
        organizationId: input.organizationId,
        name: BOARD_INSTANCE_MODULE_NAME,
        parentId: boardParentId,
      });
    }

    const parentModuleId = await resolveTypeCParentModuleId(db, {
      organizationId: input.organizationId,
      nodeLocator: input.nodeLocator,
      instanceName: input.instanceName,
    });
    const parentModule = await getParameterModuleById(db, {
      organizationId: input.organizationId,
      moduleId: parentModuleId,
    });
    if (parentModule?.name === displayInstance) {
      return parentModuleId;
    }

    return ensureNamedModule(db, {
      organizationId: input.organizationId,
      name: displayInstance,
      parentId: parentModuleId,
      description: `${displayInstance} DTS 实例模块。`,
      scope: `实例 ${displayInstance}`,
    });
  }

  return resolveModuleIdForBinding(db, {
    organizationId: input.organizationId,
    driverModule: input.driverModule,
    compatible: input.compatible,
    instanceName: input.instanceName,
  });
}
