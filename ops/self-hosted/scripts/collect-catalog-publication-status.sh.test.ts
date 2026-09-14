import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = "ops/self-hosted/scripts/collect-catalog-publication-status.sh";

const fakeCompose = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "\${WISEEFF_COLLECT_COMPOSE_LOG:?}"
for argument in "$@"; do
  case "\$argument" in
    postgres://*|postgresql://*)
      printf '%s\\n' "DSN leaked onto argv" >&2
      exit 99
      ;;
  esac
done
command=""
for argument in "$@"; do
  case "\$argument" in
    ps|images|exec|run)
      command="\$argument"
      break
      ;;
  esac
done
ops=""
saw_ops=false
for argument in "$@"; do
  if [ "\$saw_ops" = true ]; then
    ops="\$ops \$argument"
  fi
  case "\$argument" in
    *catalog-publication-ops.ts)
      saw_ops=true
      ;;
  esac
done
case "\$command" in
  ps)
    printf '%s\\n' "NAME STATUS"
    printf '%s\\n' "api running"
    exit 0
    ;;
  images)
    printf '%s\\n' "wiseeff-app:current"
    exit 0
    ;;
  exec)
    if printf '%s' "\$*" | grep -q printenv; then
      printf '%s\\n' "1"
      exit 0
    fi
    printf '%s\\n' '{"status":"ok"}'
    exit 0
    ;;
  run)
    if printf '%s' "\$*" | grep -q 'test -f scripts/catalog-publication-ops.ts'; then
      exit 0
    fi
    api_process_name=false
    api_process_one=false
    prev=""
    for argument in "$@"; do
      if [ "\$prev" = "-e" ] && [ "\$argument" = "WISEEFF_API_PROCESS" ]; then
        api_process_name=true
      fi
      if [ "\$argument" = "WISEEFF_API_PROCESS=1" ]; then
        api_process_one=true
      fi
      prev="\$argument"
    done
    if [ "\$api_process_one" = true ]; then
      printf '%s\\n' "live API process flag leaked into ops run" >&2
      exit 96
    fi
    if [ "\$api_process_name" = true ] && [ "\${WISEEFF_API_PROCESS:-}" != "0" ]; then
      printf '%s\\n' "WISEEFF_API_PROCESS must be 0 for ops run" >&2
      exit 95
    fi
    case "\$ops" in
      *"policy enable"*|*"freeze set"*|*"adopt --execute"*|*"capabilities grant"*)
        printf '%s\\n' "write command refused in collector: \$ops" >&2
        exit 98
        ;;
    esac
    case "\$ops" in
      *"inspect-login api"*)
        printf '%s\\n' '{"user":"wiseeff_api","memberOf":["catalog_publication_coordinator_role"]}'
        exit 0
        ;;
      *"inspect-login worker"*)
        printf '%s\\n' '{"user":"wiseeff_worker"}'
        exit 0
        ;;
      *"inspect-login manager"*)
        printf '%s\\n' '{"user":"wiseeff_publication_manager"}'
        exit 0
        ;;
      *"policy status"*)
        printf '%s\\n' '{"kind":"catalog-publication-policy-status","databaseOid":"12345","databaseName":"wiseeff","currentReleaseId":"crel_collect","currentReleaseDigest":"sha256:abcd","artifactDigest":"sha256:ef01","artifactSourceKind":"preexisting","adopted":false,"receiptKinds":[],"policyRevision":0,"publicationEnabled":false,"lowRiskSingleActorPublish":false,"frozen":false,"capabilityContractRevision":1}'
        printf '%s\\n' 'hint postgres://manager:s3cret@postgres:5432/wiseeff' >&2
        exit 0
        ;;
      *"freeze status"*)
        printf '%s\\n' '{"frozen":false}'
        exit 0
        ;;
      *" inspect")
        printf '%s\\n' '{"currentReleaseId":"crel_collect","digest":"sha256:abcd"}'
        exit 0
        ;;
      *"adopt --check"*)
        if ! printf '%s' "\$*" | grep -q -- '--check'; then
          printf '%s\\n' "adopt missing --check" >&2
          exit 97
        fi
        if ! printf '%s' "\$*" | grep -q '/tmp/wiseeff-collect-bundle.json'; then
          printf '%s\\n' "bundle must be mounted at /tmp/wiseeff-collect-bundle.json" >&2
          exit 94
        fi
        if ! printf '%s' "\$*" | grep -q -- '-v '; then
          printf '%s\\n' "adopt --check must pass compose -v, not bridge-artifacts" >&2
          exit 93
        fi
        printf '%s\\n' '{"ok":true,"mode":"check"}'
        exit 0
        ;;
      *"capabilities status"*)
        printf '%s\\n' '{"granted":false}'
        exit 0
        ;;
    esac
    printf '%s\\n' "unhandled ops:\$ops" >&2
    exit 1
    ;;
