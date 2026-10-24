import { expect, it } from "vitest";
import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { seedCoreGraph } from "../../../testing/fixtures";
import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import { seedBaselineAuthCatalog } from "../../auth/baselineCatalog";
import { getAuthContext } from "../../auth/repository";
import { resolveOperatingContext } from "../../auth/operatingContext";
import { createUserInvocation, createAgentInvocationFromUser } from "../../auth/trustedInvocation";
import { readProjectProtectedParameters } from "./projectReadAdapter";
import { listCanonicalValueChangesForAuth } from "../drafts/changeService";
import { withParameterAccess } from "../../parameters/operatingScope";

it("reads the authorized target with the real User or Agent actor and rechecks revoked authority", async () => {
  const database = await createEphemeralTestDatabase("scopedreadadapter"), db = createPostgresDatabase(database.url);
  try {
    await seedCoreGraph(db, { organization: { id: "read-home", name: "Home" }, users: [{ id: "read-platform" }] });
    await seedCoreGraph(db, { organization: { id: "read-target", name: "Target" }, projects: [{ id: "read-target-project" }] });
    await seedBaselineAuthCatalog(db);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('read-platform-role','read-platform','read-home','platform-admin')");
    const actor = await getAuthContext(db, "read-platform"), pool = getRootPostgresPool(db)!;
    const user = await resolveOperatingContext(db, createUserInvocation(actor), "read-target");
    const agent = createAgentInvocationFromUser(user, { sessionId: "read-agent-session", toolCallId: "read-agent-call", approval: { required: false } });
    for (const invocation of [user, agent]) {
      await expect(readProjectProtectedParameters(pool, { invocation, projectId: "read-target-project" })).resolves.toEqual([]);
      await expect(listCanonicalValueChangesForAuth(db, withParameterAccess(actor, invocation), { projectId: "read-target-project" })).resolves.toEqual([]);
      expect(invocation.principal.organization.id).toBe("read-home");
    }
    await expect(readProjectProtectedParameters(pool, { invocation: createUserInvocation(actor), projectId: "read-target-project" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('read-remaining-role','read-platform','read-home','hardware-user')");
    await db.query("delete from user_role_bindings where id='read-platform-role'");
    await expect(readProjectProtectedParameters(pool, { invocation: agent, projectId: "read-target-project" })).rejects.toMatchObject({ code: "INVALID_TRUSTED_INVOCATION_CONTEXT" });
  } finally { await db.close(); await database.drop(); }
});
