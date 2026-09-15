/**
 * Issue #849 B6: seed-time subject registration.
 *
 * The canonical value sync will not bind a subject the organisation has not
 * registered, so a seed that materializes source files but registers nothing writes
 * zero bindings. The governance contract already pre-authorises the mechanism:
 * `validateRegistrationCommand` accepts `method: "automatic"` for
 * `actorKind: "trusted-system"` with `placement.mode: "use-default"`, gives the
 * placement `origin: "auto"`, and refuses auto-restoring a retired registration.
 *
 * What the contract does *not* provide is the module: a registration still needs a
 * `destinationModuleId`, the placement guard requires the module kind to match the
 * subject kind (`driver-group` for drivers, `node-type` for node types, `business`
 * for configuration schemas), and the module tree is curated, user-visible structure.
 * So this module resolves an existing suitable module and reports the subjects it
 * could not place instead of inventing modules. Whether seed initialization may
 * provision them is the open part of B6, and it is now a single localised change.
 */
import type { Database, Queryable } from "../../../shared/database/client";
import type { AuthContext } from "../../auth/types";
import { CatalogSubjectId, type CatalogReleasePin } from "../../parameter-catalog-contract/index";
import { executeRegistration } from "../../parameter-governance/registration/service";
import type { CatalogSnapshot } from "../../catalog-kernel/interface";
import { resolveObservedSubject } from "../catalogProjectValueSync";
import { getRootPostgresPool } from "../../../shared/database/client";

/** The module kind `assert_subject_placement_kind` requires for each subject kind. */
const REQUIRED_MODULE_KIND: Record<string, string> = {
  driver: "driver-group",
  "node-type": "node-type",
  "configuration-schema": "business"
};

export type ObservedSubject = { readonly subjectId: string; readonly subjectKind: string };

export type SeedRegistrationOutcome = {
  readonly registered: readonly string[];
  /** Subjects with no available module. Reported, never silently dropped. */
  readonly unregistered: readonly string[];
  /** True when a registration already existed and was left untouched. */
  readonly alreadyRegistered: readonly string[];
};

/**
 * Distinct subjects referenced by the observed source properties. Only subjects that
 * actually own a published definition are returned, so an unrelated `compatible`
 * cannot drag a registration in.
 */
export const observedSubjectsWithDefinitions = (
  snapshot: CatalogSnapshot,
  rows: readonly {
    readonly compatible: string | null;
    readonly name: string | null;
    readonly propertyKey: string;
  }[]
): ObservedSubject[] => {
  const byId = new Map<string, ObservedSubject>();
  for (const row of rows) {
    const compatibles = (row.compatible ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const subject = resolveObservedSubject(snapshot, { compatibles, nodeName: row.name });
    if (!subject) continue;
    const definition = snapshot.getDefinition({
      subjectId: CatalogSubjectId(subject.subjectId),
      propertyKey: row.propertyKey as never
    });
    if (definition.status !== "found") continue;
    byId.set(subject.subjectId, subject);
  }
  return [...byId.values()].sort((left, right) => left.subjectId.localeCompare(right.subjectId));
};

const activeRegistrationExists = async (
  db: Queryable,
  organizationId: string,
  subjectId: string
): Promise<boolean> => {
  const result = await db.query<{ id: string }>(
    `select id from parameter_catalog.organization_subject_registrations
      where organization_id = $1 and subject_id = $2 and status = 'active'
      limit 1`,
    [organizationId, subjectId]
  );
  return Boolean(result.rows[0]);
};

/**
 * An existing module of the required kind that does not already host a placement, so
 * one module is never asked to hold two subjects (`unique (organization_id, module_id)`
 * on `subject_placements`).
 */
const availableModuleId = async (
  db: Queryable,
  organizationId: string,
  moduleKind: string
): Promise<string | null> => {
  const result = await db.query<{ id: string }>(
    `select pm.id
       from public.parameter_modules pm
      where pm.organization_id = $1
        and pm.kind = $2
        and not exists (
          select 1 from parameter_catalog.subject_placements sp
           where sp.organization_id = pm.organization_id and sp.module_id = pm.id
        )
      order by case when pm.origin = 'curated' then 0 else 1 end, pm.id
      limit 1`,
    [organizationId, moduleKind]
  );
  return result.rows[0]?.id ?? null;
};

export async function ensureSeedSubjectRegistrations(
  root: Database,
  auth: AuthContext,
  input: {
    readonly organizationId: string;
    readonly currentRelease: CatalogReleasePin;
    readonly subjects: readonly ObservedSubject[];
    /** Audit trail for the registration proof. */
    readonly seedDigest: string;
    readonly projectId: string;
  }
): Promise<SeedRegistrationOutcome> {
  const pool = getRootPostgresPool(root);
  if (!pool) {
    throw new Error("Seed subject registration requires the root database.");
  }
  const registered: string[] = [];
  const unregistered: string[] = [];
  const alreadyRegistered: string[] = [];

  for (const subject of input.subjects) {
    if (await activeRegistrationExists(root, input.organizationId, subject.subjectId)) {
      alreadyRegistered.push(subject.subjectId);
      continue;
    }
    const moduleKind = REQUIRED_MODULE_KIND[subject.subjectKind];
    if (!moduleKind) {
      unregistered.push(subject.subjectId);
      continue;
    }
    const destinationModuleId = await availableModuleId(root, input.organizationId, moduleKind);
    if (!destinationModuleId) {
      unregistered.push(subject.subjectId);
      continue;
    }
    const result = await executeRegistration(pool, {
      kind: "register",
      organizationId: input.organizationId,
      subjectId: CatalogSubjectId(subject.subjectId),
      subjectKind: subject.subjectKind as never,
      expectedRelease: input.currentRelease,
      placement: { mode: "use-default" },
      destinationModuleId,
      method: "automatic",
      proof: {
        source: "seed-initialization",
        seedDigest: input.seedDigest,
        projectId: input.projectId,
        subjectKind: subject.subjectKind
      },
      idempotencyKey: `seed-register:${input.seedDigest}:${input.projectId}:${subject.subjectId}`,
      // `RegistrationCommand` carries its own invocation shape (actorKind +
      // principalId), not the auth module's branded context. `trusted-system` is what
      // `validateRegistrationCommand` requires for `method: "automatic"`.
      context: { actorKind: "trusted-system", principalId: "seed-initialization" }
    });
    if (result.ok) {
      registered.push(subject.subjectId);
    } else {
      throw new Error(
        `Seed subject registration failed for ${subject.subjectId}: ${result.error.kind}`
      );
    }
  }

  return { registered, unregistered, alreadyRegistered };
}
