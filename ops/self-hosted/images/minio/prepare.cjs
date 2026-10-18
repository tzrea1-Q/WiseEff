const { createHash } = require("node:crypto");
const { createReadStream } = require("node:fs");
const { chmod, lstat, readFile, rename } = require("node:fs/promises");
const { pipeline } = require("node:stream/promises");
const { createWriteStream } = require("node:fs");

function parseContract(text) {
  const contract = {};
  const keys = ["MINIO", "MC"].flatMap((name) => ["RELEASE", "URL", "SHA256"].map((field) => `WISEEFF_${name}_${field}`));
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    const key = line.slice(0, separator);
    if (separator < 0 || !keys.includes(key) || Object.hasOwn(contract, key)) {
      throw new Error(`Unknown, malformed or duplicate MinIO contract key: ${key}`);
    }
    contract[key] = line.slice(separator + 1);
  }
  for (const name of ["MINIO", "MC"]) {
    const binary = name.toLowerCase();
    const release = contract[`WISEEFF_${name}_RELEASE`];
    const expected = name === "MINIO" ? "RELEASE.2024-12-18T13-15-44Z" : "RELEASE.2024-11-21T17-21-54Z";
    if (release !== expected || contract[`WISEEFF_${name}_URL`] !== `https://github.com/minio/${binary}/releases/download/${release}/${binary}.linux-amd64.${release}`) {
      throw new Error(`Invalid pinned ${binary} release or URL`);
    }
    if (!/^[a-f0-9]{64}$/.test(contract[`WISEEFF_${name}_SHA256`] ?? "")) {
      throw new Error(`Invalid WISEEFF_${name}_SHA256; replace REPLACE_WITH_SHA256_FROM_RELEASE before building`);
    }
  }
  return contract;
}

async function verifyFile(file, expected) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest("hex") !== expected) throw new Error(`MinIO binary checksum mismatch: ${file}`);
}

async function main() {
  const contract = parseContract(await readFile("/bundle/minio-bundle.env", "utf8"));
  const binary = process.env.BINARY;
  if (!["minio", "mc"].includes(binary)) throw new Error("Unsupported MinIO binary");
  const key = `WISEEFF_${binary.toUpperCase()}`;
  const url = process.env.BINARY_URL;
  if (url !== contract[`${key}_URL`]) throw new Error("Build URL does not match the pinned contract");
  const policy = process.env.WISEEFF_BUILD_TLS_POLICY;
  const ack = process.env.WISEEFF_BUILD_TLS_ACK;
  if (!((policy === "verify" && !ack) || (policy === "insecure" && ack === "allow-insecure-build"))) {
    throw new Error("Invalid build TLS authorization");
  }
  const offline = `/bundle/minio/offline/${binary}`;
  let file = offline;
  const stat = await lstat(offline).catch((error) => { if (error.code !== "ENOENT") throw error; });
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error("Offline binary must be a regular, non-symlink file");
  if (!stat) {
    // npm ships this fetch implementation in the pinned Node base; it supports
    // HTTPS CONNECT/SOCKS proxies without installing another package or image.
    const fetch = require("/usr/local/lib/node_modules/npm/node_modules/make-fetch-happen");
    const ca = await readFile("/run/secrets/wiseeff-corporate-ca", "utf8");
    const response = await fetch(url, {
      proxy: process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy || process.env.HTTP_PROXY || process.env.http_proxy,
      noProxy: process.env.NO_PROXY || process.env.no_proxy,
      ca: ca.includes("-----BEGIN CERTIFICATE-----") ? [...require("node:tls").rootCertificates, ca] : undefined,
      strictSSL: policy !== "insecure",
      retry: 2,
    });
    if (!response.ok) throw new Error(`MinIO download failed: HTTP ${response.status}`);
    file = `/tmp/${binary}`;
    await pipeline(response.body, createWriteStream(file, { flags: "wx" }));
  }
  await verifyFile(file, contract[`${key}_SHA256`]);
  await require("node:fs/promises").copyFile(file, `/usr/bin/${binary}.part`);
  await chmod(`/usr/bin/${binary}.part`, 0o755);
  await rename(`/usr/bin/${binary}.part`, `/usr/bin/${binary}`);
}

module.exports = { parseContract, verifyFile };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
