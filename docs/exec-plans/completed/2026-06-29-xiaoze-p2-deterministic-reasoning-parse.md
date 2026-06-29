# Xiaoze P2 — Deterministic Reasoning Parse

Status: completed (2026-06-29)

## Summary

Replace fragile language/character heuristics for reasoning vs answer classification with structured-field-first parsing via a single `reasoningClassifier` module shared by `perceptionAgent` and `agUiEndpoint`.

## Documentation Impact Matrix

| Doc | Impact | Updated |
| --- | --- | --- |
| `docs/developer/environment-variables.md` | New `XIAOZE_REASONING_FALLBACK_HEURISTIC` | [x] |
| `docs/zh-CN/developer/environment-variables.md` | Chinese mirror | [x] |
| `.env.example` | New env default | [x] |

## Documentation Update Gate

- [x] English env vars doc updated
- [x] Chinese env vars doc updated
- [x] `.env.example` updated
- [x] No AG-UI protocol / frontend contract changes

## Tasks

- [x] Task 1: Add `reasoningClassifier` module with structured metadata + tag priority
- [x] Task 2: Wire `wrapLangChainChatModel` and remove duplicate `normalizeSinkEventForAgUi` heuristic
- [x] Task 3: Add `XIAOZE_REASONING_FALLBACK_HEURISTIC` env (default `false`)
- [x] Task 4: Unit + fast-check property tests
- [x] Task 5: `npm run test:server` + `npm run build`

## Technical debt note

`needsFullAnswerResync` in `agUiEndpoint.ts` remains as a finalize-time safety net when streamed answer text diverges from the final turn text (e.g. misclassified upstream deltas). Can be removed once streaming classification is proven stable in production with structured reasoning fields only.
