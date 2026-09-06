import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createSelfHostedPg16Database } from "./database";

const probes = vi.hoisted(() => ({ docker: vi.fn(), connect: vi.fn(), query: vi.fn(), end: vi.fn() }));
vi.mock("../../../scripts/isolated-upgrade-docker", () => ({ createIsolatedUpgradeDocker: probes.docker }));
vi.mock("pg", () => ({ default: {
  Client: class {
    database: string;
    constructor(input: { connectionString: string }) { this.database = new URL(input.connectionString).pathname.slice(1); }
    connect = probes.connect; end = async () => probes.end();
    query(sql: string, values?: unknown[]) { return probes.query(sql, values, this.database); }
  },
  escapeIdentifier: (name: string) => `"${name}"`,
} }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("rejects missing private receipt before Docker or database access, even with an ambient database URL", async () => {
  vi.stubEnv("UPG_TEST_TARGET_RECEIPT", "");
  vi.stubEnv("TEST_DATABASE_URL", "postgres://private:secret@127.0.0.1:5432/production");
  await expect(createSelfHostedPg16Database("receipt_missing")).rejects.toThrow("selfhost-pg16-fixture-receipt-invalid");
  expect(probes.docker).not.toHaveBeenCalled(); expect(probes.connect).not.toHaveBeenCalled();
});

// These are controller/ownership unit counterexamples with observable fake I/O.
// The parent's PostgreSQL16 component matrix supplies the real boundary proof.
it.each(["database-oid", "system-id", "network", "receipt", "missing-trgm", "create-unknown", "drop-unknown"])("refuses %s without dropping an unowned or uncertain database", async fault => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "selfhost-pg16-receipt-test-"));
  const filename = path.join(directory, "receipt.json");
  const receipt = {
    profile: "selfhost-postgres16-alpine-v1", label: "wiseeff.upgrade.conversion", run: "conversion-ab12",
    id: "a".repeat(64), net: "b".repeat(64), daemonId: "owned", imageId: `sha256:${"c".repeat(64)}`,
    url: "postgres://test:private-secret@127.0.0.1:57123/postgres", systemIdentifier: "123456789", databaseOid: "5",
    dataVolume: { name: "owned-data", createdAt: "2026-09-06T00:00:00Z" },
  };
  const network = { Id: receipt.net, Labels: { [receipt.label]: receipt.run }, Driver: "bridge", Internal: false,
    Options: { "com.docker.network.bridge.enable_ip_masquerade": "false" }, Containers: { [receipt.id]: {} } };
  const container = { State: { Running: true, Restarting: false }, Image: receipt.imageId,
    Mounts: [{ Type: "volume", Name: receipt.dataVolume.name, Destination: "/var/lib/postgresql/data" }],
    NetworkSettings: { Networks: { fixture: { NetworkID: receipt.net } }, Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "57123" }] } } };
  const volume = { Name: receipt.dataVolume.name, CreatedAt: receipt.dataVolume.createdAt, Driver: "local", Options: null, Labels: { [receipt.label]: receipt.run } };
  const command = vi.fn((args: string[]) => {
    if (args[0] === "ps") return Buffer.from(receipt.id);
    if (args[0] === "network") return Buffer.from(JSON.stringify([network]));
    if (args[0] === "volume") return Buffer.from(JSON.stringify([volume]));
    if (args[0] === "image") return Buffer.from(JSON.stringify([{ Id: receipt.imageId }]));
    throw new Error("unexpected-unit-docker-command");
  });
  probes.docker.mockReturnValue({ daemonId: receipt.daemonId, assertOwned: () => container, command });
  let oid = "20000"; let system = receipt.systemIdentifier;
  const drops: string[] = []; const creates: string[] = [];
  probes.query.mockImplementation(async (sql: string, _values: unknown[], database: string) => {
    if (sql.includes("from pg_control_system()")) return { rows: [{ system_id: system, database_oid: database === "postgres" ? "5" : oid, version: 160009 }] };
    if (sql.includes("pg_available_extensions")) return { rows: fault === "missing-trgm" ? [] : [{ name: "pg_trgm" }] };
    if (sql.startsWith("create database")) { creates.push(sql); if (fault === "create-unknown") throw new Error("private-secret"); return { rows: [] }; }
    if (sql.startsWith("drop database")) { drops.push(sql); if (fault === "drop-unknown") throw new Error("private-secret"); return { rows: [] }; }
    if (sql.startsWith("select oid::text as oid")) return { rows: [{ oid, owner: "10" }] };
    if (sql.includes("pg_stat_activity")) return { rows: [{ n: 0 }] };
    if (sql.includes("object_count")) return { rows: [{ object_count: "0" }] };
    if (sql.includes("select extversion")) return { rows: [{ extversion: "1.6" }] };
    if (sql.includes("select similarity")) return { rows: [{ value: 1 }] };
    if (["create extension pg_trgm", "drop extension pg_trgm"].includes(sql)) return { rows: [] };
    throw new Error("unexpected-unit-query");
  });
  try {
    await writeFile(filename, JSON.stringify(receipt), { mode: 0o600 });
    vi.stubEnv("UPG_TEST_TARGET_RECEIPT", filename); vi.stubEnv("TEST_DATABASE_URL", receipt.url); vi.stubEnv("DATABASE_URL", "");
    if (fault === "missing-trgm" || fault === "create-unknown") {
      await expect(createSelfHostedPg16Database("fault")).rejects.toThrow(fault === "missing-trgm" ? "extension-profile-unsupported" : "database-outcome-unknown");
      expect(drops).toEqual([]); expect(creates).toHaveLength(fault === "missing-trgm" ? 0 : 1); return;
    }
    const fixture = await createSelfHostedPg16Database("fault");
    if (fault === "database-oid") oid = "20001";
    if (fault === "system-id") system = "other-system";
    if (fault === "network") network.Id = "d".repeat(64);
    if (fault === "receipt") await writeFile(filename, JSON.stringify({ ...receipt, databaseOid: "6" }));
    await expect(fixture.close()).rejects.toThrow(fault === "drop-unknown" ? "database-outcome-unknown"
      : fault === "database-oid" ? "database-ownership-drift" : fault === "system-id" ? "database-identity-drift" : "target-drift");
    expect(drops).toHaveLength(fault === "drop-unknown" ? 1 : 0);
    if (fault === "drop-unknown") {
      await expect(fixture.close()).rejects.toThrow("database-outcome-unknown");
      expect(drops).toHaveLength(1);
    }
  } finally { await rm(directory, { recursive: true }); }
});

