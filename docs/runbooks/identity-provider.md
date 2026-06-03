# Identity Provider Runbook

This runbook covers the M6.2 self-hosted OIDC path. Keycloak is the reference provider, but the WiseEff API accepts any OIDC provider that exposes discovery metadata, JWKS signing keys, issuer validation, audience validation, and the WiseEff role claims described below.

## Operating Model

- Keycloak authenticates the user and issues access tokens.
- WiseEff remains the source of truth for project-scoped authorization and user governance.
- The OIDC token proves identity; WiseEff resolves active state, role bindings, and permissions from PostgreSQL by organization plus `sub`, falling back to email only when the provider marks the claim with `email_verified=true`.
- Production auth uses `AUTH_PROVIDER=oidc`; HMAC bearer tokens are retained only for local smoke or test profiles.
- `/api/v1/me` must return the same `AuthContext` shape regardless of whether the token came from local HMAC smoke or OIDC.
- User mutations are performed through WiseEff backend APIs and must write audit events.

## Environment

Self-hosted production profile:

```text
AUTH_MODE=production
AUTH_PROVIDER=oidc
AUTH_OIDC_ISSUER=https://<host>/realms/wiseeff
AUTH_OIDC_AUDIENCE=wiseeff-api
AUTH_OIDC_JWKS_URI=
M6_SELFHOSTED_SMOKE_AUTHORIZATION=Bearer <admin-access-token>
```

`AUTH_OIDC_JWKS_URI` is optional when the provider exposes a valid discovery document at the issuer URL. Set it only when discovery is unavailable or the deployment needs a pinned JWKS endpoint.

Local non-HDC smoke may continue to use:

```text
AUTH_PROVIDER=hmac
AUTH_TOKEN_ISSUER=wiseeff-local
AUTH_TOKEN_HMAC_SECRET=<local-secret>
```

Do not use static HMAC smoke tokens as target-environment identity evidence.

## Keycloak Setup

1. Create a realm named `wiseeff`.
2. Create a client named `wiseeff-api`.
3. Configure the client audience so access tokens include `aud=wiseeff-api`.
4. Configure allowed redirect origins for the self-hosted WiseEff web origin.
5. Create an Admin recovery user with MFA and store emergency credentials according to the local secrets procedure.
6. Create initial named users in Keycloak for target-environment smoke, Admin operation, and non-Admin negative checks.
7. Configure stable subject and verified email claims. `sub` should match a WiseEff user id when possible; otherwise the email claim must match the WiseEff governed user email and the token must include `email_verified=true`.
8. Optional: configure a token mapper that emits WiseEff role bindings in the access token as `wiseeff_roles` for bootstrap diagnostics. WiseEff does not use this claim as the final production authorization source after M6.2.

When present, `wiseeff_roles` is an array:

```json
[
  { "projectId": null, "roleId": "admin" },
  { "projectId": "aurora", "roleId": "hardware-user" }
]
```

Allowed role ids are `guest`, `hardware-user`, `software-user`, `hardware-committer`, `software-committer`, and `admin`.

## Token Policy

- Access tokens must include issuer, subject, audience, expiration, and organization. Email is strongly recommended because WiseEff can use it as a fallback link when the IdP subject does not equal a WiseEff user id.
- Use short access-token lifetimes for browser sessions.
- Enable refresh according to the selected frontend OIDC runtime or reverse-proxy/session handoff.
- Expired, wrong-issuer, wrong-audience, unsigned, and malformed-role tokens must be rejected by the API.

## User Governance

Use WiseEff, not Keycloak, for project-scoped role changes:

- `GET /api/v1/users`
- `POST /api/v1/users`
- `PATCH /api/v1/users/:userId`
- `PATCH /api/v1/users/:userId/activation`
- `PUT /api/v1/users/:userId/roles`

Only active users with `users:manage` may call mutation routes. The API must prevent self-lockout and no-final-admin states, and it must write audit events for create, update, activation, deactivation, and role replacement.

Creating a WiseEff user does not automatically provision a Keycloak account. Operators must provision or link the external account so the OIDC `sub` or email claim resolves to the WiseEff user record before that person can authenticate as the governed account.

## Signing Key Rotation

1. Add a new signing key in Keycloak while keeping the old key enabled.
2. Wait for WiseEff JWKS cache refresh and verify a token signed by the new key.
3. Run `/api/v1/me` with an Admin token and a non-Admin token.
4. Run the self-hosted smoke with `M6_SELFHOSTED_SMOKE_AUTHORIZATION`.
5. Disable the old key only after both old-key and new-key token windows are understood.
6. Archive redacted evidence with issuer, key id, token expiry, and smoke result.

## Incident Response

If users cannot authenticate:

1. Check Keycloak health and realm availability.
2. Confirm `AUTH_OIDC_ISSUER` matches the token `iss` claim exactly after trailing slash normalization.
3. Confirm `AUTH_OIDC_AUDIENCE` matches the token `aud` claim.
4. Confirm the JWKS endpoint returns the signing key id used by the token.
5. Confirm the token organization, `sub`, and email claims match an active WiseEff user.
6. If `wiseeff_roles` is present, confirm it uses supported role ids.
7. Review WiseEff API error codes and request ids, then correlate audit/security events.

If Admin access is lost:

1. Use the Keycloak emergency Admin account to issue a valid Admin token.
2. Restore or assign a WiseEff `admin` role through the WiseEff governance API.
3. Verify `/api/v1/me` returns `admin:access` and `users:manage`.
4. Record the recovery action, actor, request id, and reason in the incident log.

## Evidence Gate

TD-020 remains open until target-environment OIDC evidence exists. Required evidence includes OIDC discovery/JWKS validation, `/api/v1/me` with real target tokens, token-expiry rejection, wrong-audience or wrong-issuer rejection, Admin user-governance success, non-Admin rejection, and redacted browser/runtime evidence.

Prepare four target tokens before running the identity gate:

- Admin access token for the WiseEff target.
- Access token signed by an untrusted issuer or configured against a wrong issuer.
- Access token with a wrong audience.
- Expired access token.

Then run:

```bash
npm run identity:check -- --issuer=https://<idp-host>/realms/wiseeff --api-base-url=https://<wiseeff-host> --audience=wiseeff-api --authorization="Bearer <admin-token>" --wrong-issuer-authorization="Bearer <wrong-issuer-token>" --wrong-audience-authorization="Bearer <wrong-audience-token>" --expired-authorization="Bearer <expired-token>" --browser-runtime=pending
```

Use `--browser-runtime=passed` only after browser token acquisition, refresh, and logout have been verified and archived separately. The command writes redacted evidence to `docs/generated/m6-identity-evidence.md`; this evidence proves the target OIDC gate only when it was run against the real self-hosted identity provider and API.
