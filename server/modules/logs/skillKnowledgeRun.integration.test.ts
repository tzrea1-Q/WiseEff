import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { applyTestMigrations, migrationsDir } from "../../testing/tempDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { registerKnowledgeRoutes } from "../knowledge/routes";
import type { KnowledgeEntryDto } from "../knowledge/types";
import { registerLogRoutes } from "./routes";
import { processLogAnalysisJobById } from "./worker";
import { createRuleBasedLogAnalyzer } from "./analyzer";
import { createAgentLoopLogAnalyzer } from "./analyzer/agentLoop";
import { createScriptedLogAnalysisModel } from "./analyzer/scriptedModel";
import { createWorkerLogAnalysisToolBackends } from "./analyzer/tools/workerToolBackends";
import type { getLogSkill } from "./skillsService";
import type { LogSkillRevisionDto } from "./skillsRepository";
import type { LogRecordDto } from "./types";
import type { LogRunDto } from "./repository";
import { logRecordDtoSchema, logRunDtoSchema } from "../contracts/dtoSchemas/logs";

const available = await isTestDatabaseAvailable();
const organizationId = "org-skill-knowledge";
type Skill = Awaited<ReturnType<typeof getLogSkill>>;

async function createFixture() {
  const ephemeral = await createEphemeralTestDatabase("skillknowledge");
  const db = createPostgresDatabase(ephemeral.url), objectStore = createMemoryObjectStore();
  for (const id of [organizationId, "org-other-knowledge"]) await seedCoreGraph(db, {
    organization: { id }, users: [{ id: `${id}-admin` }]
  });
  const admin = makeTestAuthContext({ organizationId, userId: `${organizationId}-admin`, permissions: [
    "logs:view", "logs:upload", "logs:analyze", "logs:admin-domains", "knowledge:view", "knowledge:edit"
  ] });
  let auth = admin;
  const router = createRouter();
  registerKnowledgeRoutes(router, { db, objectStore, getCurrentAuthContext: () => auth });
  registerLogRoutes(router, { db, objectStore, getCurrentAuthContext: () => auth });
  const server = createHttpServer(router);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Knowledge test server did not bind to a TCP port.");
  const request = async <T = unknown>(path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method,
      headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
  };
  const createMarkdown = async (title: string, contentMarkdown: string) => {
    const response = await request<{ item: KnowledgeEntryDto }>("/api/v1/knowledge/entries", "POST", {
      contentForm: "markdown", title, tags: [], contentMarkdown
    });
    expect(response.status).toBe(201);
    return response.body.item;
  };
  return { db, objectStore, admin, request, createMarkdown, setAuth: (value: typeof admin) => { auth = value; },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await db.close(); await ephemeral.drop();
    } };
}

