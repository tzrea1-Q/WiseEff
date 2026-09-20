import { createHash } from "node:crypto";

import type pg from "pg";

import type { CatalogSnapshot } from "../../../catalog-kernel/interface";
import { serializeContract } from "../../../parameter-catalog-contract";
import { parseDts } from "../../../dts";
import type { ObjectStore } from "../../../logs/objectStore";
import { appendProjectValue } from "../../values/service";
import type { BindingResult, Result, StabilizeBindingCommand, BindingConflict } from "../types";
import type { AppendProjectValueCommand, ProjectValuePayload } from "../../values/types";
import { stabilizeCanonicalBinding } from "../service";

type FixtureClient = {
  query: {
    <Row extends pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<Row>>;
  };
};

export type SourceBackedBindingFixture = {
  readonly sourceOccurrenceId: string;
  readonly sourceName: string;
  readonly configRevisionId: string;
  readonly fileId: string;
  readonly fileVersionId: string;
  readonly propertyOccurrenceId: string;
  readonly nodeOccurrenceId: string;
};

export type SourceCommitReceipt = {
  readonly requestId: string;
  readonly auditRef: string;
};

const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);

const query = <Row extends pg.QueryResultRow = pg.QueryResultRow>(
  client: FixtureClient,
  text: string,
  values: unknown[] = [],
) => client.query<Row>(text, values);

