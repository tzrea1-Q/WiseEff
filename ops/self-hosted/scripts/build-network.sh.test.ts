import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = "ops/self-hosted/scripts/build-network.sh";

function cleanProxyEnv(extra: NodeJS.ProcessEnv = {}) {
  return {
    ...process.env,
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    ALL_PROXY: "",
    NO_PROXY: "",
    http_proxy: "",
    https_proxy: "",
    all_proxy: "",
    no_proxy: "",
    ...extra
  };
}

describe("build-network.sh public interface", () => {
  it("initializes the persistent config with private permissions", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-build-network-init-"));
    const config = join(directory, "build-network.env");

    const result = spawnSync("bash", [script, "init", "--config", config], {
      encoding: "utf8",
      env: cleanProxyEnv()
    });

    expect(result.status).toBe(0);
    expect(statSync(config).mode & 0o777).toBe(0o600);
    expect(readFileSync(config, "utf8")).toContain("WISEEFF_BUILD_CA_CERT_FILE=");
    expect(readFileSync(config, "utf8")).toContain("WISEEFF_BUILD_TLS_POLICY=verify");
    expect(result.stdout).toContain("Edit the values, then run");
  });

  it("reports a private proxy config without revealing credentials", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-build-network-"));
    const config = join(directory, "build-network.env");
    writeFileSync(
      config,
      [
        "HTTPS_PROXY=http://operator:proxy-secret@proxy.example.com:8080",
        "NO_PROXY=localhost,127.0.0.1,.example.com",
        "WISEEFF_NPM_REGISTRY=https://npm.example.com/repository/npm/",
        "WISEEFF_RUNTIME_PROXY=false",
        ""
      ].join("\n"),
      { mode: 0o600 }
    );
    chmodSync(config, 0o600);

    const result = spawnSync("bash", [script, "status", "--config", config], {
      encoding: "utf8",
      env: cleanProxyEnv()
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("proxy: configured");
    expect(result.stdout).toContain("npm registry: npm.example.com");
    expect(result.stdout).toContain("corporate CA: not configured");
    expect(result.stdout).toContain("build TLS: verified");
    expect(result.stdout).toContain("runtime proxy: disabled");
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("operator");
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("proxy-secret");
  });

  it("reports the explicit build-only insecure TLS policy without treating it as runtime configuration", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-build-network-insecure-"));
    const config = join(directory, "build-network.env");
    writeFileSync(
      config,
      ["WISEEFF_BUILD_TLS_POLICY=insecure", "WISEEFF_RUNTIME_PROXY=false", ""].join("\n"),
      { mode: 0o600 }
    );
    chmodSync(config, 0o600);

    const result = spawnSync("bash", [script, "status", "--config", config, "--json"], {
      encoding: "utf8",
      env: cleanProxyEnv()
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      buildTlsPolicy: "insecure",
      runtimeProxy: false
    });
  });

  it("rejects unknown build TLS policies", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-build-network-policy-"));
    const config = join(directory, "build-network.env");
    writeFileSync(config, "WISEEFF_BUILD_TLS_POLICY=disabled\n", { mode: 0o600 });
    chmodSync(config, 0o600);

    const result = spawnSync("bash", [script, "status", "--config", config], {
      encoding: "utf8",
      env: cleanProxyEnv()
    });

    expect(result.status).toBe(10);
    expect(result.stderr).toContain("WISEEFF_BUILD_TLS_POLICY must be verify or insecure");
  });

  it("requires both insecure policy and an explicit per-command authorization", () => {
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/build-network-lib.sh
      WISEEFF_BUILD_TLS_POLICY=insecure
      WISEEFF_BUILD_TLS_ACK=
      if wiseeff_build_network_authorize_build false "upgrade apply"; then exit 0; else exit $?; fi
    `], {
      encoding: "utf8",
      env: cleanProxyEnv()
    });

    expect(result.status).toBe(10);
    expect(result.stderr).toContain("--allow-insecure-build");
  });

  it("authorizes insecure transport only for the current process", () => {
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/build-network-lib.sh
      WISEEFF_BUILD_TLS_POLICY=insecure
      WISEEFF_BUILD_TLS_ACK=
      wiseeff_build_network_authorize_build true "upgrade apply"
      printf '%s\n' "$WISEEFF_BUILD_TLS_ACK"
    `], {
      encoding: "utf8",
      env: cleanProxyEnv()
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("allow-insecure-build");
  });

  it("changes the non-secret transport fingerprint when the TLS policy changes", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-build-network-fingerprint-"));
    const secureConfig = join(directory, "secure.env");
    const insecureConfig = join(directory, "insecure.env");
    writeFileSync(secureConfig, "WISEEFF_BUILD_TLS_POLICY=verify\n", { mode: 0o600 });
    writeFileSync(insecureConfig, "WISEEFF_BUILD_TLS_POLICY=insecure\n", { mode: 0o600 });
    chmodSync(secureConfig, 0o600);
    chmodSync(insecureConfig, 0o600);

    const runFingerprint = (config: string) =>
      spawnSync("bash", ["-c", `
        source ops/self-hosted/scripts/build-network-lib.sh
        wiseeff_build_network_prepare "$PWD/ops/self-hosted" "$WISEEFF_TEST_CONFIG"
        printf '%s\n' "$WISEEFF_BUILD_TRANSPORT_FINGERPRINT"
      `], {
        encoding: "utf8",
        env: cleanProxyEnv({ WISEEFF_TEST_CONFIG: config, WISEEFF_BUILD_TLS_POLICY: "" })
      });

    const secure = runFingerprint(secureConfig);
    const insecure = runFingerprint(insecureConfig);

    expect(secure.status).toBe(0);
    expect(insecure.status).toBe(0);
    expect(secure.stdout.trim()).toMatch(/^[a-f0-9]{64}$/);
    expect(insecure.stdout.trim()).toMatch(/^[a-f0-9]{64}$/);
    expect(insecure.stdout).not.toBe(secure.stdout);
  });

  it("uses the deployment shell proxy when no persistent config exists", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-build-network-shell-"));
    const missingConfig = join(directory, "missing.env");

    const result = spawnSync("bash", [script, "status", "--config", missingConfig], {
      encoding: "utf8",
      env: cleanProxyEnv({
        HTTPS_PROXY: "http://operator:shell-secret@proxy.example.com:8080"
      })
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("proxy: configured");
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("operator");
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("shell-secret");
  });

  it("rejects conflicting upper and lower-case proxy values", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-build-network-conflict-"));

    const result = spawnSync("bash", [script, "status", "--config", join(directory, "missing.env")], {
      encoding: "utf8",
      env: cleanProxyEnv({
        HTTPS_PROXY: "http://proxy-a.example.com:8080",
        https_proxy: "http://proxy-b.example.com:8080"
      })
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Conflicting HTTPS_PROXY/https_proxy values");
    expect(result.stderr).not.toContain("proxy-a");
    expect(result.stderr).not.toContain("proxy-b");
  });

  it("validates an approved CA and renders the runtime proxy as a JSON boolean", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-build-network-ca-"));
    const config = join(directory, "build-network.env");
    writeFileSync(
      join(directory, "empty-ca.pem"),
      "-----BEGIN CERTIFICATE-----\ntest-certificate\n-----END CERTIFICATE-----\n",
      { mode: 0o600 }
    );
    writeFileSync(
      config,
      [
        "HTTPS_PROXY=http://proxy.example.com:8080",
        "WISEEFF_BUILD_CA_CERT_FILE=empty-ca.pem",
        "WISEEFF_RUNTIME_PROXY=true",
        ""
      ].join("\n"),
      { mode: 0o600 }
    );
    chmodSync(config, 0o600);

    const result = spawnSync("bash", [script, "status", "--config", config, "--json"], {
      encoding: "utf8",
      env: cleanProxyEnv()
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      proxy: "configured",
      corporateCa: "configured",
      runtimeProxy: true
    });
  });

  it("rejects registry authorities that cannot be rendered safely", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-build-network-registry-"));
    const config = join(directory, "build-network.env");
    writeFileSync(
      config,
      [
        'WISEEFF_NPM_REGISTRY=https://npm.example.com"invalid/repository/npm/',
        "WISEEFF_RUNTIME_PROXY=false",
        ""
      ].join("\n"),
      { mode: 0o600 }
    );
    chmodSync(config, 0o600);

    const result = spawnSync("bash", [script, "status", "--config", config, "--json"], {
      encoding: "utf8",
      env: cleanProxyEnv()
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("valid registry host");
  });

  it("reports an IPv6 registry host without truncating or exposing path data", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-build-network-ipv6-"));
    const config = join(directory, "build-network.env");
    writeFileSync(
      config,
      [
        "WISEEFF_NPM_REGISTRY=https://[2001:db8::1]:4873/repository/npm/",
        "WISEEFF_RUNTIME_PROXY=false",
        ""
      ].join("\n"),
      { mode: 0o600 }
    );
    chmodSync(config, 0o600);

    const result = spawnSync("bash", [script, "status", "--config", config, "--json"], {
      encoding: "utf8",
      env: cleanProxyEnv()
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).npmRegistry).toBe("[2001:db8::1]");
    expect(result.stdout).not.toContain("repository");
  });

  it("rejects proxy URLs containing whitespace", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-build-network-proxy-"));

    const result = spawnSync("bash", [script, "status", "--config", join(directory, "missing.env")], {
      encoding: "utf8",
      env: cleanProxyEnv({
        HTTPS_PROXY: "http://proxy example.com:8080"
      })
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must not contain whitespace");
    expect(result.stderr).not.toContain("proxy example");
  });

  it("clears inherited runtime proxy mappings unless runtime proxying is explicitly enabled", () => {
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/build-network-lib.sh
      WISEEFF_RUNTIME_PROXY=false
      WISEEFF_RUNTIME_HTTP_PROXY=http://must-not-reach-runtime.example.com:8080
      wiseeff_build_network_prepare "$PWD/ops/self-hosted" "$PWD/ops/self-hosted/missing-build-network.env"
      printf 'runtime_http=%s\\n' "\${WISEEFF_RUNTIME_HTTP_PROXY:-}"
    `], {
      encoding: "utf8",
      env: cleanProxyEnv()
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("runtime_http=\n");
  });
});
