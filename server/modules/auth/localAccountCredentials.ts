import { createHash, randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { ApiError } from "../../shared/http/errors";

const scryptAsync = promisify(scrypt);
const passwordHashPrefix = "scrypt";

export function validateLocalAccountUsername(username: string) {
  if (!username) {
    throw new ApiError("VALIDATION_FAILED", "Username is required.");
  }
  if (username.length < 3 || username.length > 64) {
    throw new ApiError("VALIDATION_FAILED", "Username must be 3 to 64 characters.");
  }
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw new ApiError("VALIDATION_FAILED", "Username can only contain letters, numbers, dots, underscores, or hyphens.");
  }
}

export function validateLocalAccountPassword(password: string) {
  if (password.length < 8) {
    throw new ApiError("VALIDATION_FAILED", "Password must be at least 8 characters.");
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
