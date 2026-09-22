import { randomUUID } from "node:crypto";

import type { RootDatabase } from "../../../shared/database/client";
import { getRootPostgresPool } from "../../../shared/database/client";
import { makeTestAuthContext } from "../../../testing/authContext";
import type { AuthContext } from "../../auth/types";
import { compileCatalogRelease } from "../../catalog-kernel/compiler";
import { refreshAuthoritativeSource } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import {
  jsonCatalogReleaseSource,
  PropertyKey,
  type CatalogSnapshot,
} from "../../catalog-kernel/interface";
import { createCatalogInstaller } from "../../catalog-kernel/install/installer";
import {
  firstReleaseBundle,
  SUBJECT_ID,
} from "../../catalog-kernel/runtime/catalogChain.fixture";
import { writeGuardedRegistration } from "../../parameter-governance/registration/internalGuardedRegistrationWriter";
import type { RegisterSubjectCommand } from "../../parameter-governance/registration/command";
import {
  asValueClient,
  loadPublishedCatalog as loadPublishedCatalogSnapshot,
  rawTextToPayload,
  syncPublishedCatalogProjectValuesInTransaction,
} from "../../parameter-bindings/catalogProjectValueSync";
import { writeCanonicalBinding } from "../../parameter-bindings/binding/service";
import type { Binding } from "../../parameter-bindings/binding/types";
import { writebackProtectedReference } from "../../parameter-bindings/adapters";
import {
  CatalogSubjectId,
  ParameterBindingId,
  SubjectRegistrationId,
} from "../../parameter-catalog-contract";
import type { CatalogReleaseBundle } from "../../catalog-kernel/compiler/types";
import { ingestConfigRevision } from "../../parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../../parameter-topology/types";
import { withAuditedWrite } from "../../audit/auditedWrite";
import { deriveDtsSourceRef } from "../../dts/sourceRef";

const ORGANIZATION_ID = "org-1";
const PROJECT_ID = "project-1";
const USER_ID = "user-1";
const DRIVER_MODULE_ID = "mod-dts-reload-service";
const DRIVER_ATTRIBUTION_ID = "attr-dts-reload-service";

type CandidateInput = {
  bindingId: string;
  propertyKey?: string;
  displayName?: string;
  nodePath?: string | null;
  compatible?: string | null;
  baselineValue?: string | null;
  description?: string | null;
  valueShape?: Record<string, unknown>;
  unit?: string | null;
  constraints?: Record<string, unknown>;
};

type MutableDefinition = {
  kind: "definition";
  content: {
    id: string;
    subjectId: string;
    propertyKey: string;
    revision: {
      id: string;
      number: number;
      contentDigest: string;
      lifecycle: "active";
      displayName: string;
      documentation: string;
      valueSchema: Record<string, unknown>;
      matching: {
        sourceProperty: string;
        selectorKind: "driver-compatible";
      };
      unit?: string;
    };
  };
};

type MutableAlias = {
  kind: "alias";
  content: {
    id: string;
    subjectId: string;
    selectorKind: "driver-compatible";
    normalizedSelector: string;
    lifecycle: "active";
    selectorProvenance: { source: string };
    tombstone: null;
  };
};

type MutableRelease = {
  documents: Array<
    | MutableDefinition
    | MutableAlias
    | { kind: string; content: Record<string, unknown> }
  >;
};

const DEFAULT_SHAPES: Record<string, Record<string, unknown>> = {
  watchdog_time: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 },
  active_perf_limit: { kind: "u32-array" },
  gpio_int: { kind: "mixed" },
  prevfod1_product_list: { kind: "bytes" },
  replace_sensor: { kind: "string" },
  vout_ovp_mv: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 },
  "current-speed": { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 },
  watchdog_tyme: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 },
};

const DEFAULT_CONSTRAINTS: Record<string, Record<string, unknown>> = {
  watchdog_time: { min: 0, max: 20_000 },
  active_perf_limit: {},
  gpio_int: {},
  prevfod1_product_list: {},
  replace_sensor: {},
  vout_ovp_mv: { min: 0, max: 20_000 },
  "current-speed": { min: 0, max: 4_000_000 },
  watchdog_tyme: { min: 0, max: 20_000 },
};

