# API Authentication

> Chinese: [Chinese](../zh-CN/api/authentication.md)

WiseEff supports development auth for local tests, HMAC bearer tokens for local smoke profiles, WiseEff local accounts, and OIDC/JWKS bearer tokens for the M6.2 self-hosted identity path.

## Development Mode

Development auth is selected with:

```text
AUTH_MODE=development
```

Development requests may use:

```text
x-wiseeff-user: <seed-user-id>
```

This is only for local development and tests.

## Production Mode With OIDC

Target self-hosted production auth is selected with:

```text
AUTH_MODE=production
AUTH_PROVIDER=oidc
AUTH_OIDC_ISSUER=https://id.example.com/realms/wiseeff
AUTH_OIDC_AUDIENCE=wiseeff-api
AUTH_OIDC_JWKS_URI=
```

Requests must include:

```text
Authorization: Bearer <oidc-access-token>
```

The API validates issuer, audience, expiration, not-before, and signature through discovery/JWKS. `AUTH_OIDC_JWKS_URI` is optional when the issuer discovery document exposes `jwks_uri`.

Access tokens must include `sub` and organization claims. The trusted OIDC token proves identity only; WiseEff loads the effective user, active state, roles, and permissions from PostgreSQL by matching the token organization plus `sub` first, then email as a fallback only when the token includes `email_verified=true`. Admin user-governance changes therefore affect API authorization without waiting for IdP role-claim changes.

`wiseeff_roles` may be emitted for bootstrap diagnostics or compatibility, but it is not the production source of authorization after M6.2. If present, it must use supported role ids:

```json
[
  { "projectId": null, "roleId": "admin" },
  { "projectId": "aurora", "roleId": "hardware-user" }
]
```

Allowed role ids are `guest`, `hardware-user`, `software-user`, `hardware-committer`, `software-committer`, `admin`, and `platform-admin`. Unsupported role ids are rejected. Self-service registration never accepts `admin` or `platform-admin`. Only a caller who already holds `platform-admin` may grant or revoke that role through user governance.

## Production Mode With Local Accounts

WiseEff-owned local accounts are selected with:

```text
AUTH_MODE=production
AUTH_PROVIDER=local
```

This provider stores credentials and sessions in PostgreSQL. It adds the following first-party account lifecycle routes:

| Route | Purpose |
| --- | --- |
| `GET /api/v1/auth/local-config` | Unauthenticated public config for the auth screen: `{ provider, selfRegisterEnabled, hasLocalAdmin, evaluationOrganizationName }`. Non-local providers still return `200` with `selfRegisterEnabled: false` and `hasLocalAdmin: true` so the UI does not show a bootstrap hint. |
| `POST /api/v1/auth/register` | Register a local account with an allowed self-service platform role. The account joins the Evaluation Organization (ChargeLab when seeded; otherwise the single bootstrap Organization). Returns `201` with a session for non-committer roles, or `202 pending_approval` without a token for Committer requests. Rejected with `FORBIDDEN` when `AUTH_LOCAL_SELF_REGISTER=false`. Login and register share an in-process sliding-window limiter (`AUTH_LOCAL_AUTH_MAX_ATTEMPTS` / `AUTH_LOCAL_AUTH_WINDOW_MS`); excess attempts return `RATE_LIMITED` (HTTP 429). |
| `GET /api/v1/organization` | Return the caller's home organization (`id`, `name`, `createdAt`). Any active authenticated member. |
| `PATCH /api/v1/organization` | Rename the home organization (`{ name }` only). Requires `users:manage`. Writes `organization-update` in the same transaction. |
| `POST /api/v1/auth/login` | Exchange username and password for a local session token. Failed attempts write `auth-event` / `login-failed` (actor and target may be null when the username is unknown; organization is the evaluation org when resolvable). |
| `POST /api/v1/auth/logout` | Revoke the current local session token. |
| `GET /api/v1/me` | Return the authenticated `AuthContext`. |
| `PATCH /api/v1/me/profile` | Update the current user's name and title. |
| `POST /api/v1/me/password` | Change the current user's password (`{ currentPassword, newPassword }`). Verifies the current password, updates the salted `scrypt` hash, keeps the current session, and revokes every other session for that user. |
| `POST /api/v1/users` | Let Admins create an active local-account user in their current organization with username, initial password, title, and role bindings. |
| `POST /api/v1/users/:userId/password` | Let Admins reset a user's local password (`{ password }`). Requires `users:manage`. Revokes every session for that user. |
| `GET /api/v1/users/registration-role-requests` | Let Admins list pending local committer registration requests. |
| `POST /api/v1/users/registration-role-requests/:requestId/approve` | Let Admins approve a pending committer role request. |
| `POST /api/v1/users/registration-role-requests/:requestId/reject` | Let Admins reject a pending committer role request. |

