import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { parseDts, resolveDtsConfigSetAsync } from "../dts";
import { ensureOverlayProperty } from "../parameter-topology/overlayWriteback";
import { isStructuralPropertyKey } from "../parameter-topology/parameterSurface";
import { parameterOrganizationId } from "../parameters/operatingScope";
import { assertProjectSourceWritable, getProjectParameterFileById } from "./repository";
import { loadExactSourceRevisionForProof } from "./sourceVersion";
import { requireCurrentSourceEditor, sourceRevisionDigest } from "./sourceRevisionService";
import { canAdminParameters } from "../parameter-kernel/policy";
import { readOwnedCurrentBinding, loadOwnedProjectValueSourcePin } from "../parameter-bindings/values";
import { assertTrustedSensitiveNodeWriteAllowed } from "../parameter-kernel/sensitiveNode";
import { canonicalizeLogicalNodeCompatible } from "../parameter-topology/writeLock";
import { requireCanonicalUserInvocation, type CanonicalSourceSecurityContext } from "./canonicalSource";
import type { z } from "zod";
import type { projectLocalOverrideRequestSchema } from "../contracts/dtoSchemas/sourceRevision";

/** Prepare an ordinary project source draft. Existing candidate/review/apply owns every durable write. */
export async function prepareProjectLocalOverride(db: Database, storage: ObjectStore, auth: AuthContext,
  input: z.infer<typeof projectLocalOverrideRequestSchema> & { projectId: string; configSetId: string },
  security?: CanonicalSourceSecurityContext, inTransaction = false) {
  if (security) await requireCanonicalUserInvocation(auth, security, { projectId: input.projectId, operation: "prepare project local override",
    targetType: "dts-config-set", targetId: input.configSetId });
  const prepare = async (tx: Database) => {
    auth = await requireCurrentSourceEditor(tx, auth, input.projectId);
    const organizationId = parameterOrganizationId(auth);
    const current = (await tx.query<{ id: string }>(`select id from public.dts_config_revisions
      where organization_id=$1 and project_id=$2 and config_set_id=$3 and status in ('resolved','validated','compiled','pending_approval')
      order by revision_number desc limit 1`, [organizationId, input.projectId, input.configSetId])).rows[0];
    if (!current || current.id !== input.expectedConfigRevisionId) throw new ApiError("CONFLICT", "配置已变化，请刷新生效配置后重试。", { reason: "source-revision-stale" });
    if (isStructuralPropertyKey(input.propertyName)) throw new ApiError("VALIDATION_FAILED", "此属性需要节点或身份操作，请通过原始源码修正。", { reason: "structural-property" });
    const node = (await tx.query<{ node_locator: string }>(`select node_locator from public.dts_logical_node_revisions
      where config_revision_id=$1 and logical_node_id=$2`, [current.id, input.logicalNodeId])).rows[0];
    const first = (await tx.query<{ file_id: string; file_version_id: string }>(`select file_id,file_version_id
      from public.dts_config_revision_members where config_revision_id=$1 order by sort_order,id limit 1`, [current.id])).rows[0];
    if (!node || !first) throw new ApiError("NOT_FOUND", "此配置修订中没有所选节点。");
    const bindings = (await tx.query<{ id: string }>(`select binding.id from parameter_catalog.project_parameter_bindings binding
      join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
      join parameter_catalog.parameter_definitions definition on definition.id=binding.definition_id
      where binding.organization_id=$1 and binding.project_id=$2 and occurrence.config_set_id=$3
        and occurrence.logical_node_id=$4 and definition.property_key=$5 and not parameter_catalog.is_replaced_current_binding(binding.id)`,
      [organizationId, input.projectId, input.configSetId, input.logicalNodeId, input.propertyName])).rows;
    const matched = bindings.length === 1 ? await readOwnedCurrentBinding(tx, { organizationId, projectId: input.projectId, bindingId: bindings[0]!.id }) : null;
    const pin = matched?.status === "current" ? await loadOwnedProjectValueSourcePin(tx, { organizationId, projectId: input.projectId,
      bindingId: matched.binding.id, projectValueId: matched.binding.currentValueId }) : null;
    const binding = matched?.status === "current" && pin?.valueState === "present" && pin.configRevisionId === current.id
      ? { bindingId: matched.binding.id, definitionId: matched.binding.definitionId, oldValueId: matched.binding.currentValueId, sourcePinId: pin.sourcePinId } : undefined;
    if (!canAdminParameters(auth) && !binding) throw new ApiError("FORBIDDEN", "此属性没有可编辑的正式参数关联，请由有权限的管理员通过项目原始源码修正。", { reason: "local-override-binding-required" });
    const exact = await loadExactSourceRevisionForProof(tx, storage, { organizationId, projectId: input.projectId,
      configSetId: input.configSetId, configRevisionId: current.id, fileId: first.file_id, fileVersionId: first.file_version_id });
    const { revision, members } = exact;
    if (!revision.entryFile) throw new ApiError("CONFLICT", "配置缺少真实项目入口。");
    const files = new Map(members.filter(member => member.format === "dts").map(member => [member.sourceName, { content: member.content, fileVersionId: member.fileVersionId }]));
    const resolve = () => resolveDtsConfigSetAsync({ entryFile: revision.entryFile!, includeSearchPaths: revision.includeSearchPaths,
      defines: revision.preprocessing?.defines,
      overlayOrder: revision.overlayOrder, requireExactOrigins: true, files });
    const beforeGraph = await resolve();
    if (beforeGraph.diagnostics.some(row => row.severity === "error")) throw new ApiError("CONFLICT", "配置来源无法精确解析，请打开项目原始源码修正。", { reason: "override-origin-ambiguous" });
    const property = beforeGraph.effective.nodesByLocator.get(node.node_locator)?.properties.get(input.propertyName);
    if (security) await assertTrustedSensitiveNodeWriteAllowed(tx, auth, { organizationId, projectId: input.projectId,
      nodePath: node.node_locator, sourcePath: { kind: "node-locator", value: node.node_locator },
      compatible: canonicalizeLogicalNodeCompatible(beforeGraph.effective.nodesByLocator.get(node.node_locator)?.properties.get("compatible")?.rawText ?? null),
      compatibleIsAuthoritative: true, invocation: security.invocation, requestId: security.requestId, refusalSink: security.refusalSink });
    const origin = property?.sourceChain.at(-1);
    const originMember = members.find(member => member.sourceName === origin?.fileName);
    if (!property || property.deleted || !originMember) throw new ApiError("CONFLICT", "所选属性没有可覆盖的生效声明。");
    const privateOrigin = !originMember.sharedReference;
    const target = input.action === "remove-override" ? originMember
      : input.targetFileId ? members.find(member => member.fileId === input.targetFileId)
      : privateOrigin ? originMember
      : [...revision.overlayOrder].reverse().map(name => members.find(member => member.sourceName === name && !member.sharedReference)).find(Boolean)
        ?? members.find(member => member.sourceName === revision.entryFile && !member.sharedReference);
    if (!target || target.format !== "dts" || target.sharedReference || /\.(h|hpp)$/u.test(target.sourceName)) {
      throw new ApiError("CONFLICT", "请在配置组成中提供项目自有 DTS 入口或覆盖成员后重试。", { reason: "project-override-target-required" });
    }
    await assertProjectSourceWritable(tx, target.fileId);
    if (input.action === "remove-override" && (!privateOrigin || !origin?.origin)) {
      throw new ApiError("CONFLICT", "撤销覆盖需要精确的本项目原始声明；宏来源含糊时请打开项目原始源码修正。", { reason: "override-origin-ambiguous" });
    }
    const physical = (await tx.query<{ id: string }>(`select property.id from public.dts_property_occurrences property
      join public.dts_occurrence_effects effect on effect.property_occurrence_id=property.id
      join public.dts_logical_node_revisions logical on logical.id=effect.logical_node_revision_id
      where effect.config_revision_id=$1 and logical.logical_node_id=$2 and effect.property_name=$3
      order by effect.source_order desc limit 1`, [current.id, input.logicalNodeId, input.propertyName])).rows[0];
    if (input.propertyOccurrenceId && physical?.id !== input.propertyOccurrenceId) throw new ApiError("CONFLICT", "属性来源已变化，请重新选择。");
    const rawText = input.rawText ?? "";
    if (input.action === "set") {
      let check;
      try { check = parseDts(`/ { ${input.propertyName}${rawText.trim() ? ` = ${rawText}` : ""}; };`).topLevel[0]?.children; }
      catch { throw new ApiError("VALIDATION_FAILED", "请输入单个有效的 DTS 属性值。"); }
      if (check?.length !== 1 || check[0]?.kind !== "property" || check[0].name !== input.propertyName || check[0].rawText.trim() !== rawText.trim()) {
        throw new ApiError("VALIDATION_FAILED", "请输入单个有效的 DTS 属性值。");
      }
    }
    const sameOrigin = target.fileId === originMember.fileId;
    if (sameOrigin && !origin?.origin) throw new ApiError("CONFLICT", "属性原始位置含糊，请打开项目原始源码修正，或选择单独的项目覆盖成员。", { reason: "override-origin-ambiguous" });
    const before = target.content;
    const patch = { propertyKey: input.propertyName, rawText, action: input.action, targetRef: `{${node.node_locator}}` };
    const after = sameOrigin ? ensureOverlayProperty(before, { ...patch, expectedChecksum: sourceRevisionDigest(Buffer.from(before)),
      occurrenceSpan: origin!.origin!, expectedRawText: origin!.rawText,
      preparedDocument: beforeGraph.preprocessing?.originalDocuments.get(target.sourceName) })
      : before + ensureOverlayProperty("", { ...patch, expectedChecksum: sourceRevisionDigest("") });
    files.set(target.sourceName, { content: after, fileVersionId: target.fileVersionId });
    const afterGraph = await resolve();
    const afterProperty = afterGraph.effective.nodesByLocator.get(node.node_locator)?.properties.get(input.propertyName);
    if (afterGraph.diagnostics.some(row => row.severity === "error") || (input.action === "set" && (!afterProperty || afterProperty.deleted
      || afterProperty.sourceChain.at(-1)?.fileName !== target.sourceName || afterProperty.rawText.trim() !== rawText.trim()))) {
      throw new ApiError("CONFLICT", "所选项目成员无法形成精确的生效覆盖，请检查入口和覆盖顺序。", { reason: "project-override-target-required" });
    }
    const file = await getProjectParameterFileById(tx, { organizationId, fileId: target.fileId });
    if (!file || file.projectId !== input.projectId) throw new ApiError("NOT_FOUND", "项目覆盖文件不存在。");
    return { fileId: target.fileId, fileName: file.fileName, baseVersionId: target.fileVersionId, configRevisionId: current.id,
      before, after, beforeValue: property.rawText, afterValue: afterProperty && !afterProperty.deleted ? afterProperty.rawText : null, action: input.action, binding };
  };
  return inTransaction ? prepare(db) : db.transaction(prepare);
}