function seedAuth(): AuthContext {
  return makeTestAuthContext({
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
    name: "Riley Chen",
    email: "riley@example.com",
    title: "Hardware Committer",
    organizationName: "ChargeLab",
    roles: [{ projectId: PROJECT_ID, roleId: "hardware-committer" }],
  });
}

function safePart(value: string): string {
  return (
    value
      .replace(/[^a-z0-9]+/giu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 32) || "candidate"
  );
}

function valueSchemaFor(
  constraints: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: "integer" };
  if (typeof constraints?.min === "number") schema.minimum = constraints.min;
  if (typeof constraints?.max === "number") schema.maximum = constraints.max;
  if (typeof constraints?.minItems === "number")
    schema.minItems = constraints.minItems;
  if (typeof constraints?.maxItems === "number")
    schema.maxItems = constraints.maxItems;
  return schema;
}

function sourceTextFor(
  input: CandidateInput,
  propertyKey: string,
  sourcePath: string,
): string {
  const segments = sourcePath.split("/").filter(Boolean);
  const compatible = input.compatible ?? "sc8562";
  const rawValue =
    input.baselineValue === null ? "" : (input.baselineValue ?? "<6000>");
  const property =
    rawValue === "" ? `${propertyKey};` : `${propertyKey} = ${rawValue};`;
  let node = `\t\tcompatible = \"${compatible}\";\n\t\t${property}`;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const indent = "\t".repeat(index + 1);
    node = `${indent}${segments[index]} {\n${node}\n${indent}};`;
  }
  const gpioLabel = rawValue.includes("&gpio13")
    ? "\tgpio13: gpio13 {};\n"
    : "";
  return `/dts-v1/;\n\n/ {\n${gpioLabel}${node}\n};\n`;
}

function makeCatalogBundle(input: CandidateInput): CatalogReleaseBundle {
  const propertyKey = input.propertyKey ?? "watchdog_time";
  const bundle = structuredClone(firstReleaseBundle()) as unknown as {
    schemaVersion: string;
    targetReleaseId: string;
    releases: MutableRelease[];
  };
  const release = bundle.releases[0]!;
  const baseDefinition = release.documents.find(
    (document): document is MutableDefinition => document.kind === "definition",
  );
  if (!baseDefinition)
    throw new Error("service fixture base Catalog definition missing");
  const baseAlias = release.documents.find(
    (document): document is MutableAlias => document.kind === "alias",
  );
  if (!baseAlias) throw new Error("service fixture base Catalog alias missing");

  const aliases = ["sc8562", "vendor,watchdog-v2"].map((selector, index) => {
    const alias = structuredClone(baseAlias);
    alias.content.id = `cali_dts_reload_service_${index}`;
    alias.content.normalizedSelector = selector;
    return alias;
  });
  release.documents.push(...aliases);

  const keys = new Set([...Object.keys(DEFAULT_SHAPES), propertyKey]);
  for (const [index, key] of [...keys].sort().entries()) {
    const definition = structuredClone(baseDefinition);
    definition.content.id = `pdef_dts_reload_service_${safePart(key)}`;
    definition.content.propertyKey = key;
    definition.content.revision.id = `drev_dts_reload_service_${safePart(key)}_1`;
    definition.content.revision.displayName =
      key === propertyKey ? (input.displayName ?? "Watchdog") : key;
    definition.content.revision.documentation =
      key === propertyKey
        ? input.description === undefined
          ? "Watchdog timeout for charger safety."
          : (input.description ?? "")
        : key;
    definition.content.revision.valueSchema = valueSchemaFor(
      key === propertyKey
        ? input.constraints === undefined
          ? (DEFAULT_CONSTRAINTS[key] ?? {})
          : input.constraints
        : (DEFAULT_CONSTRAINTS[key] ?? {}),
    );
    definition.content.revision.matching.sourceProperty = key;
    if (key === propertyKey && input.unit !== null) {
      definition.content.revision.unit = input.unit ?? "ms";
    } else {
      delete definition.content.revision.unit;
    }
    // Keep the generated definition identities unique even when a future test adds a key.
    if (index === 0) definition.content.revision.number = 1;
    release.documents.push(definition);
  }

  refreshAuthoritativeSource(
    release as Parameters<typeof refreshAuthoritativeSource>[0],
  );
  return bundle as unknown as CatalogReleaseBundle;
}

