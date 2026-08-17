import { vi } from "vitest";

import type { WiseEffAuthClient } from "@/app/appRuntime";
import type { AuthContextDto } from "@/infrastructure/http/authClient";

export const TEST_USER_AUTH: AuthContextDto = {
  user: {
    id: "u-api-user",
    organizationId: "org-chargelab",
    name: "API User",
    email: "api-user@chargelab.cn",
    title: "API Parameter User",
    isActive: true
  },
  organization: { id: "org-chargelab", name: "ChargeLab" },
  roles: [{ projectId: null, roleId: "user" }],
  permissions: ["parameter:edit"]
};

export const TEST_ADMIN_AUTH: AuthContextDto = {
  user: {
    id: "u-api-admin",
    organizationId: "org-chargelab",
    name: "API Admin",
    email: "api-admin@chargelab.cn",
    title: "API Platform Owner",
    isActive: true
  },
  organization: { id: "org-chargelab", name: "ChargeLab" },
  roles: [{ projectId: null, roleId: "admin" }],
  permissions: ["admin:access", "users:manage", "debugging:admin", "debugging:view"]
};

function isAuthContext(value: object): value is AuthContextDto {
  return "user" in value && "roles" in value && "permissions" in value && "organization" in value;
}

/**
 * Resolved in-memory auth client for App-level tests. Pass `"user"` / `"admin"`,
 * a full `AuthContextDto`, or a partial client (login/register/error probes).
 */
export function createTestAuthClient(
  input: "user" | "admin" | AuthContextDto | Partial<WiseEffAuthClient> = "user"
): WiseEffAuthClient {
  if (input === "user" || input === "admin") {
    const context = input === "admin" ? TEST_ADMIN_AUTH : TEST_USER_AUTH;
    return {
      getCurrentAuthContext: vi.fn().mockResolvedValue(context)
    };
  }

  if (isAuthContext(input)) {
    return {
      getCurrentAuthContext: vi.fn().mockResolvedValue(input)
    };
  }

  return {
    getCurrentAuthContext: vi.fn().mockResolvedValue(TEST_USER_AUTH),
    ...input
  };
}
