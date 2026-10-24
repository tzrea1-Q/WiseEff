import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function missingRuntimeGrants(sql: string): string[] {
  const optOuts = [...sql.matchAll(/^\s*-- runtime-acl: owner-only (?:public\.)?(\w+) [^\S\r\n]*\S[^\r\n]*/gm)]
    .map((match) => match[1]);
  const uncommented = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, "");
  const blocks = [...uncommented.matchAll(/\bdo\s+(\$(?:\w+)?\$)([\s\S]*?)\1\s*;/gi)];
  const missing: string[] = [];
  for (const create of uncommented.matchAll(/\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:"\w+"|\w+)(?:\s*\.\s*(?:"\w+"|\w+))?)(?=\s|\(|;)/gi)) {
    const parts = create[1].replaceAll('"', "").split(/\s*\.\s*/);
    if (parts.length === 2 && parts[0] !== "public") continue;
    const table = parts.at(-1)!;
    if (optOuts.includes(table)) continue;
    const hasGrant = blocks.some((block) => {
      if (block.index! <= create.index!) return false;
      const compact = block[2].replace(/\s+/g, "").toLowerCase();
      const cleanupRoutines: Record<string, string> = {
        organization_erasures: "",
        knowledge_attachment_writes: "public.knowledge_erasure_object_referenced(text,text,text)",
        log_object_writes: "parameter_catalog.erase_organization_logs(text,text,text),parameter_catalog.organization_log_erasure_objects_pending(text,text,text),parameter_catalog.organization_log_erasure_object_referenced(text,text,text,text),parameter_catalog.finish_organization_log_erasure_object(text,text,text,text)"
      };
      const cleanupLoop = compact.match(/for(\w+)inselectrolnamefrompg_roleswherenotrolsuperandhas_table_privilege\(oid,'public.users','update'\)andpg_has_role\(oid,'catalog_publication_coordinator_role','member'\)loop(.*?)endloop;/);
      if (Object.hasOwn(cleanupRoutines, table) && cleanupLoop) {
        const variable = cleanupLoop[1];
        const recipient = new RegExp(`(?:declare|;)${variable}text;`).test(compact) ? variable
          : new RegExp(`(?:declare|;)${variable}record;`).test(compact) ? `${variable}.rolname` : "";
        const routine = cleanupRoutines[table];
        const expected = `executeformat('grantselect,insert,update,deleteonpublic.${table}to%i',${recipient});`
          + (routine ? `executeformat('grantexecuteonfunction${routine}to%i',${recipient});` : "");
        if (recipient && cleanupLoop[2] === expected) return true;
      }
      if (table === "parameter_object_writes") {
        const afterCreate = uncommented.slice(create.index! + create[0].length).replace(/\s+|"/g, "").toLowerCase();
        const entries = "parameter_catalog.reserve_parameter_object_write(text,text),parameter_catalog.lock_parameter_object_write(text)";
        const owners = compact.match(/forroutineinselectoid::regprocedurenamefrompg_procwherepronamespace='parameter_catalog'::regnamespaceandpronamein\(([^)]*)\)loop(.*?)endloop;/);
        const writers = compact.match(/forruntimeinselectrolnamefrompg_roleswhererolcanloginandnotrolsuperandnotrolinheritandpg_has_role\(oid,'parameter_governance_writer_role','member'\)andpg_has_role\(oid,'parameter_governance_writer_role','set'\)loop(.*?)endloop;/);
        const grants = [...afterCreate.matchAll(/grant[^;]*onfunction[^;]*parameter_catalog\.(?:reserve_parameter_object_write|lock_parameter_object_write)\([^;]*;/g)].map(([grant]) => grant);
        if (afterCreate.includes("altertablepublic.parameter_object_writesownertocatalog_migration_owner;")
          && afterCreate.includes("revokeallonpublic.parameter_object_writesfrompublic;")
          && !/grant[^;]*on(?:[^;]*parameter_object_writes(?:,|to)|alltablesinschema[^;]*public(?:,|to)|allfunctionsinschema[^;]*parameter_catalog(?:,|to))/.test(afterCreate)
          && afterCreate.includes("createfunctionparameter_catalog.reserve_parameter_object_write(p_orgtext,p_reftext)returnstextlanguageplpgsqlsecuritydefinersetsearch_path=pg_catalog,publicas$$")
          && afterCreate.includes("createfunctionparameter_catalog.lock_parameter_object_write(p_idtext)returnsvoidlanguageplpgsqlsecuritydefinersetsearch_path=pg_catalog,publicas$$")
          && owners?.[1].includes("'reserve_parameter_object_write'") && owners[1].includes("'lock_parameter_object_write'")
          && owners[2] === "executeformat('alterfunction%sownertocatalog_migration_owner',routine.name);executeformat('revokeallonfunction%sfrompublic',routine.name);"
          && writers?.[1].includes(`executeformat('grantexecuteonfunction${entries}to%i',runtime.rolname);`)
          && JSON.stringify(grants) === JSON.stringify([
            `grantexecuteonfunction${entries}to%i',runtime.rolname);`,
            `grantexecuteonfunction${entries}toparameter_governance_writer_role;`
          ])) return true;
      }
      // These two public tables are private owner custody, exposed only through
      // their exact DEFINER entry. Recognize no generic owner-transfer exception.
      const ownerRoutine = table === "agent_checkpoint_namespaces" ? "register_agent_checkpoint_namespace(text,text,text,text,text,text,boolean)"
        : table === "organization_runtime_erasure_objects" ? "erase_organization_runtime(text,text,text,text)" : null;
      if (ownerRoutine) {
        const afterCreate = uncommented.slice(create.index! + create[0].length).replace(/\s+/g, "").toLowerCase();
        const grants = [...afterCreate.matchAll(new RegExp(`grant[^;]*on(?:table)?public\\.${table}to[^;]*;`, "g"))].map(([grant]) => grant);
        const allowedGrants = table === "agent_checkpoint_namespaces" ? [`grantselectonpublic.${table}tocatalog_baseline_reader_role;`] : [];
        const routinePattern = ownerRoutine.replace(/[().]/g, "\\$&");
        const routineGrants = [...afterCreate.matchAll(new RegExp(`grant[^;]*onfunctionparameter_catalog\\.${routinePattern}to[^;]*;`, "g"))].map(([grant]) => grant);
        const guard = table === "agent_checkpoint_namespaces"
          ? "pg_has_role(oid,'parameter_governance_writer_role','member')andpg_has_role(oid,'parameter_governance_writer_role','set')"
          : "has_table_privilege(oid,'public.users','update')andpg_has_role(oid,'catalog_publication_coordinator_role','member')";
        if (afterCreate.includes(`altertablepublic.${table}ownertocatalog_migration_owner;`)
          && afterCreate.includes(`alterfunctionparameter_catalog.${ownerRoutine}ownertocatalog_migration_owner;`)
          && afterCreate.includes(`revokeallonfunctionparameter_catalog.${ownerRoutine}frompublic;`)
          && JSON.stringify(grants) === JSON.stringify(allowedGrants)
          && JSON.stringify(routineGrants) === JSON.stringify([`grantexecuteonfunctionparameter_catalog.${ownerRoutine}to%i',actor.rolname);`])
          && compact === `declareactorrecord;beginforactorinselectrolnamefrompg_roleswhererolcanloginandnotrolsuperandnotrolinheritand${guard}loopexecuteformat('grantexecuteonfunctionparameter_catalog.${ownerRoutine}to%i',actor.rolname);endloop;end`) return true;
      }
      if (!new RegExp(`\\b${table}\\b`).test(block[2])) return false;
      const runtimeDml = /has_table_privilege\s*\(\s*oid\s*,\s*'public\.log_domains'\s*,\s*'INSERT'\s*\)/i.test(block[2])
        && /grant\s+select\s*,\s*insert\s*,\s*update\s*,\s*delete\s+on\b/i.test(block[2]);
      // Feedback cleanup companions inherit the existing attachment writers,
      // including deployments whose feedback role cannot write log domains.
      const feedbackPrivileges = ["product_feedback_attachment_uploads", "product_feedback_attachment_deletions"].includes(table)
        && /has_table_privilege\s*\(\s*oid\s*,\s*'public\.product_feedback_attachments'\s*,\s*'INSERT'\s*\)/i.test(block[2])
        && new RegExp(`grant\\s+select\\s*,\\s*insert\\s*,\\s*update\\s*,\\s*delete\\s+on\\s+public\\.${table}\\s+to\\s+%I`, "i").test(block[2]);
      // Recognition settings mirror each existing module privilege separately;
      // a read-only module role must not receive all runtime DML privileges.
      const modulePrivileges = /select\s+grantee\s*,\s*privilege_type\s+from\s+information_schema\.role_table_grants/i.test(block[2])
        && /table_schema\s*=\s*'public'\s+and\s+table_name\s*=\s*'parameter_modules'/i.test(block[2])
        && /privilege_type\s+in\s*\(\s*'SELECT'\s*,\s*'INSERT'\s*,\s*'UPDATE'\s*,\s*'DELETE'\s*\)/i.test(block[2])
        && new RegExp(`execute\\s+format\\(\\s*'grant %s on public\\.${table} to %I'\\s*,\\s*(\\w+)\\.privilege_type\\s*,\\s*\\1\\.grantee\\s*\\)`, "i").test(block[2]);
      // Identity reads mirror credentials, but writes also require coordinator membership.
      const identityPrivileges = table === "user_oidc_identities"
        && /table_schema\s*=\s*'public'\s+and\s+table_name\s*=\s*'user_password_credentials'/i.test(block[2])
        && /privilege_type\s+in\s*\(\s*'SELECT'\s*,\s*'INSERT'\s*,\s*'UPDATE'\s*,\s*'DELETE'\s*\)\s+and\s+grantee\s*<>\s*'PUBLIC'/i.test(block[2])
        && /for\s+(\w+)\s+in\s+select\s+grantee\s*,\s*privilege_type\s+from\s+information_schema\.role_table_grants[\s\S]*?\bloop\s+if\s+\1\.privilege_type\s*=\s*'SELECT'\s+or\s+pg_has_role\(\s*\1\.grantee\s*,\s*'catalog_publication_coordinator_role'\s*,\s*'MEMBER'\s*\)\s+then\s+execute\s+format\(\s*'grant %s on public\.user_oidc_identities to %I'\s*,\s*\1\.privilege_type\s*,\s*\1\.grantee\s*\)\s*;\s*end\s+if/i.test(block[2]);
      // Member administration preserves each existing privilege. Only directory
      // readers inherit reads; Team/invitation writes also require the coordinator.
      const memberSource = table === "project_members" ? "user_role_bindings"
        : ["organization_teams", "organization_team_members", "organization_invitations"].includes(table) ? "users" : null;
      const memberLoop = memberSource && block[2].match(new RegExp(
        `\\bfor\\s+(\\w+)\\s+in\\s+select\\s+(?:distinct\\s+)?grantee\\s*,\\s*privilege_type\\s+from\\s+information_schema\\.role_table_grants\\s+where\\s+table_schema\\s*=\\s*'public'\\s+and\\s+(?:information_schema\\.role_table_grants\\.)?table_name\\s*=\\s*'${memberSource}'\\s+and\\s+privilege_type\\s+in\\s*\\(\\s*'SELECT'\\s*,\\s*'INSERT'\\s*,\\s*'UPDATE'\\s*,\\s*'DELETE'\\s*\\)\\s+and\\s+grantee\\s*<>\\s*'PUBLIC'\\s+loop\\s*([\\s\\S]*)\\bend\\s+loop\\s*;`, "i"));
      const grantor = memberLoop?.[1].toLowerCase();
      const memberBody = memberLoop?.[2].replace(/\s+/g, "").toLowerCase();
      const directGrant = `executeformat('grant%sonpublic.${table}to%i',${grantor}.privilege_type,${grantor}.grantee);`;
      const coordinatorGuard = `if${grantor}.privilege_type='select'orpg_has_role(${grantor}.grantee,'catalog_publication_coordinator_role','member')then`;
      const memberPrivileges = Boolean(memberLoop) && memberBody === (table === "project_members" ? directGrant
        : table === "organization_invitations" ? `${coordinatorGuard}${directGrant}endif;`
          : `${coordinatorGuard}foreachtable_nameinarrayarray['organization_teams','organization_team_members']loopexecuteformat('grant%sonpublic.%ito%i',${grantor}.privilege_type,table_name,${grantor}.grantee);endloop;endif;`);
      // The durable singleton is pre-created: its runtime only reads and updates.
      const registrationPrivileges = table === "public_experience_registration"
        && /has_table_privilege\s*\(\s*oid\s*,\s*'public\.log_domains'\s*,\s*'INSERT'\s*\)/i.test(block[2])
        && /rolname\s*<>\s*'PUBLIC'/i.test(block[2])
        && /for\s+(\w+)\s+in[\s\S]*?\bloop\s+execute\s+format\(\s*'grant select, update on public\.public_experience_registration to %I'\s*,\s*\1\s*\)\s*;\s*end\s+loop/i.test(block[2]);
      return runtimeDml || feedbackPrivileges || modulePrivileges || identityPrivileges || memberPrivileges || registrationPrivileges;
    });
    if (!hasGrant) missing.push(table);
  }
  return missing;
}

