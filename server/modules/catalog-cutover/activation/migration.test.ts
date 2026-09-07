import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

it("adds an application-read pointer distinct from P5 with no runtime grants", () => {
  const sql = readFileSync(path.resolve("server/migrations/0141_parameter_catalog_application_activation.sql"), "utf8");
  for (const table of ["application_read_state", "cutover_mapping_epochs", "cutover_activation_attempts"]) {
    expect(sql).toContain(`create table parameter_catalog.${table}`);
    expect(sql).toContain(`alter table parameter_catalog.${table} owner to catalog_migration_owner`);
    expect(sql).toContain(`revoke all on parameter_catalog.${table} from public`);
  }
  expect(sql).not.toMatch(/\bgrant\b/i);
  expect(sql).not.toMatch(/(?:update|alter|delete from)\s+parameter_catalog\.catalog_state/i);
  expect(sql).toContain("references parameter_catalog.verification_reports(digest)");
  expect(sql).toContain("check (mode in ('legacy', 'canonical'))");
});

it("checks the actual management identity before every write-lock statement", () => {
  const source = readFileSync(path.resolve("server/modules/catalog-cutover/activation/index.ts"), "utf8");
  const transaction = source.slice(source.indexOf("async function withManagement"), source.indexOf("function assertOwnedPins"));
  const identity = transaction.indexOf("await readBindingDatabaseIdentity(client)");
  expect(identity).toBeGreaterThan(0);
  for (const lock of ["pg_try_advisory_xact_lock", "for update", "lock table"]) {
    expect(transaction.indexOf(lock)).toBeGreaterThan(identity);
  }
});
