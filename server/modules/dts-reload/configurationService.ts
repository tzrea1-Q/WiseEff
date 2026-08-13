import { randomUUID } from "node:crypto";

import { asAuditTx, writeAuditEventInTx, type AuditTx } from "../audit/auditedWrite";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import { requireDebugAdmin } from "../debugging/policy";
import type { SensitiveWriteActorType } from "../parameter-kernel/sensitiveNode";
import type { Database, Queryable } from "../../shared/database/client";
import {
  SEEDED_RELOAD_CONFIGURATION,
  type OrganisationReloadConfigurationDto,
  type ReloadConfigurationAdminView,
  type ReloadConfigurationContract
} from "./configurationTypes";
import { parseReloadConfigurationContract } from "./configurationValidation";
import {
  getOrganisationDefaultRow,
  rowToContract,
  upsertOrganisationDefault,
  type OrganisationDefaultRow
} from "./configurationRepository";
import { assertDtsReloadHumanActor } from "./policy";

export type ReloadConfigurationServiceContext = AuditCorrelationContext & {
  /**
   * Caller-supplied actor label (parameters `SensitiveWriteActorType` pattern).
   * Mutating entry points must pass this through rather than hard-coding `"user"`.
   * HTTP admin routes omit it and default to `"user"` at the gate/audit boundary.
   */
  actorType?: SensitiveWriteActorType;
};

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.toISOString();
}

function organisationDto(row: OrganisationDefaultRow | null): OrganisationReloadConfigurationDto {
  if (!row) {
    return {
      scope: "organisation",
      source: "seeded-default",
      ...SEEDED_RELOAD_CONFIGURATION,
      updatedAt: null,
      updatedByUserId: null
    };
  }
  return {
    scope: "organisation",
    source: "organisation",
    ...rowToContract(row),
    updatedAt: toIso(row.updated_at),
    updatedByUserId: row.updated_by_user_id
  };
}

async function writeConfigurationAudit(
  tx: AuditTx,
  auth: AuthContext,
  input: {
    action: "update";
    kind: "dts-reload-configuration-update";
    targetId: string;
    previous: ReloadConfigurationContract | null;
    next: ReloadConfigurationContract | null;
    actorType: SensitiveWriteActorType;
  },
  context: ReloadConfigurationServiceContext = {}
) {
  // requestId fallback survives only until reload-config contexts become mandatory (ADR-0027).
  await writeAuditEventInTx(tx, auth, { requestId: context.requestId ?? randomUUID() }, {
    app: "dts-reload",
    kind: input.kind,
    action: input.action,
    severity: "Medium",
    projectId: null,
    targetType: "dts-reload-configuration",
    targetId: input.targetId,
    metadata: {
      scope: "organisation",
      previous: input.previous,
      next: input.next
    },
    actorType: input.actorType
  });
}

async function assertConfigurationHumanActor(
  db: Queryable,
  auth: AuthContext,
  context: ReloadConfigurationServiceContext
) {
  await assertDtsReloadHumanActor(db, auth, {
    actorType: context.actorType,
    action: "configure",
    requestId: context.requestId
  });
}

export async function getReloadConfigurationAdminView(
  db: Queryable,
  auth: AuthContext
): Promise<ReloadConfigurationAdminView> {
  requireDebugAdmin(auth);
  const orgRow = await getOrganisationDefaultRow(db, auth.organization.id);
  return {
    organisation: organisationDto(orgRow)
  };
}

export async function updateOrganisationReloadConfiguration(
  db: Database,
  auth: AuthContext,
  body: unknown,
  context: ReloadConfigurationServiceContext = {}
): Promise<OrganisationReloadConfigurationDto> {
  requireDebugAdmin(auth);
  await assertConfigurationHumanActor(db, auth, context);
  const actorType = context.actorType ?? "user";
  const contract = parseReloadConfigurationContract(body);

  return db.transaction(async (tx) => {
    const previousRow = await getOrganisationDefaultRow(tx, auth.organization.id);
    const previous = previousRow ? rowToContract(previousRow) : { ...SEEDED_RELOAD_CONFIGURATION };
    const saved = await upsertOrganisationDefault(tx, {
      organizationId: auth.organization.id,
      contract,
      updatedByUserId: auth.user.id
    });
    await writeConfigurationAudit(
      asAuditTx(tx),
      auth,
      {
        action: "update",
        kind: "dts-reload-configuration-update",
        targetId: auth.organization.id,
        previous,
        next: rowToContract(saved),
        actorType
      },
      context
    );
    return organisationDto(saved);
  });
}
