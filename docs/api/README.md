# API Docs

WiseEff API documentation starts here. The design contract remains in [../design-docs/api-contract.md](../design-docs/api-contract.md), and the generated OpenAPI artifact remains in [../generated/openapi.json](../generated/openapi.json).

## Reading Order

1. [Authentication](authentication.md): development auth, production-mode bearer token, and smoke token usage.
2. [Errors](errors.md): structured error envelope and request id behavior.
3. [Examples](examples.md): curl examples for health, current user, parameters, logs, debugging, Agent, and pilot readiness.
4. [API Contract Design](../design-docs/api-contract.md): endpoint groups and domain contracts.
5. [OpenAPI Artifact](../generated/openapi.json): generated route/schema artifact checked by `npm run contract:check`.

## Contract Workflow

Run:

```bash
npm run contract:check
```

before claiming API contract freshness. If route metadata changes intentionally, regenerate the artifact with:

```bash
npm run contract:openapi
```

and review frontend DTO/client impact.
