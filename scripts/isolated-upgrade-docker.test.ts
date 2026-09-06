import { describe, expect, it } from "vitest";
import { createIsolatedUpgradeDocker } from "./isolated-upgrade-docker";

const id = "a".repeat(64);
function fixture(host = "unix:///var/run/docker.sock") {
  const calls: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
  let daemon = "local-daemon";
  let labels = { "wiseeff.test": "owned-run" };
  const run = (args: string[], env: NodeJS.ProcessEnv) => {
    calls.push({ args, env });
    if (args[0] === "context") return Buffer.from(args[1] === "show" ? "selected" : JSON.stringify([{ Endpoints: { docker: { Host: host } } }]));
    if (args[2] === "info") return Buffer.from(daemon);
    if (args[2] === "inspect") return Buffer.from(JSON.stringify([{ Id: id, Config: { Labels: labels } }]));
    return Buffer.from(id);
  };
  return { calls, run, changeDaemon: () => { daemon = "other-daemon"; }, changeLabels: () => { labels = { "wiseeff.test": "other-run" }; } };
}
describe("isolated upgrade Docker target boundary", () => {
  it.each(["tcp://127.0.0.1:2375", "ssh://production", "unix:///unknown.sock"])("rejects ambient %s before any command", (host) => {
    const fake = fixture();
    expect(() => createIsolatedUpgradeDocker({ DOCKER_HOST: host, DOCKER_CONTEXT: "local" }, fake.run)).toThrow("local-endpoint-required");
    expect(fake.calls).toEqual([]);
  });
  it.each(["tcp://remote:2375", "ssh://remote", "unix:///unknown.sock", ""])("rejects selected context %s without run/rm", (host) => {
    const fake = fixture(host);
    expect(() => createIsolatedUpgradeDocker({}, fake.run)).toThrow("local-endpoint-required");
    expect(fake.calls.every(({ args }) => args[0] === "context")).toBe(true);
  });
  it("pins endpoint despite ambient context changes, with only minimal environment", () => {
    const fake = fixture();
    const env = { DOCKER_CONTEXT: "local", DOCKER_CONFIG: "/private/config", DATABASE_URL: "secret", PATH: "/usr/bin" };
    const docker = createIsolatedUpgradeDocker(env, fake.run);
    env.DOCKER_CONTEXT = "remote";
    docker.command(["run", "sentinel"]);
    const pinned = fake.calls.filter(({ args }) => args[0] !== "context");
    expect(pinned.every(({ args }) => args[0] === "--host" && args[1] === "unix:///var/run/docker.sock")).toBe(true);
    expect(pinned.every(({ env: child }) => Object.keys(child).sort().join() === "HOME,PATH")).toBe(true);
    expect(JSON.stringify(fake.calls)).not.toContain("secret");
  });
  it("refuses daemon replacement before subsequent mutation", () => {
    const fake = fixture();
    const docker = createIsolatedUpgradeDocker({}, fake.run);
    fake.changeDaemon();
    expect(() => docker.command(["run", "sentinel"])).toThrow("identity-changed");
    expect(fake.calls.some(({ args }) => args.includes("run"))).toBe(false);
  });
  it("binds cleanup to full container ID and label, never the name", () => {
    const fake = fixture();
    const docker = createIsolatedUpgradeDocker({}, fake.run);
    expect(() => docker.assertOwned("name", "wiseeff.test", "owned-run")).toThrow("identity-invalid");
    expect(() => docker.assertOwned("b".repeat(64), "wiseeff.test", "owned-run")).toThrow("ownership-mismatch");
    docker.assertOwned(id, "wiseeff.test", "owned-run");
    fake.changeLabels();
    expect(() => { docker.assertOwned(id, "wiseeff.test", "owned-run"); docker.command(["rm", "-f", id]); }).toThrow("ownership-mismatch");
    expect(fake.calls.some(({ args }) => args.includes("rm"))).toBe(false);
  });
  it("sanitizes transport failures including argv secrets", () => {
    const fake = fixture();
    const docker = createIsolatedUpgradeDocker({}, (args, env) => {
      if (args.includes("run")) throw new Error("POSTGRES_PASSWORD=private-synthetic-password");
      return fake.run(args, env);
    });
    expect(() => docker.command(["run", "-e", "POSTGRES_PASSWORD=private-synthetic-password"])).toThrow(/^isolated-docker-operation-failed$/);
  });
});
