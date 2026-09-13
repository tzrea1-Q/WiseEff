import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  CATALOG_BASELINE_READER_ROLE,
  CATALOG_MIGRATION_OWNER,
  CATALOG_PUBLICATION_COORDINATOR_ROLE,
  CATALOG_RELATIONS,
  CATALOG_SYNCHRONIZER_ROLE,
  PARAMETER_GOVERNANCE_WRITER_ROLE,
  quoteIdent,
} from "../../catalog-kernel/security/catalogRoleManifest";
import { captureDatabaseError } from "../persistence/integrationHarness";
import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import {
  dropLabRuntimeLogins,
  inspectLoginBoundary,
  provisionPublicationRuntimeLogins,
} from "./provisionRuntimeLogins";
import { resolvePublicationManagerDatabaseUrl } from "./managerDatabaseUrl";

const token = `t${randomBytes(5).toString("hex")}`;

describe("publication runtime logins", () => {
  let url: string;
  let drop: () => Promise<void>;
  let provisioned: Awaited<ReturnType<typeof provisionPublicationRuntimeLogins>>;

  beforeAll(async () => {
    const opened = await createEphemeralTestDatabase("ra04login");
    url = opened.url;
    drop = opened.drop;
    provisioned = await provisionPublicationRuntimeLogins(url, { mode: "lab", runToken: token });
  }, 120_000);

  afterAll(async () => {
    const cleanup = await dropLabRuntimeLogins(url, token);
    if (cleanup.failed.length > 0) {
      throw new Error(`lab LOGIN cleanup failed: ${cleanup.failed.join(",")}`);
    }
    await drop?.();
  });

  it("refuses manager DSN reuse of the API login", () => {
    const reused = resolvePublicationManagerDatabaseUrl({
      DATABASE_URL: provisioned.apiUrl,
      WISEEFF_PUBLICATION_MANAGER_DATABASE_URL: provisioned.apiUrl,
    });
    expect(reused.ok).toBe(false);
    const dedicated = resolvePublicationManagerDatabaseUrl({
      DATABASE_URL: provisioned.apiUrl,
      WISEEFF_PUBLICATION_MANAGER_DATABASE_URL: provisioned.managerUrl,
    });
    expect(dedicated.ok).toBe(true);
  });

  it("proves API, worker, and manager SET ROLE boundaries on real connections", async () => {
    const api = await inspectLoginBoundary(provisioned.apiUrl);
    const worker = await inspectLoginBoundary(provisioned.workerUrl);
    const manager = await inspectLoginBoundary(provisioned.managerUrl);
    expect(api.superuser).toBe(false);
    expect(worker.superuser).toBe(false);
    expect(manager.superuser).toBe(false);
    expect(api.inherit).toBe(false);
    expect(worker.inherit).toBe(false);
    expect(manager.inherit).toBe(false);
    expect(api.memberOf).toContain(CATALOG_PUBLICATION_COORDINATOR_ROLE);
    expect(api.memberOf).toContain(CATALOG_BASELINE_READER_ROLE);
    expect(api.memberOf).toContain(PARAMETER_GOVERNANCE_WRITER_ROLE);
    expect(api.memberOf).not.toContain(CATALOG_SYNCHRONIZER_ROLE);
    expect(worker.memberOf).not.toContain(CATALOG_SYNCHRONIZER_ROLE);
    expect(worker.memberOf).not.toContain(CATALOG_PUBLICATION_COORDINATOR_ROLE);
    expect(worker.memberOf).not.toContain(PARAMETER_GOVERNANCE_WRITER_ROLE);
    expect(manager.memberOf).toContain(CATALOG_PUBLICATION_COORDINATOR_ROLE);
    expect(manager.memberOf).toContain(CATALOG_SYNCHRONIZER_ROLE);
    expect(api.catalogDml.filter((entry) => CATALOG_RELATIONS.some((rel) => entry.startsWith(`${rel}:`)))).toEqual([]);
    expect(api.publicationDml).toEqual([]);
    expect(worker.catalogDml).toEqual([]);
    expect(manager.catalogDml).toEqual([]);

    const apiClient = new pg.Client({ connectionString: provisioned.apiUrl });
    await apiClient.connect();
    try {
      await apiClient.query(`set role ${quoteIdent(CATALOG_PUBLICATION_COORDINATOR_ROLE)}`);
      const denied = await captureDatabaseError(
        apiClient.query(`set role ${quoteIdent(CATALOG_SYNCHRONIZER_ROLE)}`),
      );
      expect(denied.code).toBe("42501");
    } finally {
      await apiClient.end();
    }

    const workerClient = new pg.Client({ connectionString: provisioned.workerUrl });
    await workerClient.connect();
    try {
      const deniedCoordinator = await captureDatabaseError(
        workerClient.query(`set role ${quoteIdent(CATALOG_PUBLICATION_COORDINATOR_ROLE)}`),
      );
      expect(deniedCoordinator.code).toBe("42501");
      const deniedSynchronizer = await captureDatabaseError(
        workerClient.query(`set role ${quoteIdent(CATALOG_SYNCHRONIZER_ROLE)}`),
      );
      expect(deniedSynchronizer.code).toBe("42501");
    } finally {
      await workerClient.end();
    }

    const managerClient = new pg.Client({ connectionString: provisioned.managerUrl });
    await managerClient.connect();
    try {
      await managerClient.query("begin");
      await managerClient.query(`set local role ${quoteIdent(CATALOG_PUBLICATION_COORDINATOR_ROLE)}`);
      await managerClient.query("rollback");
      await managerClient.query("begin");
      await managerClient.query(`set local role ${quoteIdent(CATALOG_SYNCHRONIZER_ROLE)}`);
      await managerClient.query("rollback");
      const deniedOwner = await captureDatabaseError(
        managerClient.query(`set role ${quoteIdent(CATALOG_MIGRATION_OWNER)}`),
      );
      expect(deniedOwner.code).toBe("42501");
    } finally {
      await managerClient.end();
    }

    const apiOwner = new pg.Client({ connectionString: provisioned.apiUrl });
    await apiOwner.connect();
    try {
      const deniedOwner = await captureDatabaseError(
        apiOwner.query(`set role ${quoteIdent(CATALOG_MIGRATION_OWNER)}`),
      );
      expect(deniedOwner.code).toBe("42501");
    } finally {
      await apiOwner.end();
    }
  });
});
