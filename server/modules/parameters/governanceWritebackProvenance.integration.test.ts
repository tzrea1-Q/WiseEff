import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { asAuditTx } from "../audit/auditedWrite";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createPostgresDatabase, type Queryable } from "../../shared/database/client";
import { makeTestAuthContext } from "../../testing/authContext";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";
import { withTempDatabase } from "../../testing/tempDatabase";
import { createNodeEnablementDraft } from "../parameter-topology/editService";
import { preparePropertyKeySourceCutover } from "../parameter-specs/propertyKeyCutover";
import {
  writebackMergedEnablementValue,
  writebackMergedParameterValue
} from "../parameter-files/writebackService";
import { createCandidate } from "../parameter-files/candidateService";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import type { TrustedSensitiveNodeWriteContext } from "../parameter-kernel/sensitiveNode";
import { createAgentInvocation, createSystemInvocation, createUserInvocation } from "../auth/trustedInvocation";

const databaseAvailable = await isTestDatabaseAvailable();
const ORG = "org-governance-provenance";
const PROJECT = "project-governance-provenance";
const USER = "user-governance-provenance";

const auth = makeTestAuthContext({
  userId: USER,
  organizationId: ORG,
  name: "Governance Provenance Operator",
  email: "governance-provenance@example.com",
  organizationName: "Governance Provenance Org",
  roles: [{ roleId: "admin", projectId: null }],
  permissions: ["parameter:view", "parameter:edit", "parameter:edit-critical", "parameter:review", "admin:access"]
});

async function seedScope(db: Queryable) {
  await db.query(`insert into organizations (id, name) values ($1, 'Governance Provenance Org')`, [ORG]);
  await db.query(
    `insert into users (id, organization_id, name, email, title, is_active)
     values ($1, $2, 'Governance Provenance Operator', 'governance-provenance@example.com', 'Admin', true)`,
    [USER, ORG]
  );
  await db.query(
    `insert into projects (id, organization_id, name, code, status)
     values ($1, $2, 'Governance Provenance Project', 'GPROV', 'initialized')`,
    [PROJECT, ORG]
  );
}

async function stateCounts(db: Queryable) {
  const result = await db.query<Record<string, string>>(
    `select
       (select count(*)::text from parameter_drafts where organization_id = $1) as drafts,
       (select count(*)::text from dts_config_revisions where organization_id = $1) as candidates,
       (select count(*)::text from parameter_spec_property_key_cutover_items) as cutover_items,
       (select count(*)::text from project_parameter_file_versions where created_by_user_id = $2) as file_versions,
       (select count(*)::text from project_parameter_binding_revisions) as binding_revisions,
       (select count(*)::text from audit_events where organization_id = $1) as audits`,
    [ORG, USER]
  );
  return result.rows[0];
}

afterEach(() => setParameterIdentityMode(null));

