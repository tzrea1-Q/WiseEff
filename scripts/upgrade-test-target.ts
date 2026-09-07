import { constants, closeSync, fstatSync, openSync, readSync } from "node:fs";
import { createIsolatedUpgradeDocker } from "./isolated-upgrade-docker";

/** Tests may clone databases only on a cluster they created and recorded. An
 * ambient DATABASE_URL, localhost address or TEST flag alone is not authority. */
export function assertOwnedUpgradeTestTarget(env: NodeJS.ProcessEnv = process.env,
  openDocker = createIsolatedUpgradeDocker) {
  try {
    if (!env.UPG_TEST_TARGET_RECEIPT || !env.TEST_DATABASE_URL) throw new Error();
    const file = openSync(env.UPG_TEST_TARGET_RECEIPT, constants.O_RDONLY | constants.O_NOFOLLOW);
    let receipt;
    try {
      const stat = fstatSync(file);
      if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size > 16384) throw new Error();
      const bytes = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const n = readSync(file, bytes, length, bytes.length - length, length);
        if (!n) break;
        length += n;
      }
      if (length !== stat.size) throw new Error();
      receipt = JSON.parse(bytes.subarray(0, length).toString("utf8"));
    } finally { closeSync(file); }
    if (receipt.label !== "wiseeff.upgrade.conversion" || !/^conversion-[a-f0-9]+$/.test(receipt.run) ||
        !/^[a-f0-9]{64}$/.test(receipt.net) || receipt.url !== env.TEST_DATABASE_URL ||
        (env.DATABASE_URL && env.DATABASE_URL !== receipt.url)) throw new Error();
    const url = new URL(receipt.url);
    // pg-connection-string gives query host/port precedence over URL authority
    // and can read sslkey/sslcert paths. This fixture needs no URI parameters.
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1" || !url.port || !/^\/[a-z0-9_]+$/.test(url.pathname) || url.search || url.hash) throw new Error();
    const docker = openDocker(env);
    if (receipt.daemonId !== docker.daemonId) throw new Error();
    const container = docker.assertOwned(receipt.id, receipt.label, receipt.run);
    const network = JSON.parse(docker.command(["network", "inspect", receipt.net]).toString())[0];
    if (!container.State.Running || network.Id !== receipt.net || network.Labels?.[receipt.label] !== receipt.run ||
        !Object.values(container.NetworkSettings.Networks).some((n: any) => n.NetworkID === receipt.net) ||
        !container.NetworkSettings.Ports["5432/tcp"]?.some((p: any) => p.HostIp === "127.0.0.1" && p.HostPort === url.port)) throw new Error();
  } catch {
    throw new Error("upgrade-tests-require-explicit-owned-postgres-receipt");
  }
}
