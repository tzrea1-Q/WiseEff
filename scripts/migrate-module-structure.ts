import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPostgresDatabase, type Database } from "../server/shared/database/client";
import { lockOrganizationRegistrations, updatePlacementModule, type RegistrationWriterClient } from "../server/modules/parameter-governance/registration/repositories";
import { lockOrganizationModuleRecognition } from "../server/modules/parameter-modules/recognitionLock";
import { lockParameterModuleTree } from "../server/modules/parameters/parameterModuleRepository";
import { asAuditTx, writeTrustedAuditEventInTx } from "../server/modules/audit/auditedWrite";
import { createSystemInvocation } from "../server/modules/auth/trustedInvocation";

type Module = { id: string; parent_id: string | null; name: string; path: string; depth: number; kind: string; archived_at: Date | null };
type Placement = { id: string; registration_id: string; module_id: string; canonical_key: string; owner_subject_id: string | null;
  owner_registration_id: string | null; owner_status: string | null; effective_module_id: string | null; display_alias: string | null };
type Entry = { action: string; moduleId: string; registrationId?: string; fromModuleId?: string | null; toModuleId?: string | null; detail?: Record<string, unknown> };

/** Preflight and apply share the same transaction-local decisions; apply is scoped to one organization. */
export async function migrateModuleStructure(db: Database, organizationId: string, apply: boolean) {
  return db.transaction(async (tx) => {
    if (apply) {
      await lockOrganizationRegistrations(tx as unknown as RegistrationWriterClient, organizationId);
      await lockOrganizationModuleRecognition(tx, organizationId);
      await lockParameterModuleTree(tx, organizationId);
    }
    const exists = await tx.query<{ id: string }>("select id from public.organizations where id=$1", [organizationId]);
    if (!exists.rows.length) throw new Error(`Organization not found: ${organizationId}`);
    const modules = (apply
      ? await tx.query<Module>(`select id,parent_id,name,path,depth,kind,archived_at
          from public.parameter_modules where organization_id=$1 order by id for update`, [organizationId])
      : await tx.query<Module>(`select id,parent_id,name,path,depth,kind,archived_at
          from public.parameter_modules where organization_id=$1 order by id`, [organizationId])).rows;
    modules.sort((left, right) => right.depth - left.depth || left.id.localeCompare(right.id));
    const placements = (await tx.query<Placement>(`select placement.id, placement.registration_id, placement.module_id,
      subject.canonical_key, subject.owner_subject_id, owner.id as owner_registration_id, owner.status as owner_status,
      effective.module_id as effective_module_id, registration.display_alias
      from parameter_catalog.subject_placements placement
      join parameter_catalog.organization_subject_registrations registration on registration.id=placement.registration_id
        and registration.organization_id=placement.organization_id
      join parameter_catalog.catalog_subjects subject on subject.id=registration.subject_id
      left join parameter_catalog.organization_subject_registrations owner on owner.organization_id=registration.organization_id
        and owner.subject_id=subject.owner_subject_id
      left join parameter_catalog.registration_effective_module effective on effective.registration_id=registration.id
        and effective.organization_id=registration.organization_id
      where placement.organization_id=$1 and placement.module_id is not null`, [organizationId])).rows;
    const rules = (await tx.query<{ module_id: string }>(`select rule.module_id from public.module_recognition_rules rule
      left join public.registration_recognition_migration_map migrated on migrated.organization_id=rule.organization_id
        and migrated.module_id=rule.module_id
      where rule.organization_id=$1 and migrated.module_id is null`, [organizationId])).rows;
    const byId = new Map(modules.map((item) => [item.id, item]));
    const validAlias = (name: string) => name.length > 0 && name === name.trim() && Array.from(name).length <= 128 && !/\p{Cc}/u.test(name);
    const businessAncestor = (module: Module) => {
      let ancestor = module.parent_id ? byId.get(module.parent_id) : undefined;
      const visited = new Set([module.id]);
      while (ancestor && !visited.has(ancestor.id) && !(ancestor.archived_at === null
        && (ancestor.kind === "business" || (ancestor.kind === "unclassified" && ancestor.parent_id === null)))) {
        visited.add(ancestor.id);
        ancestor = ancestor.parent_id ? byId.get(ancestor.parent_id) : undefined;
      }
      return ancestor && !visited.has(ancestor.id) ? ancestor : undefined;
    };
    const ownerDestinations = new Map(placements.map((placement) => {
      const module = byId.get(placement.module_id);
      const blockedAlias = module && !placement.owner_subject_id && module.name !== placement.canonical_key
        && !placement.display_alias && !validAlias(module.name);
      const destination = module && !blockedAlias && ["driver-group", "node-type"].includes(module.kind)
        ? businessAncestor(module)?.id ?? module.id : placement.module_id;
      return [placement.registration_id, destination] as const;
    }));
    const changes: Entry[] = [];
    const conflicts: Entry[] = [];
    const information: Entry[] = [];
    const runId = randomUUID();
    const record = async (entry: Entry) => {
      changes.push(entry);
      if (apply) await tx.query(`insert into parameter_catalog.module_structure_migration_map
        (run_id,organization_id,module_id,registration_id,action,from_module_id,to_module_id,detail)
        values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [runId, organizationId, entry.moduleId, entry.registrationId ?? null,
        entry.action, entry.fromModuleId ?? null, entry.toModuleId ?? null, JSON.stringify(entry.detail ?? {})]);
    };
    for (const module of modules.filter((item) => !item.archived_at && ["driver-group", "node-type"].includes(item.kind))) {
      const ancestor = businessAncestor(module);
      for (const placement of placements.filter((item) => item.module_id === module.id)) {
        if (placement.owner_subject_id && !placement.owner_registration_id) {
          conflicts.push({ action: "owner-not-registered", moduleId: module.id, registrationId: placement.registration_id });
          continue;
        }
        if (!placement.owner_subject_id && !ancestor) {
          conflicts.push({ action: "no-business-ancestor", moduleId: module.id, registrationId: placement.registration_id });
          continue;
        }
        const destination = placement.owner_subject_id ? null : ancestor!.id;
        if (module.name !== placement.canonical_key) {
          information.push({ action: "renamed-module", moduleId: module.id, registrationId: placement.registration_id,
            detail: { moduleName: module.name, canonicalName: placement.canonical_key, existingAlias: placement.display_alias,
              aliasDisposition: placement.owner_subject_id ? "not-stored-owned-child" : placement.display_alias ? "preserved"
                : validAlias(module.name) ? "set" : "invalid" } });
          if (!placement.owner_subject_id && !placement.display_alias) {
            if (validAlias(module.name)) {
              if (apply) await tx.query(`update parameter_catalog.organization_subject_registrations set display_alias=$2,
                updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=$1`,
                [placement.registration_id, module.name]);
              await record({ action: "set-display-alias", moduleId: module.id, registrationId: placement.registration_id, detail: { alias: module.name } });
            } else {
              conflicts.push({ action: "invalid-display-alias", moduleId: module.id, registrationId: placement.registration_id });
              continue;
            }
          }
        }
        if (apply) await updatePlacementModule(tx as unknown as RegistrationWriterClient, placement.id, destination);
        await record({ action: placement.owner_subject_id ? "structural-placement" : "move-placement", moduleId: module.id,
          registrationId: placement.registration_id, fromModuleId: module.id, toModuleId: destination,
          detail: { previousBusinessModuleId: ancestor?.id ?? null,
            effectiveModuleId: placement.owner_subject_id
              ? placement.owner_status === "active" ? ownerDestinations.get(placement.owner_registration_id!) ?? placement.effective_module_id : null
              : destination } });
        placement.module_id = "";
      }
      for (const child of modules.filter((item) => item.parent_id === module.id && item.kind === "business" && !item.archived_at)) {
        if (!ancestor) {
          conflicts.push({ action: "no-business-ancestor", moduleId: child.id, fromModuleId: module.id });
          continue;
        }
        if (modules.some((item) => item.id !== child.id && item.parent_id === ancestor!.id && item.name === child.name)) {
          conflicts.push({ action: "business-name-conflict", moduleId: child.id, toModuleId: ancestor.id });
          continue;
        }
        const oldPath = child.path;
        const newPath = `${ancestor.path}/${child.id}`;
        const delta = ancestor.depth + 1 - child.depth;
        if (apply) await tx.query(`update public.parameter_modules set parent_id=case when id=$2 then $3 else parent_id end,
          path=case when id=$2 then $4 else $4 || substring(path from length($5)+1) end,
          depth=depth+$6,updated_at=clock_timestamp()
          where organization_id=$1 and (id=$2 or starts_with(path, $5 || '/'))`, [organizationId, child.id, ancestor.id, newPath, oldPath, delta]);
        await record({ action: "reparent-business", moduleId: child.id, fromModuleId: module.id, toModuleId: ancestor.id });
        for (const descendant of modules.filter((item) => item.id === child.id || item.path.startsWith(`${oldPath}/`))) {
          const previousPath = descendant.path;
          descendant.path = newPath + descendant.path.slice(oldPath.length);
          descendant.depth += delta;
          if (descendant.id !== child.id) await record({ action: "repath-descendant", moduleId: descendant.id,
            fromModuleId: descendant.parent_id, toModuleId: descendant.parent_id,
            detail: { previousPath, path: descendant.path } });
        }
        child.parent_id = ancestor.id;
      }
      if (rules.some((rule) => rule.module_id === module.id)) conflicts.push({ action: "unmigrated-recognition-rule", moduleId: module.id });
      if (placements.some((item) => item.module_id === module.id) || modules.some((item) => item.parent_id === module.id)) {
        conflicts.push({ action: "module-not-empty", moduleId: module.id });
      } else {
        if (apply) await tx.query("update public.parameter_modules set archived_at=clock_timestamp(),updated_at=clock_timestamp() where organization_id=$1 and id=$2", [organizationId, module.id]);
        module.archived_at = new Date();
        await record({ action: "archive-module", moduleId: module.id });
      }
    }
    if (apply && changes.length) await writeTrustedAuditEventInTx(asAuditTx(tx), {
      invocation: createSystemInvocation({ kind: "job", name: "migrate-module-structure" }), organizationId,
      projectId: null, app: "parameters", kind: "module-structure-migrated", action: "migrate", severity: "High",
      targetType: "organization", targetId: organizationId, metadata: { runId, changes, conflicts, information }, traceId: runId,
    });
    return { organizationId, mode: apply ? "apply" : "preflight", changes, conflicts, information };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const organizationIndex = args.indexOf("--organization");
  const organizationId = organizationIndex >= 0 ? args[organizationIndex + 1] : undefined;
  const all = args.includes("--all");
  const expectedLength = (organizationId ? 2 : 0) + (all ? 1 : 0) + (apply ? 1 : 0) + (args.includes("--preflight") ? 1 : 0);
  if (!process.env.DATABASE_URL || Boolean(organizationId) === all || (apply && args.includes("--preflight"))
    || expectedLength !== args.length || organizationId?.startsWith("--")) {
    console.error("Usage: DATABASE_URL=... npx tsx scripts/migrate-module-structure.ts (--organization <id>|--all) [--preflight|--apply]");
    process.exitCode = 2;
    return;
  }
  const db = createPostgresDatabase(process.env.DATABASE_URL);
  try {
    const organizations = all ? (await db.query<{ id: string }>("select id from public.organizations order by id")).rows.map((row) => row.id) : [organizationId!];
    const reports = [];
    for (const id of organizations) {
      try {
        const report = await migrateModuleStructure(db, id, apply);
        reports.push(report);
        console.error(`${id}: ${report.changes.length} changes, ${report.conflicts.length} conflicts, ${report.information.length} informational`);
      } catch (error) {
        reports.push({ organizationId: id, error: error instanceof Error ? error.message : "migration-failed" });
        process.exitCode = 1;
      }
    }
    console.log(JSON.stringify(reports, null, 2));
  } finally { await db.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
