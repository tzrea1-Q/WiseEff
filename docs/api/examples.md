# API Examples

> Chinese: [Chinese](../zh-CN/api/examples.md)

Examples assume:

```text
WISEEFF_API_BASE_URL=http://127.0.0.1:8787
```

For production-mode routes, set:

```text
AUTHORIZATION="Bearer ..."
```

PowerShell uses `$env:WISEEFF_API_BASE_URL` and `$env:AUTHORIZATION` for environment variables. `curl` without `.exe` is an alias for `Invoke-WebRequest`, so use `Invoke-RestMethod` or call `curl.exe` explicitly when running curl examples on Windows.

Manual PowerShell sessions do not automatically load `.env`. To load local values before running the examples:

```powershell
Get-Content .env | Where-Object { $_ -and $_ -notmatch '^\s*#' -and $_ -match '=' } | ForEach-Object {
  $name, $value = $_ -split '=', 2
  [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), 'Process')
}

$env:WISEEFF_API_BASE_URL
```

The last command must print a URL. If it is blank, the API probe URL will be missing its host.

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

## Xiaoze Threads

```bash
curl -fsS \
  -H "Authorization: $AUTHORIZATION" \
  "$WISEEFF_API_BASE_URL/api/v1/agent/xiaoze/threads"
```

```powershell
$headers = @{ Authorization = $env:AUTHORIZATION }
Invoke-RestMethod -Headers $headers -Uri "$env:WISEEFF_API_BASE_URL/api/v1/agent/xiaoze/threads"
```

Agent turns use `POST /api/v1/agent/xiaoze` (AG-UI). Use the OpenAPI artifact for exact request/response shapes before building an external integration.