esac
printf '%s\\n' "unhandled compose: \$*" >&2
exit 1
`;

function runCollect(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

function seedComposeDir(directory: string) {
  mkdirSync(join(directory, "scripts"), { recursive: true });
  writeFileSync(
    join(directory, ".env"),
    [
      "DATABASE_URL=postgres://api:s3cret@postgres:5432/wiseeff",
      "WISEEFF_WORKER_DATABASE_URL=postgres://worker:w0rk@postgres:5432/wiseeff",
      ""
    ].join("\n"),
    { mode: 0o600 }
  );
  writeFileSync(
    join(directory, ".env.publication-manager"),
    [
      "WISEEFF_PUBLICATION_MANAGER_DATABASE_URL=postgres://manager:m4n@postgres:5432/wiseeff",
      "WISEEFF_UPGRADE_ACTOR_PRINCIPAL_ID=usr_operator",
      ""
    ].join("\n"),
    { mode: 0o600 }
  );
  const compose = join(directory, "scripts", "compose");
  writeFileSync(compose, fakeCompose, { mode: 0o755 });
  chmodSync(compose, 0o755);
}

describe("collect-catalog-publication-status.sh", () => {
  it("prints usage", () => {
    const result = runCollect(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Read-only");
    expect(result.stdout).toContain("--readonly-dsn-file");
    expect(result.stdout).not.toContain("postgres://");
  });

  it("refuses --bundle without a verification digest", () => {
    const result = runCollect(["--bundle", "/tmp/missing.json"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--verification-digest");
  });

  it("collects redacted pins through compose run and never writes policy", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-collect-catalog-"));
    seedComposeDir(directory);
    const argvLog = join(directory, "compose.argv");
    const outPath = join(directory, "catalog-publication-status.json");
    const readonlyFile = join(directory, "readonly.dsn");
    const bundlePath = join(directory, "bundle.json");
    writeFileSync(readonlyFile, "postgres://readonly:r3ad@postgres:5432/wiseeff\n", { mode: 0o600 });
    writeFileSync(bundlePath, '{"kind":"catalog-release-bundle"}\n', { mode: 0o600 });

    const result = runCollect(
      [
        "--out",
        outPath,
        "--readonly-dsn-file",
        readonlyFile,
        "--bundle",
        bundlePath,
        "--verification-digest",
        "sha256:deadbeef",
        "--user-id",
        "usr_admin",
        "--organization-id",
        "org_1"
      ],
      {
        WISEEFF_COLLECT_COMPOSE_DIR: directory,
        WISEEFF_COLLECT_COMPOSE: join(directory, "scripts", "compose"),
        WISEEFF_COLLECT_REPO_ROOT: directory,
        WISEEFF_COLLECT_COMPOSE_LOG: argvLog
      }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(outPath);
    expect(result.stdout).not.toMatch(/postgres:\/\/[^\s[]+/);
    expect(result.stderr).not.toMatch(/postgres:\/\/[^\s[]+/);

    const report = JSON.parse(readFileSync(outPath, "utf8")) as {
      writes: boolean;
      managerDsnConfigured: boolean;
      pinsForPolicyCheck: { expectedCurrentId: string; databaseOid: string };
      probes: Record<string, { exitCode?: number; payload?: unknown; stderr?: string }>;
      policyCheckEnableArgv: string[];
    };
    expect(report.writes).toBe(false);
    expect(report.managerDsnConfigured).toBe(true);
    expect(report.pinsForPolicyCheck.expectedCurrentId).toBe("crel_collect");
    expect(report.pinsForPolicyCheck.databaseOid).toBe("12345");
    expect(report.probes.policy_status.exitCode).toBe(0);
    expect(report.probes.adopt_check.exitCode).toBe(0);
    expect(report.probes.capability_catalog_author.exitCode).toBe(0);
    expect(JSON.stringify(report)).not.toContain("s3cret");
    expect(JSON.stringify(report)).not.toContain("postgres://manager");
    expect(report.probes.policy_status.stderr).toContain("postgres://[redacted]");
    expect(report.policyCheckEnableArgv.join(" ")).toContain("--expected-id crel_collect");
    expect(report.policyCheckEnableArgv.join(" ")).toContain("--expected-adopted false");

    const argv = readFileSync(argvLog, "utf8");
    expect(argv).toContain("policy status");
    expect(argv).toContain("adopt --check");
    expect(argv).not.toContain("policy enable");
    expect(argv).not.toContain("adopt --execute");
    expect(argv).not.toContain("capabilities grant");
    expect(argv).not.toContain("freeze set");
    expect(argv).not.toContain("postgres://");
    expect(argv).toContain("-v");
    expect(argv).toContain("/tmp/wiseeff-collect-bundle.json:ro");
    expect(argv).not.toContain("bridge-artifacts");
  });
});
