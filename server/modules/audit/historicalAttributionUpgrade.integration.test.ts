import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPostgresDatabase } from "../../shared/database/client";
import { applyMigrations } from "../../shared/database/migrations";
import { makeTestAuthContext } from "../../testing/authContext";
import { seedCoreGraph } from "../../testing/fixtures";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { migrationsDir, withTempDatabase } from "../../testing/tempDatabase";
import { createLocalObjectStore } from "../logs/objectStore";
import { seedHistoricalPinnedSourceFixture } from "../../testing/parameterCatalog/historicalSource";
import { listFileVersions } from "../parameter-files/repository";
import { createAuditEvent, listAuditEvents } from "./repository";

describe("populated historical-attribution upgrade", () => {
  it("marks current-at-migration names honestly, keeps missing names unknown, and preserves pinned-source guards", async () => {
    await withTempDatabase({ prefix: "history_upgrade", migrate: false }, async ({ connectionString }) => {
      const db = createPostgresDatabase(connectionString);
      const directory = await mkdtemp(join(tmpdir(), "wiseeff-history-upgrade-"));
      try {
        await applyMigrations(db, migrationsDir, { before: "0259_parameter_history_attribution.sql" });
        const organizationId = "history-upgrade", projectId = "history-project", userId = "history-author";
        await seedCoreGraph(db, { organization: { id: organizationId, name: "Migration organization" },
          projects: [{ id: projectId }], users: [{ id: userId, name: "Earlier name" }, { id: "history-missing", name: "Deleted before upgrade" }] });
        const auth = makeTestAuthContext({ organizationId, userId, roleId: "admin" });
        const storage = createLocalObjectStore(directory);
        await installDriverSourceFixture(db, auth, { subjectId: "csub_acme_power", compatible: "acme,power", businessName: "History upgrade",
          driverName: "Acme power", idempotencyKey: "history-upgrade-registration", reason: "Historical attribution upgrade" });
        const source = '/dts-v1/; / { charger { compatible = "acme,power"; iin_max = <36>; }; };';
        const { fileId, fileVersionId } = await seedHistoricalPinnedSourceFixture(db, storage, {
          organizationId, projectId, source, createdByUserId: userId,
        });
        for (const actorUserId of [userId, "history-missing"]) await createAuditEvent(db, {
          id: actorUserId, organizationId, projectId, actorUserId, actorType: "user", app: "parameters", kind: "parameter-review",
          action: "approve", severity: "Low", targetType: null, targetId: null, metadata: {}, traceId: actorUserId
        });
        await db.query("update users set name='Name at migration' where id=$1", [userId]);
        await db.query("delete from users where id='history-missing'");
        const triggerModes = () => db.query("select tgrelid::regclass::text as relation, tgname, tgenabled from pg_trigger where not tgisinternal and tgname <> 'zz_historical_attribution_capture' order by relation,tgname");
        const before = (await triggerModes()).rows;
        await applyMigrations(db, migrationsDir, { through: "0259_parameter_history_attribution.sql" });
        expect((await triggerModes()).rows).toEqual(before);
        const current = (await listAuditEvents(db, { organizationId, eventId: userId })).items[0];
        expect(current.historicalAttribution).toMatchObject({ organization: { name: "Migration organization", source: "legacy-current" },
          actors: { actor_user_id: { id: userId, name: "Name at migration", source: "legacy-current" } } });
        const missing = (await listAuditEvents(db, { organizationId, eventId: "history-missing" })).items[0];
        expect(missing).toMatchObject({ actorName: null, historicalAttribution: { actors: { actor_user_id: { id: null, name: null, source: "unknown" } } } });
        await db.query("update audit_events set actor_user_id=$1, historical_attribution='{}'::jsonb where id='history-missing'", [userId]);
        expect((await listAuditEvents(db, { organizationId, eventId: "history-missing" })).items[0]).toMatchObject({ actorName: null,
          historicalAttribution: { actors: { actor_user_id: { id: null, name: null, source: "unknown" } } } });
        expect((await listFileVersions(db, { fileId }))[0]).toMatchObject({ createdByDisplayName: "Name at migration（迁移时名称）" });
        await expect(db.transaction((tx) => tx.query("update project_parameter_file_versions set checksum='changed' where id=$1", [fileVersionId])))
          .rejects.toMatchObject({ code: "55000" });
      } finally { await db.close(); await rm(directory, { recursive: true, force: true }); }
    });
  }, 120_000);
});
