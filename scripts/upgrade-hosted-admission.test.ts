import { generateKeyPairSync, sign } from "node:crypto";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const transport = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("node:https", () => ({ get: transport.get }));
import { admitHostedUpgradeComponents, assertHostedUpgradeAdmission } from "./upgrade-hosted-admission";

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "synthetic", alg: "RS256", use: "sig" };
const facts = { checkoutSha: "a".repeat(40), daemonId: "synthetic-daemon", workflowRef: "tzrea1-Q/WiseEff/.github/workflows/ci.yml@refs/pull/824/merge", runId: "12345", runAttempt: "1" };
const environment = { ACTIONS_ID_TOKEN_REQUEST_URL: "https://pipelines.actions.githubusercontent.com/synthetic?api-version=2.0", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "synthetic-request-secret" };
let claims: Record<string, unknown>;
let wrongKey = false;
let headerFields: Record<string, unknown>;
let keyFields: Record<string, unknown>;
let duplicateKey = false;
let rememberedToken: string | undefined;
let replay = false;

beforeEach(() => {
  claims = {}; headerFields = {}; keyFields = {}; wrongKey = false; duplicateKey = false;
  rememberedToken = undefined; replay = false; transport.get.mockReset();
  transport.get.mockImplementation((url: URL, options: unknown, receive: (value: Readable) => void) => {
    const request = new EventEmitter() as EventEmitter & { destroy: (error: Error) => void };
    request.destroy = error => { if (error) queueMicrotask(() => request.emit("error", error)); };
    queueMicrotask(() => {
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "synthetic", ...headerFields })).toString("base64url");
      const payload = Buffer.from(JSON.stringify({ iss: "https://token.actions.githubusercontent.com", aud: url.searchParams.get("audience"), sub: "repo:tzrea1-Q/WiseEff:pull_request", iat: now, nbf: now, exp: now + 300, runner_environment: "github-hosted", repository: "tzrea1-Q/WiseEff", workflow_ref: facts.workflowRef, sha: facts.checkoutSha, run_id: facts.runId, run_attempt: facts.runAttempt, ...claims })).toString("base64url");
      const token = `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), wrongKey ? other.privateKey : pair.privateKey).toString("base64url")}`;
      const currentToken = replay ? rememberedToken : token;
      if (url.hostname !== "token.actions.githubusercontent.com" && !replay) rememberedToken = token;
      const keys = [{ ...jwk, ...keyFields }, ...(duplicateKey ? [jwk] : [])];
      const response = Readable.from([JSON.stringify(url.hostname === "token.actions.githubusercontent.com" ? { keys } : { value: currentToken })]);
      Object.assign(response, { statusCode: 200 }); receive(response);
    });
    return request;
  });
});
afterEach(() => { vi.useRealTimers(); });