it.each(["profile", "url-host", "url-query", "volume", "system-id", "mode"])("rejects unsupported %s before opening Docker or PostgreSQL", async fault => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "selfhost-pg16-receipt-test-"));
  const filename = path.join(directory, "receipt.json");
  const receipt = {
    profile: "selfhost-postgres16-alpine-v1", label: "wiseeff.upgrade.conversion", run: "conversion-ab12",
    id: "a".repeat(64), net: "b".repeat(64), daemonId: "owned", imageId: `sha256:${"c".repeat(64)}`,
    url: "postgres://test:private-secret@127.0.0.1:57123/postgres", systemIdentifier: "123456789", databaseOid: "5",
    dataVolume: { name: "owned-data", createdAt: "2026-09-06T00:00:00Z" },
  };
  try {
    if (fault === "profile") receipt.profile = "catalog-pgvector";
    if (fault === "url-host") receipt.url = "postgres://test:private-secret@production/postgres";
    if (fault === "url-query") receipt.url += "?host=production";
    if (fault === "volume") receipt.dataVolume.name = "";
    if (fault === "system-id") receipt.systemIdentifier = "";
    await writeFile(filename, JSON.stringify(receipt), { mode: fault === "mode" ? 0o644 : 0o600 });
    vi.stubEnv("UPG_TEST_TARGET_RECEIPT", filename); vi.stubEnv("TEST_DATABASE_URL", receipt.url); vi.stubEnv("DATABASE_URL", "");
    await expect(createSelfHostedPg16Database("invalid_receipt")).rejects.toThrow("selfhost-pg16-fixture-receipt-invalid");
    expect(probes.docker).not.toHaveBeenCalled(); expect(probes.connect).not.toHaveBeenCalled();
  } finally { await rm(directory, { recursive: true }); }
});