async function installCatalogAndRegistration(
  root: RootDatabase,
  input: CandidateInput,
): Promise<{ snapshot: CatalogSnapshot; registrationId: string }> {
  const pool = getRootPostgresPool(root);
  if (!pool)
    throw new Error("service fixture requires a root PostgreSQL database");
  const bundle = makeCatalogBundle(input);
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) {
    throw new Error(
      `service fixture Catalog compile failed: ${compiled.error.violations.map((violation) => violation.detail).join(", ")}`,
    );
  }
  const installed = await createCatalogInstaller(pool).installPublishedRelease({
    mode: "bootstrap",
    source: jsonCatalogReleaseSource(bundle),
    expectedTargetDigest: compiled.value.aggregateDigest,
  });
  if (!installed.ok)
    throw new Error(
      `service fixture Catalog install failed: ${installed.error.kind}`,
    );

  await pool.query(
    `insert into attribution_subjects
       (id, organization_id, subject_kind, display_name, source_key)
     values ($1,$2,'driver-registration','DTS reload service','compatible:acme,power')
     on conflict (id) do nothing`,
    [DRIVER_ATTRIBUTION_ID, ORGANIZATION_ID],
  );
  await pool.query(
    `insert into driver_registrations
       (attribution_subject_id, driver_nature, instance_cardinality)
     values ($1,'physical-device','multiple') on conflict do nothing`,
    [DRIVER_ATTRIBUTION_ID],
  );
  await pool.query(
    `insert into parameter_modules
       (id, organization_id, parent_id, name, path, depth, sort_order,
        description, scope, kind, origin, source_key, attribution_subject_id)
     values
       ('mod-dts-reload-service-root',$1,null,'DTS reload service',
        'mod-dts-reload-service-root',1,0,'','','business','curated',null,null),
       ($2,$1,'mod-dts-reload-service-root','Acme power',
        $2,2,0,'','','driver-group','curated','compatible:acme,power',$3)
     on conflict (id) do nothing`,
    [ORGANIZATION_ID, DRIVER_MODULE_ID, DRIVER_ATTRIBUTION_ID],
  );

  const client = await pool.connect();
  let registrationId: string;
  try {
    await client.query("begin");
    await client.query("set constraints all deferred");
    const command: RegisterSubjectCommand = {
      kind: "register",
      organizationId: ORGANIZATION_ID,
      subjectId: CatalogSubjectId(SUBJECT_ID),
      subjectKind: "driver",
      expectedRelease: compiled.value.release,
      placement: { mode: "use-default" },
      destinationModuleId: DRIVER_MODULE_ID,
      method: "explicit",
      proof: { reason: "dts-reload-service-canonical-fixture" },
      idempotencyKey: `dts-reload-service-registration-${randomUUID()}`,
      context: { actorKind: "org-admin", principalId: USER_ID },
    };
    const registered = await writeGuardedRegistration(client, command);
    if (!registered.ok)
      throw new Error(
        `service fixture registration failed: ${registered.error.kind}`,
      );
    registrationId = registered.value.registrationId;
    await client.query("set constraints all immediate");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const snapshot = await loadPublishedCatalogSnapshot(pool);
  if (!snapshot)
    throw new Error("service fixture Catalog snapshot unavailable");
  return { snapshot, registrationId: registrationId! };
}

export type CanonicalServiceFixture = {
  seedCandidate: (input: CandidateInput) => Promise<void>;
  configRevisionId: (bindingId: string) => string;
};

