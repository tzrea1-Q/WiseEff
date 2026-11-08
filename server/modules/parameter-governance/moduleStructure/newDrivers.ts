import { createHash } from "node:crypto";
import type pg from "pg";
import type { z } from "zod";
import { ApiError } from "../../../shared/http/errors";
import { parseCanonicalCompatibleSelector } from "../../parameter-catalog-contract";
import type { moduleStructureDriverCreationSchema, moduleStructureUpdateDocumentSchema } from "../../contracts/dtoSchemas/moduleStructure";
import { observeModuleDriverPublication } from "../../catalog-publication/moduleStructureDrivers";

export type DriverCreation = z.infer<typeof moduleStructureDriverCreationSchema>;
type Document = z.infer<typeof moduleStructureUpdateDocumentSchema>;
export type DriverBatch = { declarations_digest: string; declarations: NonNullable<Document["newDrivers"]>;
  candidate_id: string; job_id: string; allocated_subjects: Record<string, string>; applied_receipt: unknown };

export function driverDeclarationsDigest(drivers: NonNullable<Document["newDrivers"]>) {
  return createHash("sha256").update(JSON.stringify(drivers.map(driver => ({ ref: driver.ref, compatible: driver.compatible,
    driverNature: driver.driverNature, instanceCardinality: driver.instanceCardinality })).sort((a, b) => a.ref.localeCompare(b.ref)))).digest("hex");
}

export function invalidNewDriver(index: number, field: string, message: string, hint: string, received?: unknown): never {
  throw new ApiError("VALIDATION_FAILED", "新增驱动未通过校验，请按字段诊断修复。", { reason: "invalid-new-driver",
    issues: [{ path: `document.newDrivers.${index}${field ? `.${field}` : ""}`, code: "invalid-new-driver", message, hint,
      ...(received === undefined ? {} : { received }) }] });
}

