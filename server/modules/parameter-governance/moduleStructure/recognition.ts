import type pg from "pg";
import { createHash } from "node:crypto";
import type { z } from "zod";
import { ApiError } from "../../../shared/http/errors";
import type { Database, Queryable } from "../../../shared/database/client";
import type { TrustedInvocationContext } from "../../auth/trustedInvocation";
import { moduleStructureExportSchema, moduleStructureUpdateDocumentSchema } from "../../contracts/dtoSchemas/moduleStructure";
import { listModuleRecognitionInstances } from "../../parameter-modules/recognitionInstances";
import { readInheritedRegistrationRecognitionSettings, readRegistrationRecognitionSettings, registrationRecognitionEtag,
  resetRegistrationRecognitionSettingsInTransaction, updateRegistrationRecognitionSettingsInTransaction,
  validateRecognitionCapacity, validateRegistrationRecognitionSettings, type UpdateModuleRecognition } from "../../parameter-modules/recognitionSettings";
import { stable } from "./preview";
import type { LifecycleChange } from "./lifecycle";
import { recognitionShapeError, recognitionShapeIssues, requiredRecognitionField, withRecognitionImportContext } from "./recognitionImportDiagnostics";

type Subject = z.infer<typeof moduleStructureExportSchema>["subjects"][number];
type Edit = z.infer<typeof moduleStructureUpdateDocumentSchema>["subjects"][number];
const fields = ["compatibles", "driverNature", "instanceCardinality", "nodeTypeName"] as const;