describe.skipIf(!databaseAvailable)("#614 missing and malformed provenance matrix (owned PostgreSQL)", () => {
  it("fails all five operation categories before database or object-store mutation", async () => {
    await withTempDatabase({ prefix: "govwriteprov" }, async ({ db, connectionString }) => {
      const root = createPostgresDatabase(connectionString);
      const objectStore = {
        get: vi.fn(async () => Buffer.from("", "utf8")),
        put: vi.fn()
      };
      let primaryError: unknown;
      try {
        const refusalSink = createTrustedRefusalAuditSink(root);
        await seedScope(db);
        const before = await stateCounts(db);
        const malformed = {
          invocation: { initiator: "user" },
          requestId: "malformed-context",
          refusalSink
        } as unknown as TrustedSensitiveNodeWriteContext;
        const crossUser = createUserInvocation(makeTestAuthContext({
          userId: "other-governance-user",
          organizationId: ORG,
          name: "Other Governance User",
          email: "other-governance@example.com",
          organizationName: "Governance Provenance Org",
          permissions: auth.permissions
        }));
        const crossOrganization = createUserInvocation(makeTestAuthContext({
          userId: "other-organization-user",
          organizationId: "org-other-governance-provenance",
          name: "Other Organization User",
          email: "other-org-governance@example.com",
          organizationName: "Other Governance Org",
          permissions: auth.permissions
        }));
        const contexts = [
          { name: "missing", value: undefined as unknown as TrustedSensitiveNodeWriteContext },
          { name: "malformed", value: malformed },
          {
            name: "empty-request-id",
            value: { invocation: createUserInvocation(auth), requestId: "   ", refusalSink }
          },
          {
            name: "forged-refusal-sink",
            value: {
              invocation: createUserInvocation(auth),
              requestId: "forged-refusal-sink",
              refusalSink: Object.freeze({ write: vi.fn() })
            } as unknown as TrustedSensitiveNodeWriteContext
          },
          {
            name: "cross-user",
            value: { invocation: crossUser, requestId: "cross-user", refusalSink }
          },
          {
            name: "cross-organization",
            value: { invocation: crossOrganization, requestId: "cross-organization", refusalSink }
          }
        ];
        const operations = [
          {
            name: "topology-enablement-draft",
            run: (context: TrustedSensitiveNodeWriteContext) =>
              createNodeEnablementDraft(root, auth, {
                projectId: PROJECT,
                logicalNodeId: "logical-node-missing",
                baseRevisionId: "revision-missing",
                target: "force-disabled",
                reason: "context invariant"
              }, {}, context)
          },
          {
            name: "property-key-cutover-prepare",
            run: (context: TrustedSensitiveNodeWriteContext) =>
              preparePropertyKeySourceCutover(root, auth, { specId: "spec-missing" }, context, {
                objectStore: objectStore as never
              })
          },
          {
            name: "semantic-writeback",
            run: (context: TrustedSensitiveNodeWriteContext) => {
              setParameterIdentityMode("semantic");
              return writebackMergedParameterValue(asAuditTx(root), objectStore as never, auth, {
                projectId: PROJECT,
                parameterDefinitionId: "spec-missing",
                projectParameterBindingId: "binding-missing",
                mergedValue: "<2>"
              }, context);
            }
          },
          {
            name: "retained-legacy-writeback",
            run: (context: TrustedSensitiveNodeWriteContext) => {
              setParameterIdentityMode("legacy");
              return writebackMergedParameterValue(asAuditTx(root), objectStore as never, auth, {
                projectId: PROJECT,
                parameterDefinitionId: "definition-missing",
                mergedValue: "2"
              }, context);
            }
          },
          {
            name: "enablement-writeback",
            run: (context: TrustedSensitiveNodeWriteContext) =>
              writebackMergedEnablementValue(asAuditTx(root), objectStore as never, auth, {
                projectId: PROJECT,
                logicalNodeId: "logical-node-missing",
                mergedValue: '"disabled"'
              }, context)
          }
        ];

        for (const operation of operations) {
          for (const context of contexts) {
            await expect(operation.run(context.value), `${operation.name}/${context.name}`).rejects.toMatchObject({
              code: "INVALID_TRUSTED_INVOCATION_CONTEXT"
            });
            expect(await stateCounts(db)).toEqual(before);
            expect(objectStore.put).not.toHaveBeenCalled();
          }
        }
        for (const [name, invocation] of [
          ["cross-user", crossUser],
          ["cross-organization", crossOrganization]
        ] as const) {
          await expect(
            createCandidate(root, objectStore as never, auth, {
              projectId: PROJECT,
              fileName: `${name}.dts`,
              bytes: Buffer.from("/dts-v1/;", "utf8")
            }, { invocation, requestId: `candidate-${name}` })
          ).rejects.toMatchObject({ code: "INVALID_TRUSTED_INVOCATION_CONTEXT" });
          expect(await stateCounts(db)).toEqual(before);
          expect(objectStore.put).not.toHaveBeenCalled();
        }
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
    });
  });

  it("preserves retained legacy User/Agent/System provenance across critical, high, and no-match writes", async () => {
    await withTempDatabase({ prefix: "legacywriteprov" }, async ({ db, connectionString }) => {
      const root = createPostgresDatabase(connectionString);
      const objects = new Map<string, Buffer>([["legacy/current.json", Buffer.from('{"battery":{"temp":{"max":80}}}', "utf8")]]);
      let nextObject = 0;
      const put = vi.fn(async (input: { bytes: Buffer; fileName: string; contentType: string }) => {
        nextObject += 1;
        const storageKey = `legacy/writeback-${nextObject}.json`;
        objects.set(storageKey, Buffer.from(input.bytes));
        return {
          storageKey,
          fileName: input.fileName,
          contentType: input.contentType,
          fileSizeBytes: input.bytes.length,
          checksumSha256: createHash("sha256").update(input.bytes).digest("hex")
        };
      });
      const objectStore = {
        get: vi.fn(async (key: string) => {
          const bytes = objects.get(key);
          if (!bytes) throw new Error(`missing object ${key}`);
          return Buffer.from(bytes);
        }),
        put
      };
      let primaryError: unknown;
      try {
        const refusalSink = createTrustedRefusalAuditSink(root);
        setParameterIdentityMode("legacy");
        await seedScope(db);
        await db.query(
          `insert into parameter_definitions (
             id, organization_id, name, description, explanation, config_format,
             module, default_range, unit, risk
           ) values (
             'definition-legacy-provenance', $1, 'legacy provenance', 'legacy', 'legacy', 'JSON',
             'legacy', '', '', 'High'
           )`,
          [ORG]
        );
        await db.query(
          `insert into project_parameter_values (
             id, organization_id, project_id, parameter_definition_id,
             current_value, recommended_value, value_version, updated_by_user_id,
             source_file_name, source_node_path
           ) values (
             'value-legacy-provenance', $1, $2, 'definition-legacy-provenance',
             '80', '80', 1, $3, 'config.json', 'battery/temp/max'
           )`,
          [ORG, PROJECT, USER]
        );
        await db.query(
          `insert into project_parameter_files (
             id, organization_id, project_id, file_name, format, enabled
           ) values ('file-legacy-provenance', $1, $2, 'config.json', 'json', true)`,
          [ORG, PROJECT]
        );
        await db.query(
          `insert into project_parameter_file_versions (
             id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
           ) values (
             'file-version-legacy-provenance-1', 'file-legacy-provenance', 1, 'legacy/current.json',
             'legacy-checksum', 30, '{}'::jsonb, 'upload', $1
           )`,
          [USER]
        );
        await db.query(
          `update project_parameter_files
           set current_version_id = 'file-version-legacy-provenance-1'
           where id = 'file-legacy-provenance'`
        );
        await db.query(
          `insert into dts_sensitive_node_rules (
             id, organization_id, project_id, match_type, pattern, risk_tier, required_capability, enabled
           ) values (
             'rule-legacy-provenance', $1, $2, 'path', 'battery/temp/max',
             'critical', 'parameter:edit-critical', true
           )`,
          [ORG, PROJECT]
        );

        const state = async () => (
          await db.query<Record<string, string>>(
            `select
               (select current_version_id from project_parameter_files where id = 'file-legacy-provenance') as current_version,
               (select count(*)::text from project_parameter_file_versions where file_id = 'file-legacy-provenance') as versions,
               (select count(*)::text from audit_events where kind = 'parameter-writeback-to-file') as success_audits`
          )
        ).rows[0];
        const before = await state();
        const agent = createAgentInvocation(auth, {
          sessionId: "session-legacy-writeback",
          toolCallId: "tool-legacy-writeback",
          approval: { required: true, approvalId: "approval-legacy-writeback" }
        });
        const system = createSystemInvocation({ kind: "service", name: "legacy-writeback-service" });
        for (const [requestId, invocation] of [
          ["legacy-critical-agent", agent],
          ["legacy-critical-system", system]
        ] as const) {
          await expect(
            root.transaction((tx) =>
              writebackMergedParameterValue(asAuditTx(tx), objectStore as never, auth, {
                projectId: PROJECT,
                parameterDefinitionId: "definition-legacy-provenance",
                mergedValue: "85"
              }, { invocation, requestId, refusalSink })
            )
          ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
          expect(await state()).toEqual(before);
          expect(put).not.toHaveBeenCalled();
        }

        const incapableAuth = { ...auth, permissions: auth.permissions.filter((item) => item !== "parameter:edit-critical") };
        const refusalCountBeforeIncapable = (
          await db.query<{ count: string }>(
            `select count(*)::text as count from audit_events where kind = 'parameter-sensitive-node-denied'`
          )
        ).rows[0]?.count;
        const incapableAgent = createAgentInvocation(incapableAuth, {
          sessionId: "session-legacy-incapable",
          toolCallId: "tool-legacy-incapable",
          approval: { required: true, approvalId: "approval-legacy-incapable" }
        });
        for (const [requestId, invocation] of [
          ["legacy-incapable-agent", incapableAgent],
          ["legacy-incapable-system", system]
        ] as const) {
          await expect(
            writebackMergedParameterValue(asAuditTx(root), objectStore as never, incapableAuth, {
              projectId: PROJECT,
              parameterDefinitionId: "definition-legacy-provenance",
              mergedValue: "85"
            }, { invocation, requestId, refusalSink })
          ).rejects.toMatchObject({
            code: "FORBIDDEN",
            message: "Missing permission: parameter:edit-critical."
          });
          expect(await state()).toEqual(before);
          expect(put).not.toHaveBeenCalled();
        }
        expect(
          (
            await db.query<{ count: string }>(
              `select count(*)::text as count from audit_events where kind = 'parameter-sensitive-node-denied'`
            )
          ).rows[0]?.count
        ).toBe(refusalCountBeforeIncapable);

        await root.transaction((tx) =>
          writebackMergedParameterValue(asAuditTx(tx), objectStore as never, auth, {
            projectId: PROJECT,
            parameterDefinitionId: "definition-legacy-provenance",
            mergedValue: "85"
          }, {
            invocation: createUserInvocation(auth),
            requestId: "legacy-critical-user",
            refusalSink
          })
        );
        expect((await state()).versions).toBe("2");

        await db.query(`update dts_sensitive_node_rules set risk_tier = 'high' where id = 'rule-legacy-provenance'`);
        await root.transaction((tx) =>
          writebackMergedParameterValue(asAuditTx(tx), objectStore as never, auth, {
            projectId: PROJECT,
            parameterDefinitionId: "definition-legacy-provenance",
            mergedValue: "86"
          }, { invocation: agent, requestId: "legacy-high-agent", refusalSink })
        );
        await root.transaction((tx) =>
          writebackMergedParameterValue(asAuditTx(tx), objectStore as never, auth, {
            projectId: PROJECT,
            parameterDefinitionId: "definition-legacy-provenance",
            mergedValue: "87"
          }, { invocation: system, requestId: "legacy-high-system", refusalSink })
        );
        await db.query(`delete from dts_sensitive_node_rules where id = 'rule-legacy-provenance'`);
        await root.transaction((tx) =>
          writebackMergedParameterValue(asAuditTx(tx), objectStore as never, auth, {
            projectId: PROJECT,
            parameterDefinitionId: "definition-legacy-provenance",
            mergedValue: "88"
          }, { invocation: system, requestId: "legacy-no-match-system", refusalSink })
        );

        await db.query(
          `create or replace function fail_legacy_writeback_audit() returns trigger as $$
           begin
             if new.kind = 'parameter-writeback-to-file' then
               raise exception 'injected legacy writeback audit failure';
             end if;
             return new;
           end;
           $$ language plpgsql`
        );
        await db.query(
          `create trigger fail_legacy_writeback_audit_trigger
           before insert on audit_events
           for each row execute function fail_legacy_writeback_audit()`
        );
        const beforeAuditFailure = await state();
        const putCountBeforeAuditFailure = put.mock.calls.length;
        await expect(
          root.transaction((tx) =>
            writebackMergedParameterValue(asAuditTx(tx), objectStore as never, auth, {
              projectId: PROJECT,
              parameterDefinitionId: "definition-legacy-provenance",
              mergedValue: "89"
            }, {
              invocation: createUserInvocation(auth),
              requestId: "legacy-audit-failure",
              refusalSink
            })
          )
        ).rejects.toThrow("injected legacy writeback audit failure");
        expect(await state()).toEqual(beforeAuditFailure);
        expect(put).toHaveBeenCalledTimes(putCountBeforeAuditFailure + 1);
        const orphanStorageKey = `legacy/writeback-${nextObject}.json`;
        expect(objects.has(orphanStorageKey)).toBe(true);
        const reachableOrphan = await db.query<{ count: string }>(
          `select count(*)::text as count from project_parameter_file_versions where storage_key = $1`,
          [orphanStorageKey]
        );
        expect(reachableOrphan.rows[0]?.count).toBe("0");

        const audits = await db.query<{
          actor_type: string;
          actor_user_id: string | null;
          trace_id: string;
          metadata: Record<string, unknown>;
        }>(
          `select actor_type, actor_user_id, trace_id, metadata
           from audit_events
           where kind = 'parameter-writeback-to-file'
           order by created_at`
        );
        expect(audits.rows).toEqual([
          expect.objectContaining({ actor_type: "user", actor_user_id: USER, trace_id: "legacy-critical-user" }),
          expect.objectContaining({
            actor_type: "agent",
            actor_user_id: USER,
            trace_id: "legacy-high-agent",
            metadata: expect.objectContaining({
              initiator: "agent",
              sessionId: "session-legacy-writeback",
              toolCallId: "tool-legacy-writeback",
              approvalId: "approval-legacy-writeback"
            })
          }),
          expect.objectContaining({
            actor_type: "system",
            actor_user_id: null,
            trace_id: "legacy-high-system",
            metadata: expect.objectContaining({ systemKind: "service", systemName: "legacy-writeback-service" })
          }),
          expect.objectContaining({
            actor_type: "system",
            actor_user_id: null,
            trace_id: "legacy-no-match-system"
          })
        ]);
        const legacyDomainAttribution = await db.query<{
          created_by_user_id: string | null;
        }>(
          `select created_by_user_id from project_parameter_file_versions
           where file_id = 'file-legacy-provenance' and origin = 'writeback'
           order by version_number`
        );
        expect(legacyDomainAttribution.rows).toEqual([
          { created_by_user_id: USER },
          { created_by_user_id: USER },
          { created_by_user_id: null },
          { created_by_user_id: null }
        ]);
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
    });
  });
});
