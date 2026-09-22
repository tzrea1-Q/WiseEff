import { randomUUID } from "node:crypto";

import type { RootDatabase } from "../../../shared/database/client";
import { getRootPostgresPool } from "../../../shared/database/client";
import type { ObjectStore } from "../../logs/objectStore";
import { hashLocalAccountPassword } from "../../auth/localAccountCredentials";
import type { AuthContext } from "../../auth/types";
import { makeTestAuthContext } from "../../../testing/authContext";
import { createCatalogKernel } from "../../catalog-kernel/interface";
import {
  installPublishedReleaseA,
  SUBJECT_ID,
  X_DEFINITION_ID,
  X_REVISION_1,
} from "../../catalog-kernel/runtime/catalogChain.fixture";
import { writeGuardedRegistration } from "../../parameter-governance/registration/internalGuardedRegistrationWriter";
import type { RegisterSubjectCommand } from "../../parameter-governance/registration/command";
import {
  asValueClient,
  loadPublishedCatalog,
  syncPublishedCatalogProjectValuesInTransaction,
} from "../../parameter-bindings/catalogProjectValueSync";
import type { Binding } from "../../parameter-bindings/binding";
import { ingestConfigRevision } from "../../parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../../parameter-topology/types";
import { withAuditedWrite } from "../../audit/auditedWrite";
import {
  DefinitionRevisionId,
  CatalogSubjectId,
  ParameterDefinitionId,
  ParameterBindingId,
  SubjectRegistrationId,
  type CatalogReleasePin,
} from "../../parameter-catalog-contract";

export const CANONICAL_PARAMETER_FIXTURE = {
  organizationId: "org-905-canonical",
  projectId: "project-905-canonical",
  otherProjectId: "project-905-canonical-other",
  otherOrganizationId: "org-905-canonical-other",
  editorId: "user-905-canonical-editor",
  reviewerId: "user-905-canonical-reviewer",
  guestId: "user-905-canonical-guest",
  otherOrganizationUserId: "user-905-canonical-other",
  editorUsername: "issue905-editor",
  reviewerUsername: "issue905-reviewer",
  guestUsername: "issue905-guest",
  otherUsername: "issue905-other",
  password: "issue905-local-password",
  categoryModuleId: "pmod-905-canonical-category",
  driverModuleId: "pmod-905-canonical-driver",
  attributionSubjectId: "attr-905-canonical",
} as const;

export type CanonicalParameterFixture = {
  readonly organizationId: string;
  readonly projectId: string;
  readonly otherProjectId: string;
  readonly otherOrganizationId: string;
  readonly subjectId: string;
  readonly registrationId: string;
  readonly bindingId: string;
  readonly binding: Binding;
  readonly definitionId: string;
  readonly definitionRevisionId: string;
  readonly catalogReleaseId: string;
  readonly configRevisionId: string;
  readonly currentValueId: string;
  readonly editorAuth: AuthContext;
  readonly reviewerAuth: AuthContext;
  readonly guestAuth: AuthContext;
  readonly otherAuth: AuthContext;
  readonly editorUsername: string;
  readonly reviewerUsername: string;
  readonly guestUsername: string;
  readonly otherUsername: string;
  readonly password: string;
};

