# API Authentication

WiseEff supports development auth for local tests and production-mode bearer tokens for pilot/staging checks.

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

## Production Mode

Production-mode auth is selected with:

```text
AUTH_MODE=production
AUTH_TOKEN_ISSUER=wiseeff-local
AUTH_TOKEN_HMAC_SECRET=<secret>
```

Requests must include:

```text
Authorization: Bearer <base64url-json-payload>.<hmac-sha256-signature>
```

Signed claims must include issuer, subject, and organization. Roles and permissions are taken only from signed claims.

## Smoke Tokens

M5 smoke accepts:

```text
M5_SMOKE_AUTHORIZATION
WISEEFF_SMOKE_AUTHORIZATION
```

Use a token with `admin:access` when probing `/api/v1/operations/pilot-readiness`.

Do not commit real staging or production bearer tokens.
