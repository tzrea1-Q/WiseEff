# API Examples

Examples assume:

```text
WISEEFF_API_BASE_URL=http://127.0.0.1:8787
```

For production-mode routes, set:

```text
AUTHORIZATION="Bearer ..."
```

## Health

```bash
curl -fsS "$WISEEFF_API_BASE_URL/health/live"
curl -fsS "$WISEEFF_API_BASE_URL/health/ready"
```

## Current User

```bash
curl -fsS \
  -H "Authorization: $AUTHORIZATION" \
  "$WISEEFF_API_BASE_URL/api/v1/me"
```

## Pilot Readiness

```bash
curl -fsS \
  -H "Authorization: $AUTHORIZATION" \
  "$WISEEFF_API_BASE_URL/api/v1/operations/pilot-readiness"
```

## Parameter List

```bash
curl -fsS \
  -H "Authorization: $AUTHORIZATION" \
  "$WISEEFF_API_BASE_URL/api/v1/projects/aurora/parameters"
```

## Logs

```bash
curl -fsS \
  -H "Authorization: $AUTHORIZATION" \
  "$WISEEFF_API_BASE_URL/api/v1/logs?projectId=aurora"
```

## Agent Session

```bash
curl -fsS \
  -H "Authorization: $AUTHORIZATION" \
  -H "Content-Type: application/json" \
  -d '{"pageKey":"parameters","path":"/parameters","projectId":"aurora"}' \
  "$WISEEFF_API_BASE_URL/api/v1/agent/sessions"
```

Use the OpenAPI artifact for exact request/response shapes before building an external integration.
