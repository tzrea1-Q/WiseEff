import { expect, it, vi } from "vitest";
import { inspectLegacyApplicationLoginFence, retireLegacyApplicationLogins, type LegacyLoginRetirementInput } from "./legacyWriterRetirement";
import { canonicalJson, sha256Prefixed } from "./journal";
import { observeLegacySourceEndpoint } from "./legacyWriterSource";

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
  const command = vi.fn((args: string[]) => Buffer.from(JSON.stringify(args[0] === "inspect" ? containers : [network])));
  const value = { docker: { command }, sourceUrl: "postgres://synthetic:synthetic@postgres/db",
    administrativeUrl: "postgres://synthetic:synthetic@127.0.0.1:15432/db", applicationId: appId,
    postgresId, registeredIds: [appId, postgresId], ownerRunId };
  return { value, containers, network, command };
}
it("derives the source alias and published endpoint from the same observed owned container", () => {
  const fixture = endpointFixture();
  expect(observeLegacySourceEndpoint(fixture.value)).toEqual({ networkId: "c".repeat(64), postgresId: "b".repeat(64),
    postgresAddress: "172.31.0.2", sourceHost: "postgres", managementPort: "15432" });
});
it.each(["wrong-source", "wrong-management", "custom-dns", "custom-hosts", "hosts-mount", "alias-conflict", "foreign-member", "network-drift", "foreign-owner"])(
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
    expect(() => observeLegacySourceEndpoint(fixture.value)).toThrow("SOURCE-ENDPOINT-UNPROVEN");
    expect(fixture.command.mock.calls.every(([args]) => args[0] === "inspect" || args[0] === "network")).toBe(true);
  });