describe("public table runtime grants (0185 onward)", () => {
  it("rejects missing grants and accepts a runtime block or a reasoned owner-only opt-out", () => {
    const create = "create table public.example (id text);";
    const block = `do $$
      declare role_name text;
      begin
        for role_name in select rolname from pg_roles
          where has_table_privilege(oid, 'public.log_domains', 'INSERT')
            and oid <> (select relowner from pg_class where oid = 'public.example'::regclass)
            and rolname <> 'PUBLIC'
        loop
          execute format('grant select, insert, update, delete on public.example to %I', role_name);
        end loop;
      end $$;`;
    expect(missingRuntimeGrants(create)).toEqual(["example"]);
    expect(missingRuntimeGrants(`${create}\n${block}`)).toEqual([]);
    expect(missingRuntimeGrants(`${create}\n-- runtime-acl: owner-only example internal owner workflow`)).toEqual([]);
    expect(missingRuntimeGrants(`${block}\n${create}`)).toEqual(["example"]);
    expect(missingRuntimeGrants(`${create}\n-- runtime-acl: owner-only example `)).toEqual(["example"]);
    expect(missingRuntimeGrants('create table if not exists "public"."example" (id text);')).toEqual(["example"]);
    expect(missingRuntimeGrants("create table example (id text);")).toEqual(["example"]);
    expect(missingRuntimeGrants("create table public.example as select 1 as id;")).toEqual(["example"]);
    expect(missingRuntimeGrants("create table parameter_catalog.example (id text);")).toEqual([]);
    expect(missingRuntimeGrants(`/* ${create} */ -- ${create}`)).toEqual([]);
  });

  it("accepts exact per-privilege module grants without allowing an unrelated or broader grant", () => {
    const create = "create table public.example (id text);";
    const block = `do $$ declare app_grant record; begin
      for app_grant in select grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'parameter_modules'
          and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      loop execute format('grant %s on public.example to %I', app_grant.privilege_type, app_grant.grantee);
      end loop; end $$;`;
    expect(missingRuntimeGrants(`${create}\n${block}`)).toEqual([]);
    for (const invalid of [block.replace("'parameter_modules'", "'unrelated'"),
      block.replace("'public'", "'other_schema'"), block.replace("app_grant.grantee", "someone_else.grantee"),
      block.replace("app_grant.privilege_type", "'ALL'"), block.replace("on public.example", "on public.unrelated"),
      block.replace(", 'DELETE'", "")]) {
      expect(missingRuntimeGrants(`${create}\n${invalid}`)).toEqual(["example"]);
    }
    expect(missingRuntimeGrants(`${block}\n${create}`)).toEqual(["example"]);
  });

  it("recognizes only exact feedback companion grants from existing attachment writers", () => {
    for (const table of ["product_feedback_attachment_uploads", "product_feedback_attachment_deletions"]) {
      const create = `create table public.${table}(id text);`;
      const block = `do $$ declare r record; begin
        for r in select rolname from pg_roles where has_table_privilege(oid,'public.product_feedback_attachments','INSERT') loop
          execute format('grant select,insert,update,delete on public.${table} to %I',r.rolname);
        end loop; end $$;`;
      expect(missingRuntimeGrants(create + block)).toEqual([]);
      for (const invalid of [block.replace("product_feedback_attachments", "unrelated"),
        block.replace("'INSERT'", "'SELECT'"), block.replace(`on public.${table}`, "on public.unrelated"),
        block.replace("select,insert,update,delete", "all")]) {
        expect(missingRuntimeGrants(create + invalid)).toEqual([table]);
      }
      expect(missingRuntimeGrants((create + block).replaceAll(table, "unrelated"))).toEqual(["unrelated"]);
      expect(missingRuntimeGrants(block + create)).toEqual([table]);
    }
  });

  it("recognizes identity grants only from credential privileges with coordinator-only writes", () => {
    const create = "create table public.user_oidc_identities(id text);";
    const block = `do $$ declare identity_grant record; begin
      for identity_grant in select grantee,privilege_type from information_schema.role_table_grants
        where table_schema='public' and table_name='user_password_credentials'
          and privilege_type in ('SELECT','INSERT','UPDATE','DELETE') and grantee<>'PUBLIC'
      loop
        if identity_grant.privilege_type='SELECT' or pg_has_role(identity_grant.grantee,'catalog_publication_coordinator_role','MEMBER') then
          execute format('grant %s on public.user_oidc_identities to %I',identity_grant.privilege_type,identity_grant.grantee);
        end if;
      end loop; end $$;`;
    expect(missingRuntimeGrants(create + block)).toEqual([]);
    for (const invalid of [block.replace("'user_password_credentials'", "'unrelated'"),
      block.replace("'public'", "'other_schema'"), block.replace("grantee<>'PUBLIC'", "true"),
      block.replace("pg_has_role(identity_grant.grantee", "pg_has_role(someone_else.grantee"),
      block.replace("'catalog_publication_coordinator_role'", "'catalog_worker_role'"),
      block.replace("'MEMBER'", "'USAGE'"), block.replace("='SELECT' or", "='INSERT' or"),
      block.replace("identity_grant.privilege_type,identity_grant.grantee", "'ALL',identity_grant.grantee"),
      block.replace("on public.user_oidc_identities", "on public.unrelated"), block.replace(",'DELETE'", "")]) {
      expect(missingRuntimeGrants(create + invalid)).toEqual(["user_oidc_identities"]);
    }
    expect(missingRuntimeGrants((create + block).replaceAll("user_oidc_identities", "unrelated"))).toEqual(["unrelated"]);
    expect(missingRuntimeGrants(block + create)).toEqual(["user_oidc_identities"]);
  });

  const migrationsDir = new URL("../../migrations/", import.meta.url);
  it("recognizes only the finite coordinated API cleanup grants", () => {
    for (const [table, routines, recipient] of [
      ["organization_erasures", "", "role_name"],
      ["knowledge_attachment_writes", "public.knowledge_erasure_object_referenced(text,text,text)", "role_name"],
      ["log_object_writes", "parameter_catalog.erase_organization_logs(text,text,text),parameter_catalog.organization_log_erasure_objects_pending(text,text,text),parameter_catalog.organization_log_erasure_object_referenced(text,text,text,text),parameter_catalog.finish_organization_log_erasure_object(text,text,text,text)", "role_name.rolname"]
    ]) {
      const create = `create table public.${table}(id text);`;
      const block = `do $$ declare ${recipient.includes(".") ? "installed text; " : ""}role_name ${recipient.includes(".") ? "record" : "text"}; begin
        for role_name in select rolname from pg_roles where not rolsuper
          and has_table_privilege(oid,'public.users','UPDATE')
          and pg_has_role(oid,'catalog_publication_coordinator_role','MEMBER') loop
          execute format('grant select,insert,update,delete on public.${table} to %I',${recipient});
          ${routines ? `execute format('grant execute on function ${routines} to %I',${recipient});` : ""}
        end loop; end $$;`;
      expect(missingRuntimeGrants(create + block), table).toEqual([]);
      for (const invalid of [block.replace("not rolsuper", "true"),
        block.replace("'public.users'", "'public.unrelated'"), block.replace("'UPDATE'", "'SELECT'"),
        block.replace("'MEMBER'", "'USAGE'"), block.replace("catalog_publication_coordinator_role", "catalog_worker_role"),
        block.replace("select,insert,update,delete", "all"), block.replace(`on public.${table}`, "on public.unrelated"),
        block.replaceAll(`,${recipient})`, ",unrelated)"),
        block.replace("end loop", "execute format('grant all on public.unrelated to %I',role_name); end loop")]) {
        expect(missingRuntimeGrants(create + invalid), table).toEqual([table]);
      }
      expect(missingRuntimeGrants(block + create), table).toEqual([table]);
      expect(missingRuntimeGrants((create + block).replaceAll(table, "unrelated"))).toEqual(["unrelated"]);
      if (routines) expect(missingRuntimeGrants(create + block.replace(routines, "public.unrelated()"))).toEqual([table]);
    }
  });

  it("recognizes exact owner custody and API-only function entry grants without table DML", () => {
    for (const [file, table, routine] of [
      ["0279_agent_checkpoint_ownership_and_typed_preview.sql", "agent_checkpoint_namespaces", "register_agent_checkpoint_namespace(text,text,text,text,text,text,boolean)"],
      ["0283_organization_runtime_erasure.sql", "organization_runtime_erasure_objects", "erase_organization_runtime(text,text,text,text)"]
    ]) {
      const sql = readFileSync(new URL(file, migrationsDir), "utf8");
      expect(missingRuntimeGrants(sql), file).toEqual([]);
      for (const invalid of [sql.replace(`alter table public.${table} owner to catalog_migration_owner`, `alter table public.${table} owner to catalog_worker_role`),
        sql.replace("rolcanlogin and not rolsuper and not rolinherit", "true"),
        sql.replaceAll("'MEMBER'", "'USAGE'"), sql.replace("'SET'", "'USAGE'"),
        sql.replace(`grant execute on function parameter_catalog.${routine} to %I`, `grant execute on function public.unrelated() to %I`),
        sql + `\ngrant select,insert,update,delete on public.${table} to catalog_worker_role;`,
        sql + `\ngrant all on table public.${table} to public;`,
        sql + `\ngrant execute on function parameter_catalog.${routine} to catalog_worker_role;`]) {
        if (invalid !== sql) expect(missingRuntimeGrants(invalid), file).toEqual([table]);
      }
      expect(missingRuntimeGrants(sql.replaceAll(table, "unrelated")), file).toEqual(["unrelated"]);
    }
  });

  it("recognizes parameter write custody only through its owner and exact reservation entries", () => {
    const sql = readFileSync(new URL("0280_organization_parameter_erasure.sql", migrationsDir), "utf8");
    const table = "parameter_object_writes";
    const entries = "parameter_catalog.reserve_parameter_object_write(text,text),parameter_catalog.lock_parameter_object_write(text)";
    expect(missingRuntimeGrants(sql)).toEqual([]);
    for (const invalid of [sql.replace(`alter table public.${table} owner to catalog_migration_owner`, `alter table public.${table} owner to catalog_worker_role`),
      sql.replace(`revoke all on public.${table} from public;`, ""),
      sql.replaceAll("security definer", "security invoker"),
      sql.replace("'reserve_parameter_object_write','lock_parameter_object_write'", "'unrelated','lock_parameter_object_write'"),
      sql.replace("alter function %s owner to catalog_migration_owner", "alter function %s owner to catalog_worker_role"),
      sql.replace("revoke all on function %s from public", "revoke all on function %s from catalog_worker_role"),
      sql.replace("rolcanlogin and not rolsuper and not rolinherit", "true"),
      sql.replaceAll("'parameter_governance_writer_role'", "'catalog_worker_role'"),
      sql.replaceAll("'MEMBER'", "'USAGE'"), sql.replaceAll("'SET'", "'USAGE'"),
      sql.replace(`function ${entries} to %I',runtime.rolname`, `function ${entries} to %I',unrelated.rolname`),
      sql.replace(`function ${entries} to parameter_governance_writer_role`, `function ${entries} to catalog_worker_role`),
      sql.replaceAll(entries, `${entries},public.unrelated()`),
      sql + `\ngrant execute on function ${entries} to catalog_worker_role;`]) {
      expect(missingRuntimeGrants(invalid)).toEqual([table]);
    }
    for (const role of ["wiseeff_api_role", "catalog_worker_role", "catalog_publication_manager_role"]) {
      for (const privilege of ["insert", "update", "delete", "all"]) {
        expect(missingRuntimeGrants(sql + `\ngrant ${privilege} on public.${table} to ${role};`)).toEqual([table]);
      }
      expect(missingRuntimeGrants(sql + `\ngrant all on table "public"."${table}" to ${role};`)).toEqual([table]);
      expect(missingRuntimeGrants(sql + `\ngrant all on public.${table},public.users to ${role};`)).toEqual([table]);
      expect(missingRuntimeGrants(sql + `\ngrant all on all tables in schema public to ${role};`)).toEqual([table]);
      expect(missingRuntimeGrants(sql + `\ngrant all on all tables in schema parameter_catalog,public to ${role};`)).toEqual([table]);
      expect(missingRuntimeGrants(sql + `\ngrant execute on all functions in schema parameter_catalog to ${role};`)).toEqual([table]);
      expect(missingRuntimeGrants(sql + `\ngrant execute on all functions in schema public,parameter_catalog to ${role};`)).toEqual([table]);
    }
    expect(missingRuntimeGrants(sql.replaceAll(table, "unrelated"))).toEqual(["unrelated"]);
  });

  it("recognizes exact member mirrors without granting unrelated readers or wider writes", () => {
    for (const [file, tables] of [
      ["0264_organization_teams.sql", ["organization_teams", "organization_team_members"]],
      ["0265_organization_invitations.sql", ["organization_invitations"]],
      ["0266_project_membership_expansion.sql", ["project_members"]]
    ] as const) {
      const sql = readFileSync(new URL(file, migrationsDir), "utf8");
      expect(missingRuntimeGrants(sql)).toEqual([]);
      for (const invalid of [sql.replace("table_schema='public'", "table_schema='other_schema'").replace("table_schema = 'public'", "table_schema = 'other_schema'"),
        sql.replace("table_name='users'", "table_name='unrelated'").replace("table_name = 'user_role_bindings'", "table_name = 'unrelated'"),
        sql.replaceAll(".privilege_type,", ".invalid_privilege,"),
        sql.replace("grantee<>'PUBLIC'", "true").replace("grantee <> 'PUBLIC'", "true")]) {
        expect(missingRuntimeGrants(invalid), file).toEqual([...tables]);
      }
      if (file !== "0266_project_membership_expansion.sql") {
        expect(missingRuntimeGrants(sql.replace("'MEMBER'", "'USAGE'"))).toEqual([...tables]);
        expect(missingRuntimeGrants(sql.replaceAll("catalog_publication_coordinator_role", "catalog_worker_role"))).toEqual([...tables]);
      }
    }
  });

  it("accepts the registration singleton's exact read/update grant without broader privileges", () => {
    const sql = readFileSync(new URL("0270_public_experience_registration.sql", migrationsDir), "utf8");
    expect(missingRuntimeGrants(sql)).toEqual([]);
    for (const invalid of [sql.replace("grant select, update", "grant all"),
      sql.replace("'public.log_domains'", "'public.unrelated'"), sql.replace("rolname <> 'PUBLIC'", "true"),
      sql.replace("to %I', role_name", "to %I', another_role")]) {
      expect(missingRuntimeGrants(invalid)).toEqual(["public_experience_registration"]);
    }
  });

  for (const file of readdirSync(migrationsDir).filter((name) => /^\d+_.*\.sql$/.test(name) && Number.parseInt(name, 10) >= 185).sort()) {
    it(`${file} includes runtime grants for each new public table`, () => {
      const missing = missingRuntimeGrants(readFileSync(new URL(file, migrationsDir), "utf8"));
      expect(missing, `${file}: add a subsequent runtime DML grant DO block for each table using has_table_privilege(oid, 'public.log_domains', 'INSERT'), or -- runtime-acl: owner-only <table> <reason>`).toEqual([]);
    });
  }
});
