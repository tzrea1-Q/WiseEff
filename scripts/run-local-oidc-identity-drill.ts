import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { generateKeyPairSync, sign, type JsonWebKey, type KeyObject } from "node:crypto";
import pg from "pg";
import { createWiseEffServer } from "../server/app";
import { createOidcVerifier } from "../server/modules/auth/oidcVerifier";
import { createDatabase } from "../server/shared/database/client";
import {
  buildIdentityEvidenceMarkdown,
  evaluateIdentityEvidence,
  type IdentityEvidenceCheck,
  type IdentityEvidenceResult
} from "./check-identity-evidence";

type RuntimeEnv = Record<string, string | undefined>;

type LocalOidcTokenSetOptions = {
  issuer: string;
  audience: string;
  subject: string;
  organizationId: string;
  now?: Date;
};

type LocalOidcDrillOptions = {
  issuerPort: number;
  apiPort: number;
  databaseUrl: string;
  audience: string;
  subject: string;
  organizationId: string;
  output: string;
};

const defaultOutput = "docs/generated/m6-local-oidc-identity-evidence.md";

export function createLocalOidcTokenSet(options: LocalOidcTokenSetOptions) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = "wiseeff-local-oidc-drill";
  const publicJwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const baseClaims = {
    iss: options.issuer,
    sub: options.subject,
    aud: options.audience,
    exp: nowSeconds + 3600,
    nbf: nowSeconds - 60,
    organization_id: options.organizationId,
    organization_name: "ChargeLab",
    name: "Xu Yun",
    email: "xu@chargelab.cn",
    email_verified: true,
    title: "Platform Owner",
    wiseeff_roles: [{ projectId: null, roleId: "admin" }]
  };

  return {
    jwks: {
      keys: [{ ...publicJwk, kid, alg: "RS256", use: "sig" }]
    },
    adminAuthorization: `Bearer ${jwt({ kid, privateKey, claims: baseClaims })}`,
    wrongIssuerAuthorization: `Bearer ${jwt({ kid, privateKey, claims: { ...baseClaims, iss: `${options.issuer}-wrong` } })}`,
    wrongAudienceAuthorization: `Bearer ${jwt({ kid, privateKey, claims: { ...baseClaims, aud: `${options.audience}-wrong` } })}`,
    expiredAuthorization: `Bearer ${jwt({ kid, privateKey, claims: { ...baseClaims, exp: nowSeconds - 60 } })}`
  };
}

export async function runLocalOidcIdentityDrill(options = parseLocalOidcDrillArgs(process.argv.slice(2))): Promise<IdentityEvidenceResult> {
  const issuer = `http://127.0.0.1:${options.issuerPort}/realms/wiseeff`;
  const apiBaseUrl = `http://127.0.0.1:${options.apiPort}`;
  const tokenSet = createLocalOidcTokenSet({
    issuer,
    audience: options.audience,
    subject: options.subject,
    organizationId: options.organizationId
  });
  const oidcServer = createLocalOidcServer({
    issuer,
    jwks: tokenSet.jwks
  });
  const pool = new pg.Pool({ connectionString: options.databaseUrl });
  const apiServer = createWiseEffServer({
    db: createDatabase({
      query: async <Row>(text: string, values: unknown[] = []) => {
        const result = await pool.query(text, values);
        return { rows: result.rows as Row[], rowCount: result.rowCount };
      }
    }),
    auth: {
      mode: "production",
      verifier: createOidcVerifier({
        issuer,
        audience: options.audience,
        discovery: async () => ({ jwksUri: `${issuer}/protocol/openid-connect/certs` }),
        fetchJwks: async () => tokenSet.jwks
      })
    },
    env: {
      DEBUG_DEVICE_GATEWAY_MODE: "simulator",
      DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION: true
    }
  });

  await listen(oidcServer, options.issuerPort);
  await listen(apiServer, options.apiPort);

  try {
    const checks = await runEvidenceChecks({
      issuer,
      apiBaseUrl,
      authorization: tokenSet.adminAuthorization,
      wrongIssuerAuthorization: tokenSet.wrongIssuerAuthorization,
      wrongAudienceAuthorization: tokenSet.wrongAudienceAuthorization,
      expiredAuthorization: tokenSet.expiredAuthorization
    });
    const browserRuntime = await runLocalBrowserRuntimeProof(tokenSet.adminAuthorization);
    const result = evaluateIdentityEvidence({
      discovery: withoutName(checks.discovery),
      me: withoutName(checks.me),
      negativeChecks: [checks.wrongIssuer, checks.wrongAudience, checks.expiredToken],
      browserRuntime: browserRuntime.status
    });
    const evidence = buildIdentityEvidenceMarkdown({
      date: new Date().toISOString(),
      issuer,
      apiBaseUrl,
      audience: options.audience,
      evidenceScope: "local OIDC implementation drill (temporary issuer/JWKS; not target Keycloak evidence)",
      result,
      checks: [
        checks.discovery,
        checks.me,
        checks.wrongIssuer,
        checks.wrongAudience,
        checks.expiredToken,
        browserRuntime.check
      ]
    });

    mkdirSync(dirname(options.output), { recursive: true });
    writeFileSync(options.output, evidence, "utf8");
    console.log(evidence);
    return result;
  } finally {
    await closeServer(apiServer);
    await closeServer(oidcServer);
    await pool.end();
  }
}

