import { createHash, createPublicKey, randomBytes, verify, type JsonWebKey } from "node:crypto";
import { get } from "node:https";
import type { ClientRequest } from "node:http";

const issuer = "https://token.actions.githubusercontent.com";
const jwksUrl = `${issuer}/.well-known/jwks`;
const repository = "tzrea1-Q/WiseEff";
const workflow = `${repository}/.github/workflows/ci.yml@`;
const admissions = new WeakSet<object>();

export interface HostedUpgradeFacts {
  readonly checkoutSha: string;
  readonly daemonId: string;
  readonly workflowRef: string;
  readonly runId: string;
  readonly runAttempt: string;
}

export interface HostedUpgradeAdmission {
  readonly scope: "new-owned-pg-components";
  readonly facts: Readonly<HostedUpgradeFacts>;
  readonly expiresAt: number;
}

class AdmissionError extends Error {}
function reject(reason: string): never { throw new AdmissionError(`upgrade-hosted-${reason}`); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject("response-invalid");
  return value as Record<string, unknown>;
}
function checkedFacts(value: HostedUpgradeFacts): HostedUpgradeFacts {
  if (!value || !/^[a-f0-9]{40}$/.test(value.checkoutSha)
    || !/^[a-zA-Z0-9:-]{1,128}$/.test(value.daemonId)
    || !value.workflowRef?.startsWith(workflow)
    || !/^refs\/(heads\/[A-Za-z0-9._/-]+|pull\/[1-9]\d*\/merge)$/.test(value.workflowRef.slice(workflow.length))
    || !/^[1-9]\d*$/.test(value.runId) || !/^[1-9]\d*$/.test(value.runAttempt)) reject("facts-invalid");
  return { checkoutSha: value.checkoutSha, daemonId: value.daemonId, workflowRef: value.workflowRef, runId: value.runId, runAttempt: value.runAttempt };
}
function sameFacts(left: HostedUpgradeFacts, right: HostedUpgradeFacts) {
  return JSON.stringify(checkedFacts(left)) === JSON.stringify(checkedFacts(right));
}

/** TLS is mandatory even when the parent environment disables Node TLS checks.
 * Never follow redirects, emit the request bearer, or surface transport errors. */
function readJson(url: URL, bearer?: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, rejectPromise) => {
    let settled = false;
    const finish = (error?: Error, value?: Record<string, unknown>) => {
      if (settled) return;
      settled = true; clearTimeout(deadline);
      if (error) rejectPromise(error); else resolve(value!);
    };
    const failure = () => new AdmissionError("upgrade-hosted-transport-rejected");
    let request: ClientRequest | undefined;
    const deadline = setTimeout(() => { finish(failure()); request?.destroy(); }, 10_000);
    try { request = get(url, {
      rejectUnauthorized: true,
      headers: { Accept: "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    }, response => {
      if (response.statusCode !== 200) { response.destroy(); finish(failure()); return; }
      const chunks: Buffer[] = []; let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        const buffer = Buffer.from(chunk); bytes += buffer.length;
        if (bytes > 256 * 1024) { finish(failure()); response.destroy(); return; }
        chunks.push(buffer);
      });
      response.on("error", () => finish(failure()));
      response.on("aborted", () => finish(failure()));
      response.on("end", () => {
        try { finish(undefined, object(JSON.parse(Buffer.concat(chunks).toString("utf8")))); }
        catch { finish(failure()); }
      });
    });
    request.on("error", () => finish(failure()));
    } catch { finish(failure()); }
  });
}

function decode(segment: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) reject("token-invalid");
  return object(JSON.parse(Buffer.from(segment, "base64url").toString("utf8")));
}

/** Does not accept caller JWKS, tokens, test switches, or serialized receipts.
 * The caller obtains facts via git and the existing local Docker identity guard;
 * observeCurrent must repeat those observations after the network round trips. */