export const ensureSourceBackedBindingFixture = async (
  client: FixtureClient,
  command: StabilizeBindingCommand,
  objectStore?: ObjectStore,
): Promise<SourceBackedBindingFixture> => {
  const owner = await query<{ organization_id: string }>(
    client,
    `select organization_id from public.projects where id = $1`,
    [command.projectId],
  );
  const organizationId = owner.rows[0]?.organization_id ?? command.organizationId;
  const token = digest(`${organizationId}|${command.projectId}|${command.logicalNodeId}`);
  const configRevisionId = `crev-s6-fixture-${token}`;
  const configSetId = `dcs-s6-fixture-${token}`;
  const fileId = `file-s6-fixture-${token}`;
  const fileVersionId = `fileversion-s6-fixture-${token}`;
  const sourceOccurrenceId = `src_occ_s6_fixture_${token}`;
  const nodeOccurrenceId = `nodeocc-s6-fixture-${token}`;
  const propertyOccurrenceId = `propocc-s6-fixture-${token}`;
  const logicalRevisionId = `lnr-s6-fixture-${token}`;
  const memberId = `member-s6-fixture-${token}`;
  const effectId = `effect-s6-fixture-${token}`;
  const property = command.snapshot.getDefinitionById(command.definitionId);
  if (property.status !== "found") throw new Error("fixture definition unavailable");
  const propertyKey = property.definition.propertyKey;
  const sourceName = `s6-${token}.dts`;
  const sourceText = `/dts-v1/;\n/ {\n\t${command.logicalNodeId} {\n\t\t${propertyKey} = <5>;\n\t};\n};\n`;
  const parsed = parseDts(sourceText);
  const root = parsed.topLevel.find((node) => node.isOverlayRoot);
  const parsedNode = root?.children.find(
    (child): child is Extract<typeof child, { kind: "node" }> =>
      child.kind === "node" && child.name === command.logicalNodeId,
  );
  const parsedProperty = parsedNode?.children.find(
    (child): child is Extract<typeof child, { kind: "property" }> =>
      child.kind === "property" && child.name === propertyKey,
  );
  if (!parsedNode || !parsedProperty) throw new Error("source-backed DTS fixture failed to parse");

  // A later test may replay the same source-backed Binding after its first
  // value pin.  The pinned-source graph is intentionally immutable, so an
  // `INSERT ... ON CONFLICT DO NOTHING` would still fire its BEFORE trigger.
  // Reuse the already-proven fixture graph instead of attempting that insert.
  const existing = await query<SourceBackedBindingFixture>(
    client,
    `select occurrence.id as "sourceOccurrenceId",
            member.source_name as "sourceName",
            member.config_revision_id as "configRevisionId",
            member.file_id as "fileId",
            member.file_version_id as "fileVersionId",
            property.id as "propertyOccurrenceId",
            property.node_occurrence_id as "nodeOccurrenceId"
       from parameter_catalog.project_parameter_source_occurrences occurrence
       join public.dts_config_revision_members member
         on member.config_revision_id = $2
        and member.file_id = occurrence.file_id
       join public.dts_property_occurrences property
         on property.id = $3
        and property.config_revision_id = member.config_revision_id
        and property.file_version_id = member.file_version_id
      where occurrence.id = $1
        and occurrence.config_set_id = $4
        and member.source_name is not null`,
    [sourceOccurrenceId, configRevisionId, propertyOccurrenceId, configSetId],
  );
  if (existing.rows.length === 1) return existing.rows[0]!;

  const lineColumn = (offset: number) => {
    const prefix = sourceText.slice(0, offset);
    const line = prefix.split("\n").length;
    const lastNewline = prefix.lastIndexOf("\n");
    return { line, column: offset - lastNewline };
  };
  const nodeStart = lineColumn(parsedNode.span.start);
  const nodeEnd = lineColumn(parsedNode.span.end);
  const propertyStart = lineColumn(parsedProperty.span.start);
  const propertyEnd = lineColumn(parsedProperty.span.end);
  const stored = objectStore
    ? await objectStore.put({
        organizationId,
        fileName: sourceName,
        contentType: "text/plain",
        bytes: Buffer.from(sourceText, "utf8"),
      })
    : undefined;

  await query(
    client,
    `insert into public.dts_config_set (id, organization_id, project_id, name)
     values ($1,$2,$3,$4) on conflict (id) do nothing`,
    [configSetId, organizationId, command.projectId, `s6-${token}`],
  );
  await query(
    client,
    `insert into public.project_parameter_files (
     id, organization_id, project_id, file_name, format, config_set_id, config_set_role, enabled
     ) values ($1,$2,$3,$4,'dts',$5,'base',true) on conflict (id) do nothing`,
    [fileId, organizationId, command.projectId, sourceName, configSetId],
  );
  await query(
    client,
    `insert into public.project_parameter_file_versions (
       id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin
       ) values ($1,$2,1,$3,$4,$5,'{}'::jsonb,'upload') on conflict (id) do nothing`,
    [
      fileVersionId,
      fileId,
      stored?.storageKey ?? `s6/${fileVersionId}`,
      stored?.checksumSha256 ?? `s6-checksum-${token}`,
      stored?.fileSizeBytes ?? 128,
    ],
  );
  await query(client, `update public.project_parameter_files set current_version_id = $1 where id = $2`, [
    fileVersionId,
    fileId,
  ]);
  await query(
    client,
    `insert into public.dts_config_revisions (
       id, organization_id, project_id, config_set_id, revision_number, status,
       entry_file, include_search_paths, overlay_order, manifest_state
     ) values ($1,$2,$3,$4,1,'resolved',$5,$6::jsonb,$7::jsonb,'complete') on conflict (id) do nothing`,
    [configRevisionId, organizationId, command.projectId, configSetId, sourceName, JSON.stringify(["."]), "[]"],
  );
  await query(
    client,
    `insert into public.dts_config_revision_members (
       id, config_revision_id, file_id, file_version_id, role, sort_order, source_name
     ) values ($1,$2,$3,$4,'base',0,$5) on conflict (id) do nothing`,
    [memberId, configRevisionId, fileId, fileVersionId, `s6-${token}.dts`],
  );
  await query(
    client,
    `insert into public.dts_logical_nodes (id, organization_id, project_id, config_set_id)
     values ($1,$2,$3,$4) on conflict (id) do nothing`,
    [command.logicalNodeId, organizationId, command.projectId, configSetId],
  );
  await query(
    client,
    `insert into public.dts_logical_node_revisions (
       id, logical_node_id, config_revision_id, node_locator, name
     ) values ($1,$2,$3,$4,$5) on conflict (id) do nothing`,
    [logicalRevisionId, command.logicalNodeId, configRevisionId, `/${command.logicalNodeId}`, command.logicalNodeId],
  );
  await query(
    client,
    `insert into public.dts_node_occurrences (
       id, config_revision_id, file_version_id, name, labels, node_path,
       start_offset, end_offset, start_line, start_column, end_line, end_column,
       raw_text, ast_json, source_order
       ) values ($1,$2,$3,$4,'[]'::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,0)
       on conflict (id) do nothing`,
    [
      nodeOccurrenceId,
      configRevisionId,
      fileVersionId,
      command.logicalNodeId,
      `/${command.logicalNodeId}`,
      parsedNode.span.start,
      parsedNode.span.end,
      nodeStart.line,
      nodeStart.column,
      nodeEnd.line,
      nodeEnd.column,
      sourceText.slice(parsedNode.span.start, parsedNode.span.end),
      JSON.stringify({ kind: "node", labels: parsedNode.labels, refTarget: parsedNode.refTarget ?? null, isOverlayRoot: parsedNode.isOverlayRoot }),
    ],
  );
  await query(
    client,
    `insert into public.dts_property_occurrences (
       id, config_revision_id, node_occurrence_id, file_version_id, property_name,
       start_offset, end_offset, start_line, start_column, end_line, end_column,
       raw_text, ast_json, source_order
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,0)
       on conflict (id) do nothing`,
    [
      propertyOccurrenceId,
      configRevisionId,
      nodeOccurrenceId,
      fileVersionId,
      propertyKey,
      parsedProperty.span.start,
      parsedProperty.span.end,
      propertyStart.line,
      propertyStart.column,
      propertyEnd.line,
      propertyEnd.column,
      parsedProperty.rawText,
      JSON.stringify(parsedProperty.value ?? { kind: "raw", valueType: parsedProperty.valueType }),
    ],
  );
  await query(
    client,
    `insert into public.dts_occurrence_effects (
       id, config_revision_id, logical_node_revision_id, property_occurrence_id,
       node_occurrence_id, property_name, effect_kind, source_order
     ) values ($1,$2,$3,$4,$5,$6,'set',1) on conflict (id) do nothing`,
    [effectId, configRevisionId, logicalRevisionId, propertyOccurrenceId, nodeOccurrenceId, propertyKey],
  );
  await query(
    client,
    `insert into parameter_catalog.project_parameter_source_occurrences (
       id, organization_id, project_id, config_set_id, file_id, occurrence_kind, logical_node_id
     ) values ($1,$2,$3,$4,$5,'dts',$6) on conflict (id) do nothing`,
    [sourceOccurrenceId, organizationId, command.projectId, configSetId, fileId, command.logicalNodeId],
  );
  return { sourceOccurrenceId, sourceName, configRevisionId, fileId, fileVersionId, propertyOccurrenceId, nodeOccurrenceId };
};