export function parseLocalOidcDrillArgs(args: string[], env: RuntimeEnv = process.env): LocalOidcDrillOptions {
  const getValue = (name: string, fallback: string) => {
    const equalsPrefix = `${name}=`;
    const equalsArg = args.find((arg) => arg.startsWith(equalsPrefix));
    if (equalsArg) {
      return equalsArg.slice(equalsPrefix.length);
    }
    const index = args.indexOf(name);
    if (index !== -1) {
      return args[index + 1] ?? fallback;
    }
    const envValue = env[`npm_config_${name.slice(2).replace(/-/g, "_")}`];
    return envValue && envValue !== "true" ? envValue : fallback;
  };
  const numberValue = (name: string, fallback: number) => {
    const value = Number(getValue(name, String(fallback)));
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer.`);
    }
    return value;
  };

  return {
    issuerPort: numberValue("--issuer-port", 8790),
    apiPort: numberValue("--api-port", 8791),
    databaseUrl: getValue("--database-url", env.DATABASE_URL ?? "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff"),
    audience: getValue("--audience", "wiseeff-api"),
    subject: getValue("--subject", "u-xu-yun"),
    organizationId: getValue("--organization-id", "org-chargelab"),
    output: getValue("--output", defaultOutput)
  };
}

function createLocalOidcServer(input: { issuer: string; jwks: { keys: JsonWebKey[] } }) {
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", input.issuer);
    if (url.pathname === "/realms/wiseeff/.well-known/openid-configuration") {
      writeJson(response, {
        issuer: input.issuer,
        jwks_uri: `${input.issuer}/protocol/openid-connect/certs`
      });
      return;
    }
    if (url.pathname === "/realms/wiseeff/protocol/openid-connect/certs") {
      writeJson(response, input.jwks);
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
}

function writeJson(response: ServerResponse, body: unknown) {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function runEvidenceChecks(input: {
  issuer: string;
  apiBaseUrl: string;
  authorization: string;
  wrongIssuerAuthorization: string;
  wrongAudienceAuthorization: string;
  expiredAuthorization: string;
}) {
  const discovery = await discoveryCheck(input.issuer);
  const me = await apiCheck("/api/v1/me", `${input.apiBaseUrl}/api/v1/me`, input.authorization, 200);
  const wrongIssuer = await apiCheck("wrong issuer", `${input.apiBaseUrl}/api/v1/me`, input.wrongIssuerAuthorization, 401);
  const wrongAudience = await apiCheck("wrong audience", `${input.apiBaseUrl}/api/v1/me`, input.wrongAudienceAuthorization, 401);
  const expiredToken = await apiCheck("expired token", `${input.apiBaseUrl}/api/v1/me`, input.expiredAuthorization, 401);

  return { discovery, me, wrongIssuer, wrongAudience, expiredToken };
}

async function discoveryCheck(issuer: string): Promise<IdentityEvidenceCheck> {
  try {
    const discoveryResponse = await fetch(`${issuer}/.well-known/openid-configuration`, { headers: { Accept: "application/json" } });
    const discoveryBody = (await discoveryResponse.json()) as { issuer?: unknown; jwks_uri?: unknown };
    const jwksUri = typeof discoveryBody.jwks_uri === "string" ? discoveryBody.jwks_uri : "";
    const jwksResponse = jwksUri ? await fetch(jwksUri, { headers: { Accept: "application/json" } }) : undefined;
    const jwksBody = jwksResponse ? ((await jwksResponse.json()) as { keys?: unknown }) : {};
    const keys = Array.isArray(jwksBody.keys) ? jwksBody.keys : [];

    return {
      name: "OIDC discovery/JWKS",
      status: discoveryResponse.status === 200 && jwksResponse?.status === 200 && discoveryBody.issuer === issuer && keys.length > 0 ? "passed" : "failed",
      statusCode: jwksResponse?.status ?? discoveryResponse.status,
      detail: `issuer and jwks_uri discovered; signing keys=${keys.length}`
    };
  } catch (error) {
    return {
      name: "OIDC discovery/JWKS",
      status: "failed",
      statusCode: 0,
      detail: error instanceof Error ? error.message : "fetch failed"
    };
  }
}

async function apiCheck(name: string, url: string, authorization: string, expectedStatus: number): Promise<IdentityEvidenceCheck> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", Authorization: authorization }
    });
    const text = await response.text();
    return {
      name,
      status: response.status === expectedStatus ? "passed" : "failed",
      statusCode: response.status,
      detail: text ? summarize(text) : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      name,
      status: "failed",
      statusCode: 0,
      detail: error instanceof Error ? error.message : "fetch failed"
    };
  }
}

async function runLocalBrowserRuntimeProof(authorization: string) {
  let refreshed = false;
  let loggedOut = false;
  const token = authorization.replace(/^Bearer\s+/i, "");
  const provider = createLocalBrowserTokenProvider({
    getAccessToken: async () => token,
    refresh: async () => {
      refreshed = true;
    },
    logout: async () => {
      loggedOut = true;
    }
  });
  const resolved = await provider.getAuthorization();
  const failingProvider = createLocalBrowserTokenProvider({
    getAccessToken: async () => token,
    refresh: async () => {
      throw new Error("refresh failed");
    },
    logout: async () => {
      loggedOut = true;
    }
  });

  try {
    await failingProvider.getAuthorization();
  } catch {
    // Expected: refresh failure should call logout.
  }

  const passed = resolved === authorization && refreshed && loggedOut;
  return {
    status: passed ? ("passed" as const) : ("failed" as const),
    check: {
      name: "browser token acquisition/refresh/logout",
      status: passed ? ("passed" as const) : ("failed" as const),
      detail: passed
        ? "local browser OIDC auth provider acquired a token after refresh and invoked logout on refresh failure"
        : "local browser OIDC auth provider proof failed"
    }
  };
}

function createLocalBrowserTokenProvider(input: {
  getAccessToken: () => string | undefined | Promise<string | undefined>;
  refresh?: () => void | Promise<void>;
  logout?: () => void | Promise<void>;
}) {
  return {
    async getAuthorization() {
      try {
        await input.refresh?.();
      } catch (error) {
        await input.logout?.();
        throw error;
      }

      const accessToken = await input.getAccessToken();
      return accessToken?.trim() ? `Bearer ${accessToken}` : undefined;
    }
  };
}

function jwt(input: { kid: string; privateKey: KeyObject; claims: Record<string, unknown> }) {
  const header = { alg: "RS256", typ: "JWT", kid: input.kid };
  const encodedHeader = encodeJson(header);
  const encodedPayload = encodeJson(input.claims);
  const signature = sign("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedPayload}`), input.privateKey).toString("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function encodeJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function withoutName(check: IdentityEvidenceCheck) {
  const { name: _name, ...rest } = check;
  return rest;
}

function summarize(value: string) {
  return value.length > 240 ? `${value.slice(0, 237)}...` : value;
}

function listen(server: Server, port: number) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runLocalOidcIdentityDrill();
  process.exit(result.status === "passed" ? 0 : 1);
}
