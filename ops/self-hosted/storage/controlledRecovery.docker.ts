import { createHash } from "node:crypto";
import { hasUnsupportedNonDumpCapabilities, type RecoveryPackageInput, type RecoveryRole } from "./recoveryPackage";
import { recoveryRefuse, type ControlledRecoverySource } from "./controlledRecovery";
import { access, copyInputs, type DockerRecoveryResources, type DockerRecoverySecrets } from "./dockerAccess";
export type { DockerRecoveryResources, DockerRecoverySecrets } from "./dockerAccess";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ROLE_PROFILE_SQL = `select json_build_object(
 'unsupportedRoles',(select count(*) from pg_roles where rolname !~ '^pg_' and rolname<>'postgres'
   and (rolsuper or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication or rolconnlimit<>-1 or rolvaliduntil is not null or rolconfig is not null)),
 'unsupportedMembership',(select count(*) from pg_auth_members a join pg_roles member on member.oid=a.member
   join pg_roles granted on granted.oid=a.roleid join pg_roles grantor on grantor.oid=a.grantor
   where (member.rolname !~ '^pg_' and member.rolname<>'postgres' or granted.rolname !~ '^pg_' and granted.rolname<>'postgres')
   and (a.admin_option or grantor.rolname<>'postgres' or member.rolname ~ '^pg_' or member.rolname='postgres' or granted.rolname ~ '^pg_' or granted.rolname='postgres')),
 'unsupportedSettings',(select count(*) from pg_db_role_setting s join pg_roles r on r.oid=s.setrole where r.rolname !~ '^pg_' and r.rolname<>'postgres'),
 'roles',(select coalesce(json_agg(json_build_object('name',rolname,'login',rolcanlogin,'inherit',rolinherit,'members',
   (select coalesce(json_agg(json_build_object('name',member.rolname,'inherit',am.inherit_option,'set',am.set_option) order by member.rolname),'[]')
    from pg_auth_members am join pg_roles member on member.oid=am.member where am.roleid=r.oid)) order by rolname),'[]')
   from pg_roles r where rolname !~ '^pg_' and rolname<>'postgres')) as value`;

export function createDockerRecoverySource(resources: DockerRecoveryResources, secrets: DockerRecoverySecrets): ControlledRecoverySource {
  ({ resources, secrets } = copyInputs(resources, secrets));
  const io = access(resources, secrets, true);
  return { observe: io.observe, async open() {
    const locked = await io.openSource();
    return {
      async postgres() {
        io.check();
        if (hasUnsupportedNonDumpCapabilities(await io.inventory(locked.client))) recoveryRefuse("non-dump-capability-unsupported");
        const profile = (await locked.client.query(resources.bootstrap ? ROLE_PROFILE_SQL.replaceAll("'postgres'", "$1::text") : ROLE_PROFILE_SQL,
          resources.bootstrap ? [io.adminName] : [])).rows[0].value;
        if (profile.unsupportedRoles !== 0 || profile.unsupportedMembership !== 0 || profile.unsupportedSettings !== 0) recoveryRefuse("role-capability-unsupported");
        const postgres = io.exec(resources.postgres, ["pg_dump", "-U", io.adminName, "-d", resources.database, "--format=custom", `--snapshot=${locked.snapshot}`]);
        return { postgres, roles: profile.roles as RecoveryRole[], ...(resources.bootstrap ? { bootstrap: { ...resources.bootstrap } } : {}) };
      },
      async objects() {
        const before = io.list();
        const objects: RecoveryPackageInput["objects"] = [];
        for (const entry of before) {
          const stat = JSON.parse(io.mc(["stat", "--json", `recovery/${resources.bucket}/${entry.key}`]).toString());
          const contentType = stat.metadata?.["Content-Type"];
          const head = await io.store().head({ bucket: resources.bucket, key: entry.key });
          if (stat.status !== "success" || typeof contentType !== "string" || (head && !head.ok)) recoveryRefuse("object-metadata-unavailable");
          const bytes = await io.store().get({ bucket: resources.bucket, key: entry.key });
          if (bytes.length !== entry.size) recoveryRefuse("object-size-drift");
          // The existing HEAD transport returns void for a successful object
          // with no user metadata; failed requests throw instead.
          objects.push({ key: entry.key, bytes, contentType, metadata: head?.metadata ?? {} });
        }
        if (digest(before) !== digest(io.list())) recoveryRefuse("object-inventory-drift");
        return objects;
      },
      redis: io.redisFiles, close: locked.close,
    };
  } };
}