export const createPendingSourceCommit = async (
  client: FixtureClient,
  input: {
    readonly bindingId: string;
    readonly oldValueId: string;
    readonly targetValue: ProjectValuePayload;
  },
): Promise<SourceCommitReceipt> => {
  const stored = await query<{
    organization_id: string;
    project_id: string;
    definition_id: string;
    effective_revision_id: string;
    catalog_release_id: string;
    current_value_id: string;
    source_ref: string;
    config_revision_id: string;
    source_pin_id: string;
    file_id: string;
    file_version_id: string;
    member_id: string;
    source_name: string;
  }>(
    client,
    `select binding.organization_id, binding.project_id, binding.definition_id,
            binding.effective_revision_id, binding.catalog_release_id,
            value.id as current_value_id, value.source_ref, value.config_revision_id,
            pin.id as source_pin_id, pin.file_id, pin.file_version_id,
            member.id as member_id, member.source_name
       from parameter_catalog.project_parameter_bindings binding
       join parameter_catalog.project_parameter_values value
         on value.id = binding.current_value_id
       join parameter_catalog.project_value_source_pins pin
         on pin.project_value_id = value.id and pin.binding_id = binding.id
       join public.dts_config_revision_members member
         on member.config_revision_id = pin.config_revision_id
        and member.file_id = pin.file_id
        and member.file_version_id = pin.file_version_id
      where binding.id = $1
        and (value.id = $2 or value.id = binding.current_value_id)
      order by (value.id = $2) desc
      limit 1`,
    [input.bindingId, input.oldValueId],
  );
  const row = stored.rows[0];
  if (!row) throw new Error("source-backed fixture current pin missing");
  const token = digest(`${input.bindingId}|${input.oldValueId}|${JSON.stringify(input.targetValue)}`);
  const requestId = `pvcr-s6-fixture-${token}`;
  const candidateId = `candidate-s6-fixture-${token}`;
  const memberManifest = [{
    memberId: row.member_id,
    fileId: row.file_id,
    fileVersionId: row.file_version_id,
    sourceName: row.source_name,
  }];
  const bindingManifest = [{ bindingId: input.bindingId, oldValueId: input.oldValueId }];
  const baseDigest = `sha256:${createHash("sha256").update(`${token}:base`).digest("hex")}`;
  const proposedDigest = `sha256:${createHash("sha256").update(`${token}:proposed`).digest("hex")}`;
  const diffDigest = `sha256:${createHash("sha256").update(`${token}:diff`).digest("hex")}`;
  await query(
    client,
    `insert into public.project_parameter_file_candidates (
       id, organization_id, project_id, file_id, file_name, format, status,
       base_version_id, storage_key, checksum, size_bytes, parsed_index,
       diagnostics, impact, blockers, base_digest, proposed_digest, diff_digest,
       frozen_member_manifest, frozen_binding_manifest
     ) values ($1,$2,$3,$4,$5,'dts','ready',$6,$7,$8,1,'{}'::jsonb,
       '[]'::jsonb,'{}'::jsonb,'[]'::jsonb,$9,$10,$11,$12::jsonb,$13::jsonb)
     on conflict (id) do nothing`,
    [
      candidateId,
      row.organization_id,
      row.project_id,
      row.file_id,
      row.source_name,
      row.file_version_id,
      `s6-fixture/${candidateId}`,
      baseDigest,
      baseDigest,
      proposedDigest,
      diffDigest,
      JSON.stringify(memberManifest),
      JSON.stringify(bindingManifest),
    ],
  );
  await query(
    client,
    `insert into public.project_parameter_value_change_requests (
       id, organization_id, project_id, draft_id, binding_id, definition_id,
       definition_revision_id, catalog_release_id, base_current_value_id,
       config_revision_id, source_ref, action, target_value, reason, status,
       source_pin_id, candidate_id, candidate_base_digest, candidate_proposed_digest,
       candidate_diff_digest, candidate_member_manifest, candidate_binding_manifest
     ) values ($1,$2,$3,null,$4,$5,$6,$7,$8,$9,$10,'set',$11::jsonb,
       's6 source fixture','pending',$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb)
     on conflict (id) do nothing`,
    [
      requestId,
      row.organization_id,
      row.project_id,
      input.bindingId,
      row.definition_id,
      row.effective_revision_id,
      row.catalog_release_id,
      input.oldValueId,
      row.config_revision_id,
      row.source_ref,
      JSON.stringify(input.targetValue),
      row.source_pin_id,
      candidateId,
      baseDigest,
      proposedDigest,
      diffDigest,
      JSON.stringify(memberManifest),
      JSON.stringify(bindingManifest),
    ],
  );
  return { requestId, auditRef: `s6-source-audit-${token}` };
};

