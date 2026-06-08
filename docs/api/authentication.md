# API Authentication

WiseEff supports development auth for local tests, HMAC bearer tokens for local smoke profiles, and OIDC/JWKS bearer tokens for the M6.2 self-hosted identity path.

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