describe.skipIf(!available)("skill knowledge runs over PostgreSQL", () => {
  it("reads archived and missing bindings without exposing private or foreign knowledge", async () => {
    const fixture = await createFixture();
    const { admin, request, createMarkdown, setAuth } = fixture;
    try {
      const entry = await createMarkdown("Bound notes", "Cooling guidance.");
      const privateEntry = await createMarkdown("Private notes", "Private guidance.");
      expect((await request(`/api/v1/knowledge/entries/${entry.id}/publish`, "POST", {})).status).toBe(200);
      const skill = await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name: "Bound knowledge states" });
      expect(skill.status).toBe(201);
      const skillPath = `/api/v1/log-skills/${skill.body.item.id}`;
      const spec = { schemaVersion: "skill/v1", knowledgeEntryIds: [entry.id] };
      const draft = await request<{ item: LogSkillRevisionDto }>(`${skillPath}/draft`, "PUT", {
        spec, baseDraftRevisionId: null, basePublishedRevisionId: skill.body.item.currentRevision.id
      });
      expect(draft.status).toBe(200);
      expect((await request(`${skillPath}/publish`, "POST", { draftRevisionId: draft.body.item.id })).status).toBe(200);
      expect((await request(`/api/v1/knowledge/entries/${entry.id}/archive`, "POST", {})).status).toBe(200);
      expect(await request(`/api/v1/knowledge/entries/${entry.id}/binding`)).toMatchObject({ status: 200,
        body: { deleted: false, entry: { id: entry.id, title: entry.title, status: "archived" } } });
      setAuth({ ...admin, user: { ...admin.user, id: "another-reader" } });
      expect(await request(`/api/v1/knowledge/entries/${privateEntry.id}/binding`)).toMatchObject({ status: 200,
        body: { deleted: false, entry: null } });
      setAuth(makeTestAuthContext({ organizationId: "org-other-knowledge", userId: "org-other-knowledge-admin", permissions: ["knowledge:view"] }));
      expect(await request(`/api/v1/knowledge/entries/${entry.id}/binding`)).toMatchObject({ status: 200,
        body: { deleted: true, entry: null } });
      setAuth({ ...admin, permissions: [] });
      expect((await request(`/api/v1/knowledge/entries/${entry.id}/binding`)).status).toBe(403);
      setAuth(admin);
      expect((await request(`/api/v1/knowledge/entries/${entry.id}`, "DELETE")).status).toBe(403);
      setAuth({ ...admin, permissions: [...admin.permissions, "knowledge:manage"] });
      expect((await request(`/api/v1/knowledge/entries/${entry.id}`, "DELETE")).status).toBe(200);
      expect(await request(`/api/v1/knowledge/entries/${entry.id}/binding`)).toMatchObject({ status: 200,
        body: { deleted: true, entry: null } });
      expect((await request<{ item: Skill }>(skillPath)).body.item.currentRevision.spec.knowledgeEntryIds).toEqual([entry.id]);
      const saved = await request<{ item: LogSkillRevisionDto }>(`${skillPath}/draft`, "PUT", {
        spec: { ...spec, description: "Keep the deleted binding visible" },
        baseDraftRevisionId: null, basePublishedRevisionId: draft.body.item.id
      });
      expect(saved.status).toBe(200);
      expect((await request(`${skillPath}/publish`, "POST", { draftRevisionId: saved.body.item.id })).status).toBe(200);
    } finally { await fixture.close(); }
  }, 120_000);
  it("hides unreadable knowledge status in compatibility link mutations", async () => {
    const fixture = await createFixture();
    const { db, admin, request, createMarkdown, setAuth } = fixture;
    try {
      const bobId = "skill-knowledge-link-bob";
      await seedCoreGraph(db, { organization: { id: organizationId }, users: [{ id: bobId }] });
      const privateEntry = await createMarkdown("Alice PRIVATE compatibility notes", "Private draft.");
      const archived = await createMarkdown("Alice archived compatibility notes", "Archived notes.");
      const published = await createMarkdown("Shared compatibility notes", "Published notes.");
      for (const entry of [archived, published]) {
        expect((await request(`/api/v1/knowledge/entries/${entry.id}/publish`, "POST", {})).status).toBe(200);
      }
      expect((await request(`/api/v1/knowledge/entries/${archived.id}/archive`, "POST", {})).status).toBe(200);
      const skill = await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name: "Compatibility visibility" });
      expect(skill.status).toBe(201);
      const linksPath = `/api/v1/log-domains/${skill.body.item.id}/knowledge-links`;
      type Link = { knowledgeEntryId: string; entryTitle: string; entryTags: string[]; entryStatus?: string };
      type LinkResponse = { items: Link[]; error?: { code: string; details: Record<string, unknown> } };
      for (const canViewKnowledge of [false, true]) {
        setAuth(makeTestAuthContext({ organizationId, userId: bobId, permissions: [
          "logs:view", "logs:admin-domains", ...(canViewKnowledge ? ["knowledge:view"] : [])
        ] }));
        const privateResult = await request<LinkResponse>(linksPath, "PUT", { knowledgeEntryIds: [privateEntry.id] });
        expect.soft(privateResult.status).toBe(404);
        expect.soft(privateResult.body.error?.code).toBe("NOT_FOUND");
        expect.soft(privateResult.body.error?.details).not.toHaveProperty("status");
        expect.soft(JSON.stringify(privateResult.body)).not.toContain(privateEntry.title);
        const archivedResult = await request<LinkResponse>(linksPath, "PUT", { knowledgeEntryIds: [archived.id] });
        expect.soft(archivedResult.status).toBe(canViewKnowledge ? 400 : 404);
        if (canViewKnowledge) expect.soft(archivedResult.body.error?.details).toMatchObject({ status: "archived" });
        else {
          expect.soft(archivedResult.body.error?.code).toBe("NOT_FOUND");
          expect.soft(archivedResult.body.error?.details).not.toHaveProperty("status");
          expect.soft(JSON.stringify(archivedResult.body)).not.toContain(archived.title);
        }
        const linked = await request<LinkResponse>(linksPath, "PUT", { knowledgeEntryIds: [published.id] });
        expect(linked.status).toBe(200);
        if (canViewKnowledge) expect(linked.body.items).toEqual([expect.objectContaining({
          knowledgeEntryId: published.id, entryTitle: published.title, entryStatus: "published"
        })]);
        else {
          expect.soft(linked.body.items).toEqual([expect.objectContaining({
            knowledgeEntryId: published.id, entryTitle: "无权查看的条目", entryTags: []
          })]);
          expect.soft(linked.body.items[0]).not.toHaveProperty("entryStatus");
          expect.soft(JSON.stringify(linked.body)).not.toContain(published.title);
        }
      }
      setAuth(admin);
      const readableDraft = await request<LinkResponse>(linksPath, "PUT", { knowledgeEntryIds: [privateEntry.id] });
      expect(readableDraft.status).toBe(400);
      expect(readableDraft.body.error?.details).toMatchObject({ status: "draft" });
    } finally { await fixture.close(); }
  }, 120_000);

  it("keeps linked knowledge metadata private across workspace, compatibility and run APIs", async () => {
    const fixture = await createFixture();
    const { db, objectStore, admin, request, setAuth } = fixture;
    try {
      const bobId = "skill-knowledge-bob";
      await seedCoreGraph(db, { organization: { id: organizationId }, users: [{ id: bobId }] });
      const createEntry = async (title: string, tag: string) => {
        const response = await request<{ item: KnowledgeEntryDto }>("/api/v1/knowledge/entries", "POST", {
          contentForm: "markdown", title, tags: [tag], contentMarkdown: `${title}: thermal foldback guidance.`
        });
        expect(response.status).toBe(201);
        return response.body.item;
      };
      const privateEntry = await createEntry("Alice PRIVATE thermal notes", "alice-private-tag");
      const published = await createEntry("Shared thermal notes", "shared-tag");
      expect((await request(`/api/v1/knowledge/entries/${published.id}/publish`, "POST", {})).status).toBe(200);
      const created = await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name: "Knowledge visibility" });
      expect(created.status).toBe(201);
      const skillPath = `/api/v1/log-skills/${created.body.item.id}`;
      const spec = { schemaVersion: "skill/v1", knowledgeEntryIds: [privateEntry.id, published.id] };
      const draft = await request<{ item: LogSkillRevisionDto }>(`${skillPath}/draft`, "PUT", {
        spec, baseDraftRevisionId: null, basePublishedRevisionId: created.body.item.currentRevision.id
      });
      expect(draft.status).toBe(200);
      expect((await request(`${skillPath}/publish`, "POST", { draftRevisionId: draft.body.item.id })).status).toBe(200);
      let pendingDraft = await request<{ item: LogSkillRevisionDto }>(`${skillPath}/draft`, "PUT", {
        spec, baseDraftRevisionId: null, basePublishedRevisionId: draft.body.item.id
      });
      expect(pendingDraft.status).toBe(200);
      const uploaded = await request<{ log: { id: string }; job: { id: string; runId: string } }>("/api/v1/log-files", "POST", {
        fileName: "visibility.log", contentType: "text/plain", skillId: created.body.item.id,
        contentBase64: Buffer.from("WARN thermal foldback\n").toString("base64")
      });
      expect(uploaded.status).toBe(201);
      expect(await processLogAnalysisJobById({ db, objectStore, jobId: uploaded.body.job.id, analyzer: {
        async analyze(input) {
          expect(input.knowledgeEntryIds).toEqual([privateEntry.id, published.id]);
          const backends = createWorkerLogAnalysisToolBackends({ db, organizationId,
            knowledgeEntryIds: input.knowledgeEntryIds, onKnowledgeRetrieved: input.onKnowledgeRetrieved });
          const retrieved = await backends.searchDomainKnowledge!("thermal foldback");
          expect(retrieved.items.map((item) => item.entryId)).toEqual([published.id]);
          expect(JSON.stringify(retrieved)).not.toContain(privateEntry.title);
          expect(JSON.stringify(retrieved)).not.toContain(privateEntry.headRevisionId);
          return createRuleBasedLogAnalyzer().analyze(input);
        }
      } })).toEqual({ status: "processed" });

      const reportPath = `/api/v1/logs/${uploaded.body.log.id}`;
      type Provenance = { knowledgeRevisions?: Array<{ entryId: string; revisionId?: string }> };
      expect((await request<{ item: Provenance }>(reportPath)).body.item.knowledgeRevisions).toEqual([
        { entryId: published.id, revisionId: published.headRevisionId }
      ]);
      // Defensive historical rows can retain a reference whose current entry is private.
      const storedRevisions = [published, privateEntry].map((entry) => ({ entryId: entry.id, revisionId: entry.headRevisionId }));
      await db.query("update log_analysis_runs set knowledge_revisions = $2::jsonb where id = $1",
        [uploaded.body.job.runId, JSON.stringify(storedRevisions)]);

      const assertNoPrivateMetadata = (body: unknown) => {
        const encoded = JSON.stringify(body);
        for (const value of [privateEntry.title, ...privateEntry.tags, privateEntry.headRevisionId!]) {
          expect.soft(encoded).not.toContain(value);
        }
        const inspect = (value: unknown): void => {
          if (Array.isArray(value)) return value.forEach(inspect);
          if (!value || typeof value !== "object") return;
          const record = value as Record<string, unknown>;
          if ([record.id, record.entryId, record.knowledgeEntryId].includes(privateEntry.id)) {
            for (const key of ["status", "entryStatus", "revision", "revisionId", "headRevisionId", "headRevisionNumber", "revisionNumber", "updatedAt"]) {
              expect.soft(record).not.toHaveProperty(key);
            }
          }
          Object.values(record).forEach(inspect);
        };
        inspect(body);
      };
      const assertRedactedLink = (link: unknown, entryId: string) => {
        expect.soft(link).toEqual(expect.objectContaining({ knowledgeEntryId: entryId, entryTitle: "无权查看的条目", entryTags: [] }));
        for (const key of ["entryStatus", "revisionId", "headRevisionId", "headRevisionNumber", "revisionNumber", "updatedAt"]) {
          expect.soft(link).not.toHaveProperty(key);
        }
      };
      type Link = { knowledgeEntryId: string; entryTitle: string; entryTags: string[]; entryStatus?: string };
      for (const canViewKnowledge of [false, true]) {
        setAuth(makeTestAuthContext({ organizationId, userId: bobId, permissions: [
          "logs:view", "logs:admin-domains", ...(canViewKnowledge ? ["knowledge:view"] : [])
        ] }));
        const links = await request<{ items: Link[] }>(`/api/v1/log-domains/${created.body.item.id}/knowledge-links`);
        expect(links.status).toBe(200);
        assertNoPrivateMetadata(links.body);
        assertRedactedLink(links.body.items.find((link) => link.knowledgeEntryId === privateEntry.id), privateEntry.id);
        const publishedLink = links.body.items.find((link) => link.knowledgeEntryId === published.id);
        if (canViewKnowledge) expect.soft(publishedLink).toMatchObject({ entryTitle: published.title, entryTags: published.tags, entryStatus: "published" });
        else assertRedactedLink(publishedLink, published.id);

        const skill = await request<{ item: Skill }>(skillPath);
        expect(skill.status).toBe(200);
        assertNoPrivateMetadata(skill.body);
        expect(skill.body.item.currentRevision.spec.knowledgeEntryIds).toEqual(spec.knowledgeEntryIds);
        expect(skill.body.item.draft?.spec.knowledgeEntryIds).toEqual(spec.knowledgeEntryIds);
        const saved = await request<{ item: LogSkillRevisionDto }>(`${skillPath}/draft`, "PUT", {
          spec: { ...spec, description: "Bob edits the skill without reading Alice's private knowledge." },
          baseDraftRevisionId: pendingDraft.body.item.id, basePublishedRevisionId: draft.body.item.id
        });
        expect(saved.status).toBe(200);
        assertNoPrivateMetadata(saved.body);
        pendingDraft = saved;
        for (const path of [`${skillPath}/revisions`, `${skillPath}/revisions/${draft.body.item.id}`, `${skillPath}/revisions/${saved.body.item.id}`]) {
          const revision = await request(path);
          expect(revision.status).toBe(200);
          assertNoPrivateMetadata(revision.body);
        }

        const candidates = await request<{ items: KnowledgeEntryDto[] }>("/api/v1/knowledge/entries?status=published");
        expect(candidates.status).toBe(canViewKnowledge ? 200 : 403);
        assertNoPrivateMetadata(candidates.body);
        if (canViewKnowledge) expect(candidates.body.items.map((entry) => entry.id)).toEqual([published.id]);
        const privateResponse = await request(`/api/v1/knowledge/entries/${privateEntry.id}`);
        expect(privateResponse.status).toBe(canViewKnowledge ? 404 : 403);
        assertNoPrivateMetadata(privateResponse.body);
        const publicResponse = await request<{ item: KnowledgeEntryDto }>(`/api/v1/knowledge/entries/${published.id}`);
        expect(publicResponse.status).toBe(canViewKnowledge ? 200 : 403);
        const report = await request<{ item: Provenance }>(reportPath);
        const runs = await request<{ items: Provenance[] }>(`${reportPath}/runs`);
        const logs = await request<{ items: Array<Provenance & { id: string }> }>("/api/v1/logs");
        expect(report.status).toBe(200); expect(runs.status).toBe(200); expect(logs.status).toBe(200);
        const expected = [{ entryId: published.id, ...(canViewKnowledge ? { revisionId: published.headRevisionId! } : {}) },
          { entryId: privateEntry.id }];
        expect.soft(report.body.item.knowledgeRevisions).toEqual(expected);
        expect.soft(runs.body.items[0].knowledgeRevisions).toEqual(expected);
        expect.soft(logs.body.items.find((log) => log.id === uploaded.body.log.id)?.knowledgeRevisions).toEqual(expected);
        assertNoPrivateMetadata(report.body); assertNoPrivateMetadata(runs.body); assertNoPrivateMetadata(logs.body);
      }

      expect((await db.query<{ knowledge_revisions: unknown }>("select knowledge_revisions from log_analysis_runs where id = $1",
        [uploaded.body.job.runId])).rows[0].knowledge_revisions).toEqual(storedRevisions);
      setAuth(admin);
      expect((await request<{ item: Provenance }>(reportPath)).body.item.knowledgeRevisions).toEqual(storedRevisions);
    } finally { await fixture.close(); }
  }, 120_000);

  it("backfills live links into the current publication while freezing old run scope and preserving superseded revisions", async () => {
    const fixture = await createFixture();
    const { db, objectStore, request, createMarkdown } = fixture;
    try {
      const entry = await createMarkdown("Migrated thermal guidance", "thermal foldback limits current.");
      expect((await request(`/api/v1/knowledge/entries/${entry.id}/publish`, "POST", {})).status).toBe(200);
      const skill = await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name: "Migrated knowledge skill" });
      expect(skill.status).toBe(201);
      const uploaded = await request<{ log: { id: string }; job: { id: string; runId: string } }>("/api/v1/log-files", "POST", {
        fileName: "migrated.log", contentType: "text/plain", skillId: skill.body.item.id,
        contentBase64: Buffer.from("WARN thermal foldback\n").toString("base64")
      });
      expect(uploaded.status).toBe(201);
      const original = (await db.query<{ spec: unknown; content_hash: string }>(
        "select spec, content_hash from log_skill_revisions where id = $1", [skill.body.item.currentRevision.id])).rows[0];
      const skillPath = `/api/v1/log-skills/${skill.body.item.id}`;
      const draft = await request<{ item: LogSkillRevisionDto }>(`${skillPath}/draft`, "PUT", {
        spec: { schemaVersion: "skill/v1" }, baseDraftRevisionId: null, basePublishedRevisionId: skill.body.item.currentRevision.id
      });
      expect(draft.status).toBe(200);
      expect((await request(`${skillPath}/publish`, "POST", { draftRevisionId: draft.body.item.id })).status).toBe(200);
      await db.query(`insert into log_domain_knowledge_links (id, organization_id, log_domain_id, knowledge_entry_id, created_by_user_id)
        values ('migrated-legacy-link',$1,$2,$3,$4)`, [organizationId, skill.body.item.id, entry.id, fixture.admin.user.id]);
      await db.query("alter table log_analysis_runs drop column legacy_knowledge_entry_ids, drop column knowledge_revisions");
      await db.query("delete from schema_migrations where name = '0197_log_skill_knowledge.sql'");
      await applyTestMigrations(db, migrationsDir);
      expect((await db.query("select spec, content_hash from log_skill_revisions where id = $1",
        [skill.body.item.currentRevision.id])).rows).toEqual([original]);
      expect((await db.query<{ knowledge_ids: string[]; hash_valid: boolean }>(`select spec->'knowledgeEntryIds' as knowledge_ids,
        content_hash = encode(sha256(convert_to(spec::text, 'UTF8')), 'hex') as hash_valid
        from log_skill_revisions where id = $1`, [draft.body.item.id])).rows).toEqual([
        { knowledge_ids: [entry.id], hash_valid: true }
      ]);
      expect((await db.query("select legacy_knowledge_entry_ids, knowledge_revisions from log_analysis_runs where id = $1",
        [uploaded.body.job.runId])).rows).toEqual([{ legacy_knowledge_entry_ids: [entry.id], knowledge_revisions: [] }]);
      expect((await db.query("select tgenabled from pg_trigger where tgname = 'log_skill_revision_immutable'")).rows).toEqual([{ tgenabled: "O" }]);
      expect(await processLogAnalysisJobById({ db, objectStore, jobId: uploaded.body.job.id, analyzer: {
        async analyze(input) {
          expect(input.knowledgeEntryIds).toEqual([entry.id]);
          return createRuleBasedLogAnalyzer().analyze(input);
        }
      } })).toEqual({ status: "processed" });
    } finally { await fixture.close(); }
  }, 120_000);

  it("retains a migrated legacy run's knowledge scope when rerunning its superseded revision", async () => {
    const fixture = await createFixture();
    const { db, objectStore, request, createMarkdown } = fixture;
    try {
      const entry = await createMarkdown("Legacy thermal guidance", "thermal foldback limits current.");
      const unrelated = await createMarkdown("Current thermal guidance", "thermal foldback from another link.");
      for (const item of [entry, unrelated]) {
        expect((await request(`/api/v1/knowledge/entries/${item.id}/publish`, "POST", {})).status).toBe(200);
      }
      const skill = await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name: "Legacy knowledge skill" });
      expect(skill.status).toBe(201);
      const uploaded = await request<{ log: { id: string }; job: { id: string; runId: string } }>("/api/v1/log-files", "POST", {
        fileName: "legacy.log", contentType: "text/plain", skillId: skill.body.item.id,
        contentBase64: Buffer.from("WARN thermal foldback\n").toString("base64")
      });
      expect(uploaded.status).toBe(201);
      // 0197 freezes the former live-domain scope on runs, including superseded skill revisions.
      await db.query("update log_analysis_runs set legacy_knowledge_entry_ids = $2::jsonb where id = $1",
        [uploaded.body.job.runId, JSON.stringify([entry.id])]);
      const skillPath = `/api/v1/log-skills/${skill.body.item.id}`;
      const replacement = await request<{ item: LogSkillRevisionDto }>(`${skillPath}/draft`, "PUT", {
        spec: { schemaVersion: "skill/v1", knowledgeEntryIds: [unrelated.id] },
        baseDraftRevisionId: null, basePublishedRevisionId: skill.body.item.currentRevision.id
      });
      expect(replacement.status).toBe(200);
      expect((await request(`${skillPath}/publish`, "POST", { draftRevisionId: replacement.body.item.id })).status).toBe(200);
      const process = async (jobId: string) => {
        expect(await processLogAnalysisJobById({ db, objectStore, jobId, analyzer: {
          async analyze(input) {
            expect(input.knowledgeEntryIds).toEqual([entry.id]);
            const backends = createWorkerLogAnalysisToolBackends({ db, organizationId,
              knowledgeEntryIds: input.knowledgeEntryIds, onKnowledgeRetrieved: input.onKnowledgeRetrieved });
            const retrieved = await backends.searchDomainKnowledge!("thermal foldback");
            expect(retrieved.items.map((item) => item.entryId)).toEqual([entry.id]);
            return createRuleBasedLogAnalyzer().analyze(input);
          }
        } })).toEqual({ status: "processed" });
      };
      await process(uploaded.body.job.id);
      const reportPath = `/api/v1/logs/${uploaded.body.log.id}`;
      const rerun = await request<{ job: { id: string; runId: string } }>(`${reportPath}/rerun`, "POST", { revisionPolicy: "pinned" });
      expect(rerun.status).toBe(200);
      await process(rerun.body.job.id);
      const runs = await request<{ items: LogRunDto[] }>(`${reportPath}/runs`);
      expect(runs.status).toBe(200);
      expect(runs.body.items).toHaveLength(2);
      for (const run of runs.body.items) expect(run).toMatchObject({
        skillRevision: { id: skill.body.item.currentRevision.id },
        knowledgeRevisions: [{ entryId: entry.id, revisionId: entry.headRevisionId }]
      });
    } finally { await fixture.close(); }
  }, 120_000);

  it("retrieves the pinned skill's links and records only revisions actually retrieved, preserving earlier run provenance", async () => {
    const fixture = await createFixture();
    const { db, objectStore, request, createMarkdown, admin, setAuth } = fixture;
    try {
      const entry = await createMarkdown("Thermal guidance", "thermal foldback means the cooling guard limited current.");
      expect(entry).toMatchObject({ status: "draft", headRevisionNumber: 1, sourceType: "human", publishedAt: null });
      const unmatched = await createMarkdown("Unrelated guidance", "A network timeout needs a connection retry.");
      const distractor = await createMarkdown("Other thermal guidance", "thermal foldback outside the pinned skill.");
      const skill = await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name: "Knowledge-aware analysis" });
      expect(skill.status).toBe(201);
      const skillPath = `/api/v1/log-skills/${skill.body.item.id}`;
      // Uploads follow the knowledge module's draft workflow; linking does not publish them.
      const draft = await request<{ item: LogSkillRevisionDto }>(`${skillPath}/draft`, "PUT", {
        spec: { schemaVersion: "skill/v1", knowledgeEntryIds: [entry.id, unmatched.id] },
        baseDraftRevisionId: null, basePublishedRevisionId: skill.body.item.currentRevision.id
      });
      expect(draft.status).toBe(200);
      expect((await request<{ item: KnowledgeEntryDto }>(`/api/v1/knowledge/entries/${entry.id}`)).body.item.status).toBe("draft");
      for (const item of [entry, unmatched, distractor]) {
        expect((await request(`/api/v1/knowledge/entries/${item.id}/publish`, "POST", {})).status).toBe(200);
      }
      expect((await request(`${skillPath}/publish`, "POST", { draftRevisionId: draft.body.item.id })).status).toBe(200);
      const uploaded = await request<{ log: { id: string }; job: { id: string; runId: string } }>("/api/v1/log-files", "POST", {
        fileName: "thermal.log", contentType: "text/plain", skillId: skill.body.item.id,
        contentBase64: Buffer.from("WARN thermal foldback\n").toString("base64")
      });
      expect(uploaded.status).toBe(201);
      const replacement = await request<{ item: LogSkillRevisionDto }>(`${skillPath}/draft`, "PUT", {
        spec: { schemaVersion: "skill/v1", knowledgeEntryIds: [distractor.id] },
        baseDraftRevisionId: null, basePublishedRevisionId: draft.body.item.id
      });
      expect(replacement.status).toBe(200);
      expect((await request(`${skillPath}/publish`, "POST", { draftRevisionId: replacement.body.item.id })).status).toBe(200);

      const process = async (jobId: string, revisionId: string) => {
        const model = createScriptedLogAnalysisModel([
          { content: { action: "tool", tool: "read_line_range", args: { file: "thermal.log", startLine: 1, endLine: 1 } } },
          { content: { action: "tool", tool: "read_domain_knowledge", args: { query: "thermal foldback" } } },
          { content: { action: "tool", tool: "read_domain_knowledge", args: { query: "thermal foldback" } } },
          { content: { action: "final", conclusion: "Thermal protection limited current.", impact: "Charging is slower.",
            severity: "Warning", confidence: 0.9, suggestedActions: ["Inspect cooling."], evidence: [
              { lineNumbers: [1], inference: "The warning matches thermal guidance.", suggestedAction: "Inspect cooling." }
            ] } }
        ]);
        expect(await processLogAnalysisJobById({ db, objectStore, jobId, analyzer: createAgentLoopLogAnalyzer({
          model, modelLabel: "knowledge-provenance", tokenBudget: 100_000, maxSteps: 5,
          bindToolBackends: (input) => {
            expect(input.knowledgeEntryIds).toEqual([entry.id, unmatched.id]);
            return createWorkerLogAnalysisToolBackends({ db, organizationId,
              knowledgeEntryIds: input.knowledgeEntryIds, onKnowledgeRetrieved: input.onKnowledgeRetrieved });
          }
        }) })).toEqual({ status: "processed" });
        const toolResult = model.calls[2].at(-1)?.content ?? "";
        expect(toolResult).toContain(entry.id);
        expect(toolResult).toContain(revisionId);
        expect(toolResult).not.toContain(unmatched.id);
        expect(toolResult).not.toContain(distractor.id);
      };
      await process(uploaded.body.job.id, entry.headRevisionId!);
      const reportPath = `/api/v1/logs/${uploaded.body.log.id}`;
      const firstReport = await request<{ item: LogRecordDto }>(reportPath);
      expect(firstReport.status).toBe(200);
      expect(logRecordDtoSchema.parse(firstReport.body.item)).toMatchObject({ status: "complete", analysisSource: "agent",
        skillRevision: { id: draft.body.item.id }, knowledgeRevisions: [{ entryId: entry.id, revisionId: entry.headRevisionId }] });

      const revised = await request<{ item: KnowledgeEntryDto }>(`/api/v1/knowledge/entries/${entry.id}`, "PATCH", {
        expectedHeadRevisionNumber: 1, contentMarkdown: "thermal foldback now also requires inspecting the fan."
      });
      expect(revised.status).toBe(200);
      expect(revised.body.item.headRevisionId).not.toBe(entry.headRevisionId);
      const rerun = await request<{ job: { id: string; runId: string } }>(`${reportPath}/rerun`, "POST", { revisionPolicy: "pinned" });
      expect(rerun.status).toBe(200);
      await process(rerun.body.job.id, revised.body.item.headRevisionId!);
      const runs = await request<{ items: LogRunDto[] }>(`${reportPath}/runs`);
      expect(runs.status).toBe(200);
      const parsedRuns = runs.body.items.map((run) => logRunDtoSchema.parse(run));
      expect(parsedRuns.find((run) => run.id === uploaded.body.job.runId)).toMatchObject({
        knowledgeRevisions: [{ entryId: entry.id, revisionId: entry.headRevisionId }]
      });
      expect(parsedRuns.find((run) => run.id === rerun.body.job.runId)).toMatchObject({
        knowledgeRevisions: [{ entryId: entry.id, revisionId: revised.body.item.headRevisionId }]
      });
      expect((await request<{ item: LogRecordDto }>(reportPath)).body.item.knowledgeRevisions).toEqual([
        { entryId: entry.id, revisionId: revised.body.item.headRevisionId }
      ]);
      const provenance = parsedRuns.map(({ id, knowledgeRevisions }) => ({ id, knowledgeRevisions }));
      for (const action of ["archive", "delete"]) {
        setAuth({ ...admin, permissions: [...admin.permissions, "knowledge:manage"] });
        expect((await request(`/api/v1/knowledge/entries/${entry.id}${action === "archive" ? "/archive" : ""}`,
          action === "archive" ? "POST" : "DELETE", action === "archive" ? {} : undefined)).status).toBe(200);
        expect((await request<{ items: LogRunDto[] }>(`${reportPath}/runs`)).body.items
          .map(({ id, knowledgeRevisions }) => ({ id, knowledgeRevisions }))).toEqual(provenance);
        expect((await request<{ item: LogRecordDto }>(reportPath)).body.item.knowledgeRevisions).toEqual([
          { entryId: entry.id, revisionId: revised.body.item.headRevisionId }
        ]);
        expect((await request<{ items: LogRecordDto[] }>("/api/v1/logs")).body.items
          .find((log) => log.id === uploaded.body.log.id)?.knowledgeRevisions).toEqual([
          { entryId: entry.id, revisionId: revised.body.item.headRevisionId }
        ]);
        setAuth({ ...admin, permissions: admin.permissions.filter((permission) => permission !== "knowledge:view") });
        expect((await request<{ item: LogRecordDto }>(reportPath)).body.item.knowledgeRevisions).toEqual([{ entryId: entry.id }]);
        setAuth(admin);
        expect((await request<{ item: Skill }>(skillPath)).body.item.currentRevision.spec.knowledgeEntryIds).toEqual([distractor.id]);
        const pinned = await request<{ item: LogSkillRevisionDto }>(`${skillPath}/revisions/${draft.body.item.id}`);
        expect(pinned.body.item.spec.knowledgeEntryIds).toEqual([entry.id, unmatched.id]);
      }
    } finally { await fixture.close(); }
  }, 120_000);

  it("requires knowledge edit permission for Markdown creation and rejects cross-organization skill links", async () => {
    const fixture = await createFixture();
    const { db, admin, request, createMarkdown, setAuth } = fixture;
    try {
      setAuth({ ...admin, permissions: admin.permissions.filter((permission) => permission !== "knowledge:edit") });
      const denied = await request("/api/v1/knowledge/entries", "POST", {
        contentForm: "markdown", title: "Denied upload", tags: [], contentMarkdown: "Do not create."
      });
      expect(denied).toMatchObject({ status: 403, body: { error: { code: "FORBIDDEN" } } });
      expect((await db.query("select id from knowledge_entries where organization_id = $1", [organizationId])).rows).toEqual([]);
      expect((await db.query("select id from audit_events where kind = 'knowledge-entry-create' and organization_id = $1", [organizationId])).rows).toEqual([]);
      setAuth(admin);
      const entry = await createMarkdown("Uploaded notes", "A normal Markdown draft.");
      expect(entry).toMatchObject({ status: "draft", headRevisionNumber: 1, createdByUserId: admin.user.id });
      expect((await db.query("select kind, actor_user_id from audit_events where target_id = $1", [entry.id])).rows).toEqual([
        { kind: "knowledge-entry-create", actor_user_id: admin.user.id }
      ]);
      const skill = await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name: "Tenant isolated" });
      expect(skill.status).toBe(201);
      const skillPath = `/api/v1/log-skills/${skill.body.item.id}`;
      const saveLinks = (knowledgeEntryIds: string[]) => request<{ item: LogSkillRevisionDto }>(`${skillPath}/draft`, "PUT", {
        spec: { schemaVersion: "skill/v1", knowledgeEntryIds },
        baseDraftRevisionId: null, basePublishedRevisionId: skill.body.item.currentRevision.id
      });
      setAuth({ ...admin, permissions: admin.permissions.filter((permission) => permission !== "knowledge:edit") });
      expect(await saveLinks([entry.id])).toMatchObject({ status: 403, body: { error: { code: "FORBIDDEN" } } });
      expect(await saveLinks(["11111111-1111-4111-8111-111111111111"])).toMatchObject({ status: 404, body: { error: { code: "NOT_FOUND" } } });
      setAuth(makeTestAuthContext({ organizationId: "org-other-knowledge", userId: "org-other-knowledge-admin",
        permissions: ["knowledge:view", "knowledge:edit"] }));
      const foreign = await createMarkdown("Foreign notes", "Other organization's knowledge.");
      expect((await request(`/api/v1/knowledge/entries/${foreign.id}/publish`, "POST", {})).status).toBe(200);
      setAuth(admin);
      expect(await saveLinks([foreign.id])).toMatchObject({ status: 404, body: { error: { code: "NOT_FOUND" } } });
      expect((await request<{ item: Skill }>(skillPath)).body.item.draft).toBeNull();
      expect((await request(`/api/v1/knowledge/entries/${entry.id}/publish`, "POST", {})).status).toBe(200);
      setAuth({ ...admin, permissions: admin.permissions.filter((permission) => permission !== "knowledge:edit") });
      expect(await saveLinks([entry.id])).toMatchObject({ status: 200, body: { item: { spec: { knowledgeEntryIds: [entry.id] } } } });
    } finally { await fixture.close(); }
  }, 120_000);
});
