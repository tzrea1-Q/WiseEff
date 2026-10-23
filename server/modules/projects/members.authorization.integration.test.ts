import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTempDatabase, applyTestMigrations, migrationsDir } from "../../testing/tempDatabase";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { getAuthContext } from "../auth/repository";
import { canEditCriticalParameters, canEditParameters, canMergeParameters, canReviewParameterStage } from "../parameter-kernel/policy";
import { installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { createLocalObjectStore } from "../logs/objectStore";
import { createConfigSet, addConfigSetFile } from "../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { registerCanonicalJsonSource } from "../parameter-files/canonicalJsonSource";
import { loadPublishedCatalog } from "../parameter-bindings/catalogProjectValueSync";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";

describe("explicit project authorization cutover (real HTTP/PostgreSQL)", () => {
  it("makes administrative participation changes effective for real drafts and submissions, without granting review or device duties", async () => {
    await withTempDatabase({ prefix: "memberedit" }, async ({ connectionString }) => {
      const db = createPostgresDatabase(connectionString), directory = await mkdtemp(join(tmpdir(), "wiseeff-members-"));
      const objectStore = createLocalObjectStore(directory);
      try {
        await db.query("insert into organizations(id,name) values('edit-home','Home'),('edit-target','Target')");
        for (const [id, org, role] of [["edit-platform", "edit-home", "platform-admin"], ["edit-admin", "edit-target", "admin"],
          ["edit-person", "edit-target", "software-committer"], ["edit-reader", "edit-target", "guest"], ["edit-reviewer", "edit-target", "software-committer"]]) {
          await db.query("insert into users(id,organization_id,name,title,is_active) values($1,$2,$1,'Engineer',true)", [id, org]);
          await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id,project_id) values($1,$2,$3,$4,$5)", [`${id}-role`, id, org, role, id === "edit-reviewer" ? "edit-one" : null]);
        }
        await db.query("insert into projects(id,organization_id,name,code,status) values('edit-one','edit-target','One','ONE','initialized'),('edit-two','edit-target','Two','TWO','initialized')");
        await db.query("insert into projects(id,organization_id,name,code,status) values('edit-foreign','edit-home','Foreign','FOREIGN','initialized')");
        await db.query("insert into users(id,organization_id,name,title,is_active) values('edit-roleless','edit-target','Roleless','Reader',true)");
        async function api(userId: string, path: string, method = "GET", body?: unknown) {
          const auth = await getAuthContext(db, userId);
          return requestJson<Record<string, unknown>>(createWiseEffServer({ db, objectStore, auth: { mode: "production", verifier: { verify: async () => auth } } }), path,
            { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: "Bearer test", "Content-Type": "application/json", "X-Request-Id": `membership-${userId}-${method}` } });
        }
        const membershipPath = "/api/v1/projects/edit-one/members/edit-person?organizationId=edit-target";
        expect((await api("edit-person", membershipPath, "PUT", { roles: ["software-user"], expectedRoles: [] })).status).toBe(403);
        expect((await api("edit-platform", "/api/v1/projects/edit-one/members/edit-platform?organizationId=edit-target", "PUT", { roles: ["software-user"], expectedRoles: [] })).status).toBe(404);
        const before = await getAuthContext(db, "edit-person");
        expect(canEditParameters(before, "edit-one")).toBe(false);
        const roleless = await getAuthContext(db, "edit-roleless");
        expect(roleless.roles).toEqual([]);
        expect(roleless.projectMemberships).toEqual([]);
        const organizationProjects = await api("edit-roleless", "/api/v1/projects");
        expect(organizationProjects.status).toBe(200);
        expect(organizationProjects.body.items).toEqual([
          { id: "edit-one", name: "One", code: "ONE" }, { id: "edit-two", name: "Two", code: "TWO" }
        ]);
        expect((await api("edit-roleless", "/api/v2/projects/edit-foreign/parameter-bindings")).status).toBe(404);
        expect((await api("edit-reader", "/api/v1/projects")).status).toBe(200);
        const admin = await getAuthContext(db, "edit-admin");
        await installConfigurationSourceFixture(db, admin, { subjectId: "csub_member_edit", schemaId: "wiseeff.member.edit" });
        const configSet = await createConfigSet(db, admin, { projectId: "edit-one", name: "Source" });
        const upload = await uploadProjectParameterFile(db, objectStore, admin, { projectId: "edit-one", fileName: "settings.json", bytes: Buffer.from('{"limit":36.5}') });
        await addConfigSetFile(db, admin, { configSetId: configSet.id, fileId: upload.file.id, role: "base", sortOrder: 0 });
        const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
        if (!snapshot) throw new Error("Canonical test Catalog missing");
        const source = await db.transaction((tx) => registerCanonicalJsonSource(tx, objectStore, admin, snapshot, {
          projectId: "edit-one", configSetId: configSet.id, fileId: upload.file.id, fileVersionId: upload.version.id,
          configurationSchemaId: "wiseeff.member.edit", rootPointer: "", mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: "/limit" }],
          invocation: createUserInvocation(admin), requestId: "members-source", refusalSink: createTrustedRefusalAuditSink(db)
        }));
        const binding = source.bindings[0]!, pin = (await db.query<{ config_revision_id: string }>(
          "select config_revision_id from parameter_catalog.project_value_source_pins where binding_id=$1 and project_value_id=$2", [binding.id, binding.currentValueId])).rows[0]!;
        const draftPath = `/api/v2/projects/edit-one/parameter-bindings/${binding.id}/drafts`;
        expect((await api("edit-reader", "/api/v2/projects/edit-one/parameter-bindings")).status).toBe(200);
        const draftBody = { baseRevisionId: pin.config_revision_id, sourceTarget: { format: "json", sourceText: "48" }, reason: "Explicit participant contribution" };
        expect((await api("edit-person", draftPath, "POST", draftBody)).status).toBe(403);
        expect((await api("edit-person", "/api/v2/projects/edit-one/node-enablement-drafts", "POST", { logicalNodeId: "missing", baseRevisionId: "missing", target: "force-disabled", reason: "forbidden" })).status).toBe(403);
        expect((await api("edit-platform", membershipPath, "PUT", { roles: ["hardware-user"], expectedRoles: [] })).status).toBe(200);
        const participant = await getAuthContext(db, "edit-person");
        expect(participant.organization.id).toBe("edit-target");
        expect(canEditParameters(participant, "edit-one")).toBe(true);
        expect(canEditParameters(participant, "edit-two")).toBe(false);
        expect(canEditCriticalParameters(participant, "edit-one")).toBe(false);
        expect(canReviewParameterStage(participant, "edit-one", "software_review")).toBe(false);
        expect(canMergeParameters(participant, "edit-one")).toBe(false);
        const draft = await api("edit-person", draftPath, "POST", draftBody);
        expect(draft.status, JSON.stringify(draft.body)).toBe(201);
        const draftId = (draft.body.item as { draftId: string }).draftId;
        const submission = await api("edit-person", `/api/v2/projects/edit-one/parameter-value-drafts/${draftId}/submit`, "POST", { assignedToUserId: "edit-reviewer" });
        expect(submission.status, JSON.stringify(submission.body)).toBe(201);
        const concurrent = await Promise.all([
          api("edit-platform", membershipPath, "PUT", { roles: ["software-user"], expectedRoles: ["hardware-user"] }),
          api("edit-platform", membershipPath, "PUT", { roles: ["software-committer"], expectedRoles: ["hardware-user"] })
        ]);
        expect(concurrent.map((result) => result.status).sort()).toEqual([200, 409]);
        const current = await getAuthContext(db, "edit-person");
        const roles = current.projectMemberships![0].roles;
        expect((await api("edit-platform", membershipPath, "PUT", { roles: [], expectedRoles: roles })).status).toBe(200);
        expect((await api("edit-person", draftPath, "POST", draftBody)).status).toBe(403);
        expect((await db.query("select actor_user_id,organization_id from audit_events where kind='project-membership' order by created_at limit 1")).rows).toEqual([{ actor_user_id: "edit-platform", organization_id: "edit-target" }]);
        expect((await getAuthContext(db, "edit-platform")).organization.id).toBe("edit-home");
        expect((await getAuthContext(db, "edit-person")).roles).toEqual(before.roles);
        expect((await getAuthContext(db, "edit-reader")).permissions).not.toContain("debugging:write");
        const readerPath = "/api/v1/projects/edit-one/members/edit-reader?organizationId=edit-target";
        expect((await api("edit-platform", readerPath, "PUT", { roles: ["software-committer"], expectedRoles: [] })).status).toBe(200);
        const guestParticipant = await getAuthContext(db, "edit-reader");
        expect(canEditParameters(guestParticipant, "edit-one")).toBe(true);
        expect(canEditCriticalParameters(guestParticipant, "edit-one")).toBe(true);
        expect(canEditCriticalParameters(guestParticipant, "edit-two")).toBe(false);
        expect(canReviewParameterStage(guestParticipant, "edit-one", "software_review")).toBe(false);
        expect(guestParticipant.permissions).not.toContain("debugging:write");
        await db.query("delete from user_role_bindings where user_id='edit-reader'");
        const participantWithoutOrganizationRole = await getAuthContext(db, "edit-reader");
        expect(participantWithoutOrganizationRole.roles).toEqual([]);
        expect(canEditParameters(participantWithoutOrganizationRole, "edit-one")).toBe(true);
        expect((await api("edit-reader", "/api/v1/me")).status).toBe(200);
        expect((await api("edit-reader", "/api/v1/projects")).status).toBe(200);
        await db.query(`create function membership_audit_failure() returns trigger language plpgsql as $$ begin
          if new.kind='project-membership' then raise exception 'membership audit unavailable'; end if; return new; end $$;
          create trigger membership_audit_failure before insert on audit_events for each row execute function membership_audit_failure()`);
        expect((await api("edit-platform", readerPath, "PUT", { roles: [], expectedRoles: ["software-committer"] })).status).toBe(500);
        expect((await getAuthContext(db, "edit-reader")).projectMemberships).toEqual([{ projectId: "edit-one", roles: ["software-committer"] }]);
      } finally { await db.close(); await rm(directory, { recursive: true, force: true }); }
    });
  }, 120_000);

  it("reconciles new projects and revoked roles since the first backfill without activating inactive accounts", async () => {
    await withTempDatabase({ prefix: "membercutover", migrate: false }, async ({ db }) => {
      await applyTestMigrations(db, migrationsDir, { through: "0266_project_membership_expansion.sql" });
      await db.query("insert into organizations(id,name) values('cutover','Cutover')");
      await db.query("insert into users(id,organization_id,name,title,is_active) values('cutover-editor','cutover','Editor','Engineer',true),('cutover-inactive','cutover','Inactive','Engineer',false)");
      await db.query("insert into projects(id,organization_id,name,code) values('cutover-old','cutover','Old','OLD'),('cutover-new','cutover','New','NEW')");
      await db.query("insert into project_members values('cutover','cutover-old','cutover-editor',array['software-user'],now())");
      await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('cutover-revoked','cutover-editor','cutover','guest'),('cutover-still','cutover-inactive','cutover','hardware-user')");
      await applyTestMigrations(db, migrationsDir);
      expect((await db.query("select project_id,user_id,roles from project_members where organization_id='cutover' order by project_id")).rows).toEqual([
        { project_id: "cutover-new", user_id: "cutover-inactive", roles: ["hardware-user"] }, { project_id: "cutover-old", user_id: "cutover-inactive", roles: ["hardware-user"] }
      ]);
      expect((await db.query("select is_active from users where id='cutover-inactive'")).rows).toEqual([{ is_active: false }]);
    });
  }, 120_000);
});
