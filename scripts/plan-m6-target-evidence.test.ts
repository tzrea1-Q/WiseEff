import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildM6TargetEvidencePlan,
  loadM6TargetEvidencePlanEnv,
  renderM6TargetEvidencePlanMarkdown
} from "./plan-m6-target-evidence";

describe("M6 target evidence execution plan", () => {
  it("orders M6.2 through M6.6 target evidence commands with audit-ready evidence paths", () => {
    const plan = buildM6TargetEvidencePlan({
      env: {
        WISEEFF_API_BASE_URL: "https://wiseeff.example.test?token=secret",
        AUTH_OIDC_ISSUER: "https://id.example.test/realms/wiseeff",
        AUTH_OIDC_AUDIENCE: "wiseeff-api",
        M6_IDENTITY_AUTHORIZATION: "Bearer abc.def.ghi",
        M6_IDENTITY_WRONG_ISSUER_AUTHORIZATION: "Bearer wrong.issuer.token",
        M6_IDENTITY_WRONG_AUDIENCE_AUTHORIZATION: "Bearer wrong.audience.token",
        M6_IDENTITY_EXPIRED_AUTHORIZATION: "Bearer expired.token",
        RESTORE_DATABASE_URL: "postgres://restore.example.test/wiseeff_restore",
        RESTORE_OBJECT_STORAGE_BUCKET: "wiseeff-restore",
        RESTORE_OBJECT_STORAGE_PREFIX: "m6-restore/",
        WISEEFF_CAPACITY_TARGET_URL: "https://wiseeff.example.test"
      }
    });

    expect(plan.status).toBe("ready");
    expect(plan.steps.map((step) => step.phase)).toEqual(["M6.2", "M6.3", "M6.4", "M6.5", "M6.6"]);
    expect(plan.steps[0].commands).toContain("npm run identity:check");
    expect(plan.steps[1].commands).toEqual(["npm run restore:drill", "npm run backup:drill", "npm run backup:check"]);
    expect(plan.steps[2].commands).toContain("npm run queue:check -- --base-url https://wiseeff.example.test");
    expect(plan.steps[4].commands).toContain("npm run m6:target-evidence");
    expect(plan.steps.flatMap((step) => step.evidencePaths)).toEqual(
      expect.arrayContaining([
        "docs/generated/m6-identity-evidence.md",
        "docs/generated/m6-backup-restore-evidence.md",
        "docs/generated/m6-queue-readiness-evidence.md",
        "docs/generated/m6-observability-evidence.md",
        "docs/generated/m6-rollback-rehearsal-evidence.md",
        "docs/generated/capacity-gate.md",
        "docs/generated/m6-release-readiness.md",
        "docs/generated/m6-target-evidence-summary.md"
      ])
    );
  });

  it("keeps local evidence separate from target evidence and reports missing target inputs", () => {
    const plan = buildM6TargetEvidencePlan({
      env: {
        WISEEFF_API_BASE_URL: "http://127.0.0.1:8787",
        AUTH_OIDC_ISSUER: "",
        AUTH_OIDC_AUDIENCE: "",
        M6_IDENTITY_AUTHORIZATION: "",
        RESTORE_DATABASE_URL: "",
        RESTORE_OBJECT_STORAGE_BUCKET: "",
        RESTORE_OBJECT_STORAGE_PREFIX: ""
      }
    });

    expect(plan.status).toBe("blocked");
    expect(plan.blockers).toEqual(
      expect.arrayContaining([
        "M6.2 missing AUTH_OIDC_ISSUER.",
        "M6.2 missing AUTH_OIDC_AUDIENCE.",
        "M6.2 missing M6_IDENTITY_AUTHORIZATION.",
        "M6.3 missing RESTORE_DATABASE_URL.",
        "M6.3 missing RESTORE_OBJECT_STORAGE_BUCKET.",
        "M6.3 missing RESTORE_OBJECT_STORAGE_PREFIX.",
        "M6.4 requires a non-local WISEEFF_API_BASE_URL or --base-url target.",
        "M6.6 missing WISEEFF_CAPACITY_TARGET_URL or WISEEFF_API_BASE_URL."
      ])
    );
    expect(plan.steps[0].evidencePaths).not.toContain("docs/generated/m6-local-oidc-identity-evidence.md");
    expect(plan.steps[0].notes).toContain(
      "docs/generated/m6-local-oidc-identity-evidence.md is local implementation proof only and is not accepted as target evidence."
    );
  });

  it("renders a redacted operator runbook", () => {
    const plan = buildM6TargetEvidencePlan({
      env: {
        WISEEFF_API_BASE_URL: "https://wiseeff.example.test?token=secret",
        VITE_WISEEFF_API_BASE_URL:
          "https://wiseeff.example.test?access_token=browser-token&refresh_token=refresh-secret&id_token=id-secret",
        AUTH_OIDC_ISSUER: "https://id.example.test/realms/wiseeff?client_secret=abc123",
        AUTH_OIDC_AUDIENCE: "wiseeff-api",
        M6_IDENTITY_AUTHORIZATION: "Bearer abc.def.ghi",
        M6_IDENTITY_WRONG_ISSUER_AUTHORIZATION: "Bearer wrong.issuer.token",
        M6_IDENTITY_WRONG_AUDIENCE_AUTHORIZATION: "Bearer wrong.audience.token",
        M6_IDENTITY_EXPIRED_AUTHORIZATION: "Bearer expired.token",
        RESTORE_DATABASE_URL: "postgres://wiseeff:db-secret@restore.example.test/wiseeff_restore",
        RESTORE_OBJECT_STORAGE_BUCKET: "wiseeff-restore",
        RESTORE_OBJECT_STORAGE_PREFIX: "m6-restore/",
        BACKUP_DATABASE_TARGET: "postgres://backup.example.test/wiseeff?aws_access_key_id=aws-key-id",
        BACKUP_OBJECT_STORAGE_TARGET: "s3://wiseeff-backup/m6?access_key=minio-key&private_key=minio-private",
        WISEEFF_CAPACITY_TARGET_URL: "https://wiseeff.example.test?api_key=plain&accessKeyId=camel-key-id"
      }
    });
    const markdown = renderM6TargetEvidencePlanMarkdown({
      date: "2026-06-04T00:00:00.000Z",
      plan
    });

    expect(markdown).toContain("## M6 Target Evidence Execution Plan");
    expect(markdown).toContain("Status: `ready`");
    expect(markdown).toContain("token=<redacted>");
    expect(markdown).toContain("client_secret=<redacted>");
    expect(markdown).toContain("api_key=<redacted>");
    expect(markdown).toContain("access_token=<redacted>");
    expect(markdown).toContain("refresh_token=<redacted>");
    expect(markdown).toContain("id_token=<redacted>");
    expect(markdown).toContain("access_key=<redacted>");
    expect(markdown).toContain("private_key=<redacted>");
    expect(markdown).toContain("aws_access_key_id=<redacted>");
    expect(markdown).toContain("accessKeyId=<redacted>");
    expect(markdown).not.toContain("abc.def.ghi");
    expect(markdown).not.toContain("plain");
    expect(markdown).not.toContain("db-secret");
    expect(markdown).not.toContain("browser-token");
    expect(markdown).not.toContain("refresh-secret");
    expect(markdown).not.toContain("id-secret");
    expect(markdown).not.toContain("minio-key");
    expect(markdown).not.toContain("minio-private");
    expect(markdown).not.toContain("aws-key-id");
    expect(markdown).not.toContain("camel-key-id");
    expect(markdown).toContain("postgres://<redacted>@restore.example.test/wiseeff_restore");
    expect(markdown).not.toContain("secret`");
  });

  it("exposes the target evidence plan as a package script", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(packageJson.scripts).toMatchObject({
      "m6:target-plan": "tsx scripts/plan-m6-target-evidence.ts"
    });
  });

  it("loads target inputs from an env file without leaking process secrets into the plan", () => {
    const env = loadM6TargetEvidencePlanEnv({
      args: ["--env-file", "target.env"],
      processEnv: {
        WISEEFF_API_BASE_URL: "https://process.example.test",
        SHOULD_NOT_COPY: "secret"
      },
      readFile: (filePath) => {
        expect(filePath).toBe("target.env");
        return [
          "WISEEFF_API_BASE_URL=https://target.example.test",
          "AUTH_OIDC_ISSUER=https://id.example.test/realms/wiseeff",
          "AUTH_OIDC_AUDIENCE=wiseeff-api",
          "M6_IDENTITY_AUTHORIZATION=Bearer from.file",
          "RESTORE_DATABASE_URL=postgres://restore.example.test/wiseeff_restore",
          "RESTORE_OBJECT_STORAGE_BUCKET=wiseeff-restore",
          "RESTORE_OBJECT_STORAGE_PREFIX=m6-restore/"
        ].join("\n");
      },
      exists: () => true
    });

    expect(env.WISEEFF_API_BASE_URL).toBe("https://target.example.test");
    expect(env.SHOULD_NOT_COPY).toBeUndefined();
  });
});
