import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Synthetic loopback TLS evidence only; this does not attest Docker daemon,
// registry pulls, npm/apk/git/pip downloads or the real corporate trust chain.
describe("verified build transport configuration and local TLS", () => {
  const directory = mkdtempSync(join(tmpdir(), "wiseeff-build-trust-"));
  const key = join(directory, "synthetic.key");
  const certificate = join(directory, "synthetic.pem");
  const expired = join(directory, "expired.pem");
  const env = { PATH: process.env.PATH, HOME: directory };
  function openssl(args: string[]) {
    const result = spawnSync("openssl", args, { encoding: "utf8", env });
    expect(result.status, "synthetic certificate setup must succeed").toBe(0);
  }
  beforeAll(() => {
    openssl(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", key,
      "-out", join(directory, "request.pem"), "-subj", "/CN=localhost"]);
    writeFileSync(join(directory, "extensions"), "subjectAltName=DNS:localhost\nbasicConstraints=critical,CA:TRUE\n");
    openssl(["x509", "-req", "-in", join(directory, "request.pem"), "-signkey", key,
      "-out", certificate, "-days", "2", "-extfile", join(directory, "extensions")]);
    writeFileSync(join(directory, "index"), "");
    writeFileSync(join(directory, "serial"), "01\n");
    writeFileSync(join(directory, "ca.conf"), `[ca]\ndefault_ca=local\n[local]\ndatabase=${directory}/index\nserial=${directory}/serial\nnew_certs_dir=${directory}\ndefault_md=sha256\npolicy=names\n[names]\ncommonName=supplied\n`);
    openssl(["ca", "-batch", "-selfsign", "-config", join(directory, "ca.conf"), "-keyfile", key,
      "-cert", certificate, "-in", join(directory, "request.pem"), "-out", expired,
      "-startdate", "20000101000000Z", "-enddate", "20010101000000Z", "-extfile", join(directory, "extensions")]);
  });
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  function preflight(lines: string[]) {
    const config = join(directory, "config.env");
    writeFileSync(config, `${lines.join("\n")}\n`, { mode: 0o600 });
    return spawnSync("bash", ["ops/self-hosted/scripts/build-network.sh", "require-verified", "--config", config, "--json"],
      { encoding: "utf8", env });
  }
  it("accepts parsed trust material without exposing proxy credentials", () => {
    const result = preflight([`WISEEFF_BUILD_CA_CERT_FILE=${certificate}`, "HTTPS_PROXY=http://private-user:private-secret@proxy.invalid:8080"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).buildTlsPolicy).toBe("verify");
    expect(result.stdout + result.stderr).not.toMatch(/private-user|private-secret|BEGIN CERTIFICATE/);
  });
  it.each([
    ["WISEEFF_BUILD_TLS_POLICY=insecure", "BUILD-TRUST-INSECURE"],
    ["WISEEFF_NPM_REGISTRY=http://registry.invalid", "BUILD-TRUST-REGISTRY"],
  ])("refuses %s", (setting, reason) => {
    const result = preflight([setting]);
    expect(result.status).toBe(10);
    expect(result.stderr).toContain(reason);
  });
  it("rejects malformed certificates and key-bearing bundles without printing material", () => {
    for (const contents of ["-----BEGIN CERTIFICATE-----\ninvalid-sensitive-content\n-----END CERTIFICATE-----\n",
      readFileSync(certificate, "utf8") + readFileSync(key, "utf8")]) {
      const bundle = join(directory, "invalid.pem");
      writeFileSync(bundle, contents, { mode: 0o600 });
      const result = preflight([`WISEEFF_BUILD_CA_CERT_FILE=${bundle}`]);
      expect(result.status).toBe(10);
      expect(result.stderr).toContain("BUILD-TRUST-CA");
      expect(result.stdout + result.stderr).not.toMatch(/invalid-sensitive-content|BEGIN .*KEY|BEGIN CERTIFICATE/);
    }
  });

  it.each([
    ["trusted", true, false, "localhost", 0],
    ["untrusted", false, false, "localhost", 1],
    ["wrong hostname", true, false, "wrong.invalid", 1],
    ["expired", true, true, "localhost", 1],
  ])("real TLS connection: %s", async (_name, trust, useExpired, servername, expected) => {
    const cert = useExpired ? expired : certificate;
    const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (_req, response) => response.end("ok"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing loopback server address");
      const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
        const child = spawn(process.execPath, ["-e", `
          require('node:https').get({host:'127.0.0.1',port:${address.port},servername:${JSON.stringify(servername)},timeout:2000},
            r=>{r.resume();r.on('end',()=>process.exit(r.statusCode===200?0:2));})
            .on('timeout',function(){this.destroy();}).on('error',e=>{process.stderr.write(e.code);process.exit(1);});
        `], { env: { ...env, ...(trust ? { NODE_EXTRA_CA_CERTS: cert } : {}) } });
        let output = "";
        child.stdout.on("data", (chunk) => { output += chunk; });
        child.stderr.on("data", (chunk) => { output += chunk; });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, output }));
      });
      expect(result.code, result.output).toBe(expected);
      if (useExpired) expect(result.output).toContain("CERT_HAS_EXPIRED");
      if (servername === "wrong.invalid") expect(result.output).toContain("ERR_TLS_CERT_ALTNAME_INVALID");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
