import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { WiseEffRouter } from "../../shared/http/router";
import { payloadToBindingView } from "../parameter-bindings/catalogProjectValueSync";
import { assertCurrentInstancesValid, currentInstancesCte } from "../parameter-bindings/queries/currentInstances";
import { readCurrentInstanceSourceValue } from "../parameter-bindings/queries/currentInstanceSource";
import type { ObjectStore } from "../logs/objectStore";
import type { ProjectValuePayload } from "../parameter-bindings/values";
import type { CatalogReadPorts } from "./read/types";
import { contentClassOf } from "../catalog-publication/builder/completeSuccessor";

type Instance = {
  binding_id: string; project_id: string; project_name: string; definition_id: string;
  effective_revision_id: string; current_value_id: string; definition_revision_id: string;
  source_occurrence_id: string; source_format: "dts" | "json"; config_set_id: string; config_set_name: string; value_revision_number: string;
  value_unit: string | null; value_lifecycle: "active" | "deprecated" | "retired";
  value_revision_content: unknown;
  file_id: string; file_version_id: string; file_name: string; source_locator: Record<string, unknown>; source_location: string;
  value_kind: ProjectValuePayload["kind"]; value: unknown; value_state: "present" | "deleted"; source_ref: string;
  source_raw_text: string | null;
  value_equals: boolean | null;
  value_json_text: string;
};

function compare(base: Instance, target: Instance) {
  const revision = (content: unknown): content is Parameters<typeof contentClassOf>[0] => {
    if (!content || typeof content !== "object") return false;
    const value = content as Record<string, unknown>;
    const matching = value.matching as Record<string, unknown> | null;
    return (value.unit === undefined || value.unit === null || typeof value.unit === "string") &&
      !!value.valueSchema && typeof value.valueSchema === "object" && !Array.isArray(value.valueSchema) &&
      !!matching && typeof matching === "object" && typeof matching.sourceProperty === "string" &&
      ["driver-compatible", "node-type-name", "configuration-schema-id"].includes(String(matching.selectorKind)) &&
      ["active", "deprecated", "retired"].includes(String(value.lifecycle));
  };
  const revisionChanged = base.definition_revision_id !== target.definition_revision_id;
  if (!revision(base.value_revision_content) || !revision(target.value_revision_content))
    return { status: "unavailable" as const, reason: "revision-unavailable" as const, revisionChanged };
  if (contentClassOf(base.value_revision_content, target.value_revision_content) === "semantic")
    return { status: "different-semantics" as const, reason: "revision-semantics" as const, revisionChanged };
  if (base.source_ref === "canonical-binding-identity" || target.source_ref === "canonical-binding-identity")
    return { status: "unavailable" as const, reason: "unset" as const, revisionChanged };
  // Complex DTS values include references and expressions whose meaning cannot be
  // inferred from their stored text or syntax tree across projects.
  const complexDts = (row: Instance) => row.source_format === "dts" && (row.value_kind === "json" ||
    ((row.value_kind === "number" || row.value_kind === "number-array") &&
      !/^\s*(?:\/bits\/\s*32\s*)?<\s*(?:(?:-?(?:0[xX][\da-fA-F]+|\d+)(?:[uUlL]{0,3})|\(-(?:0[xX][\da-fA-F]+|\d+)\))\s*)+>\s*$/u.test(row.source_raw_text ?? "")) ||
    ((row.value_kind === "string" || row.value_kind === "string-array") &&
      !/^\s*"(?:[^"\\]|\\.)*"(?:\s*,\s*"(?:[^"\\]|\\.)*")*\s*$/u.test(row.source_raw_text ?? "")) ||
    (row.value_kind === "boolean" && row.source_raw_text !== ""));
  if (complexDts(base) || complexDts(target))
    return { status: "unsupported" as const, reason: "complex-dts" as const, revisionChanged };
  // PostgreSQL jsonb equality preserves numeric precision, type and array order.
  const same = target.value_equals === true;
  const safeInteger = (row: Instance) => /^-?(?:0|[1-9]\d*)$/u.test(row.value_json_text) && Number.isSafeInteger(row.value);
  const delta = safeInteger(base) && safeInteger(target) ? Number(target.value) - Number(base.value) : undefined;
  return { status: same ? "same" as const : "different" as const, reason: "typed-values" as const, revisionChanged,
    ...(delta !== undefined && Number.isSafeInteger(delta) ? { delta } : {}) };
}