Registration accepts `name`, `username`, `roleId`, and `password`. An optional leftover `organization` field is ignored and must not mint Hardware Department or Software Department tenants. Self-service registration never accepts `admin`. Operators can disable the route with `AUTH_LOCAL_SELF_REGISTER=false`; the auth screen hides Register when `GET /api/v1/auth/local-config` reports `selfRegisterEnabled: false`. Requests for `hardware-committer` or `software-committer` create an inactive account with the matching base User role plus a pending Admin approval request. They do not create a session token, and password login is blocked until Admin approval activates the user and grants the requested Committer role. Local accounts do not store or return email addresses; username is the local login identifier. Email verification is not implemented yet, so registration must not be treated as verified-domain onboarding or invitation acceptance.

Admin-created users use `POST /api/v1/users` rather than self-service registration. The request accepts `name`, `username`, `password`, optional `title`, and `roles`; the backend creates the user, password credential, role bindings, and audit event in one transaction. These accounts are active immediately, including Committer/MDE roles, because the operation already requires `users:manage`. Passwords and password hashes are never returned and must not appear in audit metadata.

Local-account registration (`AUTH_PROVIDER=local`) joins the Evaluation Organization: ChargeLab (`org-chargelab`) when that row exists, otherwise the single bootstrap Organization. This is the product rule in development and non-development, not a `NODE_ENV` exception. The development profile also upserts fixed demo usernames and a shared password for the seeded ChargeLab personas during `db:seed:m0` (see [local development](../developer/local-development.md#development-demo-logins-api-mode)); non-development seeds do not write those credentials.

Passwords are stored as salted `scrypt` hashes in `user_password_credentials`. Session tokens are returned once to the caller as opaque `we_local_*` bearer tokens only for successful login or non-committer registration; pending Committer registration and Admin-created local accounts never return a session token from their creation response. Only SHA-256 token hashes are persisted in `auth_sessions`. Sessions expire after the service TTL and logout sets `revoked_at`. Changing the current password keeps the caller's session and revokes the others; Admin password reset revokes every session for the target user. Every register, login, failed login, logout, password change, Admin password reset, profile update, home-organization rename, Admin user creation, role replacement, and activation change writes an audit event.

Requests after login use:

```text
Authorization: Bearer <we_local_session_token>
```

Local session resolution still reloads active state, roles, and permissions from WiseEff PostgreSQL through the same `/api/v1/me` auth context shape. Deactivated users and users without valid role bindings cannot continue by presenting an old token.

Local accounts are useful for self-managed evaluations and deployments that do not yet integrate an external IdP. Target enterprise deployments that require SSO, MFA, identity lifecycle federation, and browser token refresh should continue to use `AUTH_PROVIDER=oidc`.

## Local HMAC Smoke Mode

Local smoke auth is selected with:

```text
AUTH_MODE=production
AUTH_PROVIDER=hmac
AUTH_TOKEN_ISSUER=wiseeff-local
AUTH_TOKEN_HMAC_SECRET=<secret>
```

Requests must include:

```text
Authorization: Bearer <base64url-json-payload>.<hmac-sha256-signature>
```

Signed claims must include issuer, subject, and organization. Roles and permissions are taken only from signed claims. This profile is for local smoke/test flows and must not be used as target-environment identity evidence.

## Smoke Tokens

M5 smoke accepts:

```text
M5_SMOKE_AUTHORIZATION
WISEEFF_SMOKE_AUTHORIZATION
```

Use a token with `admin:access` when probing `/api/v1/operations/pilot-readiness`.

Do not commit real staging or production bearer tokens.
