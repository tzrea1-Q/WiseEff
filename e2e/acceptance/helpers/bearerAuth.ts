import { createHmac } from "node:crypto";
import type { Page } from "playwright/test";

import { smokeHeaders } from "./runtime";

/** Keep in sync with src/infrastructure/http/authClient.ts — do not import frontend modules here (import.meta.env breaks Playwright Node). */
const LOCAL_AUTH_TOKEN_STORAGE_KEY = "wiseeff.localAuthToken";

const organizationId = "org-chargelab";

const acceptanceUsersByRole = {
  guest: { userId: "acceptance-role-guest", name: "Acceptance Guest", email: "acceptance.guest@chargelab.cn" },
  "hardware-user": { userId: "u-zhao-heng", name: "Zhao Heng", email: "zhao@chargelab.cn" },
  "software-user": { userId: "u-liu-min", name: "Liu Min", email: "liu@chargelab.cn" },
  "hardware-committer": { userId: "u-wang-jie", name: "Wang Jie", email: "wang@chargelab.cn" },
  "software-committer": { userId: "u-sun-mei", name: "Sun Mei", email: "sun@chargelab.cn" },
  admin: { userId: "u-xu-yun", name: "Xu Yun", email: "xu@chargelab.cn" }
} as const;

export type AcceptanceRoleId = keyof typeof acceptanceUsersByRole;

const roleLabels: Record<AcceptanceRoleId, string> = {
  guest: "Guest",
  "hardware-user": "Hardware User",
  "software-user": "Software User",
  "hardware-committer": "Hardware Committer",
  "software-committer": "Software Committer",
  admin: "Admin"
};

export function acceptanceRoleLabel(roleId: AcceptanceRoleId) {
  return roleLabels[roleId];
}

export function acceptanceUserIdForRole(roleId: AcceptanceRoleId) {
  return acceptanceUsersByRole[roleId].userId;
}

export function createBearerTokenForUser(userId: string, email: string, name: string) {
  const issuer = process.env.AUTH_TOKEN_ISSUER?.trim();
  const secret = process.env.AUTH_TOKEN_HMAC_SECRET?.trim();
  if (!issuer || !secret) {
    return null;
  }

  const payload = Buffer.from(
    JSON.stringify({
      iss: issuer,
      sub: userId,
      org: organizationId,
      name,
      email,
      title: "Acceptance User",
      orgName: "ChargeLab",
      roles: [],
      permissions: [],
      isActive: true,
      nbf: 0,
      exp: 9_999_999_999
    })
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `Bearer ${payload}.${signature}`;
}

export function authHeadersForUser(userId: string, email: string, name: string) {
  const authorization = createBearerTokenForUser(userId, email, name);
  if (authorization) {
    return {
      "Content-Type": "application/json",
      Authorization: authorization
    };
  }

  return {
    ...smokeHeaders(),
    "x-wiseeff-user": userId
  };
}

export function authHeadersForRole(roleId: AcceptanceRoleId) {
  const user = acceptanceUsersByRole[roleId];
  const authorization = createBearerTokenForUser(user.userId, user.email, user.name);
  if (authorization) {
    return {
      "Content-Type": "application/json",
      Authorization: authorization
    };
  }

  return {
    ...smokeHeaders(),
    "x-wiseeff-user": user.userId
  };
}

export async function signInBrowserAsRole(page: Page, roleId: AcceptanceRoleId, route = "/parameter-home") {
  const user = acceptanceUsersByRole[roleId];
  const authorization = createBearerTokenForUser(user.userId, user.email, user.name);
  if (!authorization) {
    throw new Error("AUTH_TOKEN_ISSUER and AUTH_TOKEN_HMAC_SECRET are required for acceptance role switching.");
  }

  const token = authorization.replace(/^Bearer\s+/u, "");
  await page.addInitScript(
    ([storageKey, authToken]) => {
      window.localStorage.setItem(storageKey, authToken);
    },
    [LOCAL_AUTH_TOKEN_STORAGE_KEY, token] as const
  );
  await page.goto(route, { waitUntil: "domcontentloaded" });
}

export async function signInBrowserAsRoleLabel(page: Page, roleLabel: string, route = "/parameter-home") {
  const roleId = (Object.entries(roleLabels).find(([, label]) => label === roleLabel)?.[0] ??
    null) as AcceptanceRoleId | null;
  if (!roleId) {
    throw new Error(`Unknown acceptance role label: ${roleLabel}`);
  }
  await signInBrowserAsRole(page, roleId, route);
}

export async function signInBrowserAsUser(
  page: Page,
  userId: string,
  email: string,
  name: string,
  route = "/parameter-home"
) {
  const authorization = createBearerTokenForUser(userId, email, name);
  if (!authorization) {
    throw new Error("AUTH_TOKEN_ISSUER and AUTH_TOKEN_HMAC_SECRET are required for acceptance browser sign-in.");
  }

  const token = authorization.replace(/^Bearer\s+/u, "");
  await page.addInitScript(
    ([storageKey, authToken]) => {
      window.localStorage.setItem(storageKey, authToken);
    },
    [LOCAL_AUTH_TOKEN_STORAGE_KEY, token] as const
  );
  await page.goto(route, { waitUntil: "domcontentloaded" });
}
