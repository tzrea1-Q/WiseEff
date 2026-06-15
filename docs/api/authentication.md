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

Allowed role ids are `guest`, `hardware-user`, `software-user`, `hardware-committer`, `software-committer`, and `admin`. Unsupported role ids are rejected.

## Production Mode With Local Accounts

WiseEff-owned local accounts are selected with:

```text
AUTH_MODE=production
AUTH_PROVIDER=local
```

This provider stores credentials and sessions in PostgreSQL. It adds the following first-party account lifecycle routes:

| Route | Purpose |
| --- | --- |
| `POST /api/v1/auth/register` | Register a local account with a selected organization and allowed self-service platform role. Returns `201` with a session for non-committer roles, or `202 pending_approval` without a token for Committer requests. |
| `POST /api/v1/auth/login` | Exchange username and password for a local session token. |
| `POST /api/v1/auth/logout` | Revoke the current local session token. |
| `GET /api/v1/me` | Return the authenticated `AuthContext`. |
| `PATCH /api/v1/me/profile` | Update the current user's name and title. |
| `POST /api/v1/users` | Let Admins create an active local-account user in their current organization with username, initial password, title, and role bindings. |
| `GET /api/v1/users/registration-role-requests` | Let Admins list pending local committer registration requests. |
| `POST /api/v1/users/registration-role-requests/:requestId/approve` | Let Admins approve a pending committer role request. |
| `POST /api/v1/users/registration-role-requests/:requestId/reject` | Let Admins reject a pending committer role request. |

Registration accepts `organization`, `name`, `username`, `roleId`, and `password`. The self-service organization choices are the localized hardware department and software department values. Self-service registration never accepts `admin`. Requests for `hardware-committer` or `software-committer` create an inactive account with the matching base User role plus a pending Admin approval request. They do not create a session token, and password login is blocked until Admin approval activates the user and grants the requested Committer role. Local accounts do not store or return email addresses; username is the local login identifier. Email verification is not implemented yet, so registration must not be treated as verified-domain onboarding or invitation acceptance.

Admin-created users use `POST /api/v1/users` rather than self-service registration. The request accepts `name`, `username`, `password`, optional `title`, and `roles`; the backend creates the user, password credential, role bindings, and audit event in one transaction. These accounts are active immediately, including Committer/MDE roles, because the operation already requires `users:manage`. Passwords and password hashes are never returned and must not appear in audit metadata.

In the local development profile (`NODE_ENV=development`, `AUTH_MODE=production`, `AUTH_PROVIDER=local`), self-registered accounts are intentionally attached to the seeded `org-chargelab` / `ChargeLab` demo organization so they can see the seeded parameter, log, and debugging data. Non-development local-account deployments keep the selected department organization ids (`org-hardware-department` or `org-software-department`) for tenant isolation.

Passwords are stored as salted `scrypt` hashes in `user_password_credentials`. Session tokens are returned once to the caller as opaque `we_local_*` bearer tokens only for successful login or non-committer registration; pending Committer registration and Admin-created local accounts never return a session token from their creation response. Only SHA-256 token hashes are persisted in `auth_sessions`. Sessions expire after the service TTL and logout sets `revoked_at`. Every register, login, logout, profile update, Admin user creation, role replacement, and activation change writes an audit event.

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
