import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { createPostgresDatabase, type Queryable } from "../../shared/database/client";
import { makeTestAuthContext } from "../../testing/authContext";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";
import { withTempDatabase } from "../../testing/tempDatabase";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import {
  createAgentInvocation,
  createSystemInvocation,
  createUserInvocation,
  TRUSTED_INVOCATION_CONTEXT_ERROR_CODE
} from "../auth/trustedInvocation";
import type { AuthContext } from "../auth/types";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { createActionTools } from "../agent/tools/actionTools";
import type { AgentToolExecutionContext } from "../agent/toolRegistry";
import { submitParameterChanges } from "./service";

const ORG = "org-parameter-provenance";
const PROJECT = "project-parameter-provenance";
const USER = "user-parameter-provenance";
const CRITICAL = "ppv-provenance-critical";
const HIGH = "ppv-provenance-high";
const PLAIN = "ppv-provenance-plain";
const ATOMIC = "ppv-provenance-atomic";
const SYSTEM_PLAIN = "ppv-provenance-system-plain";
const databaseAvailable = await isTestDatabaseAvailable();

function auth(): AuthContext {
  return makeTestAuthContext({
    userId: USER,
    organizationId: ORG,
    name: "Provenance Operator",
    email: "provenance@example.com",
    organizationName: "Provenance Org",
    roles: [{ roleId: "admin", projectId: null }],
    permissions: ["parameter:view", "parameter:edit", "parameter:edit-critical", "parameter:review", "admin:access"]
  });
}

async function seedParameter(db: Queryable, input: { id: string; definitionId: string; nodePath: string | null }) {
  await db.query(
    `insert into parameter_definitions (
       id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk
     ) values ($1, $2, $1, 'provenance', 'provenance', 'DTS', 'provenance', '', '', 'High')`,
    [input.definitionId, ORG]
  );
  await db.query(
    `insert into project_parameter_values (
       id, organization_id, project_id, parameter_definition_id, current_value, recommended_value,
       value_version, updated_by_user_id, source_file_name, source_node_path
     ) values ($1, $2, $3, $4, '<1>', '<1>', 1, $5, null, $6)`,
    [input.id, ORG, PROJECT, input.definitionId, USER, input.nodePath]
  );
}

async function seed(db: Queryable) {
  await db.query(`insert into organizations (id, name) values ($1, 'Provenance Org')`, [ORG]);
  await db.query(
    `insert into users (id, organization_id, name, email, title, is_active)
     values ($1, $2, 'Provenance Operator', 'provenance@example.com', 'Admin', true)`,
    [USER, ORG]
  );
  await db.query(
    `insert into projects (id, organization_id, name, code, status)
     values ($1, $2, 'Provenance Project', 'PROV', 'initialized')`,
    [PROJECT, ORG]
  );
  await seedParameter(db, {
    id: CRITICAL,
    definitionId: "definition-provenance-critical",
    nodePath: "safety/critical/value"
  });
  await seedParameter(db, {
    id: HIGH,
    definitionId: "definition-provenance-high",
    nodePath: "safety/high/value"
  });
  await seedParameter(db, {
    id: PLAIN,
    definitionId: "definition-provenance-plain",
    nodePath: null
  });
  await seedParameter(db, {
    id: SYSTEM_PLAIN,
    definitionId: "definition-provenance-system-plain",
    nodePath: null
  });
  await db.query(
    `insert into dts_sensitive_node_rules (
       id, organization_id, project_id, match_type, pattern, risk_tier, required_capability, enabled
     ) values
       ('rule-provenance-critical', $1, $2, 'path', 'safety/critical/*', 'critical', 'parameter:edit-critical', true),
       ('rule-provenance-high', $1, $2, 'path', 'safety/high/*', 'high', 'parameter:edit', true)`,
    [ORG, PROJECT]
  );
}

function agentContext(principal: AuthContext): AgentToolExecutionContext {
  const invocation = createAgentInvocation(principal, {
    sessionId: "session-provenance",
    toolCallId: "tool-call-provenance",
    approval: { required: true, approvalId: "approval-provenance" }
  });
  return {
    auth: principal,
    invocation,
    requestId: "request-provenance-agent",
    sessionId: invocation.sessionId,
    toolCallId: invocation.toolCallId,
    projectId: PROJECT,
    approvalId: invocation.approvalId ?? undefined
  };
}

