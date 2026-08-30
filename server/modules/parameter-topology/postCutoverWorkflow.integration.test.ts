/**
 * Task 1–3: post-cutover activity workflow on a temp DB.
 * migrate → cutover → list/draft/submit/review/merge/writeback/debug/delete
 * plus exact locked merge/writeback and stale 409 guards.
 */
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";

import { createDatabase, createPostgresDatabase, type Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { makeTestAuthContext } from "../../testing/authContext";
import { withTempDatabase as withSharedTempDatabase } from "../../testing/tempDatabase";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";
import type { AuthContext } from "../auth/types";
import { createAgentInvocation, createSystemInvocation, createUserInvocation } from "../auth/trustedInvocation";
import { createTrustedRefusalAuditSink, type TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { asAuditTx } from "../audit/auditedWrite";
import { insertNodeOperation } from "../debugging/repository";
import type { DtsToolchainRunner } from "../parameter-files/dtsToolchain";
import { writebackMergedEnablementValue, writebackMergedParameterValue } from "../parameter-files/writebackService";
import { resolveParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import {
  listParameterHistory,
  listParameters
} from "../parameters/repository";
import {
  getChangeRequestWriteLock,
  listDraftsForUser,
  upsertDraft
} from "../parameter-drafts/repository";
import { deleteProject } from "../projects/repository";
import {
  createChangeRequest,
  createSubmissionItem,
  createSubmissionRound,
  mergeChangeRequest,
  updateChangeRequestStatus
} from "../parameters/reviewWorkflowRepository";
import { reviewChange as reviewChangeService, saveDraft, submitParameterChanges } from "../parameters/service";
import type { ParameterReviewContext } from "../parameters/service";
import { createTestParameterSubmissionContext } from "../parameters/testSubmissionContext";
import { resolveBindingWriteLock, resolveEnablementWriteLock } from "./writeLock";
import {
  applyParameterIdentityCutover,
  migrateParameterIdentities,
  stableSemanticId
} from "./migration";
import { createNodeEnablementDraft } from "./editService";
import { createBindingDraft as createBindingDraftService } from "./service";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const ORG = "org-pcw-t1t2";
const PROJECT = "project-pcw-t1t2";
const USER = "user-pcw-t1t2";
const CONFIG_SET = "dcs-pcw-t1t2";

function reviewChange(
  db: Parameters<typeof reviewChangeService>[0],
  auth: AuthContext,
  input: Parameters<typeof reviewChangeService>[2],
  context: ParameterReviewContext = {}
) {
  return reviewChangeService(db, auth, input, {
    ...createTestParameterSubmissionContext(auth, `review-${input.requestId}`),
    ...context
  });
}
const DEF_ID = "pd-pcw-gpio-int";
const PPV_ID = "ppv-pcw-gpio-int";
const SCHEMA_NS = "vendor";
const PROPERTY_KEY = "gpio_int";
const DRIVER = "sc8562";
const DRIVER_SUBJECT = "asub-pcw-sc8562";
const DRIVER_SCHEMA_SPEC = "pspec-pcw-sc8562-schema";
const DRIVER_SCHEMA_VERSION = "psv-pcw-sc8562-schema";
const DRIVER_SCHEMA = "ds-pcw-sc8562";
const DRIVER_SCHEMA_VERSION_ID = "dsv-pcw-sc8562-v1";
const DRIVER_CATEGORY_MODULE = "pmod-pcw-power";
const DRIVER_GROUP_MODULE = "pmod-pcw-sc8562";
const NODE_LOCATOR = "/amba/i2c@FDF5E000/sc8562@6E";
const SOURCE_NODE_PATH = "amba/i2c@FDF5E000/sc8562@6E/gpio_int";

const databaseAvailable = await isTestDatabaseAvailable();

const MAINTENANCE_TOKEN = "test-maintenance-token";
const applyGates = {
  maintenanceToken: MAINTENANCE_TOKEN,
  expectedMaintenanceToken: MAINTENANCE_TOKEN,
  writeLockConfirmed: true as const
};

const passToolchain: DtsToolchainRunner = {
  async validate() {
    return {
      ok: true,
      mode: "release",
      compiler: { dtc: "1.8.1", fdtoverlay: "1.8.1", dtschema: "2026.6" },
      diagnostics: [],
      artifacts: {}
    };
  },
  async probe() {
    return {
      dtc: { path: "/usr/bin/dtc", version: "1.8.1" },
      fdtoverlay: { path: "/usr/bin/fdtoverlay", version: "1.8.1" },
      dtschema: { path: "/usr/bin/dt-validate", version: "2026.6" }
    };
  }
};

function expectedSpecId() {
  return stableSemanticId("parameter_spec", [ORG, "dts", SCHEMA_NS, PROPERTY_KEY]);
}

function expectedLogicalNodeId() {
  return stableSemanticId("dts_logical_node", [PROJECT, CONFIG_SET, NODE_LOCATOR]);
}

function expectedBindingId(specId: string, logicalNodeId: string) {
  return stableSemanticId("project_parameter_binding", [PROJECT, logicalNodeId, specId]);
}

async function withTempDatabase(fn: (db: Database, connectionString: string) => Promise<void>) {
  await withSharedTempDatabase({ prefix: "pcw" }, ({ db, connectionString }) =>
    fn(db, connectionString)
  );
}

async function withRefusalSink<T>(
  connectionString: string,
  fn: (sink: TrustedRefusalAuditSink) => Promise<T>
): Promise<T> {
  const root = createPostgresDatabase(connectionString);
  let primaryError: unknown;
  try {
    return await fn(createTrustedRefusalAuditSink(root));
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await root.close();
    } catch (cleanupError) {
      if (primaryError === undefined) throw cleanupError;
    }
  }
}

function makeAuth(): AuthContext {
  return makeTestAuthContext({
    userId: USER,
    organizationId: ORG,
    name: "PCW User",
    email: "pcw@example.com",
    organizationName: "PCW Org",
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"]
  });
}

async function seedPreCutoverGraph(db: Database) {
  const specId = expectedSpecId();
  const specVersionId = stableSemanticId("parameter_spec_version", [specId, "1"]);
  const logicalNodeId = expectedLogicalNodeId();
  const propertySpecId = stableSemanticId("dts_property_spec", [specId, PROPERTY_KEY]);
  const configRevisionId = "rev-pcw-1";
  const fileId = "file-pcw-1";
  const fileVersionId = "fv-pcw-1";
  const overlayFileId = "file-pcw-overlay";
  const overlayVersionId = "fv-pcw-overlay";
  const content = `/dts-v1/;
/ {
	amba {
		i2c@FDF5E000 {
			sc8562: sc8562@6E {
				compatible = "sc8562";
				gpio_int = <1>;
			};
		};
	};
};
`;
  const overlayContent = `/dts-v1/;
/plugin/;

&sc8562 {
};
`;
  const checksum = createHash("sha256").update(content, "utf8").digest("hex");
  const overlayChecksum = createHash("sha256").update(overlayContent, "utf8").digest("hex");

  await db.query(`insert into organizations (id, name) values ($1, 'PCW Org')`, [ORG]);
  await db.query(
    `insert into users (id, organization_id, name, email, title, is_active)
     values ($1, $2, 'PCW User', 'pcw@example.com', 'Admin', true)`,
    [USER, ORG]
  );
  await db.query(
    `insert into projects (id, organization_id, name, code, status)
     values ($1, $2, 'PCW Project', 'PCW', 'initialized')`,
    [PROJECT, ORG]
  );
  await db.query(
    `insert into dts_config_set (id, organization_id, project_id, name, description)
     values ($1, $2, $3, 'pcw-power', 't1t2')`,
    [CONFIG_SET, ORG, PROJECT]
  );
  // The graph below intentionally keeps the legacy flat rows used by the
  // migration assertions, but it also carries a complete canonical driver
  // identity. Post-cutover writeback must now prove this subject/schema/
  // placement tuple before it can create a recognized binding.
  await db.query(
    `insert into attribution_subjects (
       id, organization_id, subject_kind, display_name, origin, source_key
     ) values ($1, null, 'driver-registration', 'SC8562', 'curated', 'compatible:sc8562')`,
    [DRIVER_SUBJECT]
  );
  await db.query(
    `insert into driver_registrations (
       attribution_subject_id, driver_nature, instance_cardinality, notes
     ) values ($1, 'physical-device', 'multiple', 'post-cutover workflow fixture')`,
    [DRIVER_SUBJECT]
  );
  await db.query(
    `insert into parameter_modules (
       id, organization_id, parent_id, name, path, depth, sort_order,
       description, scope, kind, origin, source_key, attribution_subject_id
     ) values
       ($1, $2, null, 'Power', $1, 1, 0, '', '', 'business', 'curated', null, null),
       ($3, $2, $1, 'SC8562', $3, 2, 0, '', '', 'driver-group', 'curated',
        'compatible:sc8562', $4)`,
    [DRIVER_CATEGORY_MODULE, ORG, DRIVER_GROUP_MODULE, DRIVER_SUBJECT]
  );
  await db.query(
    `insert into driver_registration_placements (
       id, organization_id, attribution_subject_id, driver_group_module_id,
       default_business_category_module_id
     ) values ($1, $2, $3, $4, $5)`,
    ["drp-pcw-sc8562", ORG, DRIVER_SUBJECT, DRIVER_GROUP_MODULE, DRIVER_CATEGORY_MODULE]
  );
  await db.query(
    `insert into parameter_module_mappings (
       id, organization_id, parameter_module_id, match_kind, match_value, priority
     ) values ($1, $2, $3, 'compatible', $4, 500)`,
    ["pmap-pcw-sc8562", ORG, DRIVER_GROUP_MODULE, "sc8562"]
  );
  await db.query(
    `insert into parameter_specs (
       id, organization_id, source_kind, specification_key, definition_lifecycle,
       attribution_subject_id
     ) values ($1, null, 'dts', 'schema/vendor,sc8562', 'active', $2)`,
    [DRIVER_SCHEMA_SPEC, DRIVER_SUBJECT]
  );
  await db.query(
    `insert into parameter_spec_versions (
       id, parameter_spec_id, version, display_name, description, value_shape,
       lifecycle, version_status, documentation
     ) values ($1, $2, 1, 'SC8562 schema', 'schema root', '{"kind":"unknown"}'::jsonb,
       'active', 'active', 'fixture schema')`,
    [DRIVER_SCHEMA_VERSION, DRIVER_SCHEMA_SPEC]
  );
  await db.query(
    `insert into driver_schemas (
       id, parameter_spec_id, organization_id, schema_namespace, attribution_subject_id
     ) values ($1, $2, null, 'vendor', $3)`,
    [DRIVER_SCHEMA, DRIVER_SCHEMA_SPEC, DRIVER_SUBJECT]
  );
  await db.query(
    `insert into driver_schema_versions (
       id, driver_schema_id, parameter_spec_version_id, version,
       compatible_patterns, parent_bus_constraints, source, lifecycle
     ) values ($1, $2, $3, 1, '["sc8562"]'::jsonb, '{}'::jsonb, 'vendor', 'active')`,
    [DRIVER_SCHEMA_VERSION_ID, DRIVER_SCHEMA, DRIVER_SCHEMA_VERSION]
  );
  await db.query(
    `insert into parameter_specs (
       id, organization_id, source_kind, specification_key, attribution_subject_id, property_key
     ) values ($1, $2, 'dts', $3, $4, $5)`,
    [specId, null, `${DRIVER}/${PROPERTY_KEY}`, DRIVER_SUBJECT, PROPERTY_KEY]
  );
  await db.query(
    `insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape, lifecycle
    ) values ($1, $2, 1, 'gpio_int', 'GPIO interrupt', '{"kind":"cells","bits":32}'::jsonb, 'active')`,
    [specVersionId, specId]
  );
  await db.query(
    `insert into dts_property_specs (
       id, parameter_spec_id, driver_schema_id, property_key, schema_namespace, constraints
     ) values ($1, $2, $3, $4, $5, '{}'::jsonb)`,
    [propertySpecId, specId, DRIVER_SCHEMA, PROPERTY_KEY, SCHEMA_NS]
  );
  await db.query(
    `insert into project_parameter_files (
      id, organization_id, project_id, file_name, format, enabled,
      config_set_id, config_set_role, config_set_sort_order
    ) values ($1, $2, $3, 'pcw-base.dts', 'dts', true, $4, 'base', 0)`,
    [fileId, ORG, PROJECT, CONFIG_SET]
  );
  await db.query(
    `insert into project_parameter_file_versions (
      id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
    ) values ($1, $2, 1, $3, $4, $5, '{}'::jsonb, 'upload', $6)`,
    [fileVersionId, fileId, `${ORG}/${checksum}-pcw-base.dts`, checksum, Buffer.byteLength(content), USER]
  );
  await db.query(
    `insert into dts_nodes (id, file_version_id, name, node_path, compatible)
     values ($1, $2, 'sc8562', $3, 'vendor,sc8562')`,
    [`node-${fileVersionId}-sc8562`, fileVersionId, NODE_LOCATOR]
  );
  await db.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [
    fileVersionId,
    fileId
  ]);
  await db.query(
    `insert into project_parameter_files (
      id, organization_id, project_id, file_name, format, enabled,
      config_set_id, config_set_role, config_set_sort_order
    ) values ($1, $2, $3, 'pcw-overlay.dts', 'dts', true, $4, 'overlay', 1)`,
    [overlayFileId, ORG, PROJECT, CONFIG_SET]
  );
  await db.query(
    `insert into project_parameter_file_versions (
      id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
    ) values ($1, $2, 1, $3, $4, $5, $6::jsonb, 'upload', $7)`,
    [
      overlayVersionId,
      overlayFileId,
      `${ORG}/${overlayChecksum}-pcw-overlay.dts`,
      overlayChecksum,
      Buffer.byteLength(overlayContent),
      JSON.stringify({ sourceText: overlayContent }),
      USER
    ]
  );
  await db.query(
    `insert into dts_nodes (id, file_version_id, name, node_path, compatible)
     values ($1, $2, 'sc8562', $3, 'vendor,sc8562')`,
    [`node-${overlayVersionId}-sc8562`, overlayVersionId, NODE_LOCATOR]
  );
  await db.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [
    overlayVersionId,
    overlayFileId
  ]);
  await db.query(
    `insert into dts_config_revisions (
      id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id,
      entry_file, include_search_paths, overlay_order, manifest_state
    ) values ($1, $2, $3, $4, 1, 'compiled', $5, 'pcw-base.dts', $6::jsonb, $7::jsonb, 'complete')`,
    [
      configRevisionId,
      ORG,
      PROJECT,
      CONFIG_SET,
      USER,
      JSON.stringify(["."]),
      JSON.stringify(["pcw-overlay.dts"])
    ]
  );
  await db.query(
    `insert into dts_config_revision_members (
      id, config_revision_id, file_id, file_version_id, role, sort_order
    ) values ($1, $2, $3, $4, 'base', 0)`,
    [`member-${configRevisionId}-base`, configRevisionId, fileId, fileVersionId]
  );
  await db.query(
    `insert into dts_config_revision_members (
      id, config_revision_id, file_id, file_version_id, role, sort_order
    ) values ($1, $2, $3, $4, 'overlay', 1)`,
    [`member-${configRevisionId}-overlay`, configRevisionId, overlayFileId, overlayVersionId]
  );
  await db.query(
    `insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
     values ($1, $2, $3, $4)`,
    [logicalNodeId, ORG, PROJECT, CONFIG_SET]
  );
  const logicalNodeRevisionId = `lnr-${logicalNodeId}`;
  await db.query(
    `insert into dts_logical_node_revisions (
      id, logical_node_id, config_revision_id, node_locator, name, unit_address,
      compatible, driver_schema_version_id, parent_logical_node_id
    ) values ($1, $2, $3, $4, 'sc8562', '6E', 'sc8562', $5, null)`,
    [logicalNodeRevisionId, logicalNodeId, configRevisionId, NODE_LOCATOR, DRIVER_SCHEMA_VERSION_ID]
  );
  const nodeOccurrenceId = "no-pcw-1";
  const propertyOccurrenceId = "po-pcw-gpio-int";
  await db.query(
    `insert into dts_node_occurrences (
      id, config_revision_id, file_version_id, name, labels, node_path,
      start_offset, end_offset, start_line, start_column, end_line, end_column,
      raw_text, ast_json, source_order
    ) values ($1, $2, $3, 'sc8562', '[]'::jsonb, $4, 0, 100, 1, 1, 5, 2, 'node', '{}'::jsonb, 0)`,
    [nodeOccurrenceId, configRevisionId, fileVersionId, "amba/i2c@FDF5E000/sc8562@6E"]
  );
  await db.query(
    `insert into dts_property_occurrences (
      id, config_revision_id, node_occurrence_id, file_version_id, property_name,
      start_offset, end_offset, start_line, start_column, end_line, end_column,
      raw_text, ast_json, source_order
    ) values ($1, $2, $3, $4, $5, 10, 20, 2, 3, 2, 10, '<1>', '{}'::jsonb, 0)`,
    [propertyOccurrenceId, configRevisionId, nodeOccurrenceId, fileVersionId, PROPERTY_KEY]
  );
  await db.query(
    `insert into dts_occurrence_effects (
      id, config_revision_id, logical_node_revision_id, property_occurrence_id, node_occurrence_id,
      property_name, effect_kind, source_order
    ) values ($1, $2, $3, $4, $5, $6, 'set', 1)`,
    [
      "oe-pcw-gpio-int",
      configRevisionId,
      logicalNodeRevisionId,
      propertyOccurrenceId,
      nodeOccurrenceId,
      PROPERTY_KEY
    ]
  );
  await db.query(
    `insert into parameter_definitions (
      id, organization_id, name, description, explanation, config_format,
      module, default_range, unit, risk
    ) values ($1, $2, $3, 'GPIO interrupt', 'legacy', 'DTS', $4, '', '', 'Low')`,
    [DEF_ID, ORG, PROPERTY_KEY, DRIVER]
  );
  await db.query(
    `insert into project_parameter_values (
      id, organization_id, project_id, parameter_definition_id,
      current_value, recommended_value, value_version, updated_by_user_id,
      source_file_name, source_node_path
    ) values ($1, $2, $3, $4, '<1>', '', 1, $5, 'pcw-base.dts', $6)`,
    [PPV_ID, ORG, PROJECT, DEF_ID, USER, SOURCE_NODE_PATH]
  );

  // Minimal open CR / draft / history so migrate can backfill semantic FKs.
  const roundId = "round-pcw-1";
  await db.query(
    `insert into parameter_submission_rounds (
      id, organization_id, project_id, submitter_user_id, status, summary
    ) values ($1, $2, $3, $4, 'submitted', 'seed')`,
    [roundId, ORG, PROJECT, USER]
  );
  await db.query(
    `insert into parameter_change_requests (
      id, organization_id, submission_round_id, project_id, project_parameter_value_id,
      parameter_definition_id, base_version, current_value, target_value, status, submitter_user_id
    ) values ($1, $2, $3, $4, $5, $6, 1, '<1>', '<2>', 'merged', $7)`,
    ["cr-pcw-seed", ORG, roundId, PROJECT, PPV_ID, DEF_ID, USER]
  );
  await db.query(
    `insert into parameter_history_entries (
      id, organization_id, project_id, parameter_definition_id, project_parameter_value_id,
      version, value, changed_by_user_id, request_id
    ) values ($1, $2, $3, $4, $5, 1, '<1>', $6, $7)`,
    ["hist-pcw-seed", ORG, PROJECT, DEF_ID, PPV_ID, USER, "cr-pcw-seed"]
  );
  await db.query(
    `insert into parameter_drafts (
      id, organization_id, project_id, project_parameter_value_id, user_id, target_value, reason, origin
    ) values ($1, $2, $3, $4, $5, '<3>', 'seed draft', 'manual')`,
    ["draft-pcw-seed", ORG, PROJECT, PPV_ID, USER]
  );

  return {
    specId,
    bindingId: expectedBindingId(specId, logicalNodeId),
    fileId,
    fileVersionId,
    overlayFileId,
    overlayVersionId,
    content,
    overlayContent,
    checksum,
    overlayChecksum,
    configRevisionId,
  };
}

