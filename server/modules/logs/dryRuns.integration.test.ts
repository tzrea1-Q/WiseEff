import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerLogRoutes } from "./routes";
import { createRuleBasedLogAnalyzer, genericSignalRuleSet, type AnalyzeLogInput, type LogAnalysisAdapter } from "./analyzer";
import { acquireDryRunOwner, LOG_DRY_RUN_BUSY, LOG_DRY_RUN_INTERRUPTED, recoverInterruptedDryRuns } from "./dryRunAdmission";
import type { getLogSkill } from "./skillsService";
import type { LogSkillRevisionDto } from "./skillsRepository";
import type { logSkillDryRunDetailResponseSchema } from "../contracts/dtoSchemas/logs";
import type { z } from "zod";

const available = await isTestDatabaseAvailable();
type Skill = Awaited<ReturnType<typeof getLogSkill>>;
type Dry = z.infer<typeof logSkillDryRunDetailResponseSchema>;

async function harness(analyzer: LogAnalysisAdapter) {
  const ephemeral = await createEphemeralTestDatabase("dryadmission");
  const db = createPostgresDatabase(ephemeral.url);
  const otherDb = createPostgresDatabase(ephemeral.url);
  const store = createMemoryObjectStore();
  const get = vi.spyOn(store, "get"), getStream = vi.spyOn(store, "getStream");
  const client = (db: RootDatabase, organizationId: string) => {
    const auth = makeTestAuthContext({ organizationId, userId: `${organizationId}-admin`, permissions: ["logs:view", "logs:admin-domains"] });
    const router = createRouter();
    registerLogRoutes(router, { db, objectStore: store, analyzer, getCurrentAuthContext: () => auth });
    return { auth, request: <T,>(url: string, method = "GET", body?: unknown) => requestJson<T>(createHttpServer(router), url,
      { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) };
  };
  const prepare = async (organizationId: string, name: string, content = "INFO sample\nERROR example\n", database = db) => {
    const api = client(database, organizationId);
    await seedCoreGraph(db, { organization: { id: organizationId, name: organizationId }, users: [{ id: api.auth.user.id, name: "Admin" }] });
    const created = await api.request<{ item: Skill }>("/api/v1/log-skills", "POST", { name });
    expect(created.status).toBe(201);
    const skill = created.body.item, base = `/api/v1/log-skills/${skill.id}`;
    const draft = await api.request<{ item: LogSkillRevisionDto }>(`${base}/draft`, "PUT", {
      spec: skill.currentRevision.spec, baseDraftRevisionId: null, basePublishedRevisionId: skill.currentRevision.id
    });
    expect(draft.status).toBe(200);
    expect((await api.request(`${base}/sample`, "PUT", { fileName: "sample.log", contentBase64: Buffer.from(content).toString("base64") })).status).toBe(200);
    return { ...api, skill, base, revisionId: draft.body.item.id };
  };
  // Large samples stream through decoding and signals; under CI load draining can exceed 10 s.
  const idle = async (timeout = 10_000) => vi.waitFor(async () => {
    expect((await db.query("select count(*)::int n from log_skill_dry_runs where status='processing'")).rows).toEqual([{ n: 0 }]);
  }, { timeout });
  return { db, otherDb, store, get, getStream, client, prepare, idle, async close() {
    await Promise.all([db.close(), otherDb.close()]);
    await ephemeral.drop();
  } };
}

describe.skipIf(!available)("dry-run aggregate admission and process lifecycle over PostgreSQL", () => {
  it("runs bundle files with their roles and applicability and retains immutable file windows beyond the sample preview", async () => {
    const observed: AnalyzeLogInput[] = [];
    const h = await harness({ async analyze(input) { observed.push(input); return createRuleBasedLogAnalyzer().analyze(input); } });
    try {
      const api = await h.prepare("bundle-dry", "Bundle sample");
      const spec = { ...api.skill.currentRevision.spec, files: [{ glob: "charger/**", role: "充电" }],
        formatProfile: { severityMap: { info: ["ERROR"] } },
        parsing: { schemaVersion: "parsing/v1", extractors: [{ id: "sensor", pattern: "temperature=(?P<temperature>\\d+)",
          fields: { temperature: { type: "int" } } }] },
        signalRules: { ...genericSignalRuleSet, rules: [{ id: "charging-high", stageId: "rootcause", severity: "Warning",
          anyOf: [{ type: "text", pattern: "CUSTOM" }, { type: "field", field: "sensor.temperature", operator: "range", min: 90, max: 100 }],
          inference: "Inspect charger", suggestedAction: "Inspect", analysis: { suggestedActions: [] } }] } };
      expect((await api.request(`${api.base}/draft`, "PUT", { spec, baseDraftRevisionId: api.revisionId,
        basePublishedRevisionId: api.skill.currentRevision.id })).status).toBe(200);
      const zip = new JSZip();
      zip.file("kernel/dmesg.log", "ERROR CUSTOM temperature=95\n", { createFolders: false });
      zip.file("charger/charger.log", "INFO filler\n".repeat(5001) + "ERROR CUSTOM temperature=95\n", { createFolders: false });
      zip.file("misc/notes.txt", "ERROR CUSTOM temperature=95\n", { createFolders: false });
      zip.file("capture.bin", Buffer.from([0, 1, 2]), { createFolders: false });
      expect((await api.request(`${api.base}/sample`, "PUT", { fileName: "sample.zip",
        contentBase64: (await zip.generateAsync({ type: "nodebuffer" })).toString("base64") })).status).toBe(200);
      const started = await api.request<Dry>(`${api.base}/dry-runs`, "POST");
      expect(started.status).toBe(202);
      await h.idle();
      expect(observed).toHaveLength(1);
      const input = observed[0];
      expect(input.files?.map(({ path, role, skillMatched, status }) => ({ path, role, skillMatched, status }))).toEqual([
        { path: "kernel/dmesg.log", role: null, skillMatched: false, status: "analyzed" },
        { path: "charger/charger.log", role: "充电", skillMatched: true, status: "analyzed" },
        { path: "misc/notes.txt", role: null, skillMatched: false, status: "analyzed" },
        { path: "capture.bin", role: null, skillMatched: false, status: "skipped" }
      ]);
      expect(input.signalSummary?.signals.filter(({ source }) => source === "skill")).toEqual([
        expect.objectContaining({ kind: "skill:charging-high", anchors: [expect.objectContaining({ file: "charger/charger.log", line: 5002 })] })
      ]);
      for (const path of ["kernel/dmesg.log", "misc/notes.txt"]) expect(input.signalSummary?.signals).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: "generic", kind: "first-error", anchors: [expect.objectContaining({ file: path })] })
      ]));
      expect(input.decoding?.events.map(({ file }) => file)).toEqual(["charger/charger.log"]);
      expect(await input.files!.find(({ path }) => path === "misc/notes.txt")!.reader!.readRange(1, 1))
        .toEqual([{ lineNumber: 1, content: "ERROR CUSTOM temperature=95" }]);
      const finished = await api.request<Dry>(`${api.base}/dry-runs/${started.body.run.id}`);
      expect(finished.body.run).toMatchObject({ status: "complete", report: { reportContext: { lineCount: 5004 } } });
      expect(finished.body.run.report?.evidence.filter(({ ruleHit }) => ruleHit === "charging-high"))
        .toEqual([expect.objectContaining({ filePath: "charger/charger.log", lineNumbers: [5002] })]);
      // A later sample replacement must not change evidence windows for this run.
      expect((await api.request(`${api.base}/sample`, "PUT", { fileName: "new.log", contentBase64: Buffer.from("replacement").toString("base64") })).status).toBe(200);
      expect(await api.request(`${api.base}/dry-runs/${started.body.run.id}/lines?file=charger%2Fcharger.log&startLine=5002&endLine=5002`))
        .toMatchObject({ status: 200, body: { item: { file: "charger/charger.log", totalLines: 5002,
          lines: [{ lineNumber: 5002, content: "ERROR CUSTOM temperature=95" }] } } });
      expect((await api.request(`${api.base}/dry-runs/${started.body.run.id}/lines?file=missing.log&startLine=1&endLine=1`)).status).toBe(404);
    } finally { await h.idle(); await h.close(); }
  }, 120_000);

  it("atomically admits across API pools and rejects excess skills and tenants before reading or analyzing", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const analyze = vi.fn(async (input: AnalyzeLogInput) => { await blocked; return createRuleBasedLogAnalyzer().analyze(input); });
    const h = await harness({ analyze });
    try {
      vi.stubEnv("LOG_DRY_RUN_MAX_CONCURRENT", "2");
      const one = await h.prepare("admission-one", "First skill");
      const sibling = await h.prepare("admission-one", "Sibling skill", undefined, h.otherDb);
      const two = await h.prepare("admission-two", "Second tenant", undefined, h.otherDb);
      const three = await h.prepare("admission-three", "Third tenant");
      const sameOrg = await Promise.all([one, sibling].map((api) => api.request<Dry>(`${api.base}/dry-runs`, "POST")));
      expect(sameOrg.map((result) => result.status).sort()).toEqual([202, 429]);
      await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));
      const reads = { get: h.get.mock.calls.length, stream: h.getStream.mock.calls.length };
      const rejected = await sibling.request(`${sibling.base}/dry-runs`, "POST");
      expect(rejected.status).toBe(429);
      expect(rejected.body).toMatchObject({ error: { code: "RATE_LIMITED", message: LOG_DRY_RUN_BUSY } });
      expect(analyze).toHaveBeenCalledTimes(1);
      expect(h.get).toHaveBeenCalledTimes(reads.get);
      expect(h.getStream).toHaveBeenCalledTimes(reads.stream);
      expect((await h.db.query("select count(*)::int n from log_skill_dry_runs")).rows).toEqual([{ n: 1 }]);

      const crossOrg = await Promise.all([two, three].map((api) => api.request<Dry>(`${api.base}/dry-runs`, "POST")));
      expect(crossOrg.map((result) => result.status).sort()).toEqual([202, 429]);
      await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(2));
      const readsAtCapacity = h.getStream.mock.calls.length;
      for (const api of [one, sibling, two, three]) {
        const response = await api.request(`${api.base}/dry-runs`, "POST");
        expect(response.status).toBe(429);
        expect(response.body).toMatchObject({ error: { message: LOG_DRY_RUN_BUSY } });
      }
      expect(h.getStream).toHaveBeenCalledTimes(readsAtCapacity);
      expect(analyze).toHaveBeenCalledTimes(2);
      expect((await h.otherDb.query("select count(*)::int n from log_skill_dry_runs where status='processing'")).rows).toEqual([{ n: 2 }]);
      release();
      await h.idle();

      vi.stubEnv("LOG_DRY_RUN_MAX_CONCURRENT", "1");
      // A blocked analyzer makes the configurable global ceiling observable across tenants.
      let resume!: () => void;
      const gate = new Promise<void>((resolve) => { resume = resolve; });
      analyze.mockImplementationOnce(async (input) => { await gate; return createRuleBasedLogAnalyzer().analyze(input); });
      try {
        expect((await one.request(`${one.base}/dry-runs`, "POST")).status).toBe(202);
        await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(3));
        expect((await two.request(`${two.base}/dry-runs`, "POST")).status).toBe(429);
        expect(analyze).toHaveBeenCalledTimes(3);
      } finally { resume(); }
    } finally { release(); await h.idle(); vi.unstubAllEnvs(); await h.close(); }
  }, 120_000);

  it("recovers missing owners on startup and lazy reads, preserves other API owners and expires live owners", async () => {
    const h = await harness(createRuleBasedLogAnalyzer());
    const owners: Awaited<ReturnType<typeof acquireDryRunOwner>>[] = [];
    try {
      const orphan = await h.prepare("restart-orphan", "Interrupted skill");
      const live = await h.prepare("restart-live", "Other API skill", undefined, h.otherDb);
      const expired = await h.prepare("restart-expired", "Expired skill");
      const seed = async (api: typeof orphan, db: RootDatabase, deadline: string) => {
        const owner = await acquireDryRunOwner(db); owners.push(owner);
        const id = randomUUID();
        await db.query(`insert into log_skill_dry_runs (id, organization_id, skill_id, skill_revision_id,
          sample_file_name, sample_object_key, status, deadline_at, owner_pid, owner_key)
          values ($1,$2,$3,$4,'sample.log','sample-key','processing',$5,$6,$7)`,
        [id, api.auth.organization.id, api.skill.id, api.revisionId, deadline, owner.pid, owner.key]);
        return { id, owner };
      };
      const future = new Date(Date.now() + 60_000).toISOString();
      const abandoned = await seed(orphan, h.db, future);
      const active = await seed(live, h.otherDb, future);
      await abandoned.owner.close();
      // The exact startup recovery path also runs against owners from another pool.
      await recoverInterruptedDryRuns(h.db);
      expect((await orphan.request<Dry>(`${orphan.base}/dry-runs/${abandoned.id}`)).body.run).toMatchObject({ status: "failed", error: LOG_DRY_RUN_INTERRUPTED });
      expect((await live.request<Dry>(`${live.base}/dry-runs/${active.id}`)).body.run.status).toBe("processing");

      const lazy = await seed(orphan, h.db, future);
      await lazy.owner.close();
      expect((await orphan.request<Dry>(`${orphan.base}/dry-runs/${lazy.id}`)).body.run).toMatchObject({ status: "failed", error: LOG_DRY_RUN_INTERRUPTED });
      const overdue = await seed(expired, h.otherDb, new Date(Date.now() - 1000).toISOString());
      expect((await expired.request<Dry>(`${expired.base}/dry-runs/${overdue.id}`)).body.run).toMatchObject({ status: "failed", error: LOG_DRY_RUN_INTERRUPTED });
      expect((await live.request<Dry>(`${live.base}/dry-runs/${active.id}`)).body.run.status).toBe("processing");
    } finally { await Promise.all(owners.map((owner) => owner.close())); await h.close(); }
  }, 120_000);

  it("keeps timed-out unresponsive work inside organization and global caps until it settles", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const analyze = vi.fn(async (input: AnalyzeLogInput) => { await blocked; return createRuleBasedLogAnalyzer().analyze(input); });
    const h = await harness({ analyze });
    try {
      vi.stubEnv("LOG_DRY_RUN_MAX_CONCURRENT", "2");
      const one = await h.prepare("timeout-one", "Timed out skill");
      const two = await h.prepare("timeout-two", "Other tenant", undefined, h.otherDb);
      const three = await h.prepare("timeout-three", "Third tenant");
      vi.stubEnv("LOG_ANALYSIS_JOB_MAX_MS", "150");
      const started = await one.request<Dry>(`${one.base}/dry-runs`, "POST");
      expect(started.status).toBe(202);
      await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));
      await vi.waitFor(async () => expect((await one.request<Dry>(`${one.base}/dry-runs/${started.body.run.id}`)).body.run)
        .toMatchObject({ status: "failed", error: LOG_DRY_RUN_INTERRUPTED }));
      expect((await one.request(`${one.base}/dry-runs`, "POST")).status).toBe(429);
      vi.stubEnv("LOG_ANALYSIS_JOB_MAX_MS", "120000");
      expect((await two.request(`${two.base}/dry-runs`, "POST")).status).toBe(202);
      await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(2));
      const reads = h.getStream.mock.calls.length;
      const rejected = await three.request(`${three.base}/dry-runs`, "POST");
      expect(rejected.status).toBe(429);
      expect(rejected.body).toMatchObject({ error: { message: LOG_DRY_RUN_BUSY } });
      expect(analyze).toHaveBeenCalledTimes(2);
      expect(h.getStream).toHaveBeenCalledTimes(reads);
      release();
      await h.idle();
      await vi.waitFor(async () => {
        expect((await h.db.query("select count(*)::int n from pg_locks where locktype='advisory' and classid=7141230 and granted")).rows).toEqual([{ n: 0 }]);
      });
      expect((await one.request(`${one.base}/dry-runs`, "POST")).status).toBe(202);
    } finally { release(); await h.idle(); vi.unstubAllEnvs(); await h.close(); }
  }, 120_000);

  it("retains the local admission slot when the owner connection dies before unresponsive work settles", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const analyze = vi.fn(async (input: AnalyzeLogInput) => { await blocked; return createRuleBasedLogAnalyzer().analyze(input); });
    const h = await harness({ analyze });
    try {
      const api = await h.prepare("owner-loss", "Interrupted owner");
      const otherApi = h.client(h.otherDb, api.auth.organization.id);
      const started = await api.request<Dry>(`${api.base}/dry-runs`, "POST");
      expect(started.status).toBe(202);
      await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));
      const owner = (await h.otherDb.query<{ owner_pid: number }>("select owner_pid from log_skill_dry_runs where id=$1", [started.body.run.id])).rows[0];
      // Only terminate this disposable fixture run's dedicated owner connection.
      expect((await h.otherDb.query("select pg_terminate_backend($1) as terminated", [owner.owner_pid])).rows).toEqual([{ terminated: true }]);
      await vi.waitFor(async () => expect((await otherApi.request<Dry>(`${api.base}/dry-runs/${started.body.run.id}`)).body.run)
        .toMatchObject({ status: "failed", error: LOG_DRY_RUN_INTERRUPTED }));
      expect((await h.otherDb.query("select count(*)::int n from pg_locks where locktype='advisory' and pid=$1 and granted", [owner.owner_pid])).rows).toEqual([{ n: 0 }]);
      const reads = h.getStream.mock.calls.length;
      const rejected = await otherApi.request(`${api.base}/dry-runs`, "POST");
      expect(rejected.status).toBe(429);
      expect(rejected.body).toMatchObject({ error: { message: LOG_DRY_RUN_BUSY } });
      expect(analyze).toHaveBeenCalledTimes(1);
      expect(h.getStream).toHaveBeenCalledTimes(reads);
      release();
      await vi.waitFor(async () => expect((await otherApi.request(`${api.base}/dry-runs`, "POST")).status).toBe(202));
      await h.idle();
      expect(analyze).toHaveBeenCalledTimes(2);
    } finally { release(); await h.idle(); await h.close(); }
  }, 120_000);

  it("streams a 2 MiB sample with a bounded parse preview and retains evidence beyond the preview", async () => {
    const observed: AnalyzeLogInput[] = [];
    const h = await harness({ async analyze(input) { observed.push(input); return createRuleBasedLogAnalyzer().analyze(input); } });
    try {
      const sample = "x\n".repeat(600) + "ERROR fault\n" + "x\n".repeat(1_047_970);
      expect(Buffer.byteLength(sample)).toBe(2 * 1024 * 1024);
      const api = await h.prepare("large-dry", "Large sample", sample);
      expect((await api.request(`${api.base}/draft`, "PUT", {
        spec: { ...api.skill.currentRevision.spec, parsing: { schemaVersion: "parsing/v1", extractors: [
          { id: "value", pattern: "(?P<value>.+)", fields: { value: { type: "string" } } }
        ] } }, baseDraftRevisionId: api.revisionId, basePublishedRevisionId: api.skill.currentRevision.id
      })).status).toBe(200);
      vi.stubEnv("LOG_DECODE_MAX_EVENTS", "2");
      vi.stubEnv("LOG_DECODE_MAX_MS", "250");
      h.get.mockClear(); h.getStream.mockClear();
      const started = await api.request<Dry>(`${api.base}/dry-runs`, "POST");
      expect(started.status).toBe(202);
      await h.idle(60_000);
      expect(observed).toHaveLength(1);
      const input = observed[0];
      expect(input.parsed.rawLines.length).toBeLessThanOrEqual(400);
      expect(input.parsed.entries.length).toBeLessThanOrEqual(400);
      expect(input.files?.[0].reader).toBeDefined();
      expect(input.stats?.lineCount).toBe(1_048_571);
      expect(input.decoding?.events.length).toBeLessThanOrEqual(2);
      expect(input.decoding?.counts.errors).toMatchObject({ time_cap: 1 });
      expect(input.signalSummary?.signals.some((signal) => signal.anchors.some((anchor) => anchor.line === 601))).toBe(true);
      const finished = await api.request<Dry>(`${api.base}/dry-runs/${started.body.run.id}`);
      expect(finished.body.run).toMatchObject({ status: "complete", report: { reportContext: { lineCount: 1_048_571 } } });
      expect(finished.body.run.report?.evidence.some((item) => item.lineNumbers.includes(601))).toBe(true);
      expect(h.get).not.toHaveBeenCalled();
      expect(h.getStream).toHaveBeenCalled();
    } finally { await h.idle(); vi.unstubAllEnvs(); await h.close(); }
  }, 120_000);
});