async function insertUsersAndRoles(root: RootDatabase): Promise<void> {
  const pool = getRootPostgresPool(root);
  if (!pool)
    throw new Error("Issue 905 fixture requires a root PostgreSQL database.");
  const fixture = CANONICAL_PARAMETER_FIXTURE;
  const editorPasswordHash = await hashLocalAccountPassword(fixture.password);
  const reviewerPasswordHash = await hashLocalAccountPassword(fixture.password);
  const guestPasswordHash = await hashLocalAccountPassword(fixture.password);
  const otherPasswordHash = await hashLocalAccountPassword(fixture.password);

  await pool.query(
    `insert into organizations (id, name)
     values ($1, 'Issue 905 Canonical'), ($2, 'Issue 905 Other')`,
    [fixture.organizationId, fixture.otherOrganizationId],
  );
  await pool.query(
    `insert into projects (id, organization_id, name, code, status)
     values
       ($1, $3, 'Issue 905 Canonical Project', 'I905', 'initialized'),
       ($2, $3, 'Issue 905 Other Project', 'I905B', 'initialized')`,
    [fixture.projectId, fixture.otherProjectId, fixture.organizationId],
  );
  await pool.query(
    `insert into projects (id, organization_id, name, code, status)
     values ($1, $2, 'Issue 905 Foreign Project', 'I905X', 'initialized')`,
    [`${fixture.otherOrganizationId}-project`, fixture.otherOrganizationId],
  );
  await pool.query(
    `insert into users (id, organization_id, name, email, title, is_active)
     values
       ($1, $5, 'Issue 905 Editor', 'issue905-editor@example.com', 'Software User', true),
       ($2, $5, 'Issue 905 Reviewer', 'issue905-reviewer@example.com', 'Software Committer', true),
       ($3, $5, 'Issue 905 Guest', 'issue905-guest@example.com', 'Guest', true),
       ($4, $6, 'Issue 905 Other', 'issue905-other@example.com', 'Admin', true)`,
    [
      fixture.editorId,
      fixture.reviewerId,
      fixture.guestId,
      fixture.otherOrganizationUserId,
      fixture.organizationId,
      fixture.otherOrganizationId,
    ],
  );
  await pool.query(
    `insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
     values
       ('urb-905-editor', $1, $5, $7, 'software-user'),
       ('urb-905-reviewer', $2, $5, $7, 'software-committer'),
       ('urb-905-guest', $3, $5, $7, 'guest'),
       ('urb-905-other-admin', $4, $6, null, 'admin')`,
    [
      fixture.editorId,
      fixture.reviewerId,
      fixture.guestId,
      fixture.otherOrganizationUserId,
      fixture.organizationId,
      fixture.otherOrganizationId,
      fixture.projectId,
    ],
  );
  await pool.query(
    `insert into user_password_credentials (user_id, username, password_hash)
     values
       ($1, $5, $6),
       ($2, $7, $8),
       ($3, $9, $10),
       ($4, $11, $12)`,
    [
      fixture.editorId,
      fixture.reviewerId,
      fixture.guestId,
      fixture.otherOrganizationUserId,
      fixture.editorUsername,
      editorPasswordHash,
      fixture.reviewerUsername,
      reviewerPasswordHash,
      fixture.guestUsername,
      guestPasswordHash,
      fixture.otherUsername,
      otherPasswordHash,
    ],
  );
}