async function seedPendingSetCandidate(
  db: Database,
  seeded: Awaited<ReturnType<typeof seedPreCutoverGraph>>,
  input: { candidateRevisionId: string; targetValue: string; revisionNumber?: number }
) {
  await db.query(
    `insert into dts_config_revisions (
       id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id,
       entry_file, include_search_paths, overlay_order, manifest_state
     )
     select $1, organization_id, project_id, config_set_id, $2, 'pending_approval', $3,
            entry_file, include_search_paths, overlay_order, manifest_state
     from dts_config_revisions where id = $4`,
    [input.candidateRevisionId, input.revisionNumber ?? 90, USER, seeded.configRevisionId]
  );
  await db.query(
    `insert into project_parameter_binding_revisions (
       id, binding_id, config_revision_id, parameter_spec_version_id,
       typed_value, canonical_value, raw_value, schema_state, policy_state
     )
     select $1, binding_id, $2, parameter_spec_version_id,
            typed_value, canonical_value, $3, schema_state, policy_state
     from project_parameter_binding_revisions
     where binding_id = $4 and config_revision_id = $5`,
    [`bpr-${input.candidateRevisionId}`, input.candidateRevisionId, input.targetValue, seeded.bindingId, seeded.configRevisionId]
  );
  return input.candidateRevisionId;
}

async function seedPendingDeleteCandidate(
  db: Database,
  seeded: Awaited<ReturnType<typeof seedPreCutoverGraph>>,
  input: { candidateRevisionId: string; revisionNumber?: number }
) {
  await db.query(
    `insert into dts_config_revisions (
       id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id,
       entry_file, include_search_paths, overlay_order, manifest_state
     )
     select $1, organization_id, project_id, config_set_id, $2, 'pending_approval', $3,
            entry_file, include_search_paths, overlay_order, manifest_state
     from dts_config_revisions where id = $4`,
    [input.candidateRevisionId, input.revisionNumber ?? 91, USER, seeded.configRevisionId]
  );
  const logicalNodeRevisionId = `lnr-${input.candidateRevisionId}`;
  await db.query(
    `insert into dts_logical_node_revisions (
       id, logical_node_id, config_revision_id, node_locator, name, unit_address, parent_logical_node_id
     ) values ($1, $2, $3, $4, 'sc8562', '6E', null)`,
    [logicalNodeRevisionId, expectedLogicalNodeId(), input.candidateRevisionId, NODE_LOCATOR]
  );
  await db.query(
    `insert into dts_occurrence_effects (
       id, config_revision_id, logical_node_revision_id, property_name, effect_kind, source_order
     ) values ($1, $2, $3, $4, 'delete', 1)`,
    [`oe-${input.candidateRevisionId}`, input.candidateRevisionId, logicalNodeRevisionId, PROPERTY_KEY]
  );
  return input.candidateRevisionId;
}

