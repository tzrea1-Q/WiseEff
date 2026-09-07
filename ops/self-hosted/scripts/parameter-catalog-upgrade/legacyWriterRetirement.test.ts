import { afterAll, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectLegacyApplicationLoginFence, retireLegacyApplicationLogins, type LegacyLoginRetirementInput } from "./legacyWriterRetirement";
import { canonicalJson, sha256Prefixed } from "./journal";
import { observeLegacySourceEndpoint } from "./legacyWriterSource";

vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});

const resolverRoot = mkdtempSync(path.join(os.tmpdir(), "retirement-resolver-test-"));
afterAll(() => rmSync(resolverRoot, { recursive: true, force: true }));
function resolverArchive(name: string, contents: string) {
  writeFileSync(path.join(resolverRoot, name), contents);
  return execFileSync("tar", ["-cf", "-", "-C", resolverRoot, name]);
}

function input() {
  const body = { format: "wiseeff-fixed-entry-handoff-v1", inputs: { lockRoot: "/private/unissued-lock" } };
  const handoff = { ...body, digest: sha256Prefixed(canonicalJson(body)) };
  const assertHeld = vi.fn(async () => undefined);
  return { value: { handoff, expectedHandoffDigest: handoff.digest, attemptId: "retire-attempt", lock: { assertHeld } } as unknown as LegacyLoginRetirementInput, assertHeld };
}
it.each(["", "../other", "bad attempt", "x".repeat(161)])("rejects malformed attempt %s before target calls", attemptId => {
  const fixture = input();
  return expect(retireLegacyApplicationLogins({ ...fixture.value, attemptId })).rejects.toMatchObject({ reason: "ATTEMPT-INVALID" });
});
it("does not accept a hash-consistent caller object as a live host-lock capability", async () => {
  const fixture = input();
  await expect(retireLegacyApplicationLogins(fixture.value)).rejects.toMatchObject({ reason: "LOCK-UNAVAILABLE" });
  expect(fixture.assertHeld).not.toHaveBeenCalled();
});
it("rejects a changed handoff before even checking the host lock", async () => {
  const fixture = input();
  await expect(retireLegacyApplicationLogins({ ...fixture.value, expectedHandoffDigest: `sha256:${"0".repeat(64)}` })).rejects.toMatchObject({ reason: "HANDOFF-MISMATCH" });
  expect(fixture.assertHeld).not.toHaveBeenCalled();
});
it.each([retireLegacyApplicationLogins, inspectLegacyApplicationLoginFence])("redacts malformed input at the public entry", async action => {
  await expect(action(null as unknown as LegacyLoginRetirementInput)).rejects.toThrow(/^PCAT-UPG-LEGACY-LOGIN-(OPERATION|INSPECTION)-FAILED$/);
});

