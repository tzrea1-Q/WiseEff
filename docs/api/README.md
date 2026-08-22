# API Docs

> Chinese: [Chinese](../zh-CN/api/README.md)

WiseEff API documentation starts here. The design contract remains in [../design-docs/api-contract.md](../design-docs/api-contract.md), and the generated OpenAPI artifact remains in [../generated/openapi.json](../generated/openapi.json).

## Reading Order

1. [Authentication](authentication.md): development auth, production-mode bearer token, and smoke token usage.
2. [Errors](errors.md): structured error envelope and request id behavior.
3. [Examples](examples.md): curl examples for health, current user, parameters, logs, debugging, Agent, and pilot readiness.
4. [Log Analysis Integration](log-analysis-integration.md): push logs, poll jobs, fetch results, and verify result-webhook signatures.
5. [API Contract Design](../design-docs/api-contract.md): endpoint groups and domain contracts.
6. [OpenAPI Artifact](../generated/openapi.json): generated route/schema artifact checked by `npm run contract:check`.

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

## Schema-level DTO validation

OpenAPI component schemas for the M1–M4 HTTP clients (parameters, logs, debugging, Xiaoze threads / AG-UI run request / proactive suggest) are realized from Zod in `server/modules/contracts/dtoSchemas/`. `npm run contract:check` still compares the generated artifact; the same schemas parse successful JSON in `src/infrastructure/http` before DTO mapping. The suggest route validates its request before tool selection, and `useXiaozeSuggestions` fails closed to an empty list when a successful response drifts from `XiaozeSuggestResponse`.

This is schema-level validation, not a generated OpenAPI client. Handwritten mappers stay because they translate wire enums and units into domain types. Failures reuse the existing `WiseEffApiError` envelope (`INTERNAL_ERROR` with `details.reason = contract-drift`). Do not add a second error shape.

The five WiseEff CUSTOM event families (`xiaoze_turn_state`, `xiaoze_turn_reply`, `xiaoze_run_timing`, `xiaoze_prompt_debug`, and `on_interrupt`) have server-side Zod schemas exercised against frames produced by `xiaozeTurnStream`. Streaming transport still goes directly through `@ag-ui/client`; there is no fetch-wrapper or parser replacement. The generic AG-UI run response and uncovered REST surfaces (parameter-files, topology/specs, debugging admin, DTS reload, and knowledge) remain OpenAPI placeholders until a follow-up.
