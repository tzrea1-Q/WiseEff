import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { openRuntimeDatabase } from "./runtimeConnection";

describe("runtime connection bootstrap", () => {
  it("closes the real pool before exposing a privileged production login", async () => {
    const close = vi.fn(async () => undefined);
    const query = vi.fn(async () => ({ rows: [{ same_identity: true, privileged_roles: 1, management_roles: 0, owned_objects: 0, catalog_present: false }], rowCount: 1 }));
    const create = vi.fn(() => ({ query, close }));
    await expect(openRuntimeDatabase({ connectionString: "private", nodeEnv: "production" }, create as never))
      .rejects.toMatchObject({ code: "PCAT-RUNTIME-PRIVILEGED-LOGIN" });
    expect(close).toHaveBeenCalledOnce();
  });
  it.each([
    [{ same_identity: false }, "PCAT-RUNTIME-LOGIN-IDENTITY-MISMATCH"],
    [{ management_roles: 1 }, "PCAT-RUNTIME-MANAGEMENT-ROLE-REACHABLE"],
    [{ owned_objects: 1 }, "PCAT-RUNTIME-OBJECT-OWNER"],
    [{ catalog_present: true }, "PCAT-RUNTIME-LIVE-PIN-ADAPTER-UNAVAILABLE"],
  ])("refuses unsafe startup facts %j", async (extra, code) => {
    const db = { close: vi.fn(async () => undefined), query: vi.fn(async () => ({ rows: [{ same_identity: true, privileged_roles: 0, management_roles: 0, owned_objects: 0, catalog_present: false, ...extra }] })) };
    await expect(openRuntimeDatabase({ connectionString: "secret", nodeEnv: "production" }, (() => db) as never))
      .rejects.toMatchObject({ code });
    expect(db.close).toHaveBeenCalledOnce();
  });
  it("exposes only the checked login pool and sanitizes an unreadable identity", async () => {
    const db = { close: vi.fn(async () => undefined), query: vi.fn(async () => { throw new Error("private connection password"); }) };
    await expect(openRuntimeDatabase({ connectionString: "secret", nodeEnv: "production" }, (() => db) as never))
      .rejects.toMatchObject({ message: "PCAT-RUNTIME-BOOTSTRAP-QUERY-FAILED" });
    expect(db.close).toHaveBeenCalledOnce();
  });
  it("never emits a credential-bearing constructor exception", async () => {
    await expect(openRuntimeDatabase({ connectionString: "private credential", nodeEnv: "production" }, (() => { throw new Error("private credential"); }) as never))
      .rejects.toMatchObject({ message: "PCAT-RUNTIME-BOOTSTRAP-QUERY-FAILED" });
  });
  it("the actual production API process rejects missing DATABASE_URL before fallback", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", path.resolve("server/index.ts")], {
      encoding: "utf8", timeout: 20000, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "production" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL is required in production");
    expect(result.stdout).not.toContain("listening");
  });
});
