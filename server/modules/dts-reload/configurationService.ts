import { asAuditTx, writeTrustedAuditEventInTx, type AuditTx } from "../audit/auditedWrite";
import type { AuthContext } from "../auth/types";
import { requireDebugAdmin } from "../debugging/policy";
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
import {
  assertDtsReloadInvocationContext,
  requireDtsReloadUserInvocation,
  type DtsReloadInvocationContext
} from "./policy";

export type ReloadConfigurationServiceContext = DtsReloadInvocationContext;

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
  },
  context: ReloadConfigurationServiceContext
) {
  await writeTrustedAuditEventInTx(tx, {
    invocation: context.invocation,
    ...(context.invocation.initiator === "system" ? { organizationId: auth.organization.id } : {}),
    projectId: null,
    app: "dts-reload",
    kind: input.kind,
    action: input.action,
    severity: "Medium",
    targetType: "dts-reload-configuration",
    targetId: input.targetId,
    metadata: {
      scope: "organisation",
      previous: input.previous,
      next: input.next
    },
    traceId: context.requestId
  });
}

async function assertConfigurationHumanActor(
  db: Database,
  auth: AuthContext,
  context: ReloadConfigurationServiceContext
) {
  await requireDtsReloadUserInvocation(db, auth, {
    context,
    action: "configure",
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
  context: ReloadConfigurationServiceContext
): Promise<OrganisationReloadConfigurationDto> {
  const trustedContext = assertDtsReloadInvocationContext(auth, context);
  requireDebugAdmin(auth);
  await assertConfigurationHumanActor(db, auth, trustedContext);
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
      },
      trustedContext
    );
    return organisationDto(saved);
  });
}