function token(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function present(row: Instance) {
  const unset = row.source_ref === "canonical-binding-identity";
  const raw = unset ? "" : payloadToBindingView({ kind: row.value_kind, value: row.value } as ProjectValuePayload, row.source_format).rawValue;
  return {
    kind: "instance" as const, bindingId: row.binding_id, projectId: row.project_id, projectName: row.project_name,
    configSetId: row.config_set_id, configSetName: row.config_set_name, sourceOccurrenceId: row.source_occurrence_id, sourceFormat: row.source_format,
    fileId: row.file_id, fileVersionId: row.file_version_id, fileName: row.file_name, sourceLocator: row.source_locator, sourceLocation: row.source_location,
    currentValueId: row.current_value_id, definitionRevisionId: row.definition_revision_id, definitionRevisionNumber: row.value_revision_number,
    unit: row.value_unit, definitionLifecycle: row.value_lifecycle,
    effectiveRevisionId: row.effective_revision_id, valueState: unset ? "unset" as const : "present" as const, valueKind: row.value_kind,
    valuePreview: raw.slice(0, 160), valuePreviewTruncated: raw.length > 160,
  };
}

export function registerProjectConfigurations(router: WiseEffRouter, db: Database | undefined, ports: CatalogReadPorts, objectStore?: ObjectStore): void {
  router.get("/api/v2/catalog/definitions/:definitionId/project-configurations", async (request) => {
    const identity = await ports.authenticate({ method: "GET", path: request.path, params: request.params,
      query: request.query, headers: request.headers, requestId: request.requestId });
    if (!identity.ok) throw new ApiError(identity.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", "Configuration read is not authorized.");
    if (!identity.scope.canReadCatalog) throw new ApiError("FORBIDDEN", "Configuration read is not authorized.");
    if (identity.scope.projectScope.kind !== "all") throw new ApiError("FORBIDDEN", "Organization configuration read is not authorized.");
    const definitionId = request.params.definitionId;
    if (identity.scope.definitions.kind === "only" && !identity.scope.definitions.ids.some((id) => id === definitionId)) throw new ApiError("NOT_FOUND", "Definition not found.");
    const { cursor, selectedBindingId, baselineBindingId, targetBindingId, limit: rawLimit, projectId, configSetId, search, includeUnconfigured, hintProjectId, hintConfigSetId } = request.query;
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    if (!token(definitionId) || (cursor !== undefined && (typeof cursor !== "string" || cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor))) ||
      (selectedBindingId !== undefined && !token(selectedBindingId)) ||
      (baselineBindingId !== undefined && !token(baselineBindingId)) || (targetBindingId !== undefined && (!token(targetBindingId) || !baselineBindingId)) ||
      (projectId !== undefined && !token(projectId)) || (configSetId !== undefined && !token(configSetId)) ||
      (search !== undefined && !token(search)) || (includeUnconfigured !== undefined && includeUnconfigured !== "true" && includeUnconfigured !== "false") ||
      (hintProjectId !== undefined && !token(hintProjectId)) || (hintConfigSetId !== undefined && !token(hintConfigSetId)) ||
      ((hintProjectId !== undefined || hintConfigSetId !== undefined) && selectedBindingId === undefined) ||
      !Number.isInteger(limit) || limit < 1 || limit > 100 || (rawLimit !== undefined && !/^\d+$/.test(String(rawLimit)))) {
      throw new ApiError("VALIDATION_FAILED", "Invalid configuration read identity or pagination.");
    }
    if (!db) throw new ApiError("INTERNAL_ERROR", "Configuration read is unavailable.");
    const organizationId = identity.scope.organizationId;
    const body = await db.transaction(async (tx) => {
      await tx.query("set transaction isolation level repeatable read read only");
      const definition = await tx.query<{ id: string; subject_id: string }>(`select definition.id, definition.subject_id from parameter_catalog.parameter_definitions definition
        where definition.id = $1 and exists (select 1 from parameter_catalog.catalog_release_definition_heads head
          join parameter_catalog.catalog_materializations materialization on materialization.release_id = head.release_id
          where head.definition_id = definition.id)`, [definitionId]);
      if (!definition.rows.length) throw new ApiError("NOT_FOUND", "Definition not found.");
      if (identity.scope.subjects.kind === "only" && !identity.scope.subjects.ids.some((id) => id === definition.rows[0]!.subject_id)) throw new ApiError("NOT_FOUND", "Definition not found.");
      if (projectId && !(await tx.query("select 1 from public.projects where organization_id=$1 and id=$2", [organizationId, projectId])).rows.length) throw new ApiError("NOT_FOUND", "Project not found.", { reason: "invalid-filter" });
      if (configSetId && !(await tx.query("select 1 from public.dts_config_set where organization_id=$1 and id=$2 and ($3::text is null or project_id=$3)", [organizationId, configSetId, projectId ?? null])).rows.length) throw new ApiError("NOT_FOUND", "Configuration set not found.", { reason: "invalid-filter" });
      await assertCurrentInstancesValid(tx, organizationId, [definitionId]);
      const params = [organizationId, [definitionId], projectId ?? null, configSetId ?? null, search ?? null, includeUnconfigured === "true"];
      const configured = `value_state = 'present' and source_ref <> 'canonical-binding-identity'`;
      const visible = `value_state = 'present' and (source_ref <> 'canonical-binding-identity' or exists (
        select 1 from candidates configured where configured.project_id = candidates.project_id
          and configured.value_state = 'present' and configured.source_ref <> 'canonical-binding-identity'))`;
      const rowsCte = `, result_rows as (
        select 'instance:' || binding_id as row_key, project_id, project_name, to_jsonb(candidates) as row_data
          from candidates where value_state = 'present' and ($6::boolean or ${visible})
            and ($3::text is null or project_id = $3) and ($4::text is null or config_set_id = $4)
            and ($5::text is null or position(lower($5) in lower(concat_ws(' ', project_name, config_set_name, file_name, source_location, binding_id))) > 0)
        union all
        select 'project:' || project.id, project.id, project.name, null::jsonb from public.projects project
          where project.organization_id = $1 and $6::boolean and $4::text is null and $5::text is null
            and ($3::text is null or project.id = $3)
            and not exists (select 1 from candidates where candidates.project_id = project.id and value_state = 'present')
      )`;
      const summary = await tx.query<{ projects: string; instances: string; total_rows: string; read_at: string; fingerprint: string }>(`${currentInstancesCte}${rowsCte}
        select count(distinct project_id) filter (where value_state = 'present' and source_ref <> 'canonical-binding-identity')::text as projects,
          count(distinct binding_id) filter (where value_state = 'present' and source_ref <> 'canonical-binding-identity')::text as instances,
          (select count(*)::text from result_rows) as total_rows, transaction_timestamp()::text as read_at,
          md5(coalesce(string_agg(binding_id || ':' || current_value_id || ':' || project_id || ':' || project_name, E'\\n' order by binding_id), '') ||
            coalesce((select string_agg(row_key || ':' || project_name, E'\\n' order by row_key) from result_rows), '') || json_build_array($3::text, $4::text, $5::text, $6::boolean)::text) as fingerprint
        from candidates`, params);
      const fingerprint = summary.rows[0]!.fingerprint;
      let previousProjectId: string | null = null;
      let afterRowKey: string | null = null;
      if (cursor) {
        try {
          const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
          if (!decoded || typeof decoded !== "object" || !("rowKey" in decoded) || !token(decoded.rowKey) ||
            !("organizationId" in decoded) || decoded.organizationId !== organizationId || !("definitionId" in decoded) || decoded.definitionId !== definitionId ||
            !("fingerprint" in decoded) || decoded.fingerprint !== fingerprint) throw new Error("stale cursor");
          afterRowKey = decoded.rowKey;
        } catch {
          throw new ApiError("VALIDATION_FAILED", "Configuration cursor is no longer valid.", { reason: "invalid-cursor" });
        }
        const found = await tx.query<{ project_id: string }>(`${currentInstancesCte}${rowsCte} select project_id from result_rows where row_key = $7`, [...params, afterRowKey]);
        if (!found.rows.length) throw new ApiError("VALIDATION_FAILED", "Configuration cursor is no longer valid.", { reason: "invalid-cursor" });
        previousProjectId = found.rows[0]!.project_id;
      }
      const page = await tx.query<{ row_key: string; project_id: string; project_name: string; row_data: Instance | null; value_equals: boolean | null }>(`${currentInstancesCte}${rowsCte}, ordered as (
        select *, row_number() over (order by project_name, project_id, row_key) as position from result_rows
      ) select *, (select value from candidates where binding_id = substring(ordered.row_key from 10)) =
        (select value from candidates where binding_id = $9) as value_equals from ordered where position > coalesce((select position from ordered where row_key = $7), 0)
        order by position limit $8`, [...params, afterRowKey, limit + 1, baselineBindingId ?? null]);
      async function selectedInstance(bindingId: string, reason: string) {
        const value = await tx.query<Instance>(`${currentInstancesCte} select *, value = (select value from candidates where binding_id = $4) as value_equals
          from candidates where binding_id = $3 and ${configured}`, [organizationId, [definitionId], bindingId, baselineBindingId ?? null]);
        if (!value.rows[0] || (reason === "selected-unavailable" &&
          ((hintProjectId !== undefined && value.rows[0].project_id !== hintProjectId) ||
           (hintConfigSetId !== undefined && value.rows[0].config_set_id !== hintConfigSetId)))) throw new ApiError("NOT_FOUND", "Current configuration instance not found.", { reason });
        const row = value.rows[0];
        const rawValue = await readCurrentInstanceSourceValue(tx, objectStore, { organizationId, projectId: row.project_id,
          bindingId: row.binding_id, projectValueId: row.current_value_id, payload: { kind: row.value_kind, value: row.value } as ProjectValuePayload });
        return { row, detail: { ...present(row), rawValue } };
      }
      const selected = selectedBindingId ? (await selectedInstance(selectedBindingId, "selected-unavailable")).detail : null;
      const baseline = baselineBindingId ? await selectedInstance(baselineBindingId, "baseline-unavailable") : null;
      const target = targetBindingId ? targetBindingId === baselineBindingId ? baseline : await selectedInstance(targetBindingId, "target-unavailable") : null;
      const items = page.rows.slice(0, limit).map((row) => row.row_data ? { ...present(row.row_data), ...(baseline ? { comparison: compare(baseline.row, { ...row.row_data, value_equals: row.value_equals }) } : {}) } :
        { kind: "project-status" as const, projectId: row.project_id, projectName: row.project_name, status: "unconfigured" as const });
      const projects = await tx.query<{ id: string; name: string }>("select id,name from public.projects where organization_id=$1 order by name,id", [organizationId]);
      const sets = await tx.query<{ id: string; name: string; project_id: string }>("select id,name,project_id from public.dts_config_set where organization_id=$1 and (project_id=$2 or id=$3) order by name,id", [organizationId, projectId ?? null, configSetId ?? null]);
      return { items, summary: { configuredProjectCount: Number(summary.rows[0]?.projects), configuredInstanceCount: Number(summary.rows[0]?.instances) },
        projects: projects.rows, configSets: sets.rows.map((set) => ({ id: set.id, name: set.name, projectId: set.project_id })),
        totalCount: Number(summary.rows[0]!.total_rows), readAt: new Date(summary.rows[0]!.read_at).toISOString(),
        nextCursor: page.rows.length > limit && items.length ? Buffer.from(JSON.stringify({ organizationId, definitionId, fingerprint, rowKey: page.rows[limit - 1]!.row_key })).toString("base64url") : null,
        continuedProjectId: items[0]?.projectId === previousProjectId ? previousProjectId : null, selected,
        baseline: baseline?.detail ?? null, target: target && baseline ? { ...target.detail, comparison: compare(baseline.row, target.row) } : null };
    });
    return { status: 200, body };
  });
}
