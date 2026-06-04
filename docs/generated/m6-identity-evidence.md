## M6.2 Identity Evidence

- Date: 2026-06-04T05:14:13.183Z
- Status: `failed`
- Evidence scope: `target self-hosted OIDC`
- Issuer: ``
- API base URL: ``
- Audience: ``

### Checks

| Check | Status | HTTP | Detail |
| --- | --- | --- | --- |
| OIDC discovery/JWKS | failed | n/a | AUTH_OIDC_ISSUER or --issuer is required. |
| /api/v1/me | failed | n/a | authorization token is required. |
| wrong issuer | failed | n/a | authorization token is required. |
| wrong audience | failed | n/a | authorization token is required. |
| expired token | failed | n/a | authorization token is required. |

### Blockers

- OIDC discovery/JWKS evidence failed.
- /api/v1/me target token evidence failed.
- OIDC negative token check failed: wrong issuer.
- OIDC negative token check failed: wrong audience.
- OIDC negative token check failed: expired token.

### Pending Evidence

- Browser token acquisition/refresh/logout evidence is pending.