describe("signed GitHub-hosted admission for owned PG components", () => {
  it("rejects a correct-looking hosted claim with a foreign signing key", async () => {
    wrongKey = true;
    await expect(admitHostedUpgradeComponents(facts, environment, () => facts)).rejects.toThrow("upgrade-hosted-signature-rejected");
  });
  it("issues only a frozen in-memory owned-PG capability after signed claims match", async () => {
    const observe = vi.fn(() => ({ ...facts }));
    const receipt = await admitHostedUpgradeComponents(facts, environment, observe);
    expect(receipt.scope).toBe("new-owned-pg-components");
    expect(Object.isFrozen(receipt)).toBe(true); expect(Object.isFrozen(receipt.facts)).toBe(true);
    expect(observe).toHaveBeenCalledOnce();
    expect(() => assertHostedUpgradeAdmission(receipt, facts)).not.toThrow();
    expect(() => assertHostedUpgradeAdmission(JSON.parse(JSON.stringify(receipt)), facts)).toThrow("capability-rejected");
    expect(() => assertHostedUpgradeAdmission(receipt, { ...facts, daemonId: "other-daemon" })).toThrow("capability-rejected");
    const calls = transport.get.mock.calls;
    expect(calls[0][0].searchParams.get("audience")).toMatch(/^urn:wiseeff:new-owned-pg:v1:[a-f0-9]{64}$/);
    expect(calls[1][0].href).toBe("https://token.actions.githubusercontent.com/.well-known/jwks");
    for (const call of calls) expect(call[1].rejectUnauthorized).toBe(true);
    expect(calls[1][1].headers.Authorization).toBeUndefined();
    expect(JSON.stringify(receipt)).not.toContain("synthetic-request-secret");
  });
  it.each([
    ["iss", "https://untrusted.invalid"], ["aud", "copied-audience"], ["aud", ["copied-audience"]],
    ["runner_environment", "self-hosted"], ["runner_environment", undefined],
    ["repository", "attacker/WiseEff"], ["workflow_ref", "tzrea1-Q/WiseEff/.github/workflows/evil.yml@refs/pull/824/merge"],
    ["sha", "b".repeat(40)], ["run_id", "999"], ["run_attempt", "2"],
  ])("rejects signed incompatible %s claim", async (key, value) => {
    claims[key as string] = value;
    await expect(admitHostedUpgradeComponents(facts, environment, () => facts)).rejects.toThrow("claims-rejected");
  });
  it.each(["expired", "future-nbf", "future-iat", "stale", "long-lived", "missing-exp", "string-exp"])("rejects %s validity", async mode => {
    const now = Math.floor(Date.now() / 1000);
    if (mode === "expired") claims.exp = now;
    if (mode === "future-nbf") claims.nbf = now + 100;
    if (mode === "future-iat") claims.iat = now + 100;
    if (mode === "stale") claims.iat = now - 700;
    if (mode === "long-lived") claims.exp = now + 700;
    if (mode === "missing-exp") claims.exp = undefined;
    if (mode === "string-exp") claims.exp = String(now + 100);
    await expect(admitHostedUpgradeComponents(facts, environment, () => facts)).rejects.toThrow("time-rejected");
  });
  it.each([{ alg: "none" }, { alg: "HS256" }, { kid: undefined }, { crit: ["unknown"] }, { jku: "https://untrusted.invalid" }])("rejects unsafe header %j", async value => {
    headerFields = value;
    await expect(admitHostedUpgradeComponents(facts, environment, () => facts)).rejects.toThrow("algorithm-rejected");
  });
  it.each([{ kid: "wrong" }, { kty: "EC" }, { use: "enc" }, { alg: "HS256" }, { key_ops: ["sign"] }])("rejects incompatible signing key %j", async value => {
    keyFields = value;
    await expect(admitHostedUpgradeComponents(facts, environment, () => facts)).rejects.toThrow("signing-key-rejected");
  });
  it("rejects ambiguous key ids", async () => {
    duplicateKey = true;
    await expect(admitHostedUpgradeComponents(facts, environment, () => facts)).rejects.toThrow("signing-key-rejected");
  });
  it("rejects a captured token even in the same run using a fresh challenge", async () => {
    await admitHostedUpgradeComponents(facts, environment, () => facts); replay = true;
    await expect(admitHostedUpgradeComponents(facts, environment, () => facts)).rejects.toThrow("claims-rejected");
  });
  it.each(["daemonId", "checkoutSha", "runAttempt"])("rejects post-request observation drift in %s", async field => {
    const next = { ...facts, [field]: field === "checkoutSha" ? "b".repeat(40) : field === "runAttempt" ? "2" : "new-daemon" };
    await expect(admitHostedUpgradeComponents(facts, environment, () => next)).rejects.toThrow("observation-drift");
  });
  it.each(["http://pipelines.actions.githubusercontent.com/token", "https://actions.githubusercontent.com.attacker.invalid/token", "https://user:secret@pipelines.actions.githubusercontent.com/token", "https://pipelines.actions.githubusercontent.com:8443/token"])("rejects unsafe request endpoint %s before sending a bearer", async url => {
    await expect(admitHostedUpgradeComponents(facts, { ...environment, ACTIONS_ID_TOKEN_REQUEST_URL: url }, () => facts)).rejects.toThrow("request-context-invalid");
    expect(transport.get).not.toHaveBeenCalled();
  });
  it("does not accept environment booleans as authority", async () => {
    await expect(admitHostedUpgradeComponents(facts, {}, () => facts)).rejects.toThrow("admission-rejected");
    expect(transport.get).not.toHaveBeenCalled();
  });
  it("rejects a changed workflow path before requesting a token", async () => {
    await expect(admitHostedUpgradeComponents({ ...facts, workflowRef: facts.workflowRef.replace("ci.yml", "other.yml") }, environment, () => facts)).rejects.toThrow("facts-invalid");
    expect(transport.get).not.toHaveBeenCalled();
  });
  it("redacts TLS and network errors including request credentials", async () => {
    transport.get.mockImplementation(() => { throw new Error(`certificate failed ${environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`); });
    await expect(admitHostedUpgradeComponents(facts, environment, () => facts)).rejects.toThrow(/^upgrade-hosted-transport-rejected$/);
  });
  it("rejects redirects without following or forwarding the bearer", async () => {
    transport.get.mockImplementation((_url, _options, receive) => {
      const request = new EventEmitter();
      queueMicrotask(() => receive(Object.assign(Readable.from([]), { statusCode: 302, headers: { location: "https://attacker.invalid" } })));
      return request;
    });
    await expect(admitHostedUpgradeComponents(facts, environment, () => facts)).rejects.toThrow("transport-rejected");
    expect(transport.get).toHaveBeenCalledOnce();
  });
  it("bounds request time and destroys a stalled request", async () => {
    vi.useFakeTimers();
    const destroy = vi.fn();
    transport.get.mockReturnValue(Object.assign(new EventEmitter(), { destroy }));
    const result = expect(admitHostedUpgradeComponents(facts, environment, () => facts)).rejects.toThrow("transport-rejected");
    await vi.advanceTimersByTimeAsync(10_000); await result;
    expect(destroy).toHaveBeenCalledOnce();
  });
  it("bounds response bytes", async () => {
    transport.get.mockImplementation((_url, _options, receive) => {
      queueMicrotask(() => receive(Object.assign(Readable.from(["x".repeat(256 * 1024 + 1)]), { statusCode: 200 })));
      return new EventEmitter();
    });
    await expect(admitHostedUpgradeComponents(facts, environment, () => facts)).rejects.toThrow("transport-rejected");
  });
  it("expires the in-memory capability", async () => {
    const receipt = await admitHostedUpgradeComponents(facts, environment, () => facts);
    vi.useFakeTimers(); vi.setSystemTime(receipt.expiresAt);
    expect(() => assertHostedUpgradeAdmission(receipt, facts)).toThrow("capability-rejected");
  });
});