describe.skipIf(!databaseAvailable)("post-cutover semantic workflow (temp DB)", () => {
  it(
    "preserves System attribution for typed binding drafts",
    async () => {
      await withTempDatabase(async (db, connectionString) => {
        const seeded = await seedPreCutoverGraph(db);
        const report = await migrateParameterIdentities(db, {
          mode: "apply",
          organizationId: ORG,
          ...applyGates,
          dbSnapshotId: "db-snap-pcw-system-binding-red",
          objectSnapshotId: "obj-snap-pcw-system-binding-red"
        });
        expect(report.blockers).toEqual([]);
        await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
        await resolveParameterIdentityMode(db);
        await db.query(
          `update project_parameter_file_versions
           set parsed_index = jsonb_build_object('sourceText', $1::text)
           where id = $2`,
          [seeded.content, seeded.fileVersionId]
        );
        await db.query(
          `update project_parameter_file_versions
           set parsed_index = jsonb_build_object('sourceText', $1::text)
           where id = $2`,
          [seeded.overlayContent, seeded.overlayVersionId]
        );

        const auth = makeAuth();
        const putCalls: string[] = [];
        const objectStore = {
          async get(key: string) {
            return Buffer.from(key.includes("overlay") ? seeded.overlayContent : seeded.content, "utf8");
          },
          async put(input: { bytes: Buffer }) {
            putCalls.push(input.bytes.toString("utf8"));
            return {
              storageKey: `${ORG}/system-binding-red-${putCalls.length}.dts`,
              checksumSha256: createHash("sha256").update(input.bytes).digest("hex"),
              fileSizeBytes: input.bytes.length
            };
          }
        };

        await withRefusalSink(connectionString, async (refusalSink) => {
          await expect(
            createBindingDraftService(
              db,
              auth,
              {
                projectId: PROJECT,
                bindingId: seeded.bindingId,
                baseRevisionId: seeded.configRevisionId,
                targetValue: {
                  kind: "cells",
                  bits: 32,
                  groups: [[{ kind: "integer", raw: "2", value: "2" }]]
                },
                reason: "System typed binding attribution Red"
              },
              { objectStore },
              {
                invocation: createSystemInvocation({ kind: "job", name: "typed-binding-red-job" }),
                requestId: "typed-binding-system-red",
                refusalSink
              }
            )
          ).resolves.toMatchObject({ projectParameterBindingId: seeded.bindingId });
        });

        expect(putCalls).toHaveLength(1);
        const attribution = await db.query<{
          draft_user_id: string | null;
          draft_initiator_type: string;
          file_creator_user_id: string | null;
          file_initiator_type: string;
          file_system_kind: string | null;
          file_system_name: string | null;
        }>(
          `select
             d.user_id as draft_user_id,
             d.initiator_type as draft_initiator_type,
             fv.created_by_user_id as file_creator_user_id,
             fv.initiator_type as file_initiator_type,
             fv.initiator_system_kind as file_system_kind,
             fv.initiator_system_name as file_system_name
           from parameter_drafts d
           inner join dts_config_revision_members crm on crm.config_revision_id = d.candidate_config_revision_id
             and crm.role = 'overlay'
           inner join project_parameter_file_versions fv on fv.id = crm.file_version_id
           where d.project_id = $1 and d.initiator_type = 'system'
           order by d.updated_at desc
           limit 1`,
          [PROJECT]
        );
        expect(attribution.rows).toEqual([
          {
            draft_user_id: null,
            draft_initiator_type: "system",
            file_creator_user_id: null,
            file_initiator_type: "system",
            file_system_kind: "job",
            file_system_name: "typed-binding-red-job"
          }
        ]);
      });
    },
    120_000
  );

  it(
    "rolls back typed binding domain writes when the success audit fails",
    async () => {
      await withTempDatabase(async (db, connectionString) => {
        const seeded = await seedPreCutoverGraph(db);
        const report = await migrateParameterIdentities(db, {
          mode: "apply",
          organizationId: ORG,
          ...applyGates,
          dbSnapshotId: "db-snap-pcw-binding-audit-rollback-red",
          objectSnapshotId: "obj-snap-pcw-binding-audit-rollback-red"
        });
        expect(report.blockers).toEqual([]);
        await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
        await resolveParameterIdentityMode(db);
        await db.query(
          `update project_parameter_file_versions
           set parsed_index = jsonb_build_object('sourceText', $1::text)
           where id = $2`,
          [seeded.content, seeded.fileVersionId]
        );
        await db.query(
          `update project_parameter_file_versions
           set parsed_index = jsonb_build_object('sourceText', $1::text)
           where id = $2`,
          [seeded.overlayContent, seeded.overlayVersionId]
        );

        const auth = makeAuth();
        const putCalls: string[] = [];
        const objectStore = {
          async get(key: string) {
            return Buffer.from(key.includes("overlay") ? seeded.overlayContent : seeded.content, "utf8");
          },
          async put(input: { bytes: Buffer }) {
            putCalls.push(input.bytes.toString("utf8"));
            return {
              storageKey: `${ORG}/binding-audit-rollback-${putCalls.length}.dts`,
              checksumSha256: createHash("sha256").update(input.bytes).digest("hex"),
              fileSizeBytes: input.bytes.length
            };
          }
        };
        const state = async () => (
          await db.query<Record<string, string>>(
            `select
               (select count(*)::text from project_parameter_file_versions
                where file_id in ($1, $2) and origin = 'writeback') as versions,
               (select count(*)::text from dts_config_revisions
                where organization_id = $3 and project_id = $4 and status = 'draft') as candidates,
               (select count(*)::text from dts_config_revision_members crm
                inner join dts_config_revisions cr on cr.id = crm.config_revision_id
                where cr.organization_id = $3 and cr.project_id = $4) as candidate_members,
               (select count(*)::text from project_parameter_binding_revisions bpr
                inner join dts_config_revisions cr on cr.id = bpr.config_revision_id
                where cr.organization_id = $3 and cr.project_id = $4) as binding_revisions,
               (select count(*)::text from parameter_drafts
                where organization_id = $3 and project_id = $4) as drafts,
               (select count(*)::text from audit_events
                where organization_id = $3 and project_id = $4
                  and kind = 'parameter-topology-governance'
                  and action = 'binding-edited') as success_audits`,
            [seeded.fileId, seeded.overlayFileId, ORG, PROJECT]
          )
        ).rows[0]!;
        const before = await state();

        await db.query(
          `create or replace function fail_binding_draft_audit() returns trigger as $$
           begin
             if new.kind = 'parameter-topology-governance' and new.action = 'binding-edited' then
               raise exception 'injected binding draft audit failure';
             end if;
             return new;
           end;
           $$ language plpgsql`
        );
        await db.query(
          `create trigger fail_binding_draft_audit_trigger
           before insert on audit_events
           for each row execute function fail_binding_draft_audit()`
        );

        try {
          await withRefusalSink(connectionString, async (refusalSink) => {
            await expect(
              createBindingDraftService(
                db,
                auth,
                {
                  projectId: PROJECT,
                  bindingId: seeded.bindingId,
                  baseRevisionId: seeded.configRevisionId,
                  targetValue: {
                    kind: "cells",
                    bits: 32,
                    groups: [[{ kind: "integer", raw: "2", value: "2" }]]
                  },
                  reason: "Typed binding audit failure must roll back all domain writes"
                },
                { objectStore },
                {
                  invocation: createUserInvocation(auth),
                  requestId: "trace-pcw-binding-audit-rollback",
                  refusalSink
                }
              )
            ).rejects.toThrow("injected binding draft audit failure");
          });
        } finally {
          await db.query(`drop trigger fail_binding_draft_audit_trigger on audit_events`);
          await db.query(`drop function fail_binding_draft_audit()`);
        }

        expect(await state()).toEqual(before);
        // The immutable blob is written before the DB transaction. It may be an
        // unreachable orphan, but no committed domain row may reference it.
        expect(putCalls).toHaveLength(1);
        const orphanReference = await db.query<{ count: string }>(
          `select count(*)::text as count
           from project_parameter_file_versions
           where storage_key = $1`,
          [`${ORG}/binding-audit-rollback-1.dts`]
        );
        expect(orphanReference.rows).toEqual([{ count: "0" }]);
      });
    },
    120_000
  );

  it(
    "audits incapable critical Agent/System refusal before capability checks",
    async () => {
      await withTempDatabase(async (db, connectionString) => {
        const seeded = await seedPreCutoverGraph(db);
        const report = await migrateParameterIdentities(db, {
          mode: "apply",
          organizationId: ORG,
          ...applyGates,
          dbSnapshotId: "db-snap-pcw-refusal-order-red",
          objectSnapshotId: "obj-snap-pcw-refusal-order-red"
        });
        expect(report.blockers).toEqual([]);
        await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
        await resolveParameterIdentityMode(db);
        await db.query(
          `update dts_logical_node_revisions
           set compatible = 'vendor,critical-refusal-order'
           where config_revision_id = $1 and logical_node_id = $2`,
          [seeded.configRevisionId, expectedLogicalNodeId()]
        );
        await db.query(
          `insert into dts_sensitive_node_rules (
             id, organization_id, project_id, match_type, pattern,
             risk_tier, required_capability, enabled
           ) values ($1, $2, $3, 'compatible', 'vendor,critical-refusal-order',
                    'critical', 'parameter:edit-critical', true)`,
          ["rule-pcw-refusal-order-red", ORG, PROJECT]
        );
        const auth = makeAuth();
        const before = await db.query<{ drafts: string; candidates: string; refusals: string }>(
          `select
             (select count(*)::text from parameter_drafts where project_id = $1) as drafts,
             (select count(*)::text from dts_config_revisions where project_id = $1 and status = 'draft') as candidates,
             (select count(*)::text from audit_events where project_id = $1 and kind = 'parameter-sensitive-node-denied') as refusals`,
          [PROJECT]
        );
        await withRefusalSink(connectionString, async (refusalSink) => {
          for (const [requestId, invocation] of [
            [
              "refusal-order-incapable-agent",
              createAgentInvocation(auth, {
                sessionId: "session-refusal-order-agent",
                toolCallId: "tool-refusal-order-agent",
                approval: { required: true, approvalId: "approval-refusal-order-agent" }
              })
            ],
            ["refusal-order-incapable-system", createSystemInvocation({ kind: "service", name: "refusal-order-service" })]
          ] as const) {
            await expect(
              createNodeEnablementDraft(
                db,
                auth,
                {
                  projectId: PROJECT,
                  logicalNodeId: expectedLogicalNodeId(),
                  baseRevisionId: seeded.configRevisionId,
                  target: "force-enabled",
                  reason: "Incapable critical initiator must be audited"
                },
                { toolchain: passToolchain },
                { invocation, requestId, refusalSink }
              )
            ).rejects.toMatchObject({
              code: "FORBIDDEN",
              status: 403,
              details: { code: "parameter-sensitive-node-human-required", requireHuman: true }
            });
          }
        });
        expect(
          await db.query<{ drafts: string; candidates: string; refusals: string }>(
            `select
               (select count(*)::text from parameter_drafts where project_id = $1) as drafts,
               (select count(*)::text from dts_config_revisions where project_id = $1 and status = 'draft') as candidates,
               (select count(*)::text from audit_events where project_id = $1 and kind = 'parameter-sensitive-node-denied') as refusals`,
            [PROJECT]
          )
        ).toEqual({
          rows: [{ ...before.rows[0], refusals: "2" }],
          rowCount: before.rowCount
        });
      });
    },
    120_000
  );

  it(
    "matches quoted exact-revision compatible before topology enablement capability checks",
    async () => {
      await withTempDatabase(async (db, connectionString) => {
        const seeded = await seedPreCutoverGraph(db);
        await db.query(
          `delete from parameter_drafts
           where organization_id = $1 and project_id = $2 and user_id = $3`,
          [ORG, PROJECT, USER]
        );
        await db.query(
          `update dts_logical_node_revisions lnr
           set compatible = $1
           from dts_config_revisions cr
           inner join dts_config_set cs on cs.id = cr.config_set_id
           where lnr.config_revision_id = cr.id
             and cr.id = $2
             and lnr.logical_node_id = $3
             and cs.organization_id = $4
             and cs.project_id = $5`,
          ['"wiseeff,charging_core"', seeded.configRevisionId, expectedLogicalNodeId(), ORG, PROJECT]
        );
        await db.query(
          `update dts_node_occurrences
           set labels = '["sc8562"]'::jsonb
           where config_revision_id = $1 and node_path = $2`,
          [seeded.configRevisionId, "amba/i2c@FDF5E000/sc8562@6E"]
        );
        await db.query(
          `insert into dts_occurrence_effects (
             id, config_revision_id, logical_node_revision_id, node_occurrence_id,
             property_name, effect_kind, source_order
           ) values ($1, $2, $3, $4, 'status', 'delete', 2)`,
          [
            "oe-pcw-status-absent",
            seeded.configRevisionId,
            `lnr-${expectedLogicalNodeId()}`,
            "no-pcw-1"
          ]
        );
        await db.query(
          `update project_parameter_file_versions
           set parsed_index = jsonb_build_object('sourceText', $1::text)
           where id = $2`,
          [seeded.content, seeded.fileVersionId]
        );
        await db.query(
          `update project_parameter_file_versions
           set parsed_index = jsonb_build_object('sourceText', $1::text)
           where id = $2`,
          [seeded.overlayContent, seeded.overlayVersionId]
        );
        await db.query(
          `insert into dts_sensitive_node_rules (
             id, organization_id, project_id, match_type, pattern,
             risk_tier, required_capability, enabled
           ) values ($1, $2, $3, 'compatible', $4, 'critical', 'parameter:edit-critical', true)`,
          ["rule-pcw-quoted-compatible", ORG, PROJECT, "wiseeff,charging_core"]
        );

        const exactNode = await db.query<{
          logical_node_id: string;
          compatible: string | null;
        }>(
          `select lnr.logical_node_id, lnr.compatible
           from dts_logical_node_revisions lnr
           inner join dts_config_revisions cr on cr.id = lnr.config_revision_id
           inner join dts_config_set cs on cs.id = cr.config_set_id
           where cs.organization_id = $1
             and cs.project_id = $2
             and cr.id = $3
             and lnr.logical_node_id = $4`,
          [ORG, PROJECT, seeded.configRevisionId, expectedLogicalNodeId()]
        );
        expect(exactNode.rows).toEqual([
          {
            logical_node_id: expectedLogicalNodeId(),
            compatible: '"wiseeff,charging_core"'
          }
        ]);

        const snapshot = async () =>
          (
            await db.query<{ drafts: string; candidates: string }>(
              `select
                 (select count(*)::text from parameter_drafts
                  where organization_id = $1 and project_id = $2 and user_id = $3) as drafts,
                 (select count(*)::text from dts_config_revisions
                  where organization_id = $1 and project_id = $2
                    and config_set_id = $4 and status = 'draft') as candidates`,
              [ORG, PROJECT, USER, CONFIG_SET]
            )
          ).rows[0]!;
        const before = await snapshot();
        expect(before).toEqual({ drafts: "0", candidates: "0" });

        const incapableAuth = makeAuth();
        await expect(
          createNodeEnablementDraft(
            db,
            incapableAuth,
            {
              projectId: PROJECT,
              logicalNodeId: exactNode.rows[0]!.logical_node_id,
              baseRevisionId: seeded.configRevisionId,
              target: "force-disabled",
              reason: "Verify quoted compatible capability gate"
            },
            { toolchain: passToolchain },
            createTestParameterSubmissionContext(incapableAuth, "enablement-capability-denied")
          )
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          status: 403,
          details: {
            riskTier: "critical",
            requiredCapability: "parameter:edit-critical"
          }
        });
        expect(await snapshot()).toEqual(before);

        const capableAuth = makeTestAuthContext({
          userId: USER,
          organizationId: ORG,
          name: "PCW User",
          email: "pcw@example.com",
          organizationName: "PCW Org",
          permissions: [...incapableAuth.permissions, "parameter:edit-critical"]
        });
        await withRefusalSink(connectionString, async (refusalSink) => {
          const agentInvocation = createAgentInvocation(capableAuth, {
            sessionId: "session-topology-enablement",
            toolCallId: "tool-topology-enablement",
            approval: { required: true, approvalId: "approval-topology-enablement" }
          });
          const systemInvocation = createSystemInvocation({ kind: "job", name: "topology-enablement-job" });
          for (const [requestId, invocation] of [
            ["enablement-agent-refusal", agentInvocation],
            ["enablement-system-refusal", systemInvocation]
          ] as const) {
            await expect(
              createNodeEnablementDraft(
                db,
                capableAuth,
                {
                  projectId: PROJECT,
                  logicalNodeId: exactNode.rows[0]!.logical_node_id,
                  baseRevisionId: seeded.configRevisionId,
                  target: "force-disabled",
                  reason: "Critical topology enablement must preserve initiator"
                },
                { toolchain: passToolchain },
                { invocation, requestId, refusalSink }
              )
            ).rejects.toMatchObject({
              code: "FORBIDDEN",
              status: 403,
              details: { code: "parameter-sensitive-node-human-required", requireHuman: true }
            });
            expect(await snapshot()).toEqual(before);
          }
        });
        const refusalRows = await db.query<{
          actor_type: string;
          actor_user_id: string | null;
          trace_id: string;
          metadata: Record<string, unknown>;
        }>(
          `select actor_type, actor_user_id, trace_id, metadata
           from audit_events
           where organization_id = $1 and kind = 'parameter-sensitive-node-denied'
           order by trace_id`,
          [ORG]
        );
        expect(refusalRows.rows).toEqual([
          expect.objectContaining({
            actor_type: "agent",
            actor_user_id: USER,
            trace_id: "enablement-agent-refusal",
            metadata: expect.objectContaining({
              initiator: "agent",
              sessionId: "session-topology-enablement",
              toolCallId: "tool-topology-enablement",
              approvalId: "approval-topology-enablement"
            })
          }),
          expect.objectContaining({
            actor_type: "system",
            actor_user_id: null,
            trace_id: "enablement-system-refusal",
            metadata: expect.objectContaining({
              initiator: "system",
              systemKind: "job",
              systemName: "topology-enablement-job"
            })
          })
        ]);
        await db.query(
          `create or replace function fail_enablement_draft_audit() returns trigger as $$
           begin
             if new.kind = 'parameter-topology-governance' and new.action = 'enablement-changed' then
               raise exception 'injected enablement draft audit failure';
             end if;
             return new;
           end;
           $$ language plpgsql`
        );
        await db.query(
          `create trigger fail_enablement_draft_audit_trigger
           before insert on audit_events
           for each row execute function fail_enablement_draft_audit()`
        );
        await expect(
          createNodeEnablementDraft(
            db,
            capableAuth,
            {
              projectId: PROJECT,
              logicalNodeId: exactNode.rows[0]!.logical_node_id,
              baseRevisionId: seeded.configRevisionId,
              target: "force-disabled",
              reason: "Success audit failure must roll back the draft"
            },
            { toolchain: passToolchain },
            createTestParameterSubmissionContext(capableAuth, "enablement-audit-failure")
          )
        ).rejects.toThrow("injected enablement draft audit failure");
        expect(await snapshot()).toEqual(before);
        await db.query(`drop trigger fail_enablement_draft_audit_trigger on audit_events`);
        await db.query(`drop function fail_enablement_draft_audit()`);
        const created = await createNodeEnablementDraft(
          db,
          capableAuth,
          {
            projectId: PROJECT,
            logicalNodeId: exactNode.rows[0]!.logical_node_id,
            baseRevisionId: seeded.configRevisionId,
            target: "force-disabled",
            reason: "Allow capable direct user on quoted compatible"
          },
          { toolchain: passToolchain },
          createTestParameterSubmissionContext(capableAuth, "enablement-capable-user")
        );
        expect(created).toMatchObject({
          logicalNodeId: exactNode.rows[0]!.logical_node_id,
          target: "force-disabled",
          action: "set"
        });
        expect(await snapshot()).toEqual({ drafts: "1", candidates: "1" });
        await db.query(
          `update dts_sensitive_node_rules set risk_tier = 'high'
           where id = 'rule-pcw-quoted-compatible'`
        );
        await db.query(`delete from parameter_drafts where id = $1`, [created.draftId]);
        const systemOwnedState = async () => (await db.query<Record<string, string>>(
          `select
             (select count(*)::text from project_parameter_file_versions where origin = 'writeback') as versions,
             (select count(*)::text from dts_config_revisions where status = 'draft') as candidates,
             (select count(*)::text from parameter_drafts) as drafts,
             (select count(*)::text from audit_events
              where kind = 'parameter-topology-governance' and action = 'enablement-changed') as success_audits`
        )).rows[0];
        const beforeSystemOwnedState = await systemOwnedState();
        const systemHighDraft = await withRefusalSink(connectionString, (refusalSink) => createNodeEnablementDraft(
          db,
          capableAuth,
          {
            projectId: PROJECT,
            logicalNodeId: exactNode.rows[0]!.logical_node_id,
            baseRevisionId: seeded.configRevisionId,
            target: "force-enabled",
            reason: "System high-risk enablement preserves its service identity"
          },
          { toolchain: passToolchain },
          {
            invocation: createSystemInvocation({ kind: "service", name: "topology-high-service" }),
            requestId: "enablement-high-system",
            refusalSink
          }
        ));
        expect(systemHighDraft.draftId).toBeTruthy();
        expect(await snapshot()).toEqual({ drafts: "0", candidates: "2" });
        expect(await systemOwnedState()).toEqual({
          versions: "2",
          candidates: "2",
          drafts: "1",
          success_audits: "2"
        });
        expect(beforeSystemOwnedState).toEqual({
          versions: "1",
          candidates: "1",
          drafts: "0",
          success_audits: "1"
        });
        const systemHighAttribution = await db.query<{
          user_id: string | null;
          created_by_user_id: string | null;
        }>(
          `select d.user_id, fv.created_by_user_id
           from parameter_drafts d
           inner join dts_config_revision_members crm on crm.config_revision_id = d.candidate_config_revision_id
             and crm.role = 'overlay'
           inner join project_parameter_file_versions fv on fv.id = crm.file_version_id
           where d.id = $1`,
          [systemHighDraft.draftId]
        );
        expect(systemHighAttribution.rows).toEqual([
          { user_id: null, created_by_user_id: null }
        ]);
        const systemHighAudit = await db.query<{
          actor_type: string;
          actor_user_id: string | null;
          trace_id: string;
          metadata: Record<string, unknown>;
        }>(
          `select actor_type, actor_user_id, trace_id, metadata
           from audit_events where trace_id = 'enablement-high-system'
             and kind = 'parameter-topology-governance'`
        );
        expect(systemHighAudit.rows).toEqual([
          expect.objectContaining({
            actor_type: "system",
            actor_user_id: null,
            trace_id: "enablement-high-system",
            metadata: expect.objectContaining({
              initiator: "system",
              systemKind: "service",
              systemName: "topology-high-service"
            })
          })
        ]);
        const agentHighDraft = await withRefusalSink(connectionString, (refusalSink) =>
          createNodeEnablementDraft(
            db,
            capableAuth,
            {
              projectId: PROJECT,
              logicalNodeId: exactNode.rows[0]!.logical_node_id,
              baseRevisionId: seeded.configRevisionId,
              target: "force-enabled",
              reason: "Agent uses its accountable principal without losing initiator"
            },
            { toolchain: passToolchain },
            {
              invocation: createAgentInvocation(capableAuth, {
                sessionId: "session-topology-high-agent",
                toolCallId: "tool-topology-high-agent",
                approval: { required: true, approvalId: "approval-topology-high-agent" }
              }),
              requestId: "enablement-high-agent",
              refusalSink
            }
          )
        );
        const agentDraftOwner = await db.query<{ user_id: string }>(
          `select user_id from parameter_drafts where id = $1`,
          [agentHighDraft.draftId]
        );
        expect(agentDraftOwner.rows).toEqual([{ user_id: USER }]);
        await db.query(
          `insert into dts_sensitive_node_rules (
             id, organization_id, project_id, match_type, pattern,
             risk_tier, required_capability, enabled
           ) values (
             'rule-pcw-enablement-writeback-path', $1, $2, 'compatible', 'wiseeff,enablement-locked-critical',
             'critical', 'parameter:edit-critical', true
           )`,
          [ORG, PROJECT]
        );

        const enablementLock = await resolveEnablementWriteLock(db, capableAuth, {
          logicalNodeId: exactNode.rows[0]!.logical_node_id,
          baseRevisionId: seeded.configRevisionId
        });
        await db.query(
          `update dts_logical_node_revisions
           set compatible = 'wiseeff,enablement-locked-critical'
           where config_revision_id = $1 and logical_node_id = $2`,
          [seeded.configRevisionId, exactNode.rows[0]!.logical_node_id]
        );
        await db.query(
          `update dts_nodes set compatible = 'wiseeff,enablement-locked-critical'
           where file_version_id = $1 and node_path = $2`,
          [enablementLock.sourceFileVersionId, enablementLock.sourceNodePath]
        );
        await db.query(
          `insert into dts_nodes (id, file_version_id, name, node_path, compatible)
           select 'node-enablement-locked-critical', $1, 'sc8562', $2, 'wiseeff,enablement-locked-critical'
           where not exists (
             select 1 from dts_nodes where file_version_id = $1 and node_path = $2
           )`,
          [enablementLock.sourceFileVersionId, enablementLock.sourceNodePath]
        );
        await db.query(
          `insert into project_parameter_file_versions (
             id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin
           )
           select 'fv-enablement-safe-current', file_id,
                  (select max(version_number) + 1 from project_parameter_file_versions where file_id = locked.file_id),
                  'safe-enablement-current', checksum, size_bytes, parsed_index, 'upload'
           from project_parameter_file_versions locked where id = $1`,
          [enablementLock.sourceFileVersionId]
        );
        await db.query(
          `insert into dts_nodes (id, file_version_id, name, node_path, compatible)
           values ('node-enablement-safe-current', 'fv-enablement-safe-current', 'safe', $1, 'wiseeff,safe')`,
          [enablementLock.sourceNodePath]
        );
        await db.query(
          `update project_parameter_files set current_version_id = 'fv-enablement-safe-current'
           where id = (select file_id from project_parameter_file_versions where id = $1)`,
          [enablementLock.sourceFileVersionId]
        );
        const enablementPut = vi.fn(async (input: { bytes: Buffer }) => ({
          storageKey: `${ORG}/enablement-writeback.dts`,
          checksumSha256: createHash("sha256").update(input.bytes).digest("hex"),
          fileSizeBytes: input.bytes.length
        }));
        const enablementStore = {
          async get(key: string) {
            return Buffer.from(key.includes("overlay") ? seeded.overlayContent : seeded.content, "utf8");
          },
          put: enablementPut
        };
        const enablementState = async () => (
          await db.query<Record<string, string>>(
            `select
               (select count(*)::text from project_parameter_file_versions where origin = 'writeback') as versions,
               (select count(*)::text from audit_events where kind = 'parameter-writeback-to-file') as success_audits`
          )
        ).rows[0];
        const beforeEnablementWriteback = await enablementState();
        await withRefusalSink(connectionString, async (refusalSink) => {
          const agent = createAgentInvocation(capableAuth, {
            sessionId: "session-enablement-writeback",
            toolCallId: "tool-enablement-writeback",
            approval: { required: true, approvalId: "approval-enablement-writeback" }
          });
          const system = createSystemInvocation({ kind: "job", name: "enablement-writeback-job" });
          for (const [requestId, invocation] of [
            ["enablement-writeback-agent-refusal", agent],
            ["enablement-writeback-system-refusal", system]
          ] as const) {
            await expect(
              db.transaction((tx) =>
                writebackMergedEnablementValue(
                  asAuditTx(tx),
                  enablementStore as never,
                  capableAuth,
                  {
                    projectId: PROJECT,
                    logicalNodeId: exactNode.rows[0]!.logical_node_id,
                    mergedValue: '"disabled"',
                    writeLock: enablementLock
                  },
                  {
                    invocation,
                    requestId,
                    refusalSink,
                    toolchain: passToolchain,
                    skipSemanticGates: true
                  }
                )
              )
            ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
            expect(await enablementState()).toEqual(beforeEnablementWriteback);
            expect(enablementPut).not.toHaveBeenCalled();
          }
        });
        await db.query(
          `update dts_sensitive_node_rules set risk_tier = 'high'
           where id = 'rule-pcw-enablement-writeback-path'`
        );
        const systemEnablementWriteback = await withRefusalSink(connectionString, (refusalSink) =>
          db.transaction((tx) => writebackMergedEnablementValue(
            asAuditTx(tx),
            enablementStore as never,
            capableAuth,
            {
              projectId: PROJECT,
              logicalNodeId: exactNode.rows[0]!.logical_node_id,
              mergedValue: '"disabled"',
              writeLock: enablementLock
            },
            {
              invocation: createSystemInvocation({ kind: "job", name: "enablement-high-writeback-job" }),
              requestId: "enablement-high-system-writeback",
              refusalSink,
              toolchain: passToolchain,
              skipSemanticGates: true
            }
          ))
        );
        expect(systemEnablementWriteback.skipped).toBe(false);
        const systemEnablementAttribution = await db.query<{
          created_by_user_id: string | null;
          revision_creator_user_id: string | null;
        }>(
          `select fv.created_by_user_id, cr.created_by_user_id as revision_creator_user_id
           from project_parameter_file_versions fv
           inner join dts_config_revisions cr on cr.id = $2
           where fv.id = $1`,
          [systemEnablementWriteback.versionId, systemEnablementWriteback.candidateRevisionId]
        );
        expect(systemEnablementAttribution.rows).toEqual([
          { created_by_user_id: null, revision_creator_user_id: null }
        ]);
        enablementPut.mockClear();
        const enablementWriteback = await db.transaction((tx) =>
          writebackMergedEnablementValue(
            asAuditTx(tx),
            enablementStore as never,
            capableAuth,
            {
              projectId: PROJECT,
              logicalNodeId: exactNode.rows[0]!.logical_node_id,
              mergedValue: '"disabled"',
              writeLock: enablementLock
            },
            {
              ...createTestParameterSubmissionContext(capableAuth, "enablement-writeback-user"),
              toolchain: passToolchain,
              skipSemanticGates: true
            }
          )
        );
        expect(enablementWriteback.skipped).toBe(false);
        expect(enablementPut).toHaveBeenCalledTimes(1);
        const enablementAudit = await db.query<{ actor_type: string; actor_user_id: string | null; trace_id: string }>(
          `select actor_type, actor_user_id, trace_id from audit_events
           where kind = 'parameter-writeback-to-file' and trace_id = 'enablement-writeback-user'`
        );
        expect(enablementAudit.rows).toEqual([
          { actor_type: "user", actor_user_id: USER, trace_id: "enablement-writeback-user" }
        ]);

        await db.query(
          `delete from dts_sensitive_node_rules
           where id in ('rule-pcw-quoted-compatible', 'rule-pcw-enablement-writeback-path')`,
        );
        const beforeSystemNoMatch = await systemOwnedState();
        const systemNoMatchDraft = await withRefusalSink(connectionString, (refusalSink) =>
          createNodeEnablementDraft(
            db,
            capableAuth,
            {
              projectId: PROJECT,
              logicalNodeId: exactNode.rows[0]!.logical_node_id,
              baseRevisionId: seeded.configRevisionId,
              target: "force-enabled",
              reason: "System no-match preserves the existing operation",
            },
            { toolchain: passToolchain },
            {
              invocation: createSystemInvocation({ kind: "job", name: "topology-no-match-job" }),
              requestId: "enablement-no-match-system",
              refusalSink,
            },
          ),
        );
        expect(systemNoMatchDraft.draftId).toBeTruthy();
        expect(await systemOwnedState()).toEqual({
          versions: String(Number(beforeSystemNoMatch.versions) + 1),
          candidates: String(Number(beforeSystemNoMatch.candidates) + 1),
          drafts: String(Number(beforeSystemNoMatch.drafts) + 1),
          success_audits: String(Number(beforeSystemNoMatch.success_audits) + 1),
        });
        const systemNoMatchAttribution = await db.query<{
          user_id: string | null;
          initiator_type: string;
          initiator_system_kind: string | null;
          initiator_system_name: string | null;
        }>(
          `select user_id, initiator_type, initiator_system_kind, initiator_system_name
           from parameter_drafts where id = $1`,
          [systemNoMatchDraft.draftId],
        );
        expect(systemNoMatchAttribution.rows).toEqual([
          {
            user_id: null,
            initiator_type: "system",
            initiator_system_kind: "job",
            initiator_system_name: "topology-no-match-job",
          },
        ]);
        const systemNoMatchAudit = await db.query<{
          actor_type: string;
          actor_user_id: string | null;
          trace_id: string;
          metadata: Record<string, unknown>;
        }>(
          `select actor_type, actor_user_id, trace_id, metadata
           from audit_events where trace_id = 'enablement-no-match-system'
             and kind = 'parameter-topology-governance'`,
        );
        expect(systemNoMatchAudit.rows).toEqual([
          expect.objectContaining({
            actor_type: "system",
            actor_user_id: null,
            trace_id: "enablement-no-match-system",
            metadata: expect.objectContaining({
              initiator: "system",
              systemKind: "job",
              systemName: "topology-no-match-job",
            }),
          }),
        ]);
      });
    },
    90_000
  );

  it(
    "submits an exact binding draft identity and rejects project/spec/candidate/write-lock mismatches",
    async () => {
      await withTempDatabase(async (db, connectionString) => {
        const seeded = await seedPreCutoverGraph(db);
        const report = await migrateParameterIdentities(db, {
          mode: "apply",
          organizationId: ORG,
          ...applyGates,
          dbSnapshotId: "db-snap-binding-submit",
          objectSnapshotId: "obj-snap-binding-submit"
        });
        expect(report.blockers).toEqual([]);
        await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
        await resolveParameterIdentityMode(db);

        await expect(
          saveDraft(db, makeAuth(), {
            projectId: PROJECT,
            parameterId: seeded.bindingId,
            targetValue: "<&gpio13 31 0>",
            reason: "legacy save must be rejected after cutover"
          })
        ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
        await expect(
          submitParameterChanges(db, makeAuth(), {
            projectId: PROJECT,
            items: [
              {
                parameterId: seeded.bindingId,
                targetValue: "<&gpio13 31 0>",
                reason: "legacy submit must be rejected after cutover"
              }
            ]
          }, createTestParameterSubmissionContext(makeAuth(), "request-retired-legacy"))
        ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

        await db.query(`delete from parameter_drafts where organization_id = $1 and project_id = $2`, [ORG, PROJECT]);
        const candidateRevisionId = "rev-pcw-binding-submit-candidate";
        await db.query(
          `insert into dts_config_revisions (
             id, organization_id, project_id, config_set_id, revision_number, status,
             created_by_user_id, entry_file, include_search_paths, overlay_order, manifest_state
           ) values ($1, $2, $3, $4, 2, 'draft', $5, 'pcw-base.dts', '["."]'::jsonb,
             '["pcw-overlay.dts"]'::jsonb, 'complete')`,
          [candidateRevisionId, ORG, PROJECT, CONFIG_SET, USER]
        );
        await db.query(
          `insert into project_parameter_binding_revisions (
             id, binding_id, config_revision_id, parameter_spec_version_id,
             typed_value, canonical_value, raw_value, schema_state, policy_state
           )
           select $1, binding_id, $2, parameter_spec_version_id,
             typed_value, canonical_value, raw_value, schema_state, policy_state
           from project_parameter_binding_revisions
           where binding_id = $3 and config_revision_id = $4`,
          ["bpr-pcw-binding-submit-candidate", candidateRevisionId, seeded.bindingId, seeded.configRevisionId]
        );
        const writeLock = await resolveBindingWriteLock(db, makeAuth(), {
          bindingId: seeded.bindingId,
          baseRevisionId: seeded.configRevisionId
        });
        const draftId = "draft-pcw-binding-submit";
        const targetValue = "<&gpio13 30 0>";
        const reason = "Submit the exact typed binding draft";
        await upsertDraft(db, {
          id: draftId,
          organizationId: ORG,
          projectId: PROJECT,
          parameterId: seeded.bindingId,
          userId: USER,
          targetValue,
          reason,
          projectParameterBindingId: seeded.bindingId,
          parameterSpecId: seeded.specId,
          candidateConfigRevisionId: candidateRevisionId,
          writeLock
        });

        const submit = (overrides: Record<string, string> = {}, projectId = PROJECT) =>
          submitParameterChanges(db, makeAuth(), {
            projectId,
            items: [
              {
                draftId,
                projectParameterBindingId: seeded.bindingId,
                parameterSpecId: seeded.specId,
                targetValue,
                reason,
                ...overrides
              }
            ]
          }, createTestParameterSubmissionContext(makeAuth(), `request-binding-${draftId}`));

        await expect(submit()).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
        await db.query(
          `update project_parameter_binding_revisions
           set raw_value = $2
           where id = $1`,
          ["bpr-pcw-binding-submit-candidate", targetValue]
        );

        await expect(submit({ parameterSpecId: "spec-mismatch" })).rejects.toMatchObject({
          code: "CONFLICT",
          status: 409
        });
        await expect(submit({}, "project-other")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

        await db.query(`update dts_config_revisions set status = 'invalid' where id = $1`, [candidateRevisionId]);
        await expect(submit()).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
        await db.query(`update dts_config_revisions set status = 'draft' where id = $1`, [candidateRevisionId]);

        await db.query(`update parameter_drafts set expected_checksum = 'stale-checksum' where id = $1`, [draftId]);
        await expect(submit()).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
        await db.query(`update parameter_drafts set expected_checksum = $2 where id = $1`, [
          draftId,
          writeLock.expectedChecksum
        ]);

        const before = await db.query<{ requests: string; audits: string }>(
          `select
             (select count(*)::text from parameter_change_requests where project_id = $1 and id <> 'cr-pcw-seed') as requests,
             (select count(*)::text from audit_events where project_id = $1 and kind = 'parameter-submit') as audits`,
          [PROJECT]
        );
        expect(before.rows[0]).toEqual({ requests: "0", audits: "0" });

        const round = await submit();
        expect(round.items).toHaveLength(1);
        expect(round.items[0]?.candidateConfigRevisionId).toBe(candidateRevisionId);
        const persisted = await db.query<{
          project_parameter_binding_id: string;
          parameter_spec_id: string;
          base_config_revision_id: string;
          binding_revision_id: string;
          candidate_config_revision_id: string;
        }>(
          `select project_parameter_binding_id, parameter_spec_id, base_config_revision_id, binding_revision_id,
                  candidate_config_revision_id
           from parameter_change_requests where submission_round_id = $1`,
          [round.id]
        );
        expect(persisted.rows[0]).toMatchObject({
          project_parameter_binding_id: seeded.bindingId,
          parameter_spec_id: seeded.specId,
          base_config_revision_id: writeLock.baseConfigRevisionId,
          binding_revision_id: writeLock.bindingRevisionId,
          candidate_config_revision_id: candidateRevisionId
        });
        expect(
          (
            await db.query<{ candidate_config_revision_id: string }>(
              `select candidate_config_revision_id from parameter_submission_items
               where submission_round_id = $1`,
              [round.id]
            )
          ).rows
        ).toEqual([{ candidate_config_revision_id: candidateRevisionId }]);
        expect(
          (
            await db.query<{ status: string }>(
              `select status from dts_config_revisions where id = $1`,
              [candidateRevisionId]
            )
          ).rows
        ).toEqual([{ status: "pending_approval" }]);
        const audit = await db.query<{ metadata: Record<string, unknown> }>(
          `select metadata from audit_events
           where project_id = $1 and kind = 'parameter-submit'
           order by created_at desc limit 1`,
          [PROJECT]
        );
        expect(audit.rows[0]?.metadata).toMatchObject({
          bindingDraftIds: [draftId],
          projectParameterBindingIds: [seeded.bindingId],
          parameterSpecIds: [seeded.specId],
          candidateConfigRevisionIds: [candidateRevisionId]
        });
        expect((await db.query(`select 1 from parameter_drafts where id = $1`, [draftId])).rows).toHaveLength(0);
      });
    },
    90_000
  );

  it(
    "submits delete only with an exact candidate tombstone and persists the action",
    async () => {
      await withTempDatabase(async (db) => {
        const seeded = await seedPreCutoverGraph(db);
        const report = await migrateParameterIdentities(db, {
          mode: "apply",
          organizationId: ORG,
          ...applyGates,
          dbSnapshotId: "db-snap-binding-delete-submit",
          objectSnapshotId: "obj-snap-binding-delete-submit"
        });
        expect(report.blockers).toEqual([]);
        await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
        await resolveParameterIdentityMode(db);
        await db.query(`delete from parameter_drafts where organization_id = $1 and project_id = $2`, [
          ORG,
          PROJECT
        ]);

        const candidateRevisionId = "rev-pcw-binding-delete-candidate";
        await db.query(
          `insert into dts_config_revisions (
             id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id,
             entry_file, include_search_paths, overlay_order, manifest_state
           )
           select $1, organization_id, project_id, config_set_id, 99, 'draft', $2,
                  entry_file, include_search_paths, overlay_order, manifest_state
           from dts_config_revisions where id = $3`,
          [candidateRevisionId, USER, seeded.configRevisionId]
        );
        const candidateLogicalNodeRevisionId = "lnr-pcw-binding-delete-candidate";
        await db.query(
          `insert into dts_logical_node_revisions (
             id, logical_node_id, config_revision_id, node_locator, name, unit_address, parent_logical_node_id
           ) values ($1, $2, $3, $4, 'sc8562', '6E', null)`,
          [candidateLogicalNodeRevisionId, expectedLogicalNodeId(), candidateRevisionId, NODE_LOCATOR]
        );
        const writeLock = await resolveBindingWriteLock(db, makeAuth(), {
          bindingId: seeded.bindingId,
          baseRevisionId: seeded.configRevisionId
        });
        const draftId = "draft-pcw-binding-delete";
        await upsertDraft(db, {
          id: draftId,
          organizationId: ORG,
          projectId: PROJECT,
          parameterId: seeded.bindingId,
          userId: USER,
          targetValue: "",
          reason: "Delete gpio_int through formal review",
          action: "delete",
          projectParameterBindingId: seeded.bindingId,
          parameterSpecId: seeded.specId,
          candidateConfigRevisionId: candidateRevisionId,
          writeLock
        });

        const submitDelete = () =>
          submitParameterChanges(db, makeAuth(), {
            projectId: PROJECT,
            items: [
              {
                draftId,
                projectParameterBindingId: seeded.bindingId,
                parameterSpecId: seeded.specId,
                action: "delete",
                targetValue: "",
                reason: "Delete gpio_int through formal review"
              }
            ]
          }, createTestParameterSubmissionContext(makeAuth(), `request-delete-${draftId}`));

        await expect(submitDelete()).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

        await db.query(
          `insert into dts_occurrence_effects (
             id, config_revision_id, logical_node_revision_id, property_name, effect_kind, source_order
           ) values ($1, $2, $3, $4, 'delete', 1)`,
          ["oe-pcw-binding-delete-candidate", candidateRevisionId, candidateLogicalNodeRevisionId, PROPERTY_KEY]
        );
        await db.query(
          `insert into project_parameter_binding_revisions (
             id, binding_id, config_revision_id, parameter_spec_version_id,
             typed_value, canonical_value, raw_value, schema_state, policy_state
           )
           select $1, binding_id, $2, parameter_spec_version_id,
                  typed_value, canonical_value, raw_value, schema_state, policy_state
           from project_parameter_binding_revisions
           where binding_id = $3 and config_revision_id = $4`,
          ["bpr-pcw-binding-delete-contradiction", candidateRevisionId, seeded.bindingId, seeded.configRevisionId]
        );
        await expect(submitDelete()).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
        await db.query(`delete from project_parameter_binding_revisions where id = $1`, [
          "bpr-pcw-binding-delete-contradiction"
        ]);

        const round = await submitDelete();
        expect(round.items[0]).toMatchObject({ action: "delete", targetValue: "" });
        expect((await db.query(`select id from parameter_drafts where id = $1`, [draftId])).rows).toEqual([]);
        expect(
          (
            await db.query<{ action: string; target_value: string }>(
              `select action, target_value from parameter_change_requests where submission_round_id = $1`,
              [round.id]
            )
          ).rows
        ).toEqual([{ action: "delete", target_value: "" }]);
        expect(
          (
            await db.query<{ action: string; target_value: string }>(
              `select action, target_value from parameter_submission_items where submission_round_id = $1`,
              [round.id]
            )
          ).rows
        ).toEqual([{ action: "delete", target_value: "" }]);
        const audit = await db.query<{ metadata: Record<string, unknown> }>(
          `select metadata from audit_events
           where project_id = $1 and kind = 'parameter-submit'
           order by created_at desc limit 1`,
          [PROJECT]
        );
        expect(audit.rows[0]?.metadata).toMatchObject({ actions: ["delete"] });
      });
    },
    90_000
  );

  it(
    "locks the exact draft so a concurrent typed edit survives submission cleanup",
    async () => {
      await withTempDatabase(async (db, connectionString) => {
        const seeded = await seedPreCutoverGraph(db);
        const report = await migrateParameterIdentities(db, {
          mode: "apply",
          organizationId: ORG,
          ...applyGates,
          dbSnapshotId: "db-snap-binding-concurrency",
          objectSnapshotId: "obj-snap-binding-concurrency"
        });
        expect(report.blockers).toEqual([]);
        await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
        await resolveParameterIdentityMode(db);
        await db.query(`delete from parameter_drafts where organization_id = $1 and project_id = $2`, [ORG, PROJECT]);

        const candidateRevisionId = "rev-pcw-binding-concurrent-candidate";
        const submittedValue = "<&gpio13 30 0>";
        await db.query(
          `insert into dts_config_revisions (
             id, organization_id, project_id, config_set_id, revision_number, status,
             created_by_user_id, entry_file, include_search_paths, overlay_order, manifest_state
           ) values ($1, $2, $3, $4, 2, 'draft', $5, 'pcw-base.dts', '["."]'::jsonb,
             '["pcw-overlay.dts"]'::jsonb, 'complete')`,
          [candidateRevisionId, ORG, PROJECT, CONFIG_SET, USER]
        );
        await db.query(
          `insert into project_parameter_binding_revisions (
             id, binding_id, config_revision_id, parameter_spec_version_id,
             typed_value, canonical_value, raw_value, schema_state, policy_state
           )
           select $1, binding_id, $2, parameter_spec_version_id,
             typed_value, canonical_value, $3, schema_state, policy_state
           from project_parameter_binding_revisions
           where binding_id = $4 and config_revision_id = $5`,
          [
            "bpr-pcw-binding-concurrent-candidate",
            candidateRevisionId,
            submittedValue,
            seeded.bindingId,
            seeded.configRevisionId
          ]
        );
        const writeLock = await resolveBindingWriteLock(db, makeAuth(), {
          bindingId: seeded.bindingId,
          baseRevisionId: seeded.configRevisionId
        });
        const draftId = "draft-pcw-binding-concurrent";
        await upsertDraft(db, {
          id: draftId,
          organizationId: ORG,
          projectId: PROJECT,
          parameterId: seeded.bindingId,
          userId: USER,
          targetValue: submittedValue,
          reason: "submit snapshot",
          projectParameterBindingId: seeded.bindingId,
          parameterSpecId: seeded.specId,
          candidateConfigRevisionId: candidateRevisionId,
          writeLock
        });

        const submitClient = new pg.Client({ connectionString });
        const editClient = new pg.Client({ connectionString });
        await submitClient.connect();
        await editClient.connect();
        let releaseDraftRead!: () => void;
        const draftReadReleased = new Promise<void>((resolve) => {
          releaseDraftRead = resolve;
        });
        let signalDraftRead!: () => void;
        const draftRead = new Promise<void>((resolve) => {
          signalDraftRead = resolve;
        });
        let intercepted = false;
        const submitDbBase = createDatabase({
          query: async (text, values = []) => {
            const result = await submitClient.query(text, values);
            return { rows: result.rows, rowCount: result.rowCount };
          }
        });
        const submitDb: Database = {
          query: submitDbBase.query,
          transaction: (fn) =>
            submitDbBase.transaction((tx) =>
              fn({
                query: async (text, values = []) => {
                  const result = await tx.query(text, values);
                  if (!intercepted && text.includes("from parameter_drafts d")) {
                    intercepted = true;
                    signalDraftRead();
                    await draftReadReleased;
                  }
                  return result;
                }
              })
            )
        };
        const editDb = createDatabase({
          query: async (text, values = []) => {
            const result = await editClient.query(text, values);
            return { rows: result.rows, rowCount: result.rowCount };
          }
        });

        try {
          const submission = submitParameterChanges(submitDb, makeAuth(), {
            projectId: PROJECT,
            items: [
              {
                draftId,
                projectParameterBindingId: seeded.bindingId,
                parameterSpecId: seeded.specId,
                targetValue: submittedValue,
                reason: "submit snapshot"
              }
            ]
          }, createTestParameterSubmissionContext(makeAuth(), "request-concurrent-draft"));
          await draftRead;

          const editorPid = await editClient.query<{ pid: number }>("select pg_backend_pid() as pid");
          const concurrentEdit = upsertDraft(editDb, {
            id: "draft-pcw-binding-concurrent-new",
            organizationId: ORG,
            projectId: PROJECT,
            parameterId: seeded.bindingId,
            userId: USER,
            targetValue: "<&gpio13 32 0>",
            reason: "concurrent edit survives",
            projectParameterBindingId: seeded.bindingId,
            parameterSpecId: seeded.specId,
            candidateConfigRevisionId: candidateRevisionId,
            writeLock
          });

          let lockObserved = false;
          for (let attempt = 0; attempt < 50; attempt += 1) {
            const activity = await db.query<{ wait_event_type: string | null }>(
              `select wait_event_type from pg_stat_activity where pid = $1`,
              [editorPid.rows[0]!.pid]
            );
            if (activity.rows[0]?.wait_event_type === "Lock") {
              lockObserved = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
          }

          releaseDraftRead();
          await Promise.all([submission, concurrentEdit]);
          const survivingDraft = await db.query<{ target_value: string; reason: string }>(
            `select target_value, reason from parameter_drafts
             where organization_id = $1 and project_id = $2
               and project_parameter_binding_id = $3 and user_id = $4`,
            [ORG, PROJECT, seeded.bindingId, USER]
          );
          expect(lockObserved).toBe(true);
          expect(survivingDraft.rows).toEqual([
            { target_value: "<&gpio13 32 0>", reason: "concurrent edit survives" }
          ]);
        } finally {
          releaseDraftRead();
          await submitClient.end().catch(() => undefined);
          await editClient.end().catch(() => undefined);
        }
      });
    },
    90_000
  );

  it(
    "locks and promotes the exact candidate before workflow creation under a two-connection race",
    async () => {
      await withTempDatabase(async (db, connectionString) => {
        const seeded = await seedPreCutoverGraph(db);
        const report = await migrateParameterIdentities(db, {
          mode: "apply",
          organizationId: ORG,
          ...applyGates,
          dbSnapshotId: "db-snap-candidate-concurrency",
          objectSnapshotId: "obj-snap-candidate-concurrency"
        });
        expect(report.blockers).toEqual([]);
        await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
        await resolveParameterIdentityMode(db);
        await db.query(`delete from parameter_drafts where organization_id = $1 and project_id = $2`, [ORG, PROJECT]);

        const candidateRevisionId = "rev-pcw-candidate-concurrent";
        const targetValue = "<&gpio13 30 0>";
        await db.query(
          `insert into dts_config_revisions (
             id, organization_id, project_id, config_set_id, revision_number, status,
             created_by_user_id, entry_file, include_search_paths, overlay_order, manifest_state
           ) values ($1, $2, $3, $4, 2, 'draft', $5, 'pcw-base.dts', '["."]'::jsonb,
             '["pcw-overlay.dts"]'::jsonb, 'complete')`,
          [candidateRevisionId, ORG, PROJECT, CONFIG_SET, USER]
        );
        await db.query(
          `insert into project_parameter_binding_revisions (
             id, binding_id, config_revision_id, parameter_spec_version_id,
             typed_value, canonical_value, raw_value, schema_state, policy_state
           )
           select $1, binding_id, $2, parameter_spec_version_id,
             typed_value, canonical_value, $3, schema_state, policy_state
           from project_parameter_binding_revisions
           where binding_id = $4 and config_revision_id = $5`,
          ["bpr-pcw-candidate-concurrent", candidateRevisionId, targetValue, seeded.bindingId, seeded.configRevisionId]
        );
        const writeLock = await resolveBindingWriteLock(db, makeAuth(), {
          bindingId: seeded.bindingId,
          baseRevisionId: seeded.configRevisionId
        });
        const draftId = "draft-pcw-candidate-concurrent";
        await upsertDraft(db, {
          id: draftId,
          organizationId: ORG,
          projectId: PROJECT,
          parameterId: seeded.bindingId,
          userId: USER,
          targetValue,
          reason: "candidate lock race",
          projectParameterBindingId: seeded.bindingId,
          parameterSpecId: seeded.specId,
          candidateConfigRevisionId: candidateRevisionId,
          writeLock
        });

        const submitClient = new pg.Client({ connectionString });
        const mutateClient = new pg.Client({ connectionString });
        await submitClient.connect();
        await mutateClient.connect();
        let releaseCandidateRead!: () => void;
        const candidateReadReleased = new Promise<void>((resolve) => { releaseCandidateRead = resolve; });
        let signalCandidateRead!: () => void;
        const candidateRead = new Promise<void>((resolve) => { signalCandidateRead = resolve; });
        let intercepted = false;
        const submitDbBase = createDatabase({
          query: async (text, values = []) => {
            const result = await submitClient.query(text, values);
            return { rows: result.rows, rowCount: result.rowCount };
          }
        });
        const submitDb: Database = {
          query: submitDbBase.query,
          transaction: (fn) => submitDbBase.transaction((tx) => fn({
            query: async (text, values = []) => {
              const result = await tx.query(text, values);
              if (!intercepted && text.includes("from parameter_drafts d")) {
                intercepted = true;
                signalCandidateRead();
                await candidateReadReleased;
              }
              return result;
            }
          }))
        };

        try {
          const submission = submitParameterChanges(submitDb, makeAuth(), {
            projectId: PROJECT,
            items: [{
              draftId,
              projectParameterBindingId: seeded.bindingId,
              parameterSpecId: seeded.specId,
              targetValue,
              reason: "candidate lock race"
            }]
          }, createTestParameterSubmissionContext(makeAuth(), "request-candidate-race"));
          await candidateRead;
          const mutatorPid = await mutateClient.query<{ pid: number }>("select pg_backend_pid() as pid");
          const mutation = mutateClient.query(
            `update dts_config_revisions set status = 'invalid' where id = $1`,
            [candidateRevisionId]
          );

          let lockObserved = false;
          for (let attempt = 0; attempt < 50; attempt += 1) {
            const activity = await db.query<{ wait_event_type: string | null }>(
              `select wait_event_type from pg_stat_activity where pid = $1`,
              [mutatorPid.rows[0]!.pid]
            );
            if (activity.rows[0]?.wait_event_type === "Lock") {
              lockObserved = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
          }

          releaseCandidateRead();
          const [round] = await Promise.all([submission, mutation]);
          expect(lockObserved).toBe(true);
          expect(
            (
              await db.query<{ candidate_config_revision_id: string }>(
                `select candidate_config_revision_id from parameter_change_requests
                 where submission_round_id = $1`,
                [round.id]
              )
            ).rows
          ).toEqual([{ candidate_config_revision_id: candidateRevisionId }]);
          expect(
            (await db.query<{ status: string }>(`select status from dts_config_revisions where id = $1`, [candidateRevisionId])).rows
          ).toEqual([{ status: "invalid" }]);
        } finally {
          releaseCandidateRead();
          await submitClient.end().catch(() => undefined);
          await mutateClient.end().catch(() => undefined);
        }
      });
    },
    90_000
  );

  it(
    "merges a persisted delete action through locked writeback without a replacement binding revision",
    async () => {
      await withTempDatabase(async (db, connectionString) => {
        const seeded = await seedPreCutoverGraph(db);
        const report = await migrateParameterIdentities(db, {
          mode: "apply",
          organizationId: ORG,
          ...applyGates,
          dbSnapshotId: "db-snap-binding-delete-merge",
          objectSnapshotId: "obj-snap-binding-delete-merge"
        });
        expect(report.blockers).toEqual([]);
        await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
        await resolveParameterIdentityMode(db);
        await db.query(`delete from parameter_drafts where organization_id = $1 and project_id = $2`, [
          ORG,
          PROJECT
        ]);

        const auth = makeTestAuthContext({
          userId: USER,
          organizationId: ORG,
          name: "PCW User",
          email: "pcw@example.com",
          organizationName: "PCW Org",
          permissions: [...makeAuth().permissions, "parameter:edit-critical"]
        });
        const writeLock = await resolveBindingWriteLock(db, auth, {
          bindingId: seeded.bindingId,
          baseRevisionId: seeded.configRevisionId
        });
        const submittedCandidateRevisionId = await seedPendingDeleteCandidate(db, seeded, {
          candidateRevisionId: "rev-pcw-delete-reviewed-candidate"
        });
        const round = await createSubmissionRound(db, {
          id: "round-pcw-delete-merge",
          organizationId: ORG,
          projectId: PROJECT,
          submitterUserId: USER,
          status: "software_merge",
          summary: "delete gpio_int"
        });
        const request = await createChangeRequest(db, {
          id: "cr-pcw-delete-merge",
          organizationId: ORG,
          submissionRoundId: round.id,
          projectId: PROJECT,
          parameterId: seeded.bindingId,
          parameterDefinitionId: seeded.specId,
          baseVersion: 1,
          currentValue: "<1>",
          targetValue: "",
          action: "delete",
          status: "software_merge",
          submitterUserId: USER,
          parameterSpecId: seeded.specId,
          projectParameterBindingId: seeded.bindingId,
          candidateConfigRevisionId: submittedCandidateRevisionId,
          writeLock
        });
        expect(request.action).toBe("delete");

        const deletePut = vi.fn(async (input: { bytes: Buffer }) => ({
          storageKey: `${ORG}/delete-writeback-pcw.dts`,
          checksumSha256: createHash("sha256").update(input.bytes).digest("hex"),
          fileSizeBytes: input.bytes.length
        }));
        const objectStore = {
          async get(key: string) {
            return Buffer.from(key.includes("overlay") ? seeded.overlayContent : seeded.content, "utf8");
          },
          put: deletePut
        };
        await db.query(
          `update dts_occurrence_effects set effect_kind = 'set'
           where config_revision_id = $1 and property_name = $2`,
          [submittedCandidateRevisionId, PROPERTY_KEY]
        );
        await expect(
          reviewChange(
            db,
            auth,
            { requestId: request.id, decision: "advance", note: "https://example.com/reject-stale-delete-proof" },
            {
              objectStore: objectStore as never,
              toolchain: {
                async validate() {
                  return {
                    ok: true,
                    mode: "release" as const,
                    compiler: { dtc: "test", fdtoverlay: "test", dtschema: "test" },
                    diagnostics: [],
                    artifacts: {}
                  };
                },
                async probe() {
                  return {
                    dtc: { path: "/usr/bin/dtc", version: "test" },
                    fdtoverlay: { path: "/usr/bin/fdtoverlay", version: "test" },
                    dtschema: { path: "/usr/bin/dt-validate", version: "test" }
                  };
                }
              },
              skipSemanticGates: true,
              requestId: "trace-pcw-delete-merge-stale-proof"
            }
          )
        ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
        expect(
          (
            await db.query<{ count: string }>(
              `select count(*)::text as count from parameter_history_entries where request_id = $1`,
              [request.id]
            )
          ).rows[0]?.count
        ).toBe("0");
        await db.query(
          `update dts_occurrence_effects set effect_kind = 'delete'
           where config_revision_id = $1 and property_name = $2`,
          [submittedCandidateRevisionId, PROPERTY_KEY]
        );
        await db.query(
          `insert into dts_sensitive_node_rules (
             id, organization_id, project_id, match_type, pattern, risk_tier, required_capability, enabled
           ) values (
             'rule-review-merge-critical', $1, $2, 'path', '*',
             'critical', 'parameter:edit-critical', true
           )`,
          [ORG, PROJECT]
        );
        const mergeState = async () => (
          await db.query<Record<string, string>>(
            `select
               (select status from parameter_change_requests where id = $1) as status,
               (select count(*)::text from parameter_history_entries where request_id = $1) as history,
               (select count(*)::text from parameter_review_decisions where request_id = $1) as decisions,
               (select count(*)::text from project_parameter_file_versions where origin = 'writeback') as versions,
               (select count(*)::text from audit_events where kind in ('parameter-merge', 'parameter-writeback-to-file')) as success_audits`,
            [request.id]
          )
        ).rows[0];
        const beforeRefusal = await mergeState();
        await withRefusalSink(connectionString, async (refusalSink) => {
          const agentInvocation = createAgentInvocation(auth, {
            sessionId: "session-review-merge",
            toolCallId: "tool-review-merge",
            approval: { required: true, approvalId: "approval-review-merge" }
          });
          await expect(
            reviewChangeService(
              db,
              auth,
              { requestId: request.id, decision: "advance", note: "https://example.com/agent-delete" },
              {
                invocation: agentInvocation,
                requestId: "review-merge-agent-refusal",
                refusalSink,
                objectStore: objectStore as never,
                toolchain: passToolchain,
                skipSemanticGates: true
              }
            )
          ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
        });
        expect(await mergeState()).toEqual(beforeRefusal);
        expect(deletePut).not.toHaveBeenCalled();

        await db.query(
          `create or replace function fail_review_merge_writeback_audit() returns trigger as $$
           begin
             if new.kind = 'parameter-writeback-to-file' then
               raise exception 'injected review merge writeback audit failure';
             end if;
             return new;
           end;
           $$ language plpgsql`
        );
        await db.query(
          `create trigger fail_review_merge_writeback_audit_trigger
           before insert on audit_events
           for each row execute function fail_review_merge_writeback_audit()`
        );
        await expect(
          reviewChange(
            db,
            auth,
            { requestId: request.id, decision: "advance", note: "https://example.com/audit-failure-delete" },
            {
              objectStore: objectStore as never,
              toolchain: passToolchain,
              skipSemanticGates: true,
              requestId: "trace-pcw-delete-merge-audit-failure"
            }
          )
        ).rejects.toThrow("injected review merge writeback audit failure");
        expect(await mergeState()).toEqual(beforeRefusal);
        expect(deletePut).toHaveBeenCalledTimes(1);
        expect((await db.query<{ count: string }>(
          `select count(*)::text as count from user_notifications where source_id = $1`,
          [request.id]
        )).rows[0]?.count).toBe("0");
        await db.query(`drop trigger fail_review_merge_writeback_audit_trigger on audit_events`);
        await db.query(`drop function fail_review_merge_writeback_audit()`);
        deletePut.mockClear();

        const merged = await reviewChange(
          db,
          auth,
          { requestId: request.id, decision: "advance", note: "https://example.com/apply-reviewed-delete" },
          {
            objectStore: objectStore as never,
            toolchain: {
              async validate() {
                return {
                  ok: true,
                  mode: "release" as const,
                  compiler: { dtc: "test", fdtoverlay: "test", dtschema: "test" },
                  diagnostics: [],
                  artifacts: {}
                };
              },
              async probe() {
                return {
                  dtc: { path: "/usr/bin/dtc", version: "test" },
                  fdtoverlay: { path: "/usr/bin/fdtoverlay", version: "test" },
                  dtschema: { path: "/usr/bin/dt-validate", version: "test" }
                };
              }
            },
            skipSemanticGates: true,
            requestId: "trace-pcw-delete-merge"
          }
        );
        expect(merged).toMatchObject({ status: "merged", action: "delete", targetValue: "" });

        const writebackAudit = await db.query<{
          metadata: { candidateRevisionId?: string; changeAction?: string };
        }>(
          `select metadata from audit_events
           where kind = 'parameter-writeback-to-file' and trace_id = $1
           order by created_at desc limit 1`,
          ["trace-pcw-delete-merge"]
        );
        const candidateRevisionId = writebackAudit.rows[0]?.metadata.candidateRevisionId;
        expect(writebackAudit.rows[0]?.metadata.changeAction).toBe("delete");
        expect(candidateRevisionId).toBeTruthy();
        expect(
          (
            await db.query(
              `select id from project_parameter_binding_revisions
               where binding_id = $1 and config_revision_id = $2`,
              [seeded.bindingId, candidateRevisionId]
            )
          ).rows
        ).toEqual([]);
        expect(
          (
            await db.query<{ raw_value: string | null }>(
              `select raw_value from project_parameter_binding_revisions
               where binding_id = $1 and config_revision_id = $2`,
              [seeded.bindingId, seeded.configRevisionId]
            )
          ).rows[0]?.raw_value
        ).toBe("<1>");
        expect(
          (
            await db.query<{ parsed_index: { sourceText?: string } }>(
              `select parsed_index from project_parameter_file_versions
               where file_id = $1 order by version_number desc limit 1`,
              [seeded.overlayFileId]
            )
          ).rows[0]?.parsed_index.sourceText
        ).toMatch(/\/delete-property\/\s*gpio_int/);
        expect(
          (
            await db.query<{ effect_kind: string }>(
              `select effect_kind from dts_occurrence_effects
               where config_revision_id = $1 and property_name = $2`,
              [candidateRevisionId, PROPERTY_KEY]
            )
          ).rows
        ).toContainEqual({ effect_kind: "delete" });
        expect(
          (
            await db.query<{ action: string; value: string }>(
              `select pcr.action, phe.value
               from parameter_change_requests pcr
               inner join parameter_history_entries phe on phe.request_id = pcr.id
               where pcr.id = $1`,
              [request.id]
            )
          ).rows
        ).toEqual([{ action: "delete", value: "" }]);
      });
    },
    90_000
  );

  it(
    "runs list/draft/submit/review/merge/history/writeback/debug/delete without shadow PPV",
    async () => {
      await withTempDatabase(async (db, connectionString) => {
        const seeded = await seedPreCutoverGraph(db);
        const report = await migrateParameterIdentities(db, {
          mode: "apply",
          organizationId: ORG,
          ...applyGates,
          dbSnapshotId: "db-snap-pcw",
          objectSnapshotId: "obj-snap-pcw"
        });
        expect(report.blockers).toEqual([]);
        await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
        await resolveParameterIdentityMode(db);

        const activeDefs = await db.query(
          `select 1 from information_schema.tables
           where table_schema = 'public' and table_name = 'parameter_definitions'`
        );
        expect(activeDefs.rows).toHaveLength(0);

        const listed = await listParameters(db, { organizationId: ORG, projectId: PROJECT, limit: 20 });
        expect(listed.some((item) => item.id === seeded.bindingId)).toBe(true);

        const legacyCountBefore = await db.query<{ c: string }>(
          `select count(*)::text as c from legacy_project_parameter_values where organization_id = $1`,
          [ORG]
        );
        const legacyBefore = Number(legacyCountBefore.rows[0]?.c ?? 0);

        await db.query(`delete from parameter_drafts where organization_id = $1 and project_id = $2`, [
          ORG,
          PROJECT
        ]);

        const auth = makeTestAuthContext({
          userId: USER,
          organizationId: ORG,
          name: "PCW User",
          email: "pcw@example.com",
          organizationName: "PCW Org",
          permissions: [...makeAuth().permissions, "parameter:edit-critical"]
        });
        const mergedGpioValue = "<&gpio13 30 0>";
        await db.query(
          `insert into dts_config_revisions (
             id, organization_id, project_id, config_set_id, revision_number, status,
             created_by_user_id, entry_file, include_search_paths, overlay_order, manifest_state
           )
           select 'zz-newer-unbound-revision', organization_id, project_id, config_set_id, 999, 'compiled',
                  created_by_user_id, entry_file, include_search_paths, overlay_order, manifest_state
           from dts_config_revisions where id = $1`,
          [seeded.configRevisionId]
        );
        await db.query(
          `insert into dts_logical_node_revisions (
             id, logical_node_id, config_revision_id, node_locator, name, unit_address,
             parent_logical_node_id, compatible
           ) values (
             'lnr-newer-unbound-revision', $1, 'zz-newer-unbound-revision',
             '/wrong/latest/locator', 'wrong', null, null, 'wiseeff,newer-safe'
           )`,
          [expectedLogicalNodeId()]
        );
        await db.query(
          `insert into dts_sensitive_node_rules (
             id, organization_id, project_id, match_type, pattern,
             risk_tier, required_capability, enabled
           ) values ($1, $2, $3, 'path', $4, 'critical', 'parameter:edit-critical', true)`,
          ["rule-pcw-exact-base-locator", ORG, PROJECT, NODE_LOCATOR]
        );
        const capableAuth = makeTestAuthContext({
          userId: USER,
          organizationId: ORG,
          name: "PCW User",
          email: "pcw@example.com",
          organizationName: "PCW Org",
          permissions: [...makeAuth().permissions, "parameter:edit-critical"]
        });
        const beforeTypedDraft = await db.query<{ drafts: string; candidates: string }>(
          `select
             (select count(*)::text from parameter_drafts where project_id = $1) as drafts,
             (select count(*)::text from dts_config_revisions where project_id = $1 and status = 'draft') as candidates`,
          [PROJECT]
        );
        await withRefusalSink(connectionString, async (refusalSink) => {
          await expect(
            createBindingDraftService(
              db,
              capableAuth,
              {
                projectId: PROJECT,
                bindingId: seeded.bindingId,
                baseRevisionId: seeded.configRevisionId,
                targetValue: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "2", value: "2" }]] },
                reason: "Exact base locator must govern typed binding policy"
              },
              { toolchain: passToolchain },
              {
                invocation: createAgentInvocation(capableAuth, {
                  sessionId: "session-pcw-exact-base-locator",
                  toolCallId: "tool-pcw-exact-base-locator",
                  approval: { required: true, approvalId: "approval-pcw-exact-base-locator" }
                }),
                requestId: "trace-pcw-exact-base-locator",
                refusalSink
              }
            )
          ).rejects.toMatchObject({
            code: "FORBIDDEN",
            status: 403,
            details: { code: "parameter-sensitive-node-human-required", requireHuman: true }
          });
        });
        const afterTypedDraft = await db.query<{ drafts: string; candidates: string }>(
          `select
             (select count(*)::text from parameter_drafts where project_id = $1) as drafts,
             (select count(*)::text from dts_config_revisions where project_id = $1 and status = 'draft') as candidates`,
          [PROJECT]
        );
        expect(afterTypedDraft.rows).toEqual(beforeTypedDraft.rows);
        await db.query(`delete from dts_sensitive_node_rules where id = $1`, ["rule-pcw-exact-base-locator"]);
        const writeLock = await resolveBindingWriteLock(db, auth, { bindingId: seeded.bindingId });
        expect(writeLock.baseConfigRevisionId).toBeTruthy();
        expect(writeLock.bindingRevisionId).toBeTruthy();
        expect(writeLock.sourceNodePath).toBe(NODE_LOCATOR);

        const draftId = randomUUID();
        const draft = await upsertDraft(db, {
          id: draftId,
          organizationId: ORG,
          projectId: PROJECT,
          parameterId: seeded.bindingId,
          userId: USER,
          targetValue: mergedGpioValue,
          reason: "post-cutover typed draft",
          projectParameterBindingId: seeded.bindingId,
          parameterSpecId: seeded.specId,
          writeLock,
        });
        expect(draft.projectParameterBindingId).toBe(seeded.bindingId);
        expect(draft.parameterId).toBe(seeded.bindingId);

        const reloaded = await listDraftsForUser(db, {
          organizationId: ORG,
          userId: USER,
          projectId: PROJECT
        });
        const stored = reloaded.find((item) => item.projectParameterBindingId === seeded.bindingId);
        expect(stored?.id).toBe(draftId);
        expect(stored?.parameterId).toBe(seeded.bindingId);
        expect(stored?.targetValue).toBe(mergedGpioValue);

        const draftLockRow = await db.query<{
          base_config_revision_id: string | null;
          binding_revision_id: string | null;
          source_file_version_id: string | null;
          expected_checksum: string | null;
        }>(
          `select base_config_revision_id, binding_revision_id, source_file_version_id, expected_checksum
           from parameter_drafts where id = $1`,
          [draftId]
        );
        expect(draftLockRow.rows[0]?.base_config_revision_id).toBe(writeLock.baseConfigRevisionId);
        expect(draftLockRow.rows[0]?.binding_revision_id).toBe(writeLock.bindingRevisionId);
        expect(draftLockRow.rows[0]?.source_file_version_id).toBe(writeLock.sourceFileVersionId);
        expect(draftLockRow.rows[0]?.expected_checksum).toBe(writeLock.expectedChecksum);

        const legacyCountAfter = await db.query<{ c: string }>(
          `select count(*)::text as c from legacy_project_parameter_values where organization_id = $1`,
          [ORG]
        );
        expect(Number(legacyCountAfter.rows[0]?.c ?? 0)).toBe(legacyBefore);

        const shadowLinks = await db.query(
          `select 1 from legacy_project_parameter_values where source_node_path like 'binding/%'`
        );
        const shadowDefs = await db.query(
          `select 1 from legacy_parameter_definitions
           where module in ('binding-shadow', 'pre-cutover-link')`
        );
        expect(shadowLinks.rows).toHaveLength(0);
        expect(shadowDefs.rows).toHaveLength(0);

        const round = await createSubmissionRound(db, {
          id: randomUUID(),
          organizationId: ORG,
          projectId: PROJECT,
          submitterUserId: USER,
          status: "submitted",
          summary: "post-cutover submit"
        });
        const reviewedCandidateRevisionId = await seedPendingSetCandidate(db, seeded, {
          candidateRevisionId: "rev-pcw-reviewed-set",
          targetValue: mergedGpioValue
        });
        const request = await createChangeRequest(db, {
          id: randomUUID(),
          organizationId: ORG,
          submissionRoundId: round.id,
          projectId: PROJECT,
          parameterId: seeded.bindingId,
          parameterDefinitionId: seeded.specId,
          baseVersion: 1,
          currentValue: "<1>",
          targetValue: mergedGpioValue,
          status: "software_merge",
          submitterUserId: USER,
          parameterSpecId: seeded.specId,
          projectParameterBindingId: seeded.bindingId,
          candidateConfigRevisionId: reviewedCandidateRevisionId,
          writeLock,
        });
        await createSubmissionItem(db, {
          id: randomUUID(),
          organizationId: ORG,
          submissionRoundId: round.id,
          changeRequestId: request.id,
          parameterId: seeded.bindingId,
          currentValue: "<1>",
          targetValue: mergedGpioValue,
          reason: "post-cutover",
          projectParameterBindingId: seeded.bindingId,
          candidateConfigRevisionId: reviewedCandidateRevisionId
        });

        const merged = await mergeChangeRequest(db, {
          historyId: randomUUID(),
          organizationId: ORG,
          requestId: request.id,
          actorUserId: USER
        });
        expect(merged?.projectParameterBindingId).toBe(seeded.bindingId);
        await updateChangeRequestStatus(db, {
          organizationId: ORG,
          requestId: request.id,
          status: "merged"
        });

        const history = await listParameterHistory(db, {
          organizationId: ORG,
          parameterId: seeded.bindingId
        });
        expect(history.some((entry) => entry.value === mergedGpioValue)).toBe(true);
        expect(history.filter((entry) => entry.value === mergedGpioValue)).toHaveLength(1);

        const baseBindingRaw = await db.query<{ raw_value: string | null; config_revision_id: string }>(
          `select raw_value, config_revision_id from project_parameter_binding_revisions
           where binding_id = $1 and config_revision_id = $2`,
          [seeded.bindingId, writeLock.baseConfigRevisionId]
        );
        expect(baseBindingRaw.rows[0]?.raw_value).toBe("<1>");

        const put = vi.fn(async (input: { bytes: Buffer }) => ({
          storageKey: `${ORG}/writeback-pcw.dts`,
          checksumSha256: createHash("sha256").update(input.bytes).digest("hex"),
          fileSizeBytes: input.bytes.length
        }));
        const objectStore = {
          async get(key: string) {
            if (key.includes("overlay")) {
              return Buffer.from(seeded.overlayContent, "utf8");
            }
            return Buffer.from(seeded.content, "utf8");
          },
          put
        };
        await db.query(
          `update dts_logical_node_revisions
           set compatible = 'wiseeff,semantic-locked-critical'
           where config_revision_id = $1 and logical_node_id = $2`,
          [writeLock.baseConfigRevisionId, expectedLogicalNodeId()]
        );
        await db.query(
          `update dts_nodes set compatible = 'wiseeff,semantic-locked-critical'
           where file_version_id = $1 and node_path = $2`,
          [writeLock.sourceFileVersionId, writeLock.sourceNodePath]
        );
        await db.query(
          `insert into dts_nodes (id, file_version_id, name, node_path, compatible)
           select 'node-semantic-locked-critical', $1, 'sc8562', $2, 'wiseeff,semantic-locked-critical'
           where not exists (
             select 1 from dts_nodes where file_version_id = $1 and node_path = $2
           )`,
          [writeLock.sourceFileVersionId, writeLock.sourceNodePath]
        );
        await db.query(
          `insert into project_parameter_file_versions (
             id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin
           )
           select 'fv-semantic-safe-current', file_id,
                  (select max(version_number) + 1 from project_parameter_file_versions where file_id = locked.file_id),
                  'safe-semantic-current', checksum, size_bytes, parsed_index, 'upload'
           from project_parameter_file_versions locked where id = $1`,
          [writeLock.sourceFileVersionId]
        );
        await db.query(
          `insert into dts_nodes (id, file_version_id, name, node_path, compatible)
           values ('node-semantic-safe-current', 'fv-semantic-safe-current', 'safe', $1, 'wiseeff,safe')`,
          [writeLock.sourceNodePath]
        );
        await db.query(
          `update project_parameter_files set current_version_id = 'fv-semantic-safe-current'
           where id = (select file_id from project_parameter_file_versions where id = $1)`,
          [writeLock.sourceFileVersionId]
        );
        await db.query(
          `insert into dts_sensitive_node_rules (
             id, organization_id, project_id, match_type, pattern, risk_tier, required_capability, enabled
           ) values (
             'rule-semantic-writeback-critical', $1, $2, 'compatible', 'wiseeff,semantic-locked-critical',
             'critical', 'parameter:edit-critical', true
           )`,
          [ORG, PROJECT]
        );
        const writebackState = async () => (
          await db.query<Record<string, string>>(
            `select
               (select count(*)::text from project_parameter_file_versions where origin = 'writeback') as versions,
               (select count(*)::text from dts_config_revisions where status = 'draft') as candidates,
               (select count(*)::text from project_parameter_binding_revisions) as binding_revisions,
               (select count(*)::text from audit_events where kind = 'parameter-writeback-to-file') as success_audits`
          )
        ).rows[0];
        const beforeWriteback = await writebackState();
        await withRefusalSink(connectionString, async (refusalSink) => {
          const agent = createAgentInvocation(auth, {
            sessionId: "session-semantic-writeback",
            toolCallId: "tool-semantic-writeback",
            approval: { required: true, approvalId: "approval-semantic-writeback" }
          });
          const system = createSystemInvocation({ kind: "service", name: "semantic-writeback-service" });
          for (const [requestId, invocation] of [
            ["semantic-writeback-agent-refusal", agent],
            ["semantic-writeback-system-refusal", system]
          ] as const) {
            await expect(
              writebackMergedParameterValue(db, objectStore as never, auth, {
                projectId: PROJECT,
                parameterDefinitionId: seeded.specId,
                mergedValue: mergedGpioValue,
                projectParameterBindingId: seeded.bindingId,
                parameterSpecId: seeded.specId,
                changeRequestId: request.id
              }, {
                invocation,
                requestId,
                refusalSink,
                toolchain: passToolchain,
                skipSemanticGates: true
              })
            ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
            expect(await writebackState()).toEqual(beforeWriteback);
            expect(put).not.toHaveBeenCalled();
          }
        });
        await db.query(
          `update dts_logical_node_revisions
           set compatible = 'wiseeff,safe'
           where config_revision_id = $1 and logical_node_id = $2`,
          [writeLock.baseConfigRevisionId, expectedLogicalNodeId()]
        );
        await db.query(
          `update dts_nodes set compatible = 'wiseeff,safe'
           where file_version_id = $1 and node_path = $2`,
          [writeLock.sourceFileVersionId, writeLock.sourceNodePath]
        );
        await db.query(
          `update dts_nodes set compatible = 'wiseeff,semantic-locked-critical'
           where file_version_id = 'fv-semantic-safe-current' and node_path = $1`,
          [writeLock.sourceNodePath]
        );
        put.mockClear();
        await withRefusalSink(connectionString, async (refusalSink) => {
          const systemWriteback = await writebackMergedParameterValue(db, objectStore as never, auth, {
            projectId: PROJECT,
            parameterDefinitionId: seeded.specId,
            mergedValue: mergedGpioValue,
            projectParameterBindingId: seeded.bindingId,
            parameterSpecId: seeded.specId,
            changeRequestId: request.id
          }, {
            invocation: createSystemInvocation({ kind: "service", name: "semantic-reverse-version-service" }),
            requestId: "semantic-reverse-version-system",
            refusalSink,
            toolchain: passToolchain,
            skipSemanticGates: true
          });
          expect(systemWriteback.skipped).toBe(false);
          if (!systemWriteback.skipped) {
            const exactVersion = await db.query<{ created_by_user_id: string | null }>(
              `select created_by_user_id from project_parameter_file_versions where id = $1`,
              [systemWriteback.versionId]
            );
            expect(exactVersion.rows).toEqual([{ created_by_user_id: null }]);
          }
          const exactAudit = await db.query<{ actor_type: string; actor_user_id: string | null }>(
            `select actor_type, actor_user_id from audit_events where trace_id = 'semantic-reverse-version-system'`
          );
          expect(exactAudit.rows).toEqual([
            expect.objectContaining({ actor_type: "system", actor_user_id: null })
          ]);
        });
        expect(put).toHaveBeenCalledTimes(1);
        put.mockClear();
        const writeback = await writebackMergedParameterValue(db, objectStore as never, auth, {
          projectId: PROJECT,
          parameterDefinitionId: seeded.specId,
          mergedValue: mergedGpioValue,
          projectParameterBindingId: seeded.bindingId,
          parameterSpecId: seeded.specId,
          changeRequestId: request.id,
        }, {
          ...createTestParameterSubmissionContext(auth, "semantic-writeback-direct"),
          toolchain: {
            async validate() {
              return {
                ok: true,
                mode: "release" as const,
                compiler: { dtc: "test", fdtoverlay: "test", dtschema: "test" },
                diagnostics: [],
                artifacts: {},
              };
            },
            async probe() {
              return {
                dtc: { path: "/usr/bin/dtc", version: "test" },
                fdtoverlay: { path: "/usr/bin/fdtoverlay", version: "test" },
                dtschema: { path: "/usr/bin/dt-validate", version: "test" },
              };
            },
          },
          skipSemanticGates: true,
        });
        expect(writeback.skipped).toBe(false);
        if (!writeback.skipped) {
          expect(writeback.candidateRevisionId).toBeTruthy();
          expect(writeback.bindingRevisionId).toBeTruthy();

          const stillBase = await db.query<{ raw_value: string | null }>(
            `select raw_value from project_parameter_binding_revisions
             where binding_id = $1 and config_revision_id = $2`,
            [seeded.bindingId, writeLock.baseConfigRevisionId]
          );
          expect(stillBase.rows[0]?.raw_value).toBe("<1>");

          const candidateBinding = await db.query<{
            raw_value: string | null;
            typed_value: unknown;
            canonical_value: unknown;
          }>(
            `select raw_value, typed_value, canonical_value from project_parameter_binding_revisions
             where binding_id = $1 and config_revision_id = $2`,
            [seeded.bindingId, writeback.candidateRevisionId]
          );
          const expectedTypedValue = {
            kind: "cells",
            bits: 32,
            groups: [[
              { kind: "phandle", label: "gpio13" },
              { kind: "integer", raw: "30", value: "30" },
              { kind: "integer", raw: "0", value: "0" },
            ]],
          };
          expect(candidateBinding.rows[0]?.raw_value).toBe(mergedGpioValue);
          expect(candidateBinding.rows[0]?.typed_value).toEqual(expectedTypedValue);
          expect(candidateBinding.rows[0]?.canonical_value).toEqual(expectedTypedValue);
        }

        const reloadedBinding = await db.query<{ raw_value: string | null; config_revision_id: string }>(
          `select raw_value, config_revision_id from project_parameter_binding_revisions
           where binding_id = $1
           order by created_at desc
           limit 1`,
          [seeded.bindingId]
        );
        expect(reloadedBinding.rows[0]?.raw_value).toBe(mergedGpioValue);
        if (!writeback.skipped) {
          expect(reloadedBinding.rows[0]?.config_revision_id).toBe(writeback.candidateRevisionId);
        }

        const overlayVersion = await db.query<{ parsed_index: { sourceText?: string } }>(
          `select parsed_index from project_parameter_file_versions
           where file_id = $1
           order by version_number desc
           limit 1`,
          [seeded.overlayFileId]
        );
        expect(overlayVersion.rows[0]?.parsed_index?.sourceText).toMatch(
          /gpio_int\s*=\s*<&gpio13 30 0>/,
        );
        expect(seeded.content).toContain("gpio_int = <1>;");

        const deviceId = "device-pcw-1";
        const targetId = "target-pcw-1";
        const sessionId = "session-pcw-1";
        await db.query(
          `insert into debugging_devices (id, organization_id, name, transport, status, firmware)
           values ($1, $2, 'dev', 'hdc', 'online', '1.0')`,
          [deviceId, ORG]
        );
        await db.query(
          `insert into debugging_targets (id, organization_id, device_id, protocol, target_ref, label, status)
           values ($1, $2, $3, 'hdc', 't1', 'target', 'ready')`,
          [targetId, ORG, deviceId]
        );
        await db.query(
          `insert into debugging_sessions (
             id, organization_id, device_id, target_id, protocol, execution_mode,
             session_kind, actor_user_id, status
           ) values ($1, $2, $3, $4, 'hdc', 'local', 'node', $5, 'active')`,
          [sessionId, ORG, deviceId, targetId, USER]
        );
        const op = await insertNodeOperation(db, {
          organizationId: ORG,
          sessionId,
          parameterId: null,
          nodeId: null,
          parameterSpecId: seeded.specId,
          projectParameterBindingId: seeded.bindingId,
          nodePath: SOURCE_NODE_PATH,
          operationType: "read",
          status: "succeeded",
          readValue: mergedGpioValue,
          durationMs: 1,
          actorUserId: USER
        });
        expect(op.id).toBeTruthy();
        const opRow = await db.query<{ project_parameter_binding_id: string | null }>(
          `select project_parameter_binding_id from node_operations where id = $1`,
          [op.id]
        );
        expect(opRow.rows[0]?.project_parameter_binding_id).toBe(seeded.bindingId);

        const deleteSqlProbe = await fs.readFile(
          path.join(projectRoot, "server/modules/projects/repository.ts"),
          "utf8"
        );
        expect(deleteSqlProbe).not.toMatch(/delete from project_parameter_values/);
        expect(deleteSqlProbe).toContain("delete from project_parameter_bindings");

        const deleted = await deleteProject(db, { organizationId: ORG, projectId: PROJECT });
        expect(deleted.deleted).toBe(true);
        const bindingsLeft = await db.query(
          `select 1 from project_parameter_bindings where project_id = $1`,
          [PROJECT]
        );
        expect(bindingsLeft.rows).toHaveLength(0);
      });
    },
    120_000
  );

  it(
    "returns 409 when merge lock is missing or stale",
    async () => {
      await withTempDatabase(async (db) => {
        const seeded = await seedPreCutoverGraph(db);
        const report = await migrateParameterIdentities(db, {
          mode: "apply",
          organizationId: ORG,
          ...applyGates,
          dbSnapshotId: "db-snap-pcw-stale",
          objectSnapshotId: "obj-snap-pcw-stale"
        });
        expect(report.blockers).toEqual([]);
        await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
        await resolveParameterIdentityMode(db);

        const auth = makeAuth();
        const writeLock = await resolveBindingWriteLock(db, auth, { bindingId: seeded.bindingId });
        const round = await createSubmissionRound(db, {
          id: randomUUID(),
          organizationId: ORG,
          projectId: PROJECT,
          submitterUserId: USER,
          status: "submitted",
          summary: "stale merge"
        });
        const reviewedCandidateRevisionId = await seedPendingSetCandidate(db, seeded, {
          candidateRevisionId: "rev-pcw-stale-reviewed-set",
          targetValue: "<9>"
        });
        const requestWithoutLock = await createChangeRequest(db, {
          id: randomUUID(),
          organizationId: ORG,
          submissionRoundId: round.id,
          projectId: PROJECT,
          parameterId: seeded.bindingId,
          parameterDefinitionId: seeded.specId,
          baseVersion: 1,
          currentValue: "<1>",
          targetValue: "<9>",
          status: "software_merge",
          submitterUserId: USER,
          parameterSpecId: seeded.specId,
          projectParameterBindingId: seeded.bindingId,
          candidateConfigRevisionId: reviewedCandidateRevisionId
        });
        const missingLockMerge = await mergeChangeRequest(db, {
          historyId: randomUUID(),
          organizationId: ORG,
          requestId: requestWithoutLock.id,
          actorUserId: USER
        });
        expect(missingLockMerge).toBeNull();

        const requestWithoutCandidate = await createChangeRequest(db, {
          id: randomUUID(),
          organizationId: ORG,
          submissionRoundId: round.id,
          projectId: PROJECT,
          parameterId: seeded.bindingId,
          parameterDefinitionId: seeded.specId,
          baseVersion: 1,
          currentValue: "<1>",
          targetValue: "<9>",
          status: "software_merge",
          submitterUserId: USER,
          parameterSpecId: seeded.specId,
          projectParameterBindingId: seeded.bindingId,
          writeLock
        });
        expect(
          await mergeChangeRequest(db, {
            historyId: randomUUID(),
            organizationId: ORG,
            requestId: requestWithoutCandidate.id,
            actorUserId: USER
          })
        ).toBeNull();

        const request = await createChangeRequest(db, {
          id: randomUUID(),
          organizationId: ORG,
          submissionRoundId: round.id,
          projectId: PROJECT,
          parameterId: seeded.bindingId,
          parameterDefinitionId: seeded.specId,
          baseVersion: 1,
          currentValue: "<1>",
          targetValue: "<9>",
          status: "software_merge",
          submitterUserId: USER,
          parameterSpecId: seeded.specId,
          projectParameterBindingId: seeded.bindingId,
          candidateConfigRevisionId: reviewedCandidateRevisionId,
          writeLock
        });
        await db.query(`update dts_config_revisions set status = 'invalid' where id = $1`, [
          reviewedCandidateRevisionId
        ]);
        expect(
          await mergeChangeRequest(db, {
            historyId: randomUUID(),
            organizationId: ORG,
            requestId: request.id,
            actorUserId: USER
          })
        ).toBeNull();
        await db.query(`update dts_config_revisions set status = 'pending_approval' where id = $1`, [
          reviewedCandidateRevisionId
        ]);
        await db.query(
          `update project_parameter_binding_revisions set raw_value = '<10>'
           where binding_id = $1 and config_revision_id = $2`,
          [seeded.bindingId, reviewedCandidateRevisionId]
        );
        expect(
          await mergeChangeRequest(db, {
            historyId: randomUUID(),
            organizationId: ORG,
            requestId: request.id,
            actorUserId: USER
          })
        ).toBeNull();
        await db.query(
          `update project_parameter_binding_revisions set raw_value = '<9>'
           where binding_id = $1 and config_revision_id = $2`,
          [seeded.bindingId, reviewedCandidateRevisionId]
        );
        await db.query(
          `update project_parameter_file_versions set checksum = 'stale-checksum' where id = $1`,
          [writeLock.sourceFileVersionId]
        );
        const staleMerge = await mergeChangeRequest(db, {
          historyId: randomUUID(),
          organizationId: ORG,
          requestId: request.id,
          actorUserId: USER
        });
        expect(staleMerge).toBeNull();
      });
    },
    120_000
  );

  it(
    "returns 409 when writeback checksum lock is stale",
    async () => {
      await withTempDatabase(async (db) => {
        const seeded = await seedPreCutoverGraph(db);
        const report = await migrateParameterIdentities(db, {
          mode: "apply",
          organizationId: ORG,
          ...applyGates,
          dbSnapshotId: "db-snap-pcw-wb-stale",
          objectSnapshotId: "obj-snap-pcw-wb-stale"
        });
        expect(report.blockers).toEqual([]);
        await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
        await resolveParameterIdentityMode(db);

        const auth = makeAuth();
        const writeLock = await resolveBindingWriteLock(db, auth, { bindingId: seeded.bindingId });
        const round = await createSubmissionRound(db, {
          id: randomUUID(),
          organizationId: ORG,
          projectId: PROJECT,
          submitterUserId: USER,
          status: "submitted",
          summary: "stale writeback"
        });
        const reviewedCandidateRevisionId = await seedPendingSetCandidate(db, seeded, {
          candidateRevisionId: "rev-pcw-stale-writeback-reviewed-set",
          targetValue: "<9>"
        });
        const request = await createChangeRequest(db, {
          id: randomUUID(),
          organizationId: ORG,
          submissionRoundId: round.id,
          projectId: PROJECT,
          parameterId: seeded.bindingId,
          parameterDefinitionId: seeded.specId,
          baseVersion: 1,
          currentValue: "<1>",
          targetValue: "<9>",
          status: "software_merge",
          submitterUserId: USER,
          parameterSpecId: seeded.specId,
          projectParameterBindingId: seeded.bindingId,
          candidateConfigRevisionId: reviewedCandidateRevisionId,
          writeLock
        });
        await mergeChangeRequest(db, {
          historyId: randomUUID(),
          organizationId: ORG,
          requestId: request.id,
          actorUserId: USER
        });

        await db.query(
          `update project_parameter_file_versions set checksum = 'stale-checksum' where id = $1`,
          [writeLock.sourceFileVersionId]
        );

        const objectStore = {
          async get(key: string) {
            if (key.includes("overlay")) {
              return Buffer.from(seeded.overlayContent, "utf8");
            }
            return Buffer.from(seeded.content, "utf8");
          },
          async put(input: { bytes: Buffer }) {
            return {
              storageKey: `${ORG}/stale-writeback.dts`,
              checksumSha256: createHash("sha256").update(input.bytes).digest("hex"),
              fileSizeBytes: input.bytes.length
            };
          }
        };

        await expect(
          writebackMergedParameterValue(
            db,
            objectStore as never,
            auth,
            {
              projectId: PROJECT,
              parameterDefinitionId: seeded.specId,
              mergedValue: "<9>",
              projectParameterBindingId: seeded.bindingId,
              parameterSpecId: seeded.specId,
              changeRequestId: request.id
            },
            {
              ...createTestParameterSubmissionContext(auth, "semantic-writeback-stale"),
              toolchain: {
                async validate() {
                  return {
                    ok: true,
                    mode: "release" as const,
                    compiler: { dtc: "test", fdtoverlay: "test", dtschema: "test" },
                    diagnostics: [],
                    artifacts: {},
                  };
                },
                async probe() {
                  return {
                    dtc: { path: "/usr/bin/dtc", version: "test" },
                    fdtoverlay: { path: "/usr/bin/fdtoverlay", version: "test" },
                    dtschema: { path: "/usr/bin/dt-validate", version: "test" },
                  };
                },
              },
              skipSemanticGates: true,
            }
          )
        ).rejects.toMatchObject({
          code: "CONFLICT",
          status: 409
        } satisfies Partial<ApiError>);

        const persistedLock = await getChangeRequestWriteLock(db, {
          organizationId: ORG,
          requestId: request.id
        });
        expect(persistedLock?.expectedChecksum).toBe(writeLock.expectedChecksum);
      });
    },
    120_000
  );

  async function assertMergeSucceeded(
    db: Database,
    requestId: string,
    bindingId: string,
    baseRevisionId: string,
    mergedValue: string
  ) {
    const status = await db.query<{ status: string }>(
      `select status from parameter_change_requests where id = $1`,
      [requestId]
    );
    expect(status.rows[0]?.status).toBe("merged");

    const history = await listParameterHistory(db, {
      organizationId: ORG,
      parameterId: bindingId
    });
    expect(history.filter((entry) => entry.value === mergedValue)).toHaveLength(1);

    const generatedCandidate = await db.query<{ c: string }>(
      `select count(*)::text as c
       from project_parameter_binding_revisions bpr
       inner join dts_config_revisions cr on cr.id = bpr.config_revision_id
       where bpr.binding_id = $1 and bpr.raw_value = $2
         and cr.status <> 'pending_approval'`,
      [bindingId, mergedValue]
    );
    expect(Number(generatedCandidate.rows[0]?.c ?? 0)).toBeGreaterThan(0);

    const base = await db.query<{ raw_value: string | null }>(
      `select raw_value from project_parameter_binding_revisions
       where binding_id = $1 and config_revision_id = $2`,
      [bindingId, baseRevisionId]
    );
    expect(base.rows[0]?.raw_value).toBe("<1>");

    const audits = await db.query<{ c: string }>(
      `select count(*)::text as c from audit_events
       where organization_id = $1 and kind = 'parameter-merge' and target_id = $2`,
      [ORG, requestId]
    );
    expect(Number(audits.rows[0]?.c ?? 0)).toBeGreaterThan(0);
  }

  async function assertMergeRolledBack(db: Database, requestId: string, bindingId: string, baseRevisionId: string) {
    const status = await db.query<{ status: string }>(
      `select status from parameter_change_requests where id = $1`,
      [requestId]
    );
    expect(status.rows[0]?.status).toBe("software_merge");

    const history = await listParameterHistory(db, {
      organizationId: ORG,
      parameterId: bindingId
    });
    expect(history.filter((entry) => entry.value === "<9>")).toHaveLength(0);

    const generatedCandidate = await db.query<{ c: string }>(
      `select count(*)::text as c
       from project_parameter_binding_revisions bpr
       inner join dts_config_revisions cr on cr.id = bpr.config_revision_id
       where bpr.binding_id = $1 and bpr.raw_value = '<9>'
         and cr.status <> 'pending_approval'`,
      [bindingId]
    );
    expect(Number(generatedCandidate.rows[0]?.c ?? 0)).toBe(0);

    const base = await db.query<{ raw_value: string | null }>(
      `select raw_value from project_parameter_binding_revisions
       where binding_id = $1 and config_revision_id = $2`,
      [bindingId, baseRevisionId]
    );
    expect(base.rows[0]?.raw_value).toBe("<1>");

    const audits = await db.query<{ c: string }>(
      `select count(*)::text as c from audit_events
       where organization_id = $1 and kind = 'parameter-merge' and target_id = $2`,
      [ORG, requestId]
    );
    expect(Number(audits.rows[0]?.c ?? 0)).toBe(0);
  }

  function failingToolchain(failureCode: "compile-failed" | "schema-failed" | "version-mismatch" | "toolchain-unavailable", stage: "dtc" | "fdtoverlay" | "dt-validate" | "toolchain") {
    return {
      async validate() {
        return {
          ok: false as const,
          mode: "release" as const,
          compiler: { dtc: "1.8.1", fdtoverlay: "1.8.1", dtschema: "2026.6" },
          diagnostics: [
            {
              file: "<toolchain>",
              severity: "error" as const,
              code: failureCode,
              message: `injected ${failureCode}`,
              stage
            }
          ],
          artifacts: {},
          failureCode
        };
      },
      async probe() {
        return {
          dtc: { path: "/usr/bin/dtc", version: "1.8.1" },
          fdtoverlay: { path: "/usr/bin/fdtoverlay", version: "1.8.1" },
          dtschema: { path: "/usr/bin/dt-validate", version: "2026.6" }
        };
      }
    };
  }

  it(
    "fail-closes semantic merge without objectStore and leaves software_merge",
    async () => {
      await withTempDatabase(async (db) => {
        const seeded = await seedPreCutoverGraph(db);
        const report = await migrateParameterIdentities(db, {
          mode: "apply",
          organizationId: ORG,
          ...applyGates,
          dbSnapshotId: "db-snap-pcw-fc-os",
          objectSnapshotId: "obj-snap-pcw-fc-os"
        });
        expect(report.blockers).toEqual([]);
        await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
        await resolveParameterIdentityMode(db);

        const auth = makeAuth();
        const writeLock = await resolveBindingWriteLock(db, auth, { bindingId: seeded.bindingId });
        const round = await createSubmissionRound(db, {
          id: randomUUID(),
          organizationId: ORG,
          projectId: PROJECT,
          submitterUserId: USER,
          status: "submitted",
          summary: "fail-closed objectStore"
        });
        const reviewedCandidateRevisionId = await seedPendingSetCandidate(db, seeded, {
          candidateRevisionId: "rev-pcw-fc-object-store-reviewed-set",
          targetValue: "<9>"
        });
        const request = await createChangeRequest(db, {
          id: randomUUID(),
          organizationId: ORG,
          submissionRoundId: round.id,
          projectId: PROJECT,
          parameterId: seeded.bindingId,
          parameterDefinitionId: seeded.specId,
          baseVersion: 1,
          currentValue: "<1>",
          targetValue: "<9>",
          status: "software_merge",
          submitterUserId: USER,
          parameterSpecId: seeded.specId,
          projectParameterBindingId: seeded.bindingId,
          candidateConfigRevisionId: reviewedCandidateRevisionId,
          writeLock
        });

        await expect(
          reviewChange(db, auth, {
            requestId: request.id,
            decision: "advance",
            note: "https://example.com/semantic-merge-no-object-store",
            expectedVersion: 1
          })
        ).rejects.toMatchObject({
          code: "CONFLICT",
          message: expect.stringContaining("object storage")
        });

        await assertMergeRolledBack(db, request.id, seeded.bindingId, writeLock.baseConfigRevisionId);

        process.env.WISEEFF_WRITEBACK_SKIP_TOOLCHAIN = "1";
        try {
          await expect(
            reviewChange(db, auth, {
              requestId: request.id,
              decision: "advance",
              note: "https://example.com/semantic-merge-no-object-store",
              expectedVersion: 1
            })
          ).rejects.toMatchObject({
            code: "CONFLICT",
            message: expect.stringContaining("object storage")
          });
          await assertMergeRolledBack(db, request.id, seeded.bindingId, writeLock.baseConfigRevisionId);
        } finally {
          delete process.env.WISEEFF_WRITEBACK_SKIP_TOOLCHAIN;
        }

        const writebackSource = await fs.readFile(
          path.join(projectRoot, "server/modules/parameter-files/writebackService.ts"),
          "utf8"
        );
        const serviceSource = await fs.readFile(
          path.join(projectRoot, "server/modules/parameters/service.ts"),
          "utf8"
        );
        expect(writebackSource).not.toContain("WISEEFF_WRITEBACK_SKIP_TOOLCHAIN");
        expect(serviceSource).not.toContain("WISEEFF_WRITEBACK_SKIP_TOOLCHAIN");
      });
    },
    120_000
  );

  for (const caseDef of [
    { name: "dtc", failureCode: "compile-failed" as const, stage: "dtc" as const },
    { name: "fdtoverlay", failureCode: "compile-failed" as const, stage: "fdtoverlay" as const },
    { name: "dt-schema", failureCode: "schema-failed" as const, stage: "dt-validate" as const },
    { name: "version-mismatch", failureCode: "version-mismatch" as const, stage: "toolchain" as const },
    { name: "toolchain-unavailable", failureCode: "toolchain-unavailable" as const, stage: "toolchain" as const }
  ]) {
    it(
      `completes semantic merge when toolchain ${caseDef.name} fails`,
      async () => {
        await withTempDatabase(async (db, connectionString) => {
          const seeded = await seedPreCutoverGraph(db);
          const report = await migrateParameterIdentities(db, {
            mode: "apply",
            organizationId: ORG,
            ...applyGates,
            dbSnapshotId: `db-snap-pcw-fc-${caseDef.name}`,
            objectSnapshotId: `obj-snap-pcw-fc-${caseDef.name}`
          });
          expect(report.blockers).toEqual([]);
          await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
          await resolveParameterIdentityMode(db);

          const auth = makeAuth();
          const writeLock = await resolveBindingWriteLock(db, auth, { bindingId: seeded.bindingId });
          const round = await createSubmissionRound(db, {
            id: randomUUID(),
            organizationId: ORG,
            projectId: PROJECT,
            submitterUserId: USER,
            status: "submitted",
            summary: `fail-closed ${caseDef.name}`
          });
          const reviewedCandidateRevisionId = await seedPendingSetCandidate(db, seeded, {
            candidateRevisionId: `rev-pcw-fc-${caseDef.name}-reviewed-set`,
            targetValue: "<9>"
          });
          const request = await createChangeRequest(db, {
            id: randomUUID(),
            organizationId: ORG,
            submissionRoundId: round.id,
            projectId: PROJECT,
            parameterId: seeded.bindingId,
            parameterDefinitionId: seeded.specId,
            baseVersion: 1,
            currentValue: "<1>",
            targetValue: "<9>",
            status: "software_merge",
            submitterUserId: USER,
            parameterSpecId: seeded.specId,
            projectParameterBindingId: seeded.bindingId,
            candidateConfigRevisionId: reviewedCandidateRevisionId,
            writeLock
          });

          const objectStore = {
            async get(key: string) {
              if (key.includes("overlay")) {
                return Buffer.from(seeded.overlayContent, "utf8");
              }
              return Buffer.from(seeded.content, "utf8");
            },
            async put(input: { bytes: Buffer }) {
              return {
                storageKey: `${ORG}/fc-${caseDef.name}.dts`,
                checksumSha256: createHash("sha256").update(input.bytes).digest("hex"),
                fileSizeBytes: input.bytes.length
              };
            }
          };

          const trustedInvocation =
            caseDef.name === "dtc"
              ? createAgentInvocation(auth, {
                  sessionId: "session-merge-high-agent",
                  toolCallId: "tool-merge-high-agent",
                  approval: { required: true, approvalId: "approval-merge-high-agent" }
                })
              : caseDef.name === "fdtoverlay"
                ? createSystemInvocation({ kind: "job", name: "parameter-merge-high-job" })
                : undefined;
          const trustedTrace = trustedInvocation ? `trusted-merge-${caseDef.name}` : undefined;
          const reviewInput = {
            requestId: request.id,
            decision: "advance" as const,
            note: `https://example.com/toolchain-fail-${caseDef.name}`,
            expectedVersion: 1
          };
          const reviewContext = {
            objectStore: objectStore as never,
            toolchain: failingToolchain(caseDef.failureCode, caseDef.stage) as never
          };
          if (caseDef.name === "dtc") {
            const substitutedAgent = createAgentInvocation({
              ...auth,
              user: { ...auth.user, id: "other-merge-principal" }
            }, {
              sessionId: "session-substituted-agent",
              toolCallId: "tool-substituted-agent",
              approval: { required: false }
            });
            await expect(withRefusalSink(connectionString, (refusalSink) =>
              reviewChangeService(db, auth, reviewInput, {
                ...reviewContext,
                invocation: substitutedAgent,
                requestId: "trusted-merge-substituted-agent",
                refusalSink
              })
            )).rejects.toMatchObject({ code: "INVALID_TRUSTED_INVOCATION_CONTEXT" });
            await assertMergeRolledBack(db, request.id, seeded.bindingId, writeLock.baseConfigRevisionId);
            expect((await db.query<{ count: string }>(
              `select count(*)::text as count from user_notifications where source_id = $1`,
              [request.id]
            )).rows[0]?.count).toBe("0");
          }
          const runReview = () => trustedInvocation && trustedTrace
            ? withRefusalSink(connectionString, (refusalSink) =>
                reviewChangeService(db, auth, reviewInput, {
                  ...reviewContext,
                  invocation: trustedInvocation,
                  requestId: trustedTrace,
                  refusalSink
                })
              )
            : reviewChange(db, auth, reviewInput, reviewContext);

          const merged = await runReview();

          expect(merged.status).toBe("merged");
          await assertMergeSucceeded(db, request.id, seeded.bindingId, writeLock.baseConfigRevisionId, "<9>");
          if (trustedInvocation && trustedTrace) {
            const audits = await db.query<{
              kind: string;
              actor_type: string;
              actor_user_id: string | null;
              trace_id: string;
              metadata: Record<string, unknown>;
            }>(
              `select kind, actor_type, actor_user_id, trace_id, metadata
               from audit_events
               where trace_id = $1 and kind in ('parameter-merge', 'parameter-writeback-to-file')
               order by kind`,
              [trustedTrace]
            );
            expect(audits.rows).toHaveLength(2);
            if (trustedInvocation.initiator === "agent") {
              expect(audits.rows).toEqual(
                expect.arrayContaining([
                  expect.objectContaining({
                    actor_type: "agent",
                    actor_user_id: USER,
                    trace_id: trustedTrace,
                    metadata: expect.objectContaining({
                      initiator: "agent",
                      sessionId: "session-merge-high-agent",
                      toolCallId: "tool-merge-high-agent",
                      approvalId: "approval-merge-high-agent"
                    })
                  })
                ])
              );
              expect(audits.rows.every((row) => row.actor_type === "agent" && row.actor_user_id === USER)).toBe(true);
              expect(audits.rows.find((row) => row.kind === "parameter-merge")?.metadata).toEqual(
                expect.objectContaining({
                  participants: expect.arrayContaining([
                    expect.objectContaining({ role: "Agent 合入执行", name: "WiseEff Agent" })
                  ])
                })
              );
              const notifications = await db.query<{ body: string; metadata: Record<string, unknown> }>(
                `select body, metadata from user_notifications
                 where source_id = $1 and category = 'parameter.merge.completed'`,
                [request.id]
              );
              expect(notifications.rows.length).toBeGreaterThan(0);
              expect(notifications.rows).toEqual(expect.arrayContaining([
                expect.objectContaining({
                  body: expect.stringContaining("WiseEff Agent"),
                  metadata: expect.objectContaining({
                    mergerName: "WiseEff Agent",
                    initiatorType: "agent",
                    executionLabel: "WiseEff Agent"
                  })
                })
              ]));
              expect(notifications.rows.every((row) =>
                !row.body.includes("session-merge-high-agent") &&
                !row.body.includes("tool-merge-high-agent") &&
                !row.metadata.initiatorSessionId &&
                !row.metadata.initiatorToolCallId &&
                !row.metadata.initiatorApprovalId
              )).toBe(true);
              expect(notifications.rows.some((row) => row.body.includes(auth.user.name))).toBe(false);
              const accountableRows = await db.query<{
                reviewer_user_id: string;
                changed_by_user_id: string | null;
                file_creator_user_id: string | null;
                revision_creator_user_id: string | null;
              }>(
                `select
                   (select reviewer_user_id from parameter_review_decisions
                    where request_id = $1 and to_status = 'merged' order by created_at desc limit 1) as reviewer_user_id,
                   (select changed_by_user_id from parameter_history_entries
                    where request_id = $1 order by changed_at desc limit 1) as changed_by_user_id,
                   (select created_by_user_id from project_parameter_file_versions
                    where origin = 'writeback' order by created_at desc limit 1) as file_creator_user_id,
                   (select created_by_user_id from dts_config_revisions
                    order by created_at desc limit 1) as revision_creator_user_id`,
                [request.id]
              );
              expect(accountableRows.rows).toEqual([{
                reviewer_user_id: USER,
                changed_by_user_id: USER,
                file_creator_user_id: USER,
                revision_creator_user_id: USER
              }]);
            } else {
              expect(audits.rows).toEqual(
                expect.arrayContaining([
                  expect.objectContaining({
                    actor_type: "system",
                    actor_user_id: null,
                    trace_id: trustedTrace,
                    metadata: expect.objectContaining({
                      initiator: "system",
                      systemKind: "job",
                      systemName: "parameter-merge-high-job"
                    })
                  })
                ])
              );
              expect(audits.rows.every((row) => row.actor_type === "system" && row.actor_user_id === null)).toBe(true);
              const mergeMetadata = audits.rows.find((row) => row.kind === "parameter-merge")?.metadata;
              expect(mergeMetadata).toEqual(
                expect.objectContaining({
                  participants: expect.arrayContaining([
                    expect.objectContaining({
                      role: "System 合入执行",
                      name: "WiseEff System job"
                    })
                  ])
                })
              );
              const executionParticipants = (mergeMetadata?.participants as Array<{
                role: string;
                name: string;
                action?: string;
                note?: string;
              }>)
                .filter((participant) => participant.role.includes("合入执行"));
              expect(executionParticipants).toEqual([
                { role: "System 合入执行", name: "WiseEff System job", action: "合入参数", note: expect.any(String) }
              ]);
              expect(executionParticipants.some((participant) => participant.name === auth.user.name)).toBe(false);
            }
          }
        });
      },
      120_000
    );
  }

  it(
    "keeps topology draft ownership separated by trusted initiator and lets System submit its own draft",
    async () => {
      await withTempDatabase(async (db, connectionString) => {
        const seeded = await seedPreCutoverGraph(db);
        // Give the overlay fixture a concrete status effect so the enablement
        // draft can resolve its write target before the ownership assertions.
        await db.query(
          `update dts_node_occurrences
           set labels = '["sc8562"]'::jsonb
           where config_revision_id = $1 and node_path = $2`,
          [seeded.configRevisionId, "amba/i2c@FDF5E000/sc8562@6E"]
        );
        await db.query(
          `insert into dts_occurrence_effects (
             id, config_revision_id, logical_node_revision_id, node_occurrence_id,
             property_name, effect_kind, source_order
           ) values ($1, $2, $3, $4, 'status', 'delete', 2)`,
          [
            "oe-pcw-owner-status",
            seeded.configRevisionId,
            `lnr-${expectedLogicalNodeId()}`,
            "no-pcw-1"
          ]
        );
        await db.query(
          `update project_parameter_file_versions
           set parsed_index = jsonb_build_object('sourceText', $1::text)
           where id = $2`,
          [seeded.content, seeded.fileVersionId]
        );
        await db.query(
          `update project_parameter_file_versions
           set parsed_index = jsonb_build_object('sourceText', $1::text)
           where id = $2`,
          [seeded.overlayContent, seeded.overlayVersionId]
        );
        const report = await migrateParameterIdentities(db, {
          mode: "apply",
          organizationId: ORG,
          ...applyGates,
          dbSnapshotId: "db-snap-draft-owner",
          objectSnapshotId: "obj-snap-draft-owner"
        });
        expect(report.blockers).toEqual([]);
        await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
        await resolveParameterIdentityMode(db);

        const auth = makeAuth();
        const userDraft = await withRefusalSink(connectionString, (refusalSink) =>
          createNodeEnablementDraft(
            db,
            auth,
            {
              projectId: PROJECT,
              logicalNodeId: expectedLogicalNodeId(),
              baseRevisionId: seeded.configRevisionId,
              target: "force-disabled",
              reason: "Direct user draft must keep its own working tip"
            },
            { toolchain: passToolchain },
            {
              invocation: createUserInvocation(auth),
              requestId: "draft-owner-user",
              refusalSink
            }
          )
        );
        const userTip = userDraft.candidateRevisionId;

        const agentDraft = await withRefusalSink(connectionString, (refusalSink) =>
          createNodeEnablementDraft(
            db,
            auth,
            {
              projectId: PROJECT,
              logicalNodeId: expectedLogicalNodeId(),
              baseRevisionId: seeded.configRevisionId,
              target: "force-enabled",
              reason: "Agent draft must not rebase the direct user draft"
            },
            { toolchain: passToolchain },
            {
              invocation: createAgentInvocation(auth, {
                sessionId: "session-draft-owner",
                toolCallId: "tool-draft-owner",
                approval: { required: true, approvalId: "approval-draft-owner" }
              }),
              requestId: "draft-owner-agent",
              refusalSink
            }
          )
        );

        const owners = await db.query<{
          id: string;
          user_id: string | null;
          initiator_type: string;
          initiator_session_id: string | null;
          candidate_config_revision_id: string | null;
        }>(
          `select id, user_id, initiator_type, initiator_session_id, candidate_config_revision_id
           from parameter_drafts
           where project_id = $1 and logical_node_id = $2
           order by initiator_type`,
          [PROJECT, expectedLogicalNodeId()]
        );
        expect(owners.rows).toEqual([
          {
            id: agentDraft.draftId,
            user_id: USER,
            initiator_type: "agent",
            initiator_session_id: "session-draft-owner",
            candidate_config_revision_id: agentDraft.candidateRevisionId
          },
          {
            id: userDraft.draftId,
            user_id: USER,
            initiator_type: "user",
            initiator_session_id: null,
            candidate_config_revision_id: userTip
          }
        ]);

        // A non-target binding is copied into every candidate revision.  Keep
        // one explicit row so the test observes the carry-forward provenance,
        // not only the binding edited by the enablement draft.
        const baseBinding = await db.query<{
          module_id: string;
          parameter_spec_version_id: string;
        }>(
          `select b.module_id, br.parameter_spec_version_id
           from project_parameter_bindings b
           inner join project_parameter_binding_revisions br
             on br.binding_id = b.id and br.config_revision_id = $2
           where b.id = $1`,
          [expectedBindingId(seeded.specId, expectedLogicalNodeId()), seeded.configRevisionId]
        );
        expect(baseBinding.rows[0]).toBeTruthy();
        const carriedBindingId = "binding-pcw-carried-forward";
        await db.query(
          `insert into project_parameter_bindings (
             id, organization_id, project_id, logical_node_id, parameter_spec_id, module_id
           ) values ($1, $2, $3, null, $4, $5)`,
          [
            carriedBindingId,
            ORG,
            PROJECT,
            seeded.specId,
            baseBinding.rows[0]!.module_id
          ]
        );
        await db.query(
          `insert into project_parameter_binding_revisions (
             id, binding_id, config_revision_id, parameter_spec_version_id,
             typed_value, canonical_value, raw_value, schema_state
           ) values ($1, $2, $3, $4, '{"kind":"integer","value":"7"}'::jsonb,
                     '{"kind":"integer","value":"7"}'::jsonb, '<7>', 'valid')`,
          [
            "bpr-pcw-carried-forward-base",
            carriedBindingId,
            seeded.configRevisionId,
            baseBinding.rows[0]!.parameter_spec_version_id
          ]
        );

        const systemDraft = await withRefusalSink(connectionString, (refusalSink) =>
          createNodeEnablementDraft(
            db,
            auth,
            {
              projectId: PROJECT,
              logicalNodeId: expectedLogicalNodeId(),
              baseRevisionId: seeded.configRevisionId,
              target: "force-disabled",
              reason: "System draft has an independently addressable owner"
            },
            { toolchain: passToolchain },
            {
              invocation: createSystemInvocation({ kind: "job", name: "draft-owner-job" }),
              requestId: "draft-owner-system",
              refusalSink
            }
          )
        );

        const carriedForward = await db.query<{
          initiator_type: string;
          initiator_system_kind: string | null;
          initiator_system_name: string | null;
        }>(
          `select initiator_type, initiator_system_kind, initiator_system_name
           from project_parameter_binding_revisions
           where binding_id = $1 and config_revision_id = $2`,
          [carriedBindingId, systemDraft.candidateRevisionId]
        );
        expect(carriedForward.rows).toEqual([
          {
            initiator_type: "system",
            initiator_system_kind: "job",
            initiator_system_name: "draft-owner-job"
          }
        ]);

        const submitted = await withRefusalSink(connectionString, (refusalSink) =>
          submitParameterChanges(
            db,
            auth,
            {
              projectId: PROJECT,
              items: [
                {
                  draftId: systemDraft.draftId,
                  editSubjectKind: "node-enablement",
                  logicalNodeId: expectedLogicalNodeId(),
                  targetValue: systemDraft.rawText,
                  reason: "System draft has an independently addressable owner"
                }
              ]
            },
            {
              invocation: createSystemInvocation({ kind: "job", name: "draft-owner-job" }),
              requestId: "draft-owner-system-submit",
              refusalSink
            }
          )
        );
        expect(submitted).toMatchObject({ status: "submitted" });
      });
    },
    120_000
  );
});
