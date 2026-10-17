import { createHmac } from "node:crypto";
import { ACCEPTANCE_ORGANIZATION } from "./cast";

export type AcceptanceRuntimeEnv = Record<string, string | undefined>;

export function createBearerTokenForUser(userId: string, email: string, name: string, scopedOrganizationId: string = ACCEPTANCE_ORGANIZATION.id, env: AcceptanceRuntimeEnv = process.env) {
  const issuer = env.AUTH_TOKEN_ISSUER?.trim();
  const secret = env.AUTH_TOKEN_HMAC_SECRET?.trim();
  if (!issuer || !secret) return null;
  const payload = Buffer.from(JSON.stringify({
    iss: issuer, sub: userId, org: scopedOrganizationId, name, email, title: "Acceptance User", orgName: "ChargeLab",
    roles: [], permissions: [], isActive: true, nbf: 0, exp: 9_999_999_999
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `Bearer ${payload}.${signature}`;
}

const defaultApiBaseUrl = "http://127.0.0.1:8787";

export function apiBaseUrl(env: AcceptanceRuntimeEnv = process.env) {
  return env.VITE_WISEEFF_API_BASE_URL?.trim() || env.WISEEFF_API_BASE_URL?.trim() || defaultApiBaseUrl;
}

export function apiRoute(route: string, env: AcceptanceRuntimeEnv = process.env) {
  const base = apiBaseUrl(env).replace(/\/+$/, "");
  const normalizedRoute = route.startsWith("/") ? route : `/${route}`;

  return `${base}${normalizedRoute}`;
}

export function smokeHeaders(env: AcceptanceRuntimeEnv = process.env) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  const authorization = env.M5_SMOKE_AUTHORIZATION?.trim() || env.WISEEFF_SMOKE_AUTHORIZATION?.trim();

  if (authorization) {
    headers.Authorization = authorization;
  }

  return headers;
}