async function seedCatalogRegistration(
  root: RootDatabase,
  expectedRelease: CatalogReleasePin,
): Promise<string> {
  const pool = getRootPostgresPool(root);
  if (!pool)
    throw new Error("Issue 905 fixture requires a root PostgreSQL database.");
  const fixture = CANONICAL_PARAMETER_FIXTURE;
  await pool.query(
    `insert into attribution_subjects
       (id, organization_id, subject_kind, display_name, source_key)
     values ($1, $2, 'driver-registration', 'Issue 905 Acme power', 'compatible:acme,power')`,
    [fixture.attributionSubjectId, fixture.organizationId],
  );
  await pool.query(
    `insert into driver_registrations
       (attribution_subject_id, driver_nature, instance_cardinality)
     values ($1, 'physical-device', 'multiple')`,
    [fixture.attributionSubjectId],
  );
  await pool.query(
    `insert into parameter_modules
       (id, organization_id, parent_id, name, path, depth, sort_order,
        description, scope, kind, origin, source_key, attribution_subject_id)
     values
       ($1, $3, null, 'Issue 905', $1, 1, 0, '', '', 'business', 'curated', null, null),
       ($2, $3, $1, 'Acme power', $2, 2, 0, '', '', 'driver-group', 'curated',
        'compatible:acme,power', $4)`,
    [
      fixture.categoryModuleId,
      fixture.driverModuleId,
      fixture.organizationId,
      fixture.attributionSubjectId,
    ],
  );

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set constraints all deferred");
    const command: RegisterSubjectCommand = {
      kind: "register",
      organizationId: fixture.organizationId,
      subjectId: CatalogSubjectId(SUBJECT_ID),
      subjectKind: "driver",
      expectedRelease,
      placement: { mode: "use-default" },
      destinationModuleId: fixture.driverModuleId,
      method: "explicit",
      proof: { reason: "issue-905-canonical-fixture" },
      idempotencyKey: `issue-905-registration-${randomUUID()}`,
      context: { actorKind: "org-admin", principalId: fixture.editorId },
    };
    const written = await writeGuardedRegistration(client, command);
    if (!written.ok) {
      throw new Error(`Issue 905 registration failed: ${written.error.kind}`);
    }
    await client.query("set constraints all immediate");
    await client.query("commit");
    return written.value.registrationId;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function seedCanonicalParameterFixture(
  root: RootDatabase,
  objectStore: ObjectStore,
): Promise<CanonicalParameterFixture> {
  const pool = getRootPostgresPool(root);
  if (!pool)
    throw new Error("Issue 905 fixture requires a root PostgreSQL database.");
  const fixture = CANONICAL_PARAMETER_FIXTURE;
  await insertUsersAndRoles(root);
  const installed = await installPublishedReleaseA(pool);
  const registrationId = await seedCatalogRegistration(root, installed.pinA);
  const loaded = await createCatalogKernel(pool).loadPinnedCatalog(
    installed.pinA,
  );
  if (!loaded.ok)
    throw new Error(
      `Issue 905 Catalog fixture unavailable: ${loaded.error.kind}`,
    );

  const seedAuth = makeTestAuthContext({
    userId: fixture.editorId,
    organizationId: fixture.organizationId,
    name: "Issue 905 Editor",
    title: "Software User",
    organizationName: "Issue 905 Canonical",
    roles: [{ projectId: fixture.projectId, roleId: "software-user" }],
  });
  const configSetId = "dcs-905-canonical";
  const fileId = "file-905-canonical";
  const fileVersionId = "file-version-905-canonical-1";
  const sourceName = "issue-905-canonical.dts";
  const definition = loaded.value.getDefinitionById(
    ParameterDefinitionId(X_DEFINITION_ID),
  );
  if (definition.status !== "found")
    throw new Error("Issue 905 Catalog fixture definition is unavailable.");
  const sourceText = `/dts-v1/;\n/ {\n\tlogical-905-canonical {\n\t\tcompatible = \"acme,power\";\n\t\t${definition.definition.propertyKey} = <5>;\n\t};\n};\n`;
  await pool.query(
    `insert into dts_config_set
       (id, organization_id, project_id, name, description)
     values ($1,$2,$3,'Issue 905 canonical source','Issue 905')`,
    [configSetId, fixture.organizationId, fixture.projectId],
  );
  const stored = await objectStore.put({
    organizationId: fixture.organizationId,
    fileName: sourceName,
    contentType: "text/plain",
    bytes: Buffer.from(sourceText, "utf8"),
  });
  await pool.query(
    `insert into project_parameter_files
       (id, organization_id, project_id, file_name, format, enabled,
        config_set_id, config_set_role, config_set_sort_order)
     values ($1,$2,$3,$4,'dts',true,$5,'base',0)`,
    [
      fileId,
      fixture.organizationId,
      fixture.projectId,
      sourceName,
      configSetId,
    ],
  );
  await pool.query(
    `insert into project_parameter_file_versions
       (id, file_id, version_number, storage_key, checksum, size_bytes,
        parsed_index, origin, created_by_user_id)
     values ($1,$2,1,$3,$4,$5,'{}'::jsonb,'upload',$6)`,
    [
      fileVersionId,
      fileId,
      stored.storageKey,
      stored.checksumSha256,
      stored.fileSizeBytes,
      fixture.editorId,
    ],
  );
  await pool.query(
    `update project_parameter_files
        set current_version_id=$1
      where id=$2`,
    [fileVersionId, fileId],
  );
  const manifest: ConfigRevisionManifest = {
    organizationId: fixture.organizationId,
    projectId: fixture.projectId,
    configSetId,
    entryFile: sourceName,
    includeSearchPaths: ["."],
    overlayOrder: [],
    members: [
      {
        fileId,
        fileVersionId,
        fileName: sourceName,
        role: "base",
        sortOrder: 0,
        content: sourceText,
      },
    ],
  };
  const revision = await ingestConfigRevision(root, manifest, seedAuth, {
    legacyProjection: "skip",
  });
  if (revision.status !== "resolved")
    throw new Error(
      `Issue 905 source ingest did not resolve: ${revision.status}`,
    );
  const snapshot = await loadPublishedCatalog(pool);
  if (!snapshot)
    throw new Error(
      "Issue 905 Catalog fixture published snapshot unavailable.",
    );
  const synced = await withAuditedWrite(
    root,
    seedAuth,
    { requestId: `issue-905-fixture-sync-${randomUUID()}` },
    async (tx) => {
      const count = await syncPublishedCatalogProjectValuesInTransaction(
        asValueClient(tx),
        snapshot,
        {
          organizationId: fixture.organizationId,
          projectId: fixture.projectId,
          configSetId,
          configRevisionId: revision.id,
        },
      );
      return {
        result: count,
        audit: {
          app: "parameters",
          kind: "parameter-topology-governance",
          action: "binding-edited",
          severity: "Medium" as const,
          projectId: fixture.projectId,
          targetType: "dts-config-revision",
          targetId: revision.id,
          metadata: { written: count, configRevisionId: revision.id },
        },
      };
    },
  );
  if (synced !== 1)
    throw new Error(`Issue 905 source sync wrote ${synced} bindings.`);
  const bindingRow = await pool.query<{
    id: string;
    organization_id: string;
    project_id: string;
    logical_node_id: string;
    registration_id: string;
    subject_id: string;
    definition_id: string;
    effective_revision_id: string;
    catalog_release_id: string;
    current_value_id: string;
  }>(
    `select id,organization_id,project_id,logical_node_id,registration_id,
            subject_id,definition_id,effective_revision_id,catalog_release_id,
            current_value_id
       from parameter_catalog.project_parameter_bindings
      where organization_id=$1 and project_id=$2
      limit 1`,
    [fixture.organizationId, fixture.projectId],
  );
  const bindingRecord = bindingRow.rows[0];
  if (!bindingRecord)
    throw new Error("Issue 905 source sync created no canonical binding.");
  const binding: Binding = {
    id: ParameterBindingId(bindingRecord.id),
    organizationId: bindingRecord.organization_id,
    projectId: bindingRecord.project_id,
    logicalNodeId: bindingRecord.logical_node_id,
    registrationId: SubjectRegistrationId(bindingRecord.registration_id),
    subjectId: bindingRecord.subject_id as Binding["subjectId"],
    definitionId: ParameterDefinitionId(bindingRecord.definition_id),
    effectiveRevisionId: DefinitionRevisionId(
      bindingRecord.effective_revision_id,
    ),
    catalogRelease: installed.compiledA.release,
    currentValueId: bindingRecord.current_value_id as Binding["currentValueId"],
  };
  const configRevisionId = revision.id;

  const editorAuth = makeTestAuthContext({
    userId: fixture.editorId,
    organizationId: fixture.organizationId,
    name: "Issue 905 Editor",
    title: "Software User",
    organizationName: "Issue 905 Canonical",
    roles: [{ projectId: fixture.projectId, roleId: "software-user" }],
  });
  const reviewerAuth = makeTestAuthContext({
    userId: fixture.reviewerId,
    organizationId: fixture.organizationId,
    name: "Issue 905 Reviewer",
    title: "Software Committer",
    organizationName: "Issue 905 Canonical",
    roles: [{ projectId: fixture.projectId, roleId: "software-committer" }],
  });
  const guestAuth = makeTestAuthContext({
    userId: fixture.guestId,
    organizationId: fixture.organizationId,
    name: "Issue 905 Guest",
    title: "Guest",
    organizationName: "Issue 905 Canonical",
    roles: [{ projectId: fixture.projectId, roleId: "guest" }],
  });
  const otherAuth = makeTestAuthContext({
    userId: fixture.otherOrganizationUserId,
    organizationId: fixture.otherOrganizationId,
    name: "Issue 905 Other",
    title: "Admin",
    organizationName: "Issue 905 Other",
    roles: [{ projectId: null, roleId: "admin" }],
  });

  return {
    organizationId: fixture.organizationId,
    projectId: fixture.projectId,
    otherProjectId: fixture.otherProjectId,
    otherOrganizationId: fixture.otherOrganizationId,
    subjectId: SUBJECT_ID,
    registrationId,
    bindingId: binding.id,
    binding,
    definitionId: X_DEFINITION_ID,
    definitionRevisionId: X_REVISION_1,
    catalogReleaseId: installed.pinA.id,
    configRevisionId,
    currentValueId: binding.currentValueId,
    editorAuth,
    reviewerAuth,
    guestAuth,
    otherAuth,
    editorUsername: fixture.editorUsername,
    reviewerUsername: fixture.reviewerUsername,
    guestUsername: fixture.guestUsername,
    otherUsername: fixture.otherUsername,
    password: fixture.password,
  };
}
