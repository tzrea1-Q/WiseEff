import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

type Docker = { command(args: string[]): Buffer };
type ResolverFile = "hosts" | "resolv.conf" | "nsswitch.conf";
type EndpointStage = "input" | "container-identity" | "container-routing" | "network-identity" |
  `archive-${ResolverFile}-${"read" | "list" | "extract"}` | "container-hostname" | "hosts-routing" |
  "resolver-nss" | "resolver-nameserver" | "resolver-options" | "resolver-directives" | "source-alias" | "published-port";
type OptionKind = "ndots-zero" | "ndots-other" | "edns0" | "trust-ad" | "other";
type EndpointFacts = Readonly<{ memberCount?: number; tarExitStatus?: number | null; optionLineCount?: number;
  optionKinds?: readonly OptionKind[]; nameserverLineCount?: number; nssLineCount?: number }>;

/** Static stages and bounded categories only; never attach Docker stderr,
 * resolver contents, URLs or credentials to the public refusal. */
export class LegacySourceEndpointRefusal extends Error {
  constructor(readonly stage: EndpointStage, readonly facts: EndpointFacts = {}) {
    super("PCAT-UPG-LEGACY-LOGIN-SOURCE-ENDPOINT-UNPROVEN");
    Object.freeze(facts);
  }
}
const refuse = (stage: EndpointStage, facts?: EndpointFacts): never => { throw new LegacySourceEndpointRefusal(stage, facts); };

function readResolverFile(docker: Docker, applicationId: string, name: ResolverFile): string {
  let stage: EndpointStage = `archive-${name}-read`;
  try {
    const archive = docker.command(["cp", `${applicationId}:/etc/${name}`, "-"]);
    if (!archive.length || archive.length > 128 * 1024) return refuse(stage);
    stage = `archive-${name}-list`;
    const listing = spawnSync("tar", ["-tvf", "-"], { input: archive,
      env: { PATH: process.env.PATH }, timeout: 5000, maxBuffer: 64 * 1024 });
    const members = listing.stdout?.toString("utf8").trim().split("\n");
    if (listing.error || listing.status !== 0 || members?.length !== 1 ||
        !members[0].startsWith("-") || !members[0].endsWith(` ${name}`)) return refuse(stage,
          { memberCount: members?.length ?? 0, tarExitStatus: listing.status });
    // Docker supplies a tar stream, including for stopped containers. Extract
    // exactly this file to stdout; never write a tar member to the host filesystem.
    stage = `archive-${name}-extract`;
    const extracted = spawnSync("tar", ["-xOf", "-", name], { input: archive,
      env: { PATH: process.env.PATH }, timeout: 5000, maxBuffer: 64 * 1024 });
    if (extracted.error || extracted.status !== 0 || !extracted.stdout?.length) return refuse(stage, { tarExitStatus: extracted.status });
    return extracted.stdout.toString("utf8");
  } catch (error) { if (error instanceof LegacySourceEndpointRefusal) throw error; return refuse(stage); }
}

/** Read actual owned Docker routing before forwarding a former LOGIN through
 * the published management port. A matching password is never routing proof.
 * This limited bridge profile creates no resources and opens no DB connection. */