function endpointFixture() {
  const appId = "a".repeat(64), postgresId = "b".repeat(64), networkId = "c".repeat(64), ownerRunId = "d".repeat(24);
  const make = (Id: string, ip: string, aliases: string[], running: boolean) => ({ Id,
    Config: { Labels: { "wiseeff.controlled-recovery-run": ownerRunId } },
    State: { Running: running, Restarting: false }, HostConfig: { NetworkMode: networkId },
    NetworkSettings: { Networks: { owned: { NetworkID: networkId, IPAddress: ip, Aliases: aliases } },
      Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "15432" }] } },
  });
  const containers = [make(appId, "", ["api"], false), make(postgresId, "172.31.0.2", ["postgres"], true)];
  const network = { Id: networkId, Driver: "bridge", Labels: { "wiseeff.controlled-recovery-run": ownerRunId },
    Options: { "com.docker.network.bridge.enable_ip_masquerade": "false" }, Containers: { [postgresId]: {} } };
  const resolver: Record<string, string> = { hosts: "127.0.0.1 localhost\n", "resolv.conf": "nameserver 127.0.0.11\noptions ndots:0\n", "nsswitch.conf": "hosts: files dns\n" };
  const archives: Record<string, Buffer> = {};
  const command = vi.fn((args: string[]) => args[0] === "cp"
    ? archives[path.basename(args[1])] ?? resolverArchive(path.basename(args[1]), resolver[path.basename(args[1])])
    : Buffer.from(JSON.stringify(args[0] === "inspect" ? containers : [network])));
  const value = { docker: { command }, sourceUrl: "postgres://synthetic:synthetic@postgres/db",
    administrativeUrl: "postgres://synthetic:synthetic@127.0.0.1:15432/db", applicationId: appId,
    postgresId, registeredIds: [appId, postgresId], ownerRunId };
  return { value, containers, network, command, resolver, archives };
}
it("derives the source alias and published endpoint from the same observed owned container", () => {
  const fixture = endpointFixture();
  expect(observeLegacySourceEndpoint(fixture.value)).toMatchObject({ networkId: "c".repeat(64), postgresId: "b".repeat(64),
    postgresAddress: "172.31.0.2", sourceHost: "postgres", managementPort: "15432" });
});
it("accepts the Linux Docker resolver protocol flags while retaining the same owned alias and published endpoint proof", () => {
  const fixture = endpointFixture();
  // Observed in Hosted run 34130699134, not an invented relaxed resolver.
  fixture.resolver["resolv.conf"] = "nameserver 127.0.0.11\noptions edns0 trust-ad ndots:0\n";
  expect(observeLegacySourceEndpoint(fixture.value)).toMatchObject({ postgresId: "b".repeat(64),
    postgresAddress: "172.31.0.2", sourceHost: "postgres", managementPort: "15432" });
});
it.each(["ndots:0 edns0", "ndots:0 trust-ad", "ndots:0 trust-ad edns0", "trust-ad ndots:0 edns0", "edns0 ndots:0 trust-ad"])(
  "treats only supported non-routing flags as order-independent: %s", options => {
    const fixture = endpointFixture(); fixture.resolver["resolv.conf"] = `nameserver 127.0.0.11\noptions ${options}\n`;
    expect(observeLegacySourceEndpoint(fixture.value)).toMatchObject({ postgresId: "b".repeat(64), sourceHost: "postgres" });
  });
it.each(["edns0 trust-ad", "edns0 trust-ad ndots:1", "edns0 trust-ad ndots:00",
  "edns0 trust-ad ndots:0 ndots:0", "edns0 edns0 trust-ad ndots:0", "edns0 trust-ad trust-ad ndots:0",
  "edns0 trust-ad ndots:0 rotate", "edns0 trust-ad ndots:0 no-tld-query", "edns0:1 trust-ad ndots:0",
  "edns0 trust-ad:1 ndots:0", "edns0 trust-ad ndots:0\noptions ndots:0", `ndots:0 ${" ".repeat(256)}edns0`])(
  "refuses missing, conflicting, duplicate or unsupported resolver options: %s", options => {
    const fixture = endpointFixture(); fixture.resolver["resolv.conf"] = `nameserver 127.0.0.11\noptions ${options}\n`;
    try { observeLegacySourceEndpoint(fixture.value); throw new Error("expected-refusal"); }
    catch (error) { expect(error).toMatchObject({ stage: "resolver-options" }); }
  });
it.each(["source-alias", "published-port", "hosts-routing", "resolver-nameserver", "container-identity"])(
  "never uses supported protocol flags as identity authority: %s", stage => {
    const fixture = endpointFixture();
    fixture.resolver["resolv.conf"] = "nameserver 127.0.0.11\noptions edns0 trust-ad ndots:0\n";
    if (stage === "source-alias") fixture.value.sourceUrl = "postgres://synthetic:synthetic@other/db";
    if (stage === "published-port") fixture.value.administrativeUrl = "postgres://synthetic:synthetic@127.0.0.1:25432/db";
    if (stage === "hosts-routing") fixture.resolver.hosts += "172.31.0.99 postgres\n";
    if (stage === "resolver-nameserver") fixture.resolver["resolv.conf"] = "nameserver 172.31.0.99\noptions edns0 trust-ad ndots:0\n";
    if (stage === "container-identity") fixture.containers[1].Config.Labels["wiseeff.controlled-recovery-run"] = "f".repeat(24);
    try { observeLegacySourceEndpoint(fixture.value); throw new Error("expected-refusal"); }
    catch (error) { expect(error).toMatchObject({ stage }); }
  });