async function stateCounts(db: Queryable) {
  const result = await db.query<{
    drafts: string;
    rounds: string;
    requests: string;
    items: string;
    successAudits: string;
  }>(
    `select
       (select count(*)::text from parameter_drafts where organization_id = $1) as drafts,
       (select count(*)::text from parameter_submission_rounds where organization_id = $1) as rounds,
       (select count(*)::text from parameter_change_requests where organization_id = $1) as requests,
       (select count(*)::text from parameter_submission_items where organization_id = $1) as items,
       (select count(*)::text from audit_events
          where organization_id = $1 and kind in ('parameter-submit', 'parameter-structured-edit-submit')) as "successAudits"`,
    [ORG]
  );
  return result.rows[0];
}

afterEach(() => setParameterIdentityMode(null));

describe.skipIf(!databaseAvailable)("parameter submission provenance (owned PostgreSQL)", () => {
  it("preserves user/Agent/system lineage, risk policy, durable refusal, and no-side-effect failures", async () => {
    await withTempDatabase({ prefix: "paramprov" }, async ({ db, connectionString }) => {
      const root = createPostgresDatabase(connectionString);
      try {
        setParameterIdentityMode("legacy");
        await seed(db);
        const principal = auth();
        const refusalSink = createTrustedRefusalAuditSink(root);
        const agent = agentContext(principal);
        const actionTool = createActionTools({ db: root, refusalAuditSink: refusalSink }).find(
          (tool) => tool.name === "action.submitParameterChange"
        )!;

        const initial = await stateCounts(db);
        expect(initial).toEqual({ drafts: "0", rounds: "0", requests: "0", items: "0", successAudits: "0" });

        await expect(
          root.transaction(async (tx) => {
            const transactionalTool = createActionTools({ db: tx, refusalAuditSink: refusalSink }).find(
              (tool) => tool.name === "action.submitParameterChange"
            )!;
            return transactionalTool.run(agent, {
              projectId: PROJECT,
              parameterId: CRITICAL,
              targetValue: "<9>",
              reason: "approved Agent must remain Agent"
            });
          })
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          status: 403,
          details: { initiator: "agent", requireHuman: true }
        });
        expect(await stateCounts(db)).toEqual(initial);

        const agentRefusal = await db.query<{
          actor_type: string;
          actor_user_id: string | null;
          trace_id: string;
          metadata: Record<string, unknown>;
        }>(
          `select actor_type, actor_user_id, trace_id, metadata
           from audit_events
           where organization_id = $1 and kind = 'parameter-sensitive-node-denied'
           order by created_at desc limit 1`,
          [ORG]
        );
        expect(agentRefusal.rows[0]).toMatchObject({
          actor_type: "agent",
          actor_user_id: USER,
          trace_id: "request-provenance-agent",
          metadata: {
            initiator: "agent",
            sessionId: "session-provenance",
            toolCallId: "tool-call-provenance",
            approvalId: "approval-provenance",
            requireHuman: true
          }
        });

        const systemInvocation = createSystemInvocation({ kind: "job", name: "parameter-provenance-test" });
        await expect(
          submitParameterChanges(
            root,
            principal,
            {
              projectId: PROJECT,
              items: [{ parameterId: CRITICAL, targetValue: "<8>", reason: "system deny" }]
            },
            {
              invocation: systemInvocation,
              requestId: "request-provenance-system",
              refusalSink
            }
          )
        ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403, details: { initiator: "system" } });
        expect(await stateCounts(db)).toEqual(initial);
        const systemRefusal = await db.query<{
          actor_type: string;
          actor_user_id: string | null;
          trace_id: string;
          metadata: Record<string, unknown>;
        }>(
          `select actor_type, actor_user_id, trace_id, metadata
           from audit_events
           where organization_id = $1 and kind = 'parameter-sensitive-node-denied'
             and actor_type = 'system'`,
          [ORG]
        );
        expect(systemRefusal.rows[0]).toMatchObject({
          actor_type: "system",
          actor_user_id: null,
          trace_id: "request-provenance-system",
          metadata: {
            initiator: "system",
            systemKind: "job",
            systemName: "parameter-provenance-test"
          }
        });

        await submitParameterChanges(
          root,
          principal,
          {
            projectId: PROJECT,
            items: [{ parameterId: SYSTEM_PLAIN, targetValue: "<10>", reason: "system non-sensitive allowed" }]
          },
          {
            invocation: systemInvocation,
            requestId: "request-provenance-system-success",
            refusalSink
          }
        );
        const systemSuccess = await db.query<{
          organization_id: string;
          actor_type: string;
          actor_user_id: string | null;
        }>(
          `select organization_id, actor_type, actor_user_id from audit_events
           where organization_id = $1 and kind = 'parameter-submit' and trace_id = $2`,
          [ORG, "request-provenance-system-success"]
        );
        expect(systemSuccess.rows[0]).toEqual({
          organization_id: ORG,
          actor_type: "system",
          actor_user_id: null
        });

        const highResult = await actionTool.run(agent, {
          projectId: PROJECT,
          parameterId: HIGH,
          targetValue: "<7>",
          reason: "high remains allowed"
        });
        expect(highResult.data).toMatchObject({ parameterId: HIGH, targetValue: "<7>" });
        const plainResult = await actionTool.run(agent, {
          projectId: PROJECT,
          parameterId: PLAIN,
          targetValue: "<6>",
          reason: "non-sensitive remains allowed"
        });
        expect(plainResult.data).toMatchObject({ parameterId: PLAIN, targetValue: "<6>" });

        const userRound = await submitParameterChanges(
          root,
          principal,
          {
            projectId: PROJECT,
            items: [{ parameterId: CRITICAL, targetValue: "<5>", reason: "direct user allowed" }]
          },
          {
            invocation: createUserInvocation(principal),
            requestId: "request-provenance-user",
            refusalSink
          }
        );
        expect(userRound.items).toHaveLength(1);

        const successAudits = await db.query<{
          actor_type: string;
          trace_id: string;
          metadata: Record<string, unknown>;
        }>(
          `select actor_type, trace_id, metadata from audit_events
           where organization_id = $1 and kind = 'parameter-submit' order by created_at`,
          [ORG]
        );
        expect(successAudits.rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              actor_type: "agent",
              metadata: expect.objectContaining({
                initiator: "agent",
                sessionId: "session-provenance",
                toolCallId: "tool-call-provenance",
                approvalId: "approval-provenance"
              })
            }),
            expect.objectContaining({
              actor_type: "user",
              trace_id: "request-provenance-user",
              metadata: expect.objectContaining({ initiator: "user" })
            })
          ])
        );

        const beforeInvalid = await stateCounts(db);
        for (const context of [
          undefined,
          { requestId: "request-missing", invocation: { initiator: "user" }, refusalSink }
        ]) {
          await expect(
            Reflect.apply(submitParameterChanges, undefined, [
              root,
              principal,
              {
                projectId: PROJECT,
                items: [{ parameterId: `missing-${randomUUID()}`, targetValue: "<4>", reason: "invalid context" }]
              },
              context
            ])
          ).rejects.toMatchObject({ code: TRUSTED_INVOCATION_CONTEXT_ERROR_CODE });
        }
        expect(await stateCounts(db)).toEqual(beforeInvalid);

        const otherPrincipal = makeTestAuthContext({
          userId: "user-substitution",
          organizationId: "org-substitution",
          roles: [{ roleId: "admin", projectId: null }],
          permissions: ["parameter:edit"]
        });
        await expect(
          submitParameterChanges(
            root,
            principal,
            {
              projectId: PROJECT,
              items: [{ parameterId: `substitution-${randomUUID()}`, targetValue: "<3>", reason: "substitution" }]
            },
            {
              invocation: createUserInvocation(otherPrincipal),
              requestId: "request-substitution",
              refusalSink
            }
          )
        ).rejects.toMatchObject({ code: TRUSTED_INVOCATION_CONTEXT_ERROR_CODE });
        expect(await stateCounts(db)).toEqual(beforeInvalid);

        await seedParameter(db, {
          id: ATOMIC,
          definitionId: "definition-provenance-atomic",
          nodePath: null
        });
        const beforeAtomicRollback = await stateCounts(db);
        await expect(
          root.transaction(async (tx) => {
            await submitParameterChanges(
              tx,
              principal,
              {
                projectId: PROJECT,
                items: [{ parameterId: ATOMIC, targetValue: "<2>", reason: "atomic rollback" }]
              },
              {
                invocation: createUserInvocation(principal),
                requestId: "request-atomic-rollback",
                refusalSink
              }
            );
            throw new Error("force outer rollback");
          })
        ).rejects.toThrow("force outer rollback");
        expect(await stateCounts(db)).toEqual(beforeAtomicRollback);
      } finally {
        await root.close();
      }
    });
  }, 90_000);
});