export function observeLegacySourceEndpoint(input: {
  docker: Docker; sourceUrl: string; administrativeUrl: string;
  applicationId: string; postgresId: string; registeredIds: readonly string[];
  ownerRunId: string;
}) {
  let stage: EndpointStage = "input";
  try {
    const original = new URL(input.sourceUrl), management = new URL(input.administrativeUrl);
    if (!["postgres:", "postgresql:"].includes(original.protocol) ||
        !["postgres:", "postgresql:"].includes(management.protocol) || original.search || original.hash ||
        management.search || management.hash || !original.username || !management.username ||
        (original.port || "5432") !== "5432" || original.pathname !== management.pathname ||
        management.hostname !== "127.0.0.1" || !/^[a-f0-9]{24}$/.test(input.ownerRunId) ||
        new Set(input.registeredIds).size !== input.registeredIds.length ||
        input.registeredIds.some(id => !/^[a-f0-9]{64}$/.test(id)) ||
        !input.registeredIds.includes(input.applicationId) || !input.registeredIds.includes(input.postgresId)) return refuse(stage);
    stage = "container-identity";
    const observed = JSON.parse(input.docker.command(["inspect", ...input.registeredIds]).toString());
    if (!Array.isArray(observed) || observed.length !== input.registeredIds.length ||
        new Set(observed.map(info => info.Id)).size !== input.registeredIds.length ||
        observed.some(info => !input.registeredIds.includes(info.Id) || info.Config?.Labels?.["wiseeff.controlled-recovery-run"] !== input.ownerRunId)) return refuse(stage);
    stage = "container-routing";
    const app = observed.find(info => info.Id === input.applicationId), postgres = observed.find(info => info.Id === input.postgresId);
    const appNetworks = Object.values(app.NetworkSettings.Networks) as { NetworkID: string }[];
    const pgNetworks = Object.values(postgres.NetworkSettings.Networks) as { NetworkID: string; IPAddress: string; Aliases?: string[] }[];
    if (appNetworks.length !== 1 || pgNetworks.length !== 1 || appNetworks[0].NetworkID !== pgNetworks[0].NetworkID ||
        !/^[a-f0-9]{64}$/.test(pgNetworks[0].NetworkID) || isIP(pgNetworks[0].IPAddress) !== 4 ||
        app.State?.Running || app.State?.Restarting || !postgres.State?.Running || postgres.State?.Restarting ||
        app.Config?.Env?.some((value: string) => /^(RES_OPTIONS|LOCALDOMAIN|HOSTALIASES)=/.test(value)) ||
        ["Dns", "DnsOptions", "DnsSearch", "ExtraHosts", "Links"].some(key => app.HostConfig?.[key]?.length) ||
        app.Mounts?.some((mount: { Destination: string }) => ["/etc/hosts", "/etc/resolv.conf", "/etc/nsswitch.conf"].some(filename =>
          mount.Destination === "/" || filename === mount.Destination || filename.startsWith(`${mount.Destination}/`))) ||
        app.HostConfig?.NetworkMode === "host" || app.HostConfig?.NetworkMode?.startsWith("container:")) return refuse(stage);
    stage = "network-identity";
    const network = JSON.parse(input.docker.command(["network", "inspect", pgNetworks[0].NetworkID]).toString())[0];
    if (network?.Id !== pgNetworks[0].NetworkID || network.Driver !== "bridge" ||
        network.Labels?.["wiseeff.controlled-recovery-run"] !== input.ownerRunId ||
        network.Options?.["com.docker.network.bridge.enable_ip_masquerade"] !== "false" ||
        !network.Containers?.[input.postgresId] || Object.keys(network.Containers).some(id => !input.registeredIds.includes(id))) return refuse(stage);
    const hostname = original.hostname;
    const resolver = (["hosts", "resolv.conf", "nsswitch.conf"] as const).map(name => readResolverFile(input.docker, input.applicationId, name));
    const lines = (text: string) => text.split(/\r?\n/).map(line => line.split("#", 1)[0].trim()).filter(Boolean);
    const hosts = lines(resolver[0]).map(line => line.split(/\s+/)).filter(words => words.slice(1).some(name => name.toLowerCase() === hostname));
    const nss = lines(resolver[2]).filter(line => /^hosts\s*:/.test(line));
    const dns = lines(resolver[1]);
    if (app.Config?.Hostname?.toLowerCase() === hostname) return refuse("container-hostname");
    if (hosts.some(words => words[0] !== pgNetworks[0].IPAddress)) return refuse("hosts-routing");
    if (nss.length !== 1 || !/^hosts\s*:\s*files\s+dns\s*$/.test(nss[0])) return refuse("resolver-nss", { nssLineCount: nss.length });
    const nameservers = dns.filter(line => /^nameserver\s/.test(line));
    if (nameservers.join("\n") !== "nameserver 127.0.0.11") return refuse("resolver-nameserver", { nameserverLineCount: nameservers.length });
    const options = dns.filter(line => /^options\s/.test(line));
    if (options.join("\n") !== "options ndots:0") {
      const optionKinds = options.flatMap(line => line.split(/\s+/).slice(1)).map((option): OptionKind =>
        option === "ndots:0" ? "ndots-zero" : option.startsWith("ndots:") ? "ndots-other" :
          option === "edns0" || option === "trust-ad" ? option : "other");
      return refuse("resolver-options", { optionLineCount: options.length, optionKinds: Object.freeze([...new Set(optionKinds)]) });
    }
    if (dns.some(line => !/^(nameserver|options|search|domain)\s/.test(line))) return refuse("resolver-directives");
    stage = "source-alias";
    const matches = observed.filter(info => Object.values(info.NetworkSettings.Networks).some(value => {
      const endpoint = value as { NetworkID: string; IPAddress: string; Aliases?: string[] };
      return endpoint.NetworkID === network.Id && (hostname === endpoint.IPAddress || endpoint.Aliases?.includes(hostname));
    }));
    if (["localhost", "host.docker.internal", "gateway.docker.internal"].includes(hostname) ||
        matches.length !== 1 || matches[0].Id !== input.postgresId) return refuse(stage);
    stage = "published-port";
    const ports = postgres.NetworkSettings.Ports?.["5432/tcp"];
    if (!Array.isArray(ports) || ports.length !== 1 || ports[0].HostIp !== "127.0.0.1" ||
        ports[0].HostPort !== (management.port || "5432")) return refuse(stage);
    return { networkId: network.Id as string, postgresId: postgres.Id as string,
      postgresAddress: pgNetworks[0].IPAddress, sourceHost: hostname, managementPort: ports[0].HostPort as string,
      resolverDigest: `sha256:${createHash("sha256").update(JSON.stringify(resolver)).digest("hex")}` };
  } catch (error) { if (error instanceof LegacySourceEndpointRefusal) throw error; return refuse(stage); }
}
