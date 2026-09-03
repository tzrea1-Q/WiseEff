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

## Knowledge Search

Search covers published entries only; drafts and archived entries never appear in results.

```bash
curl -fsS \
  -H "Authorization: $AUTHORIZATION" \
  "$WISEEFF_API_BASE_URL/api/v1/knowledge/search?q=fast%20charge"
```

```powershell
$headers = @{ Authorization = $env:AUTHORIZATION }
Invoke-RestMethod -Headers $headers -Uri "$env:WISEEFF_API_BASE_URL/api/v1/knowledge/search?q=fast%20charge"
```

## Create Knowledge Entry

```bash
curl -fsS -X POST \
  -H "Authorization: $AUTHORIZATION" \
  -H "Content-Type: application/json" \
  -d '{"contentForm":"markdown","title":"Fast charge tuning notes","tags":["project-aurora"],"contentMarkdown":"Increase current in 0.5A steps."}' \
  "$WISEEFF_API_BASE_URL/api/v1/knowledge/entries"
```

Entries start as drafts; `POST /api/v1/knowledge/entries/{entryId}/publish` moves them into retrieval. Saves via `PATCH` must carry `expectedHeadRevisionNumber` and receive a structured `409` when stale.

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

## Canonical Parameter Catalog

These examples freeze the S8-CON client contract. HTTP handlers land in later tickets; a current local API may still return 404.

```bash
curl -fsS \
  -H "Authorization: $AUTHORIZATION" \
  "$WISEEFF_API_BASE_URL/api/v2/catalog"

curl -fsS \
  -H "Authorization: $AUTHORIZATION" \
  -H "X-WiseEff-Catalog-Release: crel_01K42" \
  -H "If-Match: \"review-item-prev_01KAMBIG-v7\"" \
  -H "Idempotency-Key: resolve-review-prev-01KAMBIG-v7" \
  -H "Content-Type: application/json" \
  -d '{"resolution":{"type":"register-subject","subjectId":"csub_01KSC8562","placement":{"mode":"use-default"}},"reason":"explicit placement"}' \
  "$WISEEFF_API_BASE_URL/api/v2/organizations/org_acme/parameter-review-items/prev_01KAMBIG/resolve"

curl -fsS \
  -H "Authorization: $AUTHORIZATION" \
  "$WISEEFF_API_BASE_URL/api/v2/catalog/legacy-identifiers/parameter-spec/spec-sc8562-gpio-int"
```

Catalog writes send `X-WiseEff-Catalog-Release` and `Idempotency-Key`. Mutable review/placement/proposal writes also send `If-Match`. Clients must not send `X-WiseEff-Role` or other self-asserted actor headers. Branch on `error.details.reason`; do not parse `message`.
