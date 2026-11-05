import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { WiseEffRouter } from "../../shared/http/router";
import { payloadToBindingView } from "../parameter-bindings/catalogProjectValueSync";
import { assertCurrentInstancesValid, currentInstancesCte } from "../parameter-bindings/queries/currentInstances";
import type { ProjectValuePayload } from "../parameter-bindings/values";
import type { CatalogReadPorts } from "./read/types";

type Instance = {
  binding_id: string; project_id: string; project_name: string; definition_id: string;
  effective_revision_id: string; current_value_id: string; definition_revision_id: string;
  source_occurrence_id: string; source_format: "dts" | "json"; config_set_id: string; config_set_name: string; value_revision_number: string;
  value_unit: string | null; value_lifecycle: "active" | "deprecated" | "retired";
  file_id: string; file_version_id: string; file_name: string; source_locator: Record<string, unknown>;
  value_kind: ProjectValuePayload["kind"]; value: unknown; value_state: "present" | "deleted"; source_ref: string;
};

function token(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function present(row: Instance, full: boolean) {
  const unset = row.source_ref === "canonical-binding-identity";
  const raw = unset ? "" : payloadToBindingView({ kind: row.value_kind, value: row.value } as ProjectValuePayload, row.source_format).rawValue;
  return {
    kind: "instance" as const, bindingId: row.binding_id, projectId: row.project_id, projectName: row.project_name,
    configSetId: row.config_set_id, configSetName: row.config_set_name, sourceOccurrenceId: row.source_occurrence_id, sourceFormat: row.source_format,
    fileId: row.file_id, fileVersionId: row.file_version_id, fileName: row.file_name, sourceLocator: row.source_locator,
    currentValueId: row.current_value_id, definitionRevisionId: row.definition_revision_id, definitionRevisionNumber: row.value_revision_number,
    unit: row.value_unit, definitionLifecycle: row.value_lifecycle,
    effectiveRevisionId: row.effective_revision_id, valueState: unset ? "unset" as const : "present" as const,
    valuePreview: raw.slice(0, 160), valuePreviewTruncated: raw.length > 160,
    ...(full && !unset ? { rawValue: raw } : {}),
  };
}

export function registerProjectConfigurations(router: WiseEffRouter, db: Database | undefined, ports: CatalogReadPorts): void {
  router.get("/api/v2/catalog/definitions/:definitionId/project-configurations", async (request) => {
    const identity = await ports.authenticate({ method: "GET", path: request.path, params: request.params,
      query: request.query, headers: request.headers, requestId: request.requestId });
    if (!identity.ok) throw new ApiError(identity.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", "Configuration read is not authorized.");
    if (!identity.scope.canReadCatalog) throw new ApiError("FORBIDDEN", "Configuration read is not authorized.");
    if (identity.scope.projectScope.kind !== "all") throw new ApiError("FORBIDDEN", "Organization configuration read is not authorized.");
    const definitionId = request.params.definitionId;
    if (identity.scope.definitions.kind === "only" && !identity.scope.definitions.ids.some((id) => id === definitionId)) throw new ApiError("NOT_FOUND", "Definition not found.");
    const { cursor, selectedBindingId, limit: rawLimit } = request.query;
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    if (!token(definitionId) || (cursor !== undefined && (typeof cursor !== "string" || cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor))) ||
      (selectedBindingId !== undefined && !token(selectedBindingId)) ||
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
      await assertCurrentInstancesValid(tx, organizationId, [definitionId]);
      const params = [organizationId, [definitionId]];
      const summary = await tx.query<{ projects: string; instances: string; fingerprint: string }>(`${currentInstancesCte}
        select count(distinct project_id) filter (where value_state = 'present' and source_ref <> 'canonical-binding-identity')::text as projects,
          count(distinct binding_id) filter (where value_state = 'present' and source_ref <> 'canonical-binding-identity')::text as instances,
          md5(coalesce(string_agg(binding_id || ':' || current_value_id || ':' || project_id || ':' || project_name, E'\\n' order by binding_id), '')) as fingerprint
        from candidates`, params);
      const fingerprint = summary.rows[0]!.fingerprint;
      const configured = `value_state = 'present' and source_ref <> 'canonical-binding-identity'`;
      const visible = `value_state = 'present' and (source_ref <> 'canonical-binding-identity' or exists (
        select 1 from candidates configured where configured.project_id = candidates.project_id
          and configured.value_state = 'present' and configured.source_ref <> 'canonical-binding-identity'))`;
      let previousProjectId: string | null = null;
      let afterBindingId: string | null = null;
      if (cursor) {
        try {
          const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
          if (!decoded || typeof decoded !== "object" || !("bindingId" in decoded) || !token(decoded.bindingId) ||
            !("organizationId" in decoded) || decoded.organizationId !== organizationId || !("definitionId" in decoded) || decoded.definitionId !== definitionId ||
            !("fingerprint" in decoded) || decoded.fingerprint !== fingerprint) throw new Error("stale cursor");
          afterBindingId = decoded.bindingId;
        } catch {
          throw new ApiError("VALIDATION_FAILED", "Configuration cursor is no longer valid.", { reason: "invalid-cursor" });
        }
        const found = await tx.query<{ project_id: string }>(`${currentInstancesCte} select project_id from candidates where binding_id = $3 and ${visible}`, [...params, afterBindingId]);
        if (!found.rows.length) throw new ApiError("VALIDATION_FAILED", "Configuration cursor is no longer valid.", { reason: "invalid-cursor" });
        previousProjectId = found.rows[0]!.project_id;
      }
      const page = await tx.query<Instance>(`${currentInstancesCte}, ordered as (
        select *, row_number() over (order by project_name, project_id, binding_id) as position from candidates where ${visible}
      ) select * from ordered where position > coalesce((select position from ordered where binding_id = $3), 0)
        order by position limit $4`, [...params, afterBindingId, limit + 1]);
      let selected: ReturnType<typeof present> | null = null;
      if (selectedBindingId) {
        const value = await tx.query<Instance>(`${currentInstancesCte} select * from candidates where binding_id = $3 and ${configured}`, [...params, selectedBindingId]);
        if (!value.rows[0]) throw new ApiError("NOT_FOUND", "Current configuration instance not found.");
        selected = present(value.rows[0], true);
      }
      const items = page.rows.slice(0, limit).map((row) => present(row, false));
      return { items, summary: { configuredProjectCount: Number(summary.rows[0]?.projects), configuredInstanceCount: Number(summary.rows[0]?.instances) },
        nextCursor: page.rows.length > limit && items.length ? Buffer.from(JSON.stringify({ organizationId, definitionId, fingerprint, bindingId: items.at(-1)!.bindingId })).toString("base64url") : null,
        continuedProjectId: items[0]?.projectId === previousProjectId ? previousProjectId : null, selected };
    });
    return { status: 200, body };
  });
}
