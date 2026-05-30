# API Examples

Examples assume:

```text
WISEEFF_API_BASE_URL=http://127.0.0.1:8787
```

For production-mode routes, set:

```text
AUTHORIZATION="Bearer ..."
```

PowerShell uses `$env:WISEEFF_API_BASE_URL` and `$env:AUTHORIZATION` for environment variables. `curl` without `.exe` is an alias for `Invoke-WebRequest`, so use `Invoke-RestMethod` or call `curl.exe` explicitly when running curl examples on Windows.

## Health

```bash
curl -fsS "$WISEEFF_API_BASE_URL/health/live"
curl -fsS "$WISEEFF_API_BASE_URL/health/ready"
```

```powershell
Invoke-RestMethod -Uri "$env:WISEEFF_API_BASE_URL/health/live"
Invoke-RestMethod -Uri "$env:WISEEFF_API_BASE_URL/health/ready"
```

## Current User

```bash
curl -fsS \
  -H "Authorization: $AUTHORIZATION" \
  "$WISEEFF_API_BASE_URL/api/v1/me"
```

```powershell
$headers = @{ Authorization = $env:AUTHORIZATION }
Invoke-RestMethod -Headers $headers -Uri "$env:WISEEFF_API_BASE_URL/api/v1/me"
```

## Pilot Readiness

```bash
curl -fsS \
  -H "Authorization: $AUTHORIZATION" \
  "$WISEEFF_API_BASE_URL/api/v1/operations/pilot-readiness"
```

```powershell
$headers = @{ Authorization = $env:AUTHORIZATION }
Invoke-RestMethod -Headers $headers -Uri "$env:WISEEFF_API_BASE_URL/api/v1/operations/pilot-readiness"
```

## Parameter List

```bash
curl -fsS \
  -H "Authorization: $AUTHORIZATION" \
  "$WISEEFF_API_BASE_URL/api/v1/projects/aurora/parameters"
```

```powershell
$headers = @{ Authorization = $env:AUTHORIZATION }
Invoke-RestMethod -Headers $headers -Uri "$env:WISEEFF_API_BASE_URL/api/v1/projects/aurora/parameters"
```

## Logs

```bash
curl -fsS \
  -H "Authorization: $AUTHORIZATION" \
  "$WISEEFF_API_BASE_URL/api/v1/logs?projectId=aurora"
```

```powershell
$headers = @{ Authorization = $env:AUTHORIZATION }
Invoke-RestMethod -Headers $headers -Uri "$env:WISEEFF_API_BASE_URL/api/v1/logs?projectId=aurora"
```

## Agent Session

```bash
curl -fsS \
  -H "Authorization: $AUTHORIZATION" \
  -H "Content-Type: application/json" \
  -d '{"pageKey":"parameters","path":"/parameters","projectId":"aurora"}' \
  "$WISEEFF_API_BASE_URL/api/v1/agent/sessions"
```

```powershell
$headers = @{
  Authorization = $env:AUTHORIZATION
  "Content-Type" = "application/json"
}

$body = @{
  pageKey = "parameters"
  path = "/parameters"
  projectId = "aurora"
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Headers $headers -Body $body -Uri "$env:WISEEFF_API_BASE_URL/api/v1/agent/sessions"
```

Use the OpenAPI artifact for exact request/response shapes before building an external integration.
