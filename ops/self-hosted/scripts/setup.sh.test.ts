import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEnvText } from "./ip-lab-profile";
import { normalizeAnswers } from "./selfhost-answers";
import { renderSelfHostEnv } from "./selfhost-profile";

const script = "ops/self-hosted/scripts/setup.sh";
const fallbackCommand = `
  function command() {
    if [[ "\${TEST_NO_HOST_NODE:-}" == 1 && "\${1:-}" == -v && "\${2:-}" == node ]]; then return 1; fi
    builtin command "$@"
  }
  function [() {
    if [[ "\${1:-}" == -x && "\${2:-}" == */node_modules/.bin/tsx ]]; then return 1; fi
    builtin [ "$@"
  }
  export -f [ command
  bash "$@"
`;

function runSetup(args: string[], env: NodeJS.ProcessEnv = {}, shell = "bash") {
  return spawnSync(shell, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

describe("setup.sh", () => {
  describe.each(["bash", "tsx", "doctor fallback", "bash without Node", "doctor without Node", "bash without Node using base image"])("%s preflight", (mode) => {
    it.each([
      ["bootstrap query password override", "postgres://wiseeff:postgres_lab_secret@postgres/wiseeff?password=wrong", 1],
      ["runtime query user override", "postgres://wiseeff_api:independent_secret@postgres/wiseeff?user=other", 1],
      ["bootstrap", "postgres://wiseeff:postgres_lab_secret@postgres:5432/wiseeff", 0],
      ["runtime login", "postgres://wiseeff_api:independent_secret@postgres:5432/wiseeff", 0],
      ["interpolation", "postgres://wiseeff:${POSTGRES_PASSWORD}@postgres:5432/wiseeff", 1],
      ["wrong bootstrap password", "postgres://wiseeff:wrong@postgres:5432/wiseeff?probe=postgres_lab_secret", 1],
      ["hostname substring", "postgres://wiseeff:wrong@postgres_lab_secret:5432/wiseeff", 1],
      ["password substring", "postgres://wiseeff:prefix_postgres_lab_secret_suffix@postgres/wiseeff", 1],
      ["malformed URL", "postgres_lab_secret", 1],
      ["wrong protocol", "https://wiseeff:postgres_lab_secret@postgres/wiseeff", 1],
      ["missing hostname", "postgres:///wiseeff?probe=postgres_lab_secret", 1],
      ["invalid port", "postgres://wiseeff:postgres_lab_secret@postgres:99999/wiseeff", 1],
      ["invalid encoding", "postgres://wiseeff_api:bad%XX@postgres/wiseeff", 1],
      ["unrecognized role", "postgres://other:postgres_lab_secret@postgres/wiseeff", 1],
      ["worker role", "postgres://wiseeff_worker:postgres_lab_secret@postgres/wiseeff", 1],
      ["empty runtime password", "postgres://wiseeff_api@postgres/wiseeff?probe=postgres_lab_secret", 1],
      ["same password bytes for runtime role", "postgres://wiseeff_api:postgres_lab_secret@postgres/wiseeff", 0],
      ["interpolated query", "postgres://wiseeff:postgres_lab_secret@postgres/wiseeff?probe=${VALUE}", 1],
      ["encoded interpolation", "postgres://wiseeff_api:%24%7BPASSWORD%7D@postgres/wiseeff", 1],
      ["decoded bootstrap credential", "postgresql://wiseeff:%70ostgres_lab_secret@postgres/wiseeff", 0],
      ["encoded runtime credential and IPv6", "postgresql://%77iseeff_api:runtime%3A%40%2F%25@[::1]:5432/wiseeff", 0]
    ])("checks DATABASE_URL for %s", (_name, databaseUrl, status) => {
      const fixture = preflightFixture(databaseUrl);
      if (mode.includes("base image")) {
        fixture.env.TEST_LOCAL_IMAGE = "base";
      }
      const result = mode.startsWith("doctor") || mode.includes("without Node")
        ? spawnSync("/bin/bash", ["-c", fallbackCommand, "preflight-fallback", ...(mode.startsWith("doctor")
            ? ["ops/self-hosted/scripts/doctor.sh", "--env-file", fixture.envFile]
            : [script, "--non-interactive", "preflight", "--env-file", fixture.envFile])], {
            encoding: "utf8", env: { ...fixture.env, TEST_NO_HOST_NODE: mode.includes("without Node") ? "1" : "0" }
          })
        : runSetup(["--non-interactive", "preflight", "--env-file", fixture.envFile], {
            ...fixture.env, WISEEFF_SETUP_RENDER: mode
          });
      expect(result.status, result.stderr).toBe(status);
      expect(`${result.stdout}\n${result.stderr}`).not.toContain(databaseUrl);
      expect(`${result.stdout}\n${result.stderr}`).not.toContain("independent_secret");
      if (mode.includes("without Node")) {
        const calls = readFileSync(fixture.dockerLog, "utf8");
        expect(calls).toContain("run-parser run --rm --pull never");
        expect(calls).toContain(mode.includes("base image") ? "local-base-image" : "local-app-image");
      }
    });
  });

  it("prepares the verified bundle before the first build on a cold Docker-only host", () => {
    const fixture = preflightFixture("postgres://wiseeff_api:postgres_lab_secret@postgres/wiseeff");
    const result = spawnSync("/bin/bash", ["-c", fallbackCommand, "cold-setup", script,
      "--non-interactive", "all", "--skip-provision", "--env-file", fixture.envFile], {
      encoding: "utf8",
      env: { ...fixture.env, TEST_NO_HOST_NODE: "1", TEST_LOCAL_IMAGE: "cold" }
    });
    expect(result.status, result.stderr).toBe(0);
    const calls = readFileSync(fixture.dockerLog, "utf8");
    expect(calls).toContain("bundle-load");
    expect(calls).toContain("bundle-tag");
    expect(calls).toContain("up -d --build postgres redis minio minio-init");
    expect(calls.indexOf("bundle-load")).toBeLessThan(calls.indexOf("up -d --build"));
  });

  it("starts and migrates without --build under Bash 3.2 nounset", () => {
    const fixture = preflightFixture("postgres://wiseeff:postgres_lab_secret@postgres:5432/wiseeff");
    const result = runSetup(["--non-interactive", "up", "--skip-build", "--env-file", fixture.envFile], fixture.env, "/bin/bash");
    expect(result.stderr).not.toContain("unbound variable");
    expect(result.status, result.stderr).toBe(0);
    const calls = readFileSync(fixture.dockerLog, "utf8");
    expect(calls).toContain("up -d postgres redis minio minio-init");
    expect(calls).toContain("run --rm --no-deps -e DATABASE_URL api npm run db:migrate");
    expect(calls).toContain("up -d api worker publication-manager web proxy");
    expect(calls).not.toContain("--build");
  });

  it("retains --build for the normal startup path", () => {
    const fixture = preflightFixture("postgres://wiseeff_api:independent_secret@postgres:5432/wiseeff");
    const result = runSetup(["--non-interactive", "up", "--env-file", fixture.envFile], fixture.env, "/bin/bash");
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(fixture.dockerLog, "utf8")).toContain("up -d --build postgres redis minio minio-init");
  });

  it("documents the private build-network contract", () => {
    const result = runSetup(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--build-network-file");
    expect(result.stdout).toContain("--allow-insecure-build");
  });

  it("refuses an insecure setup build without explicit per-command authorization", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-setup-insecure-build-"));
    const envFile = join(directory, "runtime.env");
    const buildNetworkFile = join(directory, "build-network.env");
    writeFileSync(
      envFile,
      [
        "WISEEFF_SITE_HOST=203.0.113.10",
        "WISEEFF_PUBLIC_URL=http://203.0.113.10",
        "WISEEFF_CADDYFILE=Caddyfile.ip-lab",
        "POSTGRES_PASSWORD=probe",
        "DATABASE_URL=postgres://wiseeff:probe@postgres:5432/wiseeff",
        "AUTH_PROVIDER=local",
        ""
      ].join("\n"),
      { mode: 0o600 }
    );
    writeFileSync(buildNetworkFile, "WISEEFF_BUILD_TLS_POLICY=insecure\n", { mode: 0o600 });
    chmodSync(buildNetworkFile, 0o600);

    const result = runSetup(
      ["--non-interactive", "up", "--env-file", envFile, "--build-network-file", buildNetworkFile],
      {
        WISEEFF_SETUP_RENDER: "bash",
        WISEEFF_OPERATION_LOCK_DIR: join(directory, "lock"),
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        ALL_PROXY: "",
        NO_PROXY: "",
        http_proxy: "",
        https_proxy: "",
        all_proxy: "",
        no_proxy: ""
      }
    );

    expect(result.status).toBe(10);
    expect(result.stderr).toContain("--allow-insecure-build");
  });

  it("loads the private build-network contract before setup preflight succeeds", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-setup-build-network-"));
    const envFile = join(directory, "runtime.env");
    const buildNetworkFile = join(directory, "build-network.env");
    writeFileSync(
      envFile,
      [
        "WISEEFF_SITE_HOST=203.0.113.10",
        "WISEEFF_PUBLIC_URL=http://203.0.113.10",
        "WISEEFF_CADDYFILE=Caddyfile.ip-lab",
        "POSTGRES_PASSWORD=probe",
        "DATABASE_URL=postgres://wiseeff:probe@postgres:5432/wiseeff",
        "AUTH_PROVIDER=local",
        ""
      ].join("\n"),
      { mode: 0o600 }
    );
    writeFileSync(buildNetworkFile, "HTTPS_PROXY=http://operator:secret@proxy.example.com:8080\n", {
      mode: 0o644
    });
    chmodSync(buildNetworkFile, 0o644);

    const result = runSetup(
      ["--non-interactive", "preflight", "--env-file", envFile, "--build-network-file", buildNetworkFile],
      {
        WISEEFF_SETUP_RENDER: "bash",
        WISEEFF_OPERATION_LOCK_DIR: join(directory, "lock"),
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        ALL_PROXY: "",
        NO_PROXY: "",
        http_proxy: "",
        https_proxy: "",
        all_proxy: "",
        no_proxy: ""
      }
    );

    expect(result.status).toBe(10);
    expect(result.stderr).toContain("mode 644");
    expect(result.stdout).not.toContain("Preflight passed");
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("operator:secret");
  });

  it("prints a Quick IP lab env from flags", () => {
    const result = runSetup([
      "--non-interactive",
      "--print-env",
      "--profile",
      "ip-lab",
      "--ip",
      "203.0.113.10",
      "--admin-password",
      "ReplaceWithAStrongPassword"
    ]);
    expect(result.status).toBe(0);
    const env = parseEnvText(result.stdout);
    expect(env.WISEEFF_DEPLOY_PROFILE).toBe("ip-lab");
    expect(env.WISEEFF_PUBLIC_URL).toBe("http://203.0.113.10");
    expect(env.DATABASE_URL).toContain(env.POSTGRES_PASSWORD);
    expect(env.XIAOZE_DETERMINISTIC).toBe("true");
    expect(env.WISEEFF_LAB_SEED).toBe("chargelab");
  });

  it("prints an ACME env from the bash renderer", () => {
    const result = runSetup(
      [
        "--non-interactive",
        "--print-env",
        "--profile",
        "acme",
        "--host",
        "wiseeff.example.com",
        "--tls-email",
        "ops@example.com",
        "--admin-password",
        "ReplaceWithAStrongPassword"
      ],
      { WISEEFF_SETUP_RENDER: "bash" }
    );
    expect(result.status).toBe(0);
    const env = parseEnvText(result.stdout);
    expect(env.WISEEFF_DEPLOY_PROFILE).toBe("acme");
    expect(env.WISEEFF_CADDYFILE).toBe("Caddyfile.example");
    expect(env.WISEEFF_PUBLIC_URL).toBe("https://wiseeff.example.com");
    expect(env.DATABASE_URL).not.toContain("${");
  });

  it("exits 2 when non-interactive setup has no host and no env", () => {
    const result = runSetup(["--non-interactive", "init", "--env-file", "/tmp/wiseeff-does-not-exist.env"]);
    expect(result.status).toBe(2);
  });

  it("backfills an unconfigured manager env without copying DATABASE_URL when .env already exists", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-setup-manager-backfill-"));
    const envFile = join(directory, "runtime.env");
    const managerEnv = join(directory, ".env.publication-manager");
    writeFileSync(
      envFile,
      [
        "WISEEFF_SITE_HOST=203.0.113.10",
        "WISEEFF_PUBLIC_URL=http://203.0.113.10",
        "POSTGRES_PASSWORD=probe",
        "DATABASE_URL=postgres://wiseeff:probe@postgres:5432/wiseeff",
        "AUTH_PROVIDER=local",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );

    const result = runSetup(["--non-interactive", "init", "--env-file", envFile], {
      WISEEFF_PUBLICATION_MANAGER_ENV_FILE: managerEnv,
      WISEEFF_OPERATION_LOCK_DIR: join(directory, "lock"),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("already exists");
    expect(result.stdout).toContain("unconfigured");
    const written = readFileSync(managerEnv, "utf8");
    expect(written).toContain("WISEEFF_PUBLICATION_MANAGER=1");
    expect(written).not.toMatch(/^[^#]*DATABASE_URL=/m);
    expect(written).not.toMatch(/^[^#]*WISEEFF_PUBLICATION_MANAGER_DATABASE_URL=/m);
    expect(written).not.toContain("postgres://wiseeff:probe");
  });

  it("does not overwrite an existing private manager env without --force", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-setup-manager-keep-"));
    const envFile = join(directory, "runtime.env");
    const managerEnv = join(directory, ".env.publication-manager");
    writeFileSync(envFile, "DATABASE_URL=postgres://wiseeff:probe@postgres:5432/wiseeff\n", { mode: 0o600 });
    writeFileSync(managerEnv, "WISEEFF_PUBLICATION_MANAGER=1\n# existing private file\n", { mode: 0o600 });

    const result = runSetup(["--non-interactive", "init", "--env-file", envFile], {
      WISEEFF_PUBLICATION_MANAGER_ENV_FILE: managerEnv,
      WISEEFF_OPERATION_LOCK_DIR: join(directory, "lock"),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Keeping");
    expect(readFileSync(managerEnv, "utf8")).toContain("existing private file");
  });
});

function preflightFixture(databaseUrl: string) {
  const directory = mkdtempSync(join(tmpdir(), "wiseeff-setup-url-"));
  const envFile = join(directory, "runtime.env");
  const dockerLog = join(directory, "docker.log");
  const text = renderSelfHostEnv(normalizeAnswers({
    profile: "ip-lab", siteHost: "203.0.113.10", adminPassword: "ReplaceWithAStrongPassword"
  }), { postgresPassword: "postgres_lab_secret", minioPassword: "minio_lab_secret" });
  writeFileSync(envFile, text.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${databaseUrl}`), { mode: 0o600 });
  writeFileSync(join(directory, "docker"), `#!/bin/bash
if [ "$1" = image ] && [ "\${2:-}" = inspect ]; then
  if [[ "\${5:-}" == node:22.21.1-alpine* ]]; then
    if [ "$TEST_LOCAL_IMAGE" = cold ] && [ ! -f "$TEST_BUNDLE_STATE" ]; then exit 1; fi
    if [ "\${4:-}" = '{{.Id}}|{{.Os}}/{{.Architecture}}' ]; then
      echo "$TEST_BASE_IMAGE_ID|linux/amd64"
    else
      echo local-base-image
    fi
    exit 0
  fi
  if [ "$TEST_LOCAL_IMAGE" = base ] || [ "$TEST_LOCAL_IMAGE" = cold ]; then exit 1; fi
  echo local-app-image
  exit 0
fi
if [ "$1" = version ]; then echo linux/amd64; exit 0; fi
if [ "$1" = load ]; then
  touch "$TEST_BUNDLE_STATE"
  printf 'bundle-load\\n' >> "$TEST_DOCKER_LOG"
  exit 0
fi
if [ "$1" = tag ]; then printf 'bundle-tag\\n' >> "$TEST_DOCKER_LOG"; exit 0; fi
if [ "$1" = run ]; then
  printf 'run-parser' >> "$TEST_DOCKER_LOG"
  while [ "$#" -gt 0 ]; do
    if [ "$1" = -e ]; then
      printf '\\n' >> "$TEST_DOCKER_LOG"
      exec "${process.execPath}" -e "$2"
    fi
    printf ' %s' "$1" >> "$TEST_DOCKER_LOG"
    shift
  done
  exit 2
fi
if [ "$1" = compose ] && [ "\${2:-}" = version ]; then echo 'Docker Compose version v2.39.0'; exit 0; fi
if [ "$1" = ps ]; then exit 0; fi
printf '%s\\n' "$*" >> "$TEST_DOCKER_LOG"
`, { mode: 0o700 });
  writeFileSync(join(directory, "curl"), "#!/bin/bash\nexit 0\n", { mode: 0o700 });
  return {
    envFile, dockerLog,
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      WISEEFF_SETUP_RENDER: "bash",
      WISEEFF_BUILD_NETWORK_FILE: join(directory, "missing-build-network.env"),
      WISEEFF_OPERATION_LOCK_DIR: join(directory, "lock"),
      TEST_DOCKER_LOG: dockerLog,
      TEST_LOCAL_IMAGE: "app",
      TEST_BUNDLE_STATE: join(directory, "bundle-loaded"),
      TEST_BASE_IMAGE_ID: parseEnvText(readFileSync("ops/self-hosted/images/base-image-bundle.env", "utf8")).WISEEFF_BASE_IMAGE_CONFIG_ID,
      WISEEFF_PUBLICATION_MANAGER_ENV_FILE: join(directory, ".env.publication-manager"),
      HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", NO_PROXY: "",
      http_proxy: "", https_proxy: "", all_proxy: "", no_proxy: ""
    }
  };
}
