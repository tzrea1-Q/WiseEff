import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createPostgresDatabase } from "../../shared/database/client";
import { applyTestMigrations, migrationsDir } from "../../testing/tempDatabase";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createUserInvocation } from "../auth/trustedInvocation";
import { saveLogSkillDraft, publishLogSkill } from "./skillsService";
import { seededChargingRuleSet } from "./chargingSignalRules";
import { provisionChargingSkill } from "./provisionChargingSkill";

const available = await isTestDatabaseAvailable();
const historical = await readFile(new URL("../../migrations/0196_seed_charging_skill.sql", import.meta.url), "utf8");
const originalSpec = { schemaVersion: "skill/v1", signalRules: JSON.parse(historical.match(/\$rules\$([\s\S]*?)\$rules\$/)![1]) };

describe.skipIf(!available)("charging seed localization migration", () => {
  it("upgrades original numeric seed names and their 0202 collision keys", async () => {
    const ephemeral = await createEphemeralTestDatabase("chargingkeys");
    const db = createPostgresDatabase(ephemeral.url);
    try {
      for (const id of ["numeric-key", "collision-key"]) await seedCoreGraph(db, { organization: { id } });
      await db.transaction(async (tx) => {
        // An existing key forces the same collision branch used by the 0202 backfill.
        await tx.query(`insert into log_domains (id, organization_id, name) values ('key-blocker', 'collision-key', '10');
          insert into log_skill_revisions (id, organization_id, skill_id, revision_number, status, spec, content_hash)
          values ('key-blocker-revision', 'collision-key', 'key-blocker', 1, 'published', '{"schemaVersion":"skill/v1"}', 'fixture')`);
        for (const id of ["numeric-key", "collision-key"]) {
          const skillId = `seed-charging:${id}`, spec = JSON.stringify(originalSpec);
          await tx.query(`insert into log_domains (id, organization_id, name, description)
            values ($1, $2, '充电 (10)', 'Charging analysis with the original charging signal rules.')`, [skillId, id]);
          await tx.query(`insert into log_skill_revisions
            (id, organization_id, skill_id, revision_number, status, spec, content_hash, published_at)
            values ($1, $2, $3, 1, 'published', $4::jsonb,
              encode(sha256(convert_to(($4::jsonb)::text, 'UTF8')), 'hex'), now())`,
          [`seed-charging-revision:${id}`, id, skillId, spec]);
        }
      });
      expect((await db.query("select skill_key from log_domains where id = 'seed-charging:numeric-key'")).rows)
        .toEqual([{ skill_key: "10" }]);
      expect((await db.query("select skill_key = '10-' || left(md5(id), 8) as collision from log_domains where id = 'seed-charging:collision-key'")).rows)
        .toEqual([{ collision: true }]);
      await db.transaction(async (tx) => {
        await tx.query("delete from schema_migrations where name = '0208_localize_seed_charging_skill.sql'");
        await applyTestMigrations(tx, migrationsDir, { through: "0208_localize_seed_charging_skill.sql" });
      });
      expect((await db.query(`select organization_id, revision_number from log_skill_revisions
        where organization_id in ('numeric-key', 'collision-key') and skill_id like 'seed-charging:%'
          and status = 'published' order by organization_id`)).rows)
        .toEqual([{ organization_id: "collision-key", revision_number: 2 }, { organization_id: "numeric-key", revision_number: 2 }]);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);

  it("preserves publication history and known 0197 metadata without audit writes, with idempotent replay", async () => {
    const ephemeral = await createEphemeralTestDatabase("charginglocalize");
    const db = createPostgresDatabase(ephemeral.url);
    try {
      for (const id of ["localize-a", "localize-b"]) await seedCoreGraph(db, { organization: { id } });
      await db.transaction(async (tx) => {
        await tx.query("delete from schema_migrations where name = '0196_seed_charging_skill.sql'");
        await applyTestMigrations(tx, migrationsDir, { through: "0196_seed_charging_skill.sql" });
        // Model the 0197 backfill at insertion time without changing frozen publications.
        await tx.query(`insert into organizations (id, name) values ('localize-0197', '0197 seed');
          insert into log_domains (id, organization_id, name, description)
          values ('seed-charging:localize-0197', 'localize-0197', '充电', 'Charging analysis with the original charging signal rules.')`);
        const spec = JSON.stringify({ ...originalSpec, knowledgeEntryIds: [] });
        await tx.query(`insert into log_skill_revisions
          (id, organization_id, skill_id, revision_number, status, spec, content_hash, published_at)
          values ('seed-charging-revision:localize-0197', 'localize-0197', 'seed-charging:localize-0197',
            1, 'published', $1::jsonb, encode(sha256(convert_to(($1::jsonb)::text, 'UTF8')), 'hex'), now())`, [spec]);
      });
      const before = (await db.query<Record<string, unknown>>("select * from log_skill_revisions where organization_id like 'localize-%' order by id")).rows;
      const audits = (await db.query("select * from audit_events order by id")).rows;
      await db.transaction(async (tx) => {
        await tx.query("delete from schema_migrations where name = '0208_localize_seed_charging_skill.sql'");
        await applyTestMigrations(tx, migrationsDir, { through: "0208_localize_seed_charging_skill.sql" });
      });
      const rows = (await db.query(`select organization_id, spec, revision_number, created_by_user_id, published_by_user_id,
        published_at is not null as published, content_hash = encode(sha256(convert_to(spec::text, 'UTF8')), 'hex') as valid_hash
        from log_skill_revisions where organization_id like 'localize-%' and status = 'published' order by organization_id`)).rows;
      expect(rows).toEqual(["localize-0197", "localize-a", "localize-b"].map((organization_id) => ({
        organization_id, spec: { schemaVersion: "skill/v1", signalRules: seededChargingRuleSet,
          ...(organization_id === "localize-0197" ? { knowledgeEntryIds: [] } : {}) },
        revision_number: 2, created_by_user_id: null, published_by_user_id: null, published: true, valid_hash: true
      })));
      expect((await db.query("select description from log_domains where organization_id like 'localize-%' order by id")).rows)
        .toEqual(Array.from({ length: 3 }, () => ({ description: "根据充电异常规则分析日志。" })));
      expect((await db.query("select * from log_skill_revisions where organization_id like 'localize-%' and status = 'superseded' order by id")).rows)
        .toEqual(before.map((row) => ({ ...row, status: "superseded" })));
      expect((await db.query("select * from audit_events order by id")).rows).toEqual(audits);
      const after = (await db.query("select * from log_skill_revisions where organization_id like 'localize-%' order by id")).rows;
      await db.transaction(async (tx) => {
        await tx.query("delete from schema_migrations where name = '0208_localize_seed_charging_skill.sql'");
        await applyTestMigrations(tx, migrationsDir, { through: "0208_localize_seed_charging_skill.sql" });
      });
      expect((await db.query("select * from log_skill_revisions where organization_id like 'localize-%' order by id")).rows).toEqual(after);
      expect((await db.query("select * from audit_events order by id")).rows).toEqual(audits);
      await expect(db.query(`insert into log_skill_revisions
        (id, organization_id, skill_id, revision_number, status, spec, content_hash)
        values ('cross-tenant', 'localize-b', 'seed-charging:localize-a', 3, 'draft', '{"schemaVersion":"skill/v1"}', 'fixture')`))
        .rejects.toMatchObject({ code: "23503" });
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);

  it("skips edited publications, authored drafts, edited identities and new runtime seeds", async () => {
    const ephemeral = await createEphemeralTestDatabase("chargingauthors");
    const db = createPostgresDatabase(ephemeral.url);
    try {
      const ids = ["author-published", "author-draft", "author-name", "author-key", "author-description", "author-content"];
      for (const id of ids) await seedCoreGraph(db, { organization: { id }, users: [{ id: `${id}-admin` }] });
      await db.transaction(async (tx) => {
        // Same original IDs are insufficient: altered seed content must also be preserved.
        const spec = JSON.stringify({ ...originalSpec, procedure: "Administrator procedure" });
        await tx.query(`insert into log_domains (id, organization_id, name, description)
          values ('seed-charging:author-content', 'author-content', '充电', 'Charging analysis with the original charging signal rules.')`);
        await tx.query(`insert into log_skill_revisions
          (id, organization_id, skill_id, revision_number, status, spec, content_hash, published_at)
          values ('seed-charging-revision:author-content', 'author-content', 'seed-charging:author-content',
            1, 'published', $1::jsonb, encode(sha256(convert_to(($1::jsonb)::text, 'UTF8')), 'hex'), now())`, [spec]);
        await tx.query("delete from schema_migrations where name = '0196_seed_charging_skill.sql'");
        await applyTestMigrations(tx, migrationsDir, { through: "0196_seed_charging_skill.sql" });
      });
      for (const id of ["author-published", "author-draft"]) {
        const auth = makeTestAuthContext({ organizationId: id, userId: `${id}-admin`,
          roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:view", "logs:admin-domains"] });
        const draft = await saveLogSkillDraft(db, auth, `seed-charging:${id}`,
          { schemaVersion: "skill/v1", procedure: "Administrator procedure" }, null,
          `seed-charging-revision:${id}`, createUserInvocation(auth), { requestId: id });
        if (id === "author-published") await publishLogSkill(db, auth, `seed-charging:${id}`,
          draft.id, createUserInvocation(auth), { requestId: id });
      }
      await db.query("update log_domains set name='管理员技能' where organization_id='author-name'");
      await db.query("update log_domains set skill_key='admin-selected-key' where organization_id='author-key'");
      await db.query("update log_domains set description='管理员说明' where organization_id='author-description'");
      await seedCoreGraph(db, { organization: { id: "new-runtime" } });
      await provisionChargingSkill(db, "new-runtime");
      const before = (await db.query("select * from log_skill_revisions order by id")).rows;
      const identities = (await db.query("select * from log_domains order by id")).rows;
      const audits = (await db.query("select * from audit_events order by id")).rows;
      await db.transaction(async (tx) => {
        await tx.query("delete from schema_migrations where name = '0208_localize_seed_charging_skill.sql'");
        await applyTestMigrations(tx, migrationsDir, { through: "0208_localize_seed_charging_skill.sql" });
      });
      expect((await db.query("select * from log_skill_revisions order by id")).rows).toEqual(before);
      expect((await db.query("select * from log_domains order by id")).rows).toEqual(identities);
      expect((await db.query("select * from audit_events order by id")).rows).toEqual(audits);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);
});
