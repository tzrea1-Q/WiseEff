import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { hashLocalSessionToken } from "./localAccountCredentials";
import { isLocalSessionToken } from "./localAuth";
import { getAuthContextForExternalIdentity } from "./repository";
import type { AuthContext } from "./types";

type OfflineLocalSessionRow = {
  id: string;
  user_id: string;
  organization_id: string;
  expires_at: string;
  revoked_at: string | null;
};

export type ResolvedOfflineLocalSession = {
  readonly sessionId: string;
  readonly auth: AuthContext;
};

function unauthenticated(): never {
  throw new ApiError("UNAUTHENTICATED", "Session is not active.");
}

/** Resolves a persisted local session for offline maintenance without touching session state. */
export async function resolveOfflineLocalSession(
  db: Queryable,
  token: string,
  now: () => Date = () => new Date(),
): Promise<ResolvedOfflineLocalSession> {
  if (!isLocalSessionToken(token)) unauthenticated();

  const result = await db.query<OfflineLocalSessionRow>(
    `
    select id, user_id, organization_id, expires_at::text as expires_at, revoked_at::text as revoked_at
    from public.auth_sessions
    where token_hash = $1
    limit 1
    `,
    [hashLocalSessionToken(token)],
  );
  const session = result.rows[0];
  const expiry = session ? Date.parse(session.expires_at) : Number.NaN;
  if (!session || session.revoked_at || !Number.isFinite(expiry) || expiry <= now().getTime()) {
    unauthenticated();
  }

  const auth = await getAuthContextForExternalIdentity(db, {
    organizationId: session.organization_id,
    subject: session.user_id,
  });
  if (
    auth.user.id !== session.user_id ||
    auth.user.organizationId !== session.organization_id ||
    auth.organization.id !== session.organization_id
  ) {
    unauthenticated();
  }
  if (!auth.roles.some((role) => role.projectId === null && role.roleId === "admin")) {
    throw new ApiError("FORBIDDEN", "An Organization Admin session is required.");
  }

  return { sessionId: session.id, auth };
}
