import { createHash } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { listDebugNodeModules } from "./debugNodeModuleRepository";

/** Caller holds the organization catalog writer fence for this snapshot and its mutation. */
export async function inspectDebugModuleDeletion(tx: Queryable, organizationId: string, moduleId: string, targetModuleId: string | null) {
  const modules = await listDebugNodeModules(tx, { organizationId });
  const module = modules.find(item => item.id === moduleId);
  if (!module) throw new ApiError("NOT_FOUND", "Debug module was not found.");
  if (targetModuleId === moduleId) throw new ApiError("VALIDATION_FAILED", "不能迁移到正在删除的模块。");
  const target = targetModuleId ? modules.find(item => item.id === targetModuleId) : null;
  if (targetModuleId && !target) throw new ApiError("NOT_FOUND", "目标模块不存在或不属于本组织。");
  const nodes = (await tx.query<{ id: string; name: string; module: string; module_id: string | null; updated_at: string }>(
    `select id,name,module,debug_node_module_id as module_id,updated_at::text
       from public.debug_nodes where organization_id=$1 and (debug_node_module_id=$2
         or (debug_node_module_id is null and trim(module)=trim($3))) order by id`, [organizationId, moduleId, module.name])).rows;
  const children = modules.filter(item => item.parentId === moduleId);
  const sameName = modules.filter(item => item.name.trim() === module.name.trim());
  const legacy = nodes.filter(item => item.module_id === null);
  const ambiguousNodes = sameName.length > 1 ? legacy.map(({ id, name }) => ({ id, name })) : [];
  const previewDigest = `sha256:${createHash("sha256").update(JSON.stringify({ organizationId, module, target: target ?? null,
    nodes, children, sameName })).digest("hex")}`;
  return {
    nodeIds: nodes.map(item => item.id),
    preview: { module: { id: module.id, name: module.name }, target: target ? { id: target.id, name: target.name } : null,
      nodeCount: nodes.length, legacyNodeCount: legacy.length, children: children.map(({ id, name }) => ({ id, name })),
      ambiguousNodes, canDelete: children.length === 0 && ambiguousNodes.length === 0, previewDigest }
  };
}