it.each(["wrong-source", "wrong-management", "custom-dns", "custom-hosts", "hosts-mount", "alias-conflict", "foreign-member", "network-drift", "foreign-owner",
  "actual-hosts", "hostname", "actual-resolver", "nss-order", "search-first"])(
  "refuses unproven source routing without opening a database: %s", fault => {
    const fixture = endpointFixture();
    if (fault === "wrong-source") fixture.value.sourceUrl = "postgres://synthetic:synthetic@elsewhere/db";
    if (fault === "wrong-management") fixture.value.administrativeUrl = "postgres://synthetic:synthetic@127.0.0.1:15433/db";
    if (fault === "custom-dns") Object.assign(fixture.containers[0].HostConfig, { Dns: ["172.31.0.99"] });
    if (fault === "custom-hosts") Object.assign(fixture.containers[0].HostConfig, { ExtraHosts: ["postgres:172.31.0.99"] });
    if (fault === "hosts-mount") Object.assign(fixture.containers[0], { Mounts: [{ Destination: "/etc/hosts" }] });
    if (fault === "alias-conflict") fixture.containers[0].NetworkSettings.Networks.owned.Aliases.push("postgres");
    if (fault === "foreign-member") fixture.network.Containers["e".repeat(64)] = {};
    if (fault === "network-drift") fixture.containers[0].NetworkSettings.Networks.owned.NetworkID = "f".repeat(64);
    if (fault === "foreign-owner") fixture.containers[1].Config.Labels["wiseeff.controlled-recovery-run"] = "f".repeat(24);
    if (fault === "actual-hosts") fixture.resolver.hosts += "172.31.0.99 postgres\n";
    if (fault === "hostname") Object.assign(fixture.containers[0].Config, { Hostname: "postgres" });
    if (fault === "actual-resolver") fixture.resolver["resolv.conf"] = "nameserver 172.31.0.99\noptions ndots:0\n";
    if (fault === "nss-order") fixture.resolver["nsswitch.conf"] = "hosts: myhostname files dns\n";
    if (fault === "search-first") fixture.resolver["resolv.conf"] += "options ndots:1\n";
    expect(() => observeLegacySourceEndpoint(fixture.value)).toThrow("SOURCE-ENDPOINT-UNPROVEN");
    const stages: Record<string, string> = { "wrong-source": "source-alias", "wrong-management": "published-port",
      "custom-dns": "container-routing", "custom-hosts": "container-routing", "hosts-mount": "container-routing",
      "alias-conflict": "source-alias", "foreign-member": "network-identity", "network-drift": "container-routing",
      "foreign-owner": "container-identity", "actual-hosts": "hosts-routing", hostname: "container-hostname",
      "actual-resolver": "resolver-nameserver", "nss-order": "resolver-nss", "search-first": "resolver-options" };
    try { observeLegacySourceEndpoint(fixture.value); throw new Error("expected-refusal"); }
    catch (error) { expect(error).toMatchObject({ stage: stages[fault] }); }
    expect(fixture.command.mock.calls.every(([args]) => ["inspect", "network", "cp"].includes(args[0]))).toBe(true);
  });
