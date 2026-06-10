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

## Common Codes

| Code | Meaning |
| --- | --- |
| `UNAUTHENTICATED` | Missing or invalid identity. |
| `FORBIDDEN` | Identity is valid but lacks permission or scope. |
| `VALIDATION_FAILED` | Request body or query parameters are invalid. |
| `CONFLICT` | Expected version, state, lease, or approval status no longer matches. |
| `NOT_FOUND` | Target object does not exist or is outside scope. |
| `INTERNAL_ERROR` | Unexpected server failure. |

## Operator Rule

For high-risk writes, an error without request/audit traceability is itself an incident to investigate.