export async function admitHostedUpgradeComponents(
  observed: HostedUpgradeFacts,
  environment: Partial<Pick<NodeJS.ProcessEnv, "ACTIONS_ID_TOKEN_REQUEST_URL" | "ACTIONS_ID_TOKEN_REQUEST_TOKEN">>,
  observeCurrent: () => HostedUpgradeFacts,
): Promise<HostedUpgradeAdmission> {
  try {
    const facts = checkedFacts(observed);
    if (typeof observeCurrent !== "function") reject("observation-required");
    const url = new URL(environment.ACTIONS_ID_TOKEN_REQUEST_URL ?? "");
    const bearer = environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    if (url.protocol !== "https:" || !url.hostname.endsWith(".actions.githubusercontent.com")
      || url.username || url.password || url.hash || (url.port && url.port !== "443")
      || !bearer || /[\r\n]/.test(bearer)) reject("request-context-invalid");
    const audience = `urn:wiseeff:new-owned-pg:v1:${createHash("sha256").update(JSON.stringify({ facts, nonce: randomBytes(32).toString("hex") })).digest("hex")}`;
    url.searchParams.set("audience", audience);
    const response = await readJson(url, bearer);
    if (typeof response.value !== "string" || response.value.length > 32 * 1024) reject("token-invalid");
    const parts = response.value.split(".");
    if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[2])) reject("token-invalid");
    const header = decode(parts[0]); const claims = decode(parts[1]);
    if (header.alg !== "RS256" || header.typ !== "JWT" || typeof header.kid !== "string"
      || !header.kid || header.crit !== undefined || header.jku !== undefined || header.x5u !== undefined) reject("algorithm-rejected");
    const jwks = await readJson(new URL(jwksUrl));
    if (!Array.isArray(jwks.keys)) reject("signing-key-rejected");
    const keys = jwks.keys.map(object).filter(key => key.kid === header.kid);
    if (keys.length !== 1) reject("signing-key-rejected");
    const key = keys[0];
    if (key.kty !== "RSA" || (key.alg !== undefined && key.alg !== "RS256")
      || (key.use !== undefined && key.use !== "sig")
      || (key.key_ops !== undefined && (!Array.isArray(key.key_ops) || !key.key_ops.includes("verify")))
      || key.d !== undefined) reject("signing-key-rejected");
    const publicKey = createPublicKey({ key: key as JsonWebKey, format: "jwk" });
    if ((publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) reject("signing-key-rejected");
    if (!verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], "base64url"))) reject("signature-rejected");
    const now = Math.floor(Date.now() / 1000);
    if (![claims.iat, claims.nbf, claims.exp].every(value => typeof value === "number" && Number.isSafeInteger(value))
      || (claims.iat as number) > now || (claims.nbf as number) > now || (claims.exp as number) <= now
      || (claims.iat as number) < now - 600 || (claims.exp as number) > (claims.iat as number) + 600) reject("time-rejected");
    if (claims.iss !== issuer || claims.aud !== audience || claims.runner_environment !== "github-hosted"
      || claims.repository !== repository || claims.workflow_ref !== facts.workflowRef || claims.sha !== facts.checkoutSha
      || claims.run_id !== facts.runId || claims.run_attempt !== facts.runAttempt) reject("claims-rejected");
    if (!sameFacts(facts, observeCurrent())) reject("observation-drift");
    const admission = Object.freeze({ scope: "new-owned-pg-components" as const, facts: Object.freeze(facts), expiresAt: (claims.exp as number) * 1000 });
    admissions.add(admission);
    return admission;
  } catch (error) {
    if (error instanceof AdmissionError) throw error;
    reject("admission-rejected");
  }
}

/** A copied/JSON-supplied receipt cannot authorize resource creation. This check
 * supplements, and never replaces, the Docker guard's per-call identity check. */
export function assertHostedUpgradeAdmission(admission: HostedUpgradeAdmission, observed: HostedUpgradeFacts): void {
  if (!admissions.has(admission) || admission.scope !== "new-owned-pg-components"
    || admission.expiresAt <= Date.now() || !sameFacts(admission.facts, observed)) reject("capability-rejected");
}
