# API Errors

> Chinese: [Chinese](../zh-CN/api/errors.md)

WiseEff APIs return structured errors so frontend clients, smoke scripts, and operators can diagnose failures.

## Shape

Errors include:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "User does not have permission.",
    "requestId": "req_..."
  }
}
```

The exact fields may vary by endpoint, but `code`, readable `message`, and request correlation are expected for production paths.

## Request Id

Clients may send:

```text
X-Request-Id: <client-generated-id>
```

The API reflects or generates a request id and propagates it to audit events where supported.

## Codes

The HTTP status is derived from the code (`API_ERROR_STATUS` in `server/shared/http/errors.ts`); a code/status mismatch cannot occur.

| Code | Status | Meaning |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | Missing or invalid identity. |
| `FORBIDDEN` | 403 | Identity is valid but lacks permission or scope. |
| `VALIDATION_FAILED` | 400 | Request body or query parameters are invalid. |
| `CONFLICT` | 409 | Expected version, state, lease, or approval status no longer matches. |
| `APPROVAL_REQUIRED` | 409 | The action pauses until a human approves it. |
| `INVALID_APPROVAL_STATE` | 409 | The approval is not in a state that allows this transition. |
| `DEVICE_UNAVAILABLE` | 409 | The target device or bridge is not connected or not usable. |
| `PROTOCOL_UNSUPPORTED` | 409 | The requested device protocol is not supported by the gateway. |
| `DEBUG_BINDING_NOT_CONFIGURED` | 400 | The debug node has no binding for the requested protocol. |
| `DEBUG_BINDING_DISABLED` | 400 | The debug node binding exists but is disabled. |
| `NOT_FOUND` | 404 | Target object does not exist or is outside scope. |
| `GONE` | 410 | The surface is retired and permanently unavailable. |
| `RATE_LIMITED` | 429 | Too many authentication attempts in the local sliding window (`AUTH_LOCAL_AUTH_MAX_ATTEMPTS` / `AUTH_LOCAL_AUTH_WINDOW_MS`). |
| `INTERNAL_ERROR` | 500 | Unexpected server failure. |

## Operator Rule

For high-risk writes, an error without request/audit traceability is itself an incident to investigate.