it("reports only bounded resolver option categories, never private tokens or source credentials", () => {
  const fixture = endpointFixture();
  fixture.resolver["resolv.conf"] = "nameserver 127.0.0.11\noptions edns0 trust-ad ndots:0 private-token.invalid\n";
  try { observeLegacySourceEndpoint(fixture.value); throw new Error("expected-refusal"); }
  catch (error) {
    expect(error).toMatchObject({ stage: "resolver-options", facts: {
      optionLineCount: 1, optionKinds: ["edns0", "trust-ad", "ndots-zero", "other"] } });
    expect(JSON.stringify(error)).not.toMatch(/private-token|synthetic|postgres:\/\//);
  }
});
it("does not expose a Docker exception as endpoint diagnostic evidence", () => {
  const fixture = endpointFixture();
  fixture.command.mockImplementation(() => { throw new Error("postgres://private:password@private-host/db"); });
  try { observeLegacySourceEndpoint(fixture.value); throw new Error("expected-refusal"); }
  catch (error) {
    expect(error).toMatchObject({ stage: "container-identity" });
    expect(JSON.stringify(error)).not.toMatch(/password|private-host|postgres:\/\//);
  }
});
it("classifies malformed private input without echoing it", () => {
  const fixture = endpointFixture(); fixture.value.sourceUrl = "private-invalid-url";
  expect(() => observeLegacySourceEndpoint(fixture.value)).toThrow("SOURCE-ENDPOINT-UNPROVEN");
  try { observeLegacySourceEndpoint(fixture.value); throw new Error("expected-refusal"); }
  catch (error) { expect(error).toMatchObject({ stage: "input" }); expect(JSON.stringify(error)).not.toContain("private-invalid-url"); }
});
it("classifies unknown resolver directives without returning their contents", () => {
  const fixture = endpointFixture(); fixture.resolver["resolv.conf"] += "private-directive private.invalid\n";
  try { observeLegacySourceEndpoint(fixture.value); throw new Error("expected-refusal"); }
  catch (error) { expect(error).toMatchObject({ stage: "resolver-directives" }); expect(JSON.stringify(error)).not.toContain("private.invalid"); }
});
it.each(["hosts", "resolv.conf", "nsswitch.conf"])("identifies the failed bounded archive read: %s", file => {
  const fixture = endpointFixture(); fixture.archives[file] = Buffer.alloc(0);
  try { observeLegacySourceEndpoint(fixture.value); throw new Error("expected-refusal"); }
  catch (error) { expect(error).toMatchObject({ stage: `archive-${file}-read`, facts: {} }); }
});
it("keeps an extraction failure separate from a successful one-member listing and redacts subprocess output", () => {
  const fixture = endpointFixture();
  const result = (status: number, text: string) => ({ status, stdout: Buffer.from(text), stderr: Buffer.from("private-tar-diagnostic") }) as ReturnType<typeof spawnSync>;
  vi.mocked(spawnSync).mockReturnValueOnce(result(0, "-rw-r--r-- 0/0 12 2026-09-07 hosts\n"))
    .mockReturnValueOnce(result(2, "private-file-contents"));
  try { observeLegacySourceEndpoint(fixture.value); throw new Error("expected-refusal"); }
  catch (error) {
    expect(error).toMatchObject({ stage: "archive-hosts-extract", facts: { tarExitStatus: 2 } });
    expect(JSON.stringify(error)).not.toMatch(/private-tar|private-file/);
  }
});
it.each(["RES_OPTIONS=ndots:5", "LOCALDOMAIN=other.invalid", "HOSTALIASES=/tmp/aliases"])(
  "refuses an effective resolver environment override: %s", override => {
    const fixture = endpointFixture();
    Object.assign(fixture.containers[0].Config, { Env: [override] });
    expect(() => observeLegacySourceEndpoint(fixture.value)).toThrow("SOURCE-ENDPOINT-UNPROVEN");
  });
it.each(["duplicate", "link", "invalid"])("rejects a resolver tar that is not one exact ordinary file: %s", fault => {
  const fixture = endpointFixture();
  const hosts = path.join(resolverRoot, "hosts");
  try {
    if (fault === "invalid") fixture.archives.hosts = Buffer.from("not a Docker tar");
    else if (fault === "duplicate") {
      writeFileSync(hosts, fixture.resolver.hosts);
      fixture.archives.hosts = execFileSync("tar", ["-cf", "-", "-C", resolverRoot, "hosts", "hosts"]);
    } else {
      rmSync(hosts, { force: true }); symlinkSync("other-file", hosts);
      fixture.archives.hosts = execFileSync("tar", ["-cf", "-", "-C", resolverRoot, "hosts"]);
    }
    expect(() => observeLegacySourceEndpoint(fixture.value)).toThrow("SOURCE-ENDPOINT-UNPROVEN");
    try { observeLegacySourceEndpoint(fixture.value); throw new Error("expected-refusal"); }
    catch (error) { expect(error).toMatchObject({ stage: "archive-hosts-list" }); }
  } finally { rmSync(hosts, { force: true }); }
});
