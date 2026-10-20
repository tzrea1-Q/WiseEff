import type { Database } from "../../shared/database/client";
import { withAuditedWrite } from "../audit/auditedWrite";
import { createSystemInvocation } from "../auth/trustedInvocation";
import { seededChargingRuleSet } from "./chargingSignalRules";

/** Compose with an existing organization transaction, or own one for seed retries. */
export async function provisionChargingSkill(db: Database, organizationId: string, source = "organization-provisioning"): Promise<void> {
  await withAuditedWrite(db, createSystemInvocation({ kind: "service", name: source }), { requestId: source }, async (tx) => {
    const organization = await tx.query("select id from organizations where id = $1 for update", [organizationId]);
    if (!organization.rowCount) throw Object.assign(new Error("Organization does not exist"), { code: "23503" });
    const skillId = `seed-charging:${organizationId}`, revisionId = `seed-charging-revision:${organizationId}`;
    if ((await tx.query("select id from log_domains where id = $1 and organization_id = $2", [skillId, organizationId])).rowCount) {
      return { result: undefined, audit: null };
    }
    let name = "充电", suffix = 1;
    while ((await tx.query("select id from log_domains where organization_id = $1 and name = $2", [organizationId, name])).rowCount) {
      name = `充电 (${++suffix})`;
    }
    await tx.query(`insert into log_domains (id, organization_id, name, description) values ($1, $2, $3, $4)`,
      [skillId, organizationId, name, "Charging analysis with the original charging signal rules."]);
    const spec = JSON.stringify({ schemaVersion: "skill/v1", signalRules: seededChargingRuleSet });
    await tx.query(`insert into log_skill_revisions
      (id, organization_id, skill_id, revision_number, status, spec, content_hash, published_at)
      values ($1, $2, $3, 1, 'published', $4::jsonb, encode(sha256(convert_to(($4::jsonb)::text, 'UTF8')), 'hex'), now())`,
      [revisionId, organizationId, skillId, spec]);
    return { result: undefined, audit: {
      id: `seed-charging-audit:${organizationId}`, organizationId, projectId: null, app: "log-analysis",
      kind: "log-skill-create", action: "log-skill-create", severity: "Medium", targetType: "log-skill", targetId: skillId,
      metadata: { revisionId }
    } };
  });
}