export async function inspectNewDrivers(client: pg.PoolClient, organizationId: string, document: Document): Promise<DriverCreation | undefined> {
  const drivers = document.newDrivers ?? [];
  if (!drivers.length) return undefined;
  const refs = new Set<string>(), compatibles = new Set<string>();
  for (const [index, driver] of drivers.entries()) {
    if (driver.ref.trim() !== driver.ref || /[\u0000-\u001f\u007f]/u.test(driver.ref) || refs.has(driver.ref))
      invalidNewDriver(index, "ref", "新增驱动 ref 必须唯一且不含首尾空白或控制字符。", "为每个新增驱动提供独立、稳定的包内 ref。", driver.ref);
    refs.add(driver.ref);
    const parsed = parseCanonicalCompatibleSelector(driver.compatible);
    if (!parsed.ok || parsed.value !== driver.compatible) invalidNewDriver(index, "compatible", "compatible 必须是一个精确、合法的驱动标识。", "填写源码中的单个 compatible 字符串；不要填写通配符、数组或节点名。", driver.compatible);
    if (compatibles.has(driver.compatible)) invalidNewDriver(index, "compatible", "同一文件不能重复创建相同 compatible 的驱动。", "合并重复声明，每个 compatible 仅保留一项。", driver.compatible);
    compatibles.add(driver.compatible);
    if (driver.displayAlias !== undefined && driver.displayAlias !== null && (driver.displayAlias !== driver.displayAlias.trim()
      || /[\u0000-\u001f\u007f-\u009f]/u.test(driver.displayAlias)))
      invalidNewDriver(index, "displayAlias", "展示别名不能包含首尾空白或控制字符。", "填写正常显示名称，或使用 null。", driver.displayAlias);
  }
  const batch = (await client.query<DriverBatch>(`select declarations_digest,declarations,candidate_id,job_id,allocated_subjects,applied_receipt
    from parameter_catalog.module_structure_driver_publications where organization_id=$1 and export_id=$2`, [organizationId, document.source.exportId])).rows[0];
  if (batch && batch.declarations_digest !== driverDeclarationsDigest(drivers))
    invalidNewDriver(0, "", "此导出包的新增驱动已经进入发布，不能替换声明。", "使用原文件继续；如需不同驱动，请重新导出后编辑新文件。");
  const collision = await client.query<{ subject_id: string; compatible: string }>(`select s.id as subject_id, offered.compatible
    from unnest($1::text[]) offered(compatible) join parameter_catalog.catalog_subjects s on s.canonical_key='driver:' || offered.compatible
    union select rs.subject_id, offered.compatible from unnest($1::text[]) offered(compatible)
      join parameter_catalog.catalog_release_subjects rs on rs.selector_snapshot->'values' ? offered.compatible
      join parameter_catalog.catalog_state cs on cs.current_catalog_release_id=rs.release_id
    union select a.subject_id, a.normalized_selector from parameter_catalog.catalog_subject_aliases a
      where a.selector_kind='driver-compatible' and a.normalized_selector=any($1::text[])
    union select r.subject_id, offered.compatible from unnest($1::text[]) offered(compatible)
      join public.registration_recognition_rules rr on offered.compatible=any(rr.compatibles) and rr.organization_id=$2
      join parameter_catalog.organization_subject_registrations r on r.id=rr.registration_id and r.organization_id=rr.organization_id`, [[...compatibles], organizationId]);
  for (const match of collision.rows) {
    const index = drivers.findIndex(driver => driver.compatible === match.compatible);
    if (index >= 0 && (!batch || !Object.hasOwn(batch.allocated_subjects, drivers[index]!.ref)
      || batch.allocated_subjects[drivers[index]!.ref] !== match.subject_id))
      invalidNewDriver(index, "compatible", "该 compatible 已被已有主体使用，不能另建重复驱动。", `将已有 subjectId「${match.subject_id}」放入 subjects 进行登记或调整归属；如标识有误，请修正 compatible。`, match.compatible);
  }
  if (!batch) return { phase: "required", drivers };
  const mapped = drivers.map(driver => ({ ...driver, subjectId: Object.hasOwn(batch.allocated_subjects, driver.ref) ? batch.allocated_subjects[driver.ref] : undefined }));
  if (mapped.some(driver => !driver.subjectId)) throw new ApiError("CONFLICT", "新增驱动身份映射不完整，请联系管理员。");
  const observed = await observeModuleDriverPublication(client, organizationId, batch.candidate_id, batch.job_id);
  if (observed.phase === "ready") {
    for (const driver of mapped) {
      const allocation = Array.isArray(observed.allocation) ? observed.allocation.find(entry => entry && typeof entry === "object" && !Array.isArray(entry)
        && entry.canonicalKey === `driver:${driver.compatible}` && entry.subjectId === driver.subjectId) : null;
      if (!allocation) throw new ApiError("CONFLICT", "新增驱动发布回执与身份映射不一致。");
    }
    if (!batch.applied_receipt) {
      const current = await client.query<{ subject_id: string; kind: string; owner_subject_id: string | null; lifecycle: string; selector_snapshot: { values?: string[] }; nature: string; cardinality: string }>(
        `select rs.subject_id,s.kind,s.owner_subject_id,rs.lifecycle,rs.selector_snapshot,d.nature,d.cardinality
         from parameter_catalog.catalog_release_subjects rs
         join parameter_catalog.catalog_state cs on cs.current_catalog_release_id=rs.release_id
         join parameter_catalog.catalog_subjects s on s.id=rs.subject_id
         left join parameter_catalog.catalog_drivers d on d.subject_id=s.id where rs.subject_id=any($1::text[])`, [mapped.map(driver => driver.subjectId!)]);
      for (const [index, driver] of mapped.entries()) {
        const subject = current.rows.find(row => row.subject_id === driver.subjectId);
        if (!subject || subject.kind !== "driver" || subject.owner_subject_id !== null || subject.lifecycle !== "active" || !subject.selector_snapshot.values?.includes(driver.compatible)
          || subject.nature !== driver.driverNature || subject.cardinality !== driver.instanceCardinality)
          invalidNewDriver(index, "", "发布后的驱动身份或识别属性已变化，不能继续按旧声明登记。", `重新导出并核对已有主体「${driver.subjectId}」，再通过 subjects 登记或调整归属。`);
      }
    }
  }
  return { phase: batch.applied_receipt && observed.phase === "ready" ? "applied" : observed.phase, drivers: mapped,
    candidateId: batch.candidate_id, jobId: batch.job_id, ...("message" in observed ? { message: observed.message } : {}) };
}

export function assertNewDriverDestinations(creation: DriverCreation | undefined, moduleIds: Map<string, string>,
  existingBusinessIds: Set<string>, newIds: Set<string>, deleted: Set<string>) {
  if (!creation || creation.phase === "applied") return;
  for (const [index, driver] of creation.drivers.entries()) {
    const ref = driver.placement.moduleRef, id = moduleIds.get(ref);
    if (!id || deleted.has(id) || (!existingBusinessIds.has(id) && !newIds.has(id)))
      invalidNewDriver(index, "placement.moduleRef", "新增驱动必须归属到本组织已有或本文件新增的有效业务模块。", "引用 modules 中的 ref；目标不能是技术模块、已归档模块或本次删除的模块。", ref);
  }
}