export async function planRecognition(client: pg.PoolClient, organizationId: string, releaseId: string,
  edits: Edit[], baseline: Subject[], current: Subject[], resolutions: Record<string, "current" | "file">, lifecycle: LifecycleChange[] = []) {
  const db = client as unknown as Queryable;
  const changes: Array<{ subjectId: string; registrationId: string; ifMatch: string; mode: "inherit" | "override"; body: UpdateModuleRecognition; before: unknown; after: unknown }> = [];
  const conflicts: Array<{ key: string; moduleId: string; field: string; baseline: unknown; file: unknown; current: unknown }> = [];
  const evidence: unknown[] = [];
  for (const [index, edit] of edits.entries()) {
    const subject = current.find(s => s.subjectId === edit.subjectId) ?? baseline.find(s => s.subjectId === edit.subjectId) ?? edit;
    const base = baseline.find(s => s.subjectId === edit.subjectId)?.recognition;
    const target = current.find(s => s.subjectId === edit.subjectId)?.recognition;
    const requested = edit.recognition;
    if (requested === undefined || stable(requested) === stable(base)) continue;
    const registration = lifecycle.find(change => change.subjectId === edit.subjectId && change.operation === "register");
    if (!base && registration && requested) {
      if (registration.kind !== "configuration-schema" && requested.effective === undefined && requested.mode === "inherit" && !requested.override) continue;
      if (registration.kind === "configuration-schema" || requested.effective !== undefined || requested.mode !== "override" || !requested.override)
        throw recognitionShapeError(index, { ...subject, kind: registration.kind }, "Invalid recognition settings for a new registration.", recognitionShapeIssues(registration.kind, requested, "new"));
      const initial = { kind: registration.kind, recognitionSubjectId: edit.subjectId, compatibles: [] as string[], nodeTypeName: null,
        driverNature: null, instanceCardinality: null, overridden: false };
      const inherited = await withRecognitionImportContext(index, { ...subject, kind: registration.kind }, "effective", () => readInheritedRegistrationRecognitionSettings(db, initial, releaseId));
      const override = requested.override;
      if (registration.kind === "driver" ? override.compatibles === null || override.driverNature === null || override.instanceCardinality === null || override.nodeTypeName != null
        : override.nodeTypeName === null || override.compatibles?.length || override.driverNature != null || override.instanceCardinality != null)
        throw recognitionShapeError(index, { ...subject, kind: registration.kind }, "Recognition fields do not match this Subject kind.", recognitionShapeIssues(registration.kind, requested, "new"));
      const body = Object.fromEntries(Object.entries(registration.kind === "driver"
        ? { compatibles: override.compatibles, driverNature: override.driverNature, instanceCardinality: override.instanceCardinality }
        : { nodeTypeName: override.nodeTypeName }).filter(([, value]) => value !== undefined)) as UpdateModuleRecognition;
      const next = await withRecognitionImportContext(index, { ...subject, kind: registration.kind }, "override", () => validateRegistrationRecognitionSettings(db, organizationId, inherited, body));
      const instances = await listModuleRecognitionInstances(db, organizationId, next);
      instances.sort((a, b) => a.projectId.localeCompare(b.projectId) || a.logicalNodeId.localeCompare(b.logicalNodeId));
      const bindings = (await client.query(`select distinct project_id, coalesce(logical_node_id, source_occurrence_id) as instance_id
        from parameter_catalog.current_project_parameter_bindings where organization_id=$1 and subject_id=$2 order by project_id, instance_id`, [organizationId, edit.subjectId])).rows;
      evidence.push({ subjectId: edit.subjectId, instances, bindings });
      changes.push({ subjectId: edit.subjectId, registrationId: "", ifMatch: registrationRecognitionEtag(inherited), mode: "override", body, before: null, after: next });
      continue;
    }
    if (!base || !target || !requested) throw recognitionShapeError(index, subject, "Recognition settings do not apply to this Subject.", [{ path: "", code: "recognition-not-applicable", received: requested ?? null,
      message: "该主体没有可编辑的识别规则，或提交的 recognition 被清空。", rule: "只有具有识别规则的 driver / node-type 登记可以修改 recognition。",
      hint: "恢复原始导出的 recognition；新增主体请显式登记，configuration-schema 不应添加识别规则。" }]);
    const changedEffective = requested.effective === undefined ? [] : Object.entries(requested.effective).filter(([k, v]) => stable(v) !== stable(base.effective[k as keyof typeof base.effective]));
    if (changedEffective.length) throw recognitionShapeError(index, subject, "Effective recognition settings are read-only.", changedEffective.map(([field, received]) => ({
      path: `effective.${field}`, code: "readonly-recognition-effective", message: "此生效字段是只读导出快照。", received, expected: base.effective[field as keyof typeof base.effective],
      rule: "effective 必须保持原始导出的值；自定义规则应写入 override。", hint: "恢复此 effective 字段，或省略 effective；需要自定义时将 mode 设为 override 并编辑 override 中的对应字段。" })));
    const row = (await client.query<{ id: string }>("select id from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id=$2", [organizationId, edit.subjectId])).rows[0];
    if (!row) throw new ApiError("CONFLICT", "Subject registration no longer exists.", { path: `subjects.${index}.recognition` });
    const settings = await withRecognitionImportContext(index, subject, "effective", () => readRegistrationRecognitionSettings(db, organizationId, row.id));
    if (!settings) throw new ApiError("CONFLICT", "Subject registration no longer exists.", { path: `subjects.${index}.recognition` });
    const merge = (field: string, original: unknown, file: unknown, now: unknown) => {
      if (file === undefined || stable(file) === stable(original) || stable(file) === stable(now)) return now;
      const key = `${edit.subjectId}:recognition.${field}`;
      if (stable(now) !== stable(original) && !resolutions[key]) { conflicts.push({ key, moduleId: edit.subjectId, field: `recognition.${field}`, baseline: original, file, current: now }); return now; }
      return stable(now) !== stable(original) && resolutions[key] === "current" ? now : file;
    };
    let mode = merge("mode", base.mode, requested.mode, target.mode) as "inherit" | "override";
    if (requested.mode === "inherit" && base.mode === "override" && target.mode === "override" && stable(base.override) !== stable(target.override)) {
      const key = `${edit.subjectId}:recognition.mode`;
      if (!resolutions[key]) conflicts.push({ key, moduleId: edit.subjectId, field: "recognition.mode", baseline: base.override, file: "inherit", current: target.override });
      if (resolutions[key] !== "file") mode = "override";
    }
    const body: UpdateModuleRecognition = {};
    if (mode === "override") {
      const original = base.override ?? base.effective;
      const now = target.override ?? target.effective;
      for (const field of fields) {
        const value = merge(field, original[field], requested.override?.[field], now[field]);
        if (stable(value) !== stable(now[field])) {
          if (value === null) throw recognitionShapeError(index, subject, "Recognition fields cannot be cleared for this Subject kind.", [requiredRecognitionField(field, value)]);
          Object.assign(body, { [field]: value });
        }
      }
    } else if (requested.override && Object.keys(requested.override).length) throw recognitionShapeError(index, subject, "An inherited rule cannot have an override.", [{ path: "override", code: "inherited-rule-has-override", received: requested.override, expected: null,
      message: "inherit 模式不能同时提交覆盖字段。", rule: "继承目录规则时，override 必须为 null、空对象或省略。", hint: "将 override 改为 null；若确实需要自定义，明确设置 mode 为 override。" }]);
    if (mode === target.mode && Object.keys(body).length === 0) continue;
    let next: Awaited<ReturnType<typeof validateRegistrationRecognitionSettings>>;
    if (mode === "inherit") {
      next = await withRecognitionImportContext(index, subject, "effective", () => readInheritedRegistrationRecognitionSettings(db, settings, releaseId));
      await withRecognitionImportContext(index, subject, "effective", () => validateRecognitionCapacity(db, organizationId, next));
    } else {
      if (Object.keys(body).length === 0) Object.assign(body, settings.kind === "driver" ? { compatibles: settings.compatibles } : { nodeTypeName: settings.nodeTypeName });
      next = await withRecognitionImportContext(index, subject, "override", () => validateRegistrationRecognitionSettings(db, organizationId, settings, body));
    }
    const instances = await listModuleRecognitionInstances(db, organizationId, next);
    instances.sort((a, b) => a.projectId.localeCompare(b.projectId) || a.logicalNodeId.localeCompare(b.logicalNodeId));
    const bindings = (await client.query(`select distinct project_id, coalesce(logical_node_id, source_occurrence_id) as instance_id
      from parameter_catalog.current_project_parameter_bindings where organization_id=$1 and subject_id=$2
      order by project_id, instance_id`, [organizationId, edit.subjectId])).rows;
    evidence.push({ subjectId: edit.subjectId, instances, bindings });
    changes.push({ subjectId: edit.subjectId, registrationId: row.id, ifMatch: registrationRecognitionEtag(settings), mode, body, before: target, after: next });
  }
  return { changes, conflicts, evidence };
}

export async function applyRecognition(tx: Database, organizationId: string, releaseId: string,
  invocation: TrustedInvocationContext, requestId: string, key: string, changes: Awaited<ReturnType<typeof planRecognition>>["changes"]) {
  for (const change of changes) {
    const registrationId = change.registrationId || (await tx.query<{ id: string }>("select id from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id=$2", [organizationId, change.subjectId])).rows[0]?.id;
    if (!registrationId) throw new ApiError("CONFLICT", "Subject registration no longer exists.");
    if (change.mode === "inherit") await resetRegistrationRecognitionSettingsInTransaction(tx, { organizationId, registrationId, ifMatch: change.ifMatch, catalogReleaseId: releaseId });
    else await updateRegistrationRecognitionSettingsInTransaction(tx, { organizationId, registrationId, body: change.body,
      invocation, requestId, ifMatch: change.ifMatch, catalogReleaseId: releaseId,
      idempotencyKey: `module-structure:${createHash("sha256").update(JSON.stringify([key, change.subjectId])).digest("hex")}` });
  }
}
