## M6.2 Identity Evidence

- Date: 2026-06-04T05:13:07.313Z
- Status: `passed`
- Evidence scope: `local OIDC implementation drill (temporary issuer/JWKS; not target Keycloak evidence)`
- Issuer: `http://127.0.0.1:8790/realms/wiseeff`
- API base URL: `http://127.0.0.1:8791`
- Audience: `wiseeff-api`

### Checks

| Check | Status | HTTP | Detail |
| --- | --- | --- | --- |
| OIDC discovery/JWKS | passed | 200 | issuer and jwks_uri discovered; signing keys=1 |
| /api/v1/me | passed | 200 | {"user":{"id":"u-xu-yun","organizationId":"org-chargelab","name":"Xu Yun","email":"xu@chargelab.cn","title":"Platform Owner","isActive":true},"organization":{"id":"org-chargelab","name":"ChargeLab"},"roles":[{"projectId":null,"roleId":"a... |
| wrong issuer | passed | 401 | {"error":{"code":"UNAUTHENTICATED","message":"OIDC token issuer is not trusted.","details":{},"requestId":"5d51455a-8f39-4748-8259-b6c6794cb403"}} |
| wrong audience | passed | 401 | {"error":{"code":"UNAUTHENTICATED","message":"OIDC token audience is not accepted.","details":{},"requestId":"ba8a0fc5-07ec-4eaf-a080-bf96853a7a81"}} |
| expired token | passed | 401 | {"error":{"code":"UNAUTHENTICATED","message":"OIDC token has expired.","details":{},"requestId":"9e6672b2-f241-4a3c-bc20-2cd7eec06ec8"}} |
| browser token acquisition/refresh/logout | passed | n/a | local browser OIDC auth provider acquired a token after refresh and invoked logout on refresh failure |

### Blockers

- none

### Pending Evidence

- none