export const appendSourceCommittedValue = async (
  pool: pg.Pool,
  command: AppendProjectValueCommand,
): Promise<ReturnType<typeof appendProjectValue> extends Promise<infer Result> ? Result : never> => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set constraints all deferred");
    const currentPin = await query<{
      config_revision_id: string;
      file_id: string;
      file_version_id: string;
      format: string;
      property_occurrence_id: string | null;
      locator: unknown;
      locator_digest: string;
    }>(
      client,
      `select config_revision_id, file_id, file_version_id, format,
              property_occurrence_id, locator, locator_digest
         from parameter_catalog.project_value_source_pins
        where project_value_id = $1 and binding_id = $2`,
      [command.expectedTip, command.binding.id],
    );
    const pin = currentPin.rows[0] ?? (await query<typeof currentPin.rows[number]>(
      client,
      `select pin.config_revision_id, pin.file_id, pin.file_version_id, pin.format,
              pin.property_occurrence_id, pin.locator, pin.locator_digest
         from parameter_catalog.project_parameter_bindings binding
         join parameter_catalog.project_value_source_pins pin
           on pin.project_value_id = binding.current_value_id and pin.binding_id = binding.id
        where binding.id = $1
        order by pin.created_at desc, pin.id desc
        limit 1`,
      [command.binding.id],
    )).rows[0];
    if (!pin) {
      const result = await appendProjectValue({ query: client.query.bind(client) }, command);
      await client.query("rollback");
      return result;
    }
    const commit = await createPendingSourceCommit(client, {
      bindingId: command.binding.id,
      oldValueId: command.expectedTip,
      targetValue: command.payload,
    });
    const result = await appendProjectValue({ query: client.query.bind(client) }, {
      ...command,
      source: { ...command.source, configRevisionId: pin.config_revision_id },
      sourceCommit: { requestId: commit.requestId, auditRef: commit.auditRef, derived: false },
    });
    if (!result.ok) {
      await client.query("rollback");
      return result;
    }
    if (result.value.outcome === "committed") {
      await client.query(
        `insert into parameter_catalog.project_value_source_pins (
           id, project_value_id, binding_id, definition_id, organization_id, project_id,
           source_occurrence_id, config_revision_id, file_id, file_version_id, format,
           property_occurrence_id, locator, locator_digest
         ) select $1, $2, binding.id, binding.definition_id, binding.organization_id,
                  binding.project_id, binding.source_occurrence_id, $3, $4, $5, $6, $7, $8::jsonb, $9
             from parameter_catalog.project_parameter_bindings binding
            where binding.id = $10`,
        [
          `src-pin-s6-commit-${result.value.value.id}`,
          result.value.value.id,
          pin.config_revision_id,
          pin.file_id,
          pin.file_version_id,
          pin.format,
          pin.property_occurrence_id,
          JSON.stringify(pin.locator),
          pin.locator_digest,
          command.binding.id,
        ],
      );
      await client.query(
        `insert into public.audit_events (
           id, organization_id, project_id, actor_type, app, kind, action, severity,
           target_type, target_id, metadata, trace_id
         ) values ($1,$2,$3,'system','parameter-bindings','project-value',$4,'info',
           'project-value',$5,$6::jsonb,$5)
         on conflict (id) do nothing`,
        [
          commit.auditRef,
          command.binding.organizationId,
          command.binding.projectId,
          "project-value-appended",
          result.value.value.id,
          JSON.stringify({ bindingId: command.binding.id, valueId: result.value.value.id }),
        ],
      );
    }
    await client.query("set constraints all immediate");
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

