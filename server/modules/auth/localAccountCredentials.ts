import { createHash, randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { ApiError } from "../../shared/http/errors";

const scryptAsync = promisify(scrypt);
const passwordHashPrefix = "scrypt";

export const localRegistrationOrganizationIds = {
  硬件部: "org-hardware-department",
  软件部: "org-software-department"
} as const;

export function defaultLocalRegistrationOrganizationResolver(organizationName: string) {
  const organizationId = localRegistrationOrganizationIds[organizationName as keyof typeof localRegistrationOrganizationIds];
  if (!organizationId) {
    throw new ApiError("VALIDATION_FAILED", "Organization must be one of: 硬件部, 软件部.", 400, { organization: organizationName });
  }

  return {
    id: organizationId,
    name: organizationName
  };
}

export function validateLocalAccountUsername(username: string) {
  if (!username) {
    throw new ApiError("VALIDATION_FAILED", "Username is required.", 400);
  }
  if (username.length < 3 || username.length > 64) {
    throw new ApiError("VALIDATION_FAILED", "Username must be 3 to 64 characters.", 400);
  }
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw new ApiError("VALIDATION_FAILED", "Username can only contain letters, numbers, dots, underscores, or hyphens.", 400);
  }
}

export function validateLocalAccountPassword(password: string) {
  if (password.length < 8) {
    throw new ApiError("VALIDATION_FAILED", "Password must be at least 8 characters.", 400);
  }
}

export async function hashLocalAccountPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${passwordHashPrefix}$${salt}$${derived.toString("base64url")}`;
}

export function hashLocalSessionToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}
