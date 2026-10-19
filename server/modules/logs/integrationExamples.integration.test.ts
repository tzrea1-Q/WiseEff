import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { buildSkillUploadExamples } from "../../../src/features/log-skills/integrationExamples";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createLogSkill } from "./skillsService";
import { registerLogRoutes } from "./routes";

const available = await isTestDatabaseAvailable();

describe.skipIf(!available)("workspace curl examples against the local app", () => {
  it("executes the generated JSON and multipart requests and pins the publication", async () => {
    const ephemeral = await createEphemeralTestDatabase("skillcurl");
    const db = createPostgresDatabase(ephemeral.url);
    const router = createRouter();
    const auth = makeTestAuthContext({ organizationId: "curl-org", userId: "curl-admin",
      roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:view", "logs:upload", "logs:admin-domains"] });
    const server = createHttpServer(router);
    const statuses: number[] = [];
    server.on("request", (_request, response) => response.once("finish", () => { statuses.push(response.statusCode); }));
    try {
      await seedCoreGraph(db, { organization: { id: auth.organization.id, name: "Curl examples" },
        users: [{ id: auth.user.id, name: "Admin" }] });
      const skill = await createLogSkill(db, auth, { name: "curl-example" }, createUserInvocation(auth), { requestId: "curl-test" });
      registerLogRoutes(router, { db, objectStore: createMemoryObjectStore(), getCurrentAuthContext: (request) => {
        expect(request.headers.authorization).toBe("Bearer example-token");
        return auth;
      } });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No test address");
      const examples = buildSkillUploadExamples(`http://127.0.0.1:${address.port}`, skill.skillKey);
      for (const example of [examples.json, examples.multipart]) {
        expect(example.curl).not.toMatch(/^\+/m);
        expect(example.curl).toContain("Bearer <集成凭据>");
        const { stdout } = await promisify(execFile)("/bin/sh", ["-ec", example.curl.replace("<集成凭据>", "example-token")], {
          env: process.env, timeout: 15_000
        });
        const uploaded = JSON.parse(stdout);
        expect(uploaded.log.skillRevision).toEqual({ id: skill.currentRevision.id, number: skill.currentRevision.number });
        expect(uploaded.job.id).toBeTruthy();
      }
      expect((await db.query<{ count: string }>("select count(*) from log_records where organization_id = $1", [auth.organization.id])).rows[0].count).toBe("2");
      expect(statuses).toEqual([201, 201]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.close();
      await ephemeral.drop();
    }
  }, 120_000);
});