export const createSourceBackedBindingService = (
  pool: pg.Pool,
  options: {
    readonly sourceRef?: string;
    readonly initialPayload?: ProjectValuePayload;
    readonly objectStore?: ObjectStore;
    readonly keepPlaceholder?: boolean;
  } = {},
) => ({
  stabilize: async (
    command: StabilizeBindingCommand,
  ): Promise<Result<BindingResult, BindingConflict>> => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const fixture = await ensureSourceBackedBindingFixture(client, command, options.objectStore);
      const stabilized = await stabilizeCanonicalBinding(client, {
        ...command,
        sourceOccurrenceId: command.sourceOccurrenceId ?? fixture.sourceOccurrenceId,
      });
      if (!stabilized.ok || stabilized.value.outcome === "replayed") {
        await client.query(stabilized.ok ? "commit" : "rollback");
        return stabilized;
      }
      const currentValue = await query<{ source_ref: string }>(
        client,
        `select source_ref from parameter_catalog.project_parameter_values where id = $1`,
        [stabilized.value.binding.currentValueId],
      );
      if (currentValue.rows[0]?.source_ref !== "canonical-binding-identity") {
        await client.query("commit");
        return stabilized;
      }
      if (options.keepPlaceholder) {
        const definition = command.snapshot.getDefinitionById(command.definitionId);
        const locator = {
          kind: "dts-property",
          propertyOccurrenceId: fixture.propertyOccurrenceId,
          nodeOccurrenceId: fixture.nodeOccurrenceId,
          fileVersionId: fixture.fileVersionId,
          propertyName: definition.status === "found" ? definition.definition.propertyKey : command.definitionId,
        };
        await client.query(
          `insert into parameter_catalog.project_value_source_pins (
             id, project_value_id, binding_id, definition_id, organization_id, project_id,
             source_occurrence_id, config_revision_id, file_id, file_version_id, format,
             property_occurrence_id, locator, locator_digest
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'dts',$11,$12::jsonb,$13)`,
          [
            `src_pin_s6_${stabilized.value.binding.currentValueId.slice("pval_".length)}`,
            stabilized.value.binding.currentValueId,
            stabilized.value.binding.id,
            command.definitionId,
            command.organizationId,
            command.projectId,
            fixture.sourceOccurrenceId,
            fixture.configRevisionId,
            fixture.fileId,
            fixture.fileVersionId,
            fixture.propertyOccurrenceId,
            JSON.stringify(locator),
            `sha256:${createHash("sha256").update(serializeContract(locator)).digest("hex")}`,
          ],
        );
        await client.query("set constraints all immediate");
        await client.query("commit");
        return stabilized;
      }
      const appended = await appendProjectValue(
        { query: client.query.bind(client) },
        {
          snapshot: command.snapshot,
          binding: stabilized.value.binding,
          definitionRevisionId: command.effectiveRevisionId,
          source: {
          sourceRef: options.sourceRef ?? `${fixture.sourceName}!/${command.logicalNodeId}`,
          configRevisionId: fixture.configRevisionId,
        },
          payload: options.initialPayload ?? (options.objectStore ? { kind: "number", value: 5 } : { kind: "number", value: 0 }),
          expectedTip: stabilized.value.binding.currentValueId,
        },
      );
      if (!appended.ok) {
        await client.query("rollback");
        return { ok: false, error: { kind: "invalid-command", reason: "fixture-value" } };
      }
      const definition = command.snapshot.getDefinitionById(command.definitionId);
      const locator = {
        kind: "dts-property",
        propertyOccurrenceId: fixture.propertyOccurrenceId,
        nodeOccurrenceId: fixture.nodeOccurrenceId,
        fileVersionId: fixture.fileVersionId,
        propertyName: definition.status === "found" ? definition.definition.propertyKey : command.definitionId,
      };
      await client.query(
        `insert into parameter_catalog.project_value_source_pins (
           id, project_value_id, binding_id, definition_id, organization_id, project_id,
           source_occurrence_id, config_revision_id, file_id, file_version_id, format,
           property_occurrence_id, locator, locator_digest
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'dts',$11,$12::jsonb,$13)`,
        [
          `src_pin_s6_${appended.value.value.id.slice("pval_".length)}`,
          appended.value.value.id,
          stabilized.value.binding.id,
          command.definitionId,
          command.organizationId,
          command.projectId,
          fixture.sourceOccurrenceId,
          fixture.configRevisionId,
          fixture.fileId,
          fixture.fileVersionId,
          fixture.propertyOccurrenceId,
          JSON.stringify(locator),
          `sha256:${createHash("sha256").update(serializeContract(locator)).digest("hex")}`,
        ],
      );
      await client.query("set constraints all immediate");
      await client.query("commit");
      return {
        ok: true,
        value: {
          outcome: "committed",
          binding: { ...stabilized.value.binding, currentValueId: appended.value.currentTip },
        },
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },
});

export const sourceBackedCommand = async (
  client: FixtureClient,
  command: StabilizeBindingCommand,
): Promise<StabilizeBindingCommand> => {
  const fixture = await ensureSourceBackedBindingFixture(client, command);
  return { ...command, sourceOccurrenceId: command.sourceOccurrenceId ?? fixture.sourceOccurrenceId };
};