export async function createCanonicalServiceFixture(
  root: RootDatabase,
): Promise<CanonicalServiceFixture> {
  const pool = getRootPostgresPool(root);
  if (!pool)
    throw new Error("service fixture requires a root PostgreSQL database");
  let catalog: Awaited<
    ReturnType<typeof installCatalogAndRegistration>
  > | null = null;
  let sequence = 0;
  const revisions = new Map<string, string>();

  const seedCandidate = async (input: CandidateInput): Promise<void> => {
    const propertyKey = input.propertyKey ?? "watchdog_time";
    if (propertyKey === "status") return;
    catalog ??= await installCatalogAndRegistration(root, input);
    sequence += 1;
    const slug = `${safePart(input.bindingId)}-${sequence}`;
    const configSetId = `dcs-dts-reload-${slug}`;
    const fileId = `file-dts-reload-${slug}`;
    const fileVersionId = `filev-dts-reload-${slug}`;
    const sourceName = `dts-reload-${slug}.dts`;
    const requestedNodePath =
      input.nodePath === undefined
        ? "/amba/i2c@FDF5E000/sc8562@6E"
        : (input.nodePath ?? `/dts-reload-${slug}`);
    const sourceText = sourceTextFor(input, propertyKey, requestedNodePath);
    const auth = seedAuth();

    await pool.query(
      `insert into dts_config_set
         (id, organization_id, project_id, name, description)
       values ($1,$2,$3,$4,'DTS reload service canonical source')`,
      [configSetId, ORGANIZATION_ID, PROJECT_ID, `source-${slug}`],
    );
    await pool.query(
      `insert into project_parameter_files
         (id, organization_id, project_id, file_name, format, enabled,
          config_set_id, config_set_role, config_set_sort_order)
       values ($1,$2,$3,$4,'dts',true,$5,'base',0)`,
      [fileId, ORGANIZATION_ID, PROJECT_ID, sourceName, configSetId],
    );
    await pool.query(
      `insert into project_parameter_file_versions
         (id, file_id, version_number, storage_key, checksum, size_bytes,
          parsed_index, origin, created_by_user_id)
       values ($1,$2,1,$3,$4,$5,'{}'::jsonb,'upload',$6)`,
      [
        fileVersionId,
        fileId,
        `${ORGANIZATION_ID}/${sourceName}`,
        `sha-${sourceName}`,
        Buffer.byteLength(sourceText, "utf8"),
        USER_ID,
      ],
    );
    await pool.query(
      `update project_parameter_files set current_version_id=$1 where id=$2`,
      [fileVersionId, fileId],
    );
    const manifest: ConfigRevisionManifest = {
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      configSetId,
      entryFile: sourceName,
      includeSearchPaths: ["."],
      overlayOrder: [],
      members: [
        {
          fileId,
          fileVersionId,
          fileName: sourceName,
          sourceName,
          role: "base",
          sortOrder: 0,
          content: sourceText,
        },
      ],
    };
    const revision = await ingestConfigRevision(root, manifest, auth, {
      legacyProjection: "skip",
    });
    if (revision.status !== "resolved") {
      throw new Error(
        `service fixture source ingest did not resolve: ${revision.status}`,
      );
    }

    const observed = await pool.query<{
      logical_node_id: string;
      node_locator: string;
      property_occurrence_id: string;
      node_occurrence_id: string;
      file_version_id: string;
      raw_text: string;
      file_id: string;
      source_name: string;
    }>(
      `select lnr.logical_node_id,lnr.node_locator,
              po.id as property_occurrence_id,po.node_occurrence_id,
              po.file_version_id,po.raw_text,file.id as file_id,
              member.source_name
         from dts_occurrence_effects effect
         join dts_logical_node_revisions lnr on lnr.id=effect.logical_node_revision_id
         join dts_property_occurrences po on po.id=effect.property_occurrence_id
         join project_parameter_files file on file.id=$2
         join dts_config_revision_members member
           on member.config_revision_id=effect.config_revision_id
          and member.file_id=file.id and member.file_version_id=po.file_version_id
        where effect.config_revision_id=$1
          and effect.property_name=$3
          and effect.effect_kind in ('set','override')
        order by effect.source_order desc limit 1`,
      [revision.id, fileId, propertyKey],
    );
    const row = observed.rows[0];
    if (!row)
      throw new Error(
        `service fixture source property missing: ${propertyKey}`,
      );

    if (input.nodePath === null) {
      await pool.query(
        `update dts_logical_node_revisions set node_locator='' where logical_node_id=$1 and config_revision_id=$2`,
        [row.logical_node_id, revision.id],
      );
      await pool.query(
        `update dts_node_occurrences set node_path='', ref_target=null where id=$1 and config_revision_id=$2`,
        [row.node_occurrence_id, revision.id],
      );
      row.node_locator = "";
    }

    const sourceOccurrenceId = `socc-dts-reload-${slug}`;
    await pool.query(
      `insert into parameter_catalog.project_parameter_source_occurrences
         (id, organization_id, project_id, config_set_id, file_id,
          occurrence_kind, logical_node_id)
       values ($1,$2,$3,$4,$5,'dts',$6)`,
      [
        sourceOccurrenceId,
        ORGANIZATION_ID,
        PROJECT_ID,
        configSetId,
        row.file_id,
        row.logical_node_id,
      ],
    );
    const definition = catalog.snapshot.getDefinition({
      subjectId: CatalogSubjectId(SUBJECT_ID),
      propertyKey: PropertyKey(propertyKey),
    });
    if (definition.status !== "found") {
      throw new Error(
        `service fixture Catalog definition missing: ${propertyKey}`,
      );
    }
    const synced = await withAuditedWrite(root, auth,
      { requestId: `dts-reload-service-sync-${randomUUID()}` }, async (tx) => {
      const write = asValueClient(tx);
    const stabilized = await writeCanonicalBinding(
      write,
      {
        snapshot: catalog!.snapshot,
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        logicalNodeId: row.logical_node_id,
        sourceOccurrenceId,
        registrationId: SubjectRegistrationId(catalog!.registrationId),
        definitionId: definition.definition.id,
        effectiveRevisionId: definition.definition.selectedRevision.id,
        expectedEffectiveRevisionId: null,
      },
      { preservedBindingId: ParameterBindingId(input.bindingId) },
    );
    if (!stabilized.ok)
      throw new Error(
        `service fixture Binding failed: ${stabilized.error.kind}`,
      );
    const binding: Binding = stabilized.value.binding;
    const payload = rawTextToPayload(propertyKey, row.raw_text);
    const sourceRef = deriveDtsSourceRef({
      fileName: row.source_name,
      nodeLocator: row.node_locator || null,
    });
    const writtenBack = await writebackProtectedReference(write, {
      snapshot: catalog!.snapshot,
      binding,
      definitionRevisionId: definition.definition.selectedRevision.id,
      source: { sourceRef, configRevisionId: revision.id },
      payload,
      expectedTip: binding.currentValueId,
    });
    if (!writtenBack.ok)
      throw new Error(
        `service fixture ProjectValue failed: ${writtenBack.error.reason}`,
      );
    const locator = {
      kind: "dts-property",
      propertyOccurrenceId: row.property_occurrence_id,
      nodeOccurrenceId: row.node_occurrence_id,
      fileVersionId: row.file_version_id,
      propertyName: propertyKey,
    };
    await write.query(
      `insert into parameter_catalog.project_value_source_pins
         (id, project_value_id, binding_id, definition_id, organization_id, project_id,
          source_occurrence_id, config_revision_id, file_id, file_version_id,
          format, property_occurrence_id, locator, locator_digest)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'dts',$11,$12::jsonb,
               parameter_catalog.canonical_dts_parameter_locator_digest($12::jsonb))`,
      [
        `spin-dts-reload-${slug}`,
        writtenBack.value.value.id,
        binding.id,
        definition.definition.id,
        ORGANIZATION_ID,
        PROJECT_ID,
        sourceOccurrenceId,
        revision.id,
        row.file_id,
        row.file_version_id,
        row.property_occurrence_id,
        JSON.stringify(locator),
      ],
    );

      const count = await syncPublishedCatalogProjectValuesInTransaction(write, catalog!.snapshot, {
        organizationId: ORGANIZATION_ID, projectId: PROJECT_ID, configSetId, configRevisionId: revision.id
      });
      return { result: count, audit: null };
    });
    if (synced !== 1)
      throw new Error(`service fixture source sync wrote ${synced} rows`);
    revisions.set(input.bindingId, revision.id);
  };

  return {
    seedCandidate,
    configRevisionId: (bindingId) => {
      const revision = revisions.get(bindingId);
      if (!revision)
        throw new Error(`service fixture revision missing: ${bindingId}`);
      return revision;
    },
  };
}
