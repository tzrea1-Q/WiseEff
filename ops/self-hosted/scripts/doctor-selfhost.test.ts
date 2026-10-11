import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSelfHostDoctor } from "./doctor-selfhost";
import { normalizeAnswers } from "./selfhost-answers";
import { renderSelfHostEnv } from "./selfhost-profile";

describe("self-host doctor", () => {
  it.each([
    ["bootstrap", "postgres://wiseeff:postgres_lab_secret@postgres:5432/wiseeff", "passed"],
    ["runtime login", "postgres://wiseeff_api:independent_secret@postgres:5432/wiseeff", "passed"],
    ["interpolation", "postgres://wiseeff:${POSTGRES_PASSWORD}@postgres:5432/wiseeff", "failed"],
    ["wrong bootstrap password", "postgres://wiseeff:wrong@postgres:5432/wiseeff?probe=postgres_lab_secret", "failed"]
  ])("checks DATABASE_URL for %s", (_name, databaseUrl, status) => {
    const dir = mkdtempSync(join(tmpdir(), "wiseeff-doctor-url-"));
    const envFile = join(dir, ".env");
    const text = renderSelfHostEnv(normalizeAnswers({
      profile: "ip-lab", siteHost: "203.0.113.10", adminPassword: "ReplaceWithAStrongPassword"
    }), { postgresPassword: "postgres_lab_secret", minioPassword: "minio_lab_secret" });
    writeFileSync(envFile, text.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${databaseUrl}`));
    expect(runSelfHostDoctor(["--env-file", envFile], process.cwd()).status).toBe(status);
  });

  it("passes a generated IP lab env against the committed Caddyfile", () => {
    const dir = mkdtempSync(join(tmpdir(), "wiseeff-doctor-"));
    const envFile = join(dir, ".env");
    writeFileSync(
      envFile,
      renderSelfHostEnv(
        normalizeAnswers({
          profile: "ip-lab",
          siteHost: "203.0.113.10",
          adminPassword: "ReplaceWithAStrongPassword"
        }),
        { postgresPassword: "postgres_lab_secret", minioPassword: "minio_lab_secret" }
      )
    );
    const result = runSelfHostDoctor(["--env-file", envFile], process.cwd());
    expect(result.status).toBe("passed");
    expect(result.summary.profile).toBe("ip-lab");
    expect(result.summary.llm).toBe("skip");
  });

  it("fails when the env file is missing", () => {
    const result = runSelfHostDoctor(["--env-file", join(tmpdir(), "missing-wiseeff.env")]);
    expect(result.status).toBe("failed");
    expect(result.issues[0]?.message).toMatch(/Missing env file/);
  });
});
