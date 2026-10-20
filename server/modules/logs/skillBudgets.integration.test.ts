import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerLogRoutes } from "./routes";
import type { getLogSkill } from "./skillsService";
import type { LogSkillRevisionDto } from "./skillsRepository";

const available = await isTestDatabaseAvailable();

describe.skipIf(!available)("skill budgets over PostgreSQL", () => {
  it("returns field errors above platform caps and publishes valid budgets with the revision", async () => {
    const ephemeral = await createEphemeralTestDatabase("skillbudgets");
    const db = createPostgresDatabase(ephemeral.url);
    const auth = makeTestAuthContext({ organizationId: "org-budgets", userId: "budget-admin",
      roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:view", "logs:admin-domains"] });
    try {
      await seedCoreGraph(db, { organization: { id: "org-budgets", name: "Budgets" }, users: [{ id: "budget-admin", name: "Admin" }] });
      const router = createRouter();
      const caps = { stepBudget: 4, tokenBudget: 5000 };
      registerLogRoutes(router, { db, skillBudgetCaps: caps, getCurrentAuthContext: () => auth });
      const request = <T,>(url: string, method = "GET", body?: unknown) => requestJson<T>(createHttpServer(router), url,
        { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      type Skill = Awaited<ReturnType<typeof getLogSkill>>;
      const created = await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name: "Power budgets" });
      expect(created.status).toBe(201);
      const skill = created.body.item;
      const base = `/api/v1/log-skills/${skill.id}`;
      const save = (stepBudget: number, tokenBudget: number) => request<{ item: LogSkillRevisionDto }>(`${base}/draft`, "PUT", {
        spec: { schemaVersion: "skill/v1", stepBudget, tokenBudget }, baseDraftRevisionId: null, basePublishedRevisionId: skill.currentRevision.id
      });
      expect(await save(5, 5001)).toMatchObject({ status: 400, body: { error: { code: "VALIDATION_FAILED", details: { issues: [
        { path: ["stepBudget"], message: "不能超过平台上限（4）。" },
        { path: ["tokenBudget"], message: "不能超过平台上限（5000）。" }
      ] } } } });
      expect((await request<{ item: Skill }>(base)).body.item.draft).toBeNull();
      for (const tokenBudget of [1, 4095]) {
        expect(await save(3, tokenBudget)).toMatchObject({ status: 400, body: { error: { details: { issues: [
          { path: ["tokenBudget"], message: "不能小于 4096。" }
        ] } } } });
      }
      expect(await save(0, 4096)).toMatchObject({ status: 400, body: { error: { details: { issues: [
        { path: ["spec", "stepBudget"] }
      ] } } } });
      const saved = await save(3, 4096);
      expect(saved.status).toBe(200);
      const validSpec = saved.body.item.spec;
      // Simulate a draft stored before minimum validation was introduced.
      for (const invalid of [{ tokenBudget: 1 }, { stepBudget: 0 }]) {
        await db.query("update log_skill_revisions set spec=$2::jsonb where id=$1", [saved.body.item.id, JSON.stringify({ ...validSpec, ...invalid })]);
        expect(await request(`${base}/publish`, "POST", { draftRevisionId: saved.body.item.id })).toMatchObject({ status: 400,
          body: { error: { details: { issues: [{ path: [Object.keys(invalid)[0]] }] } } } });
        expect((await request<{ item: Skill }>(base)).body.item.currentRevision.id).toBe(skill.currentRevision.id);
      }
      await db.query("update log_skill_revisions set spec=$2::jsonb where id=$1", [saved.body.item.id, JSON.stringify(validSpec)]);
      const published = await request<{ item: Skill }>(`${base}/publish`, "POST", { draftRevisionId: saved.body.item.id });
      expect(published.status).toBe(200);
      expect(published.body.item.currentRevision.spec).toMatchObject({ stepBudget: 3, tokenBudget: 4096 });
      expect((await request<{ item: Skill }>(base)).body.item.currentRevision.spec).toMatchObject({ stepBudget: 3, tokenBudget: 4096 });
      caps.tokenBudget = 3000;
      const lowerCapSkill = (await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name: "Lower platform cap" })).body.item;
      const saveLower = (tokenBudget: number) => request(`/api/v1/log-skills/${lowerCapSkill.id}/draft`, "PUT", {
        spec: { schemaVersion: "skill/v1", stepBudget: 1, tokenBudget }, baseDraftRevisionId: null, basePublishedRevisionId: lowerCapSkill.currentRevision.id
      });
      expect(await saveLower(2999)).toMatchObject({ status: 400, body: { error: { details: { issues: [
        { path: ["tokenBudget"], message: "不能小于 3000。" }
      ] } } } });
      expect((await saveLower(3000)).status).toBe(200);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);
});
