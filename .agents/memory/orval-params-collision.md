---
name: Orval params name collision
description: When an operation has both path params AND query params, Orval generates ListXxxParams in both api.ts (Zod) and types/ (TypeScript), causing TS2308 when re-exported.
---

# Orval v8 — params name collision between api.ts and types/

## Rule
Never put query params on an operation that also has path params. Remove query params from those operations (filtering can be handled server-side as undocumented params).

## Why
Orval generates `<OperationIdPascal>Params` as:
- A Zod schema in `api.ts` for path params
- A TypeScript interface in `types/<op>Params.ts` for query params

When both are exported via `export * from "./generated/api"` and `export * from "./generated/types"`, TypeScript throws TS2308 ambiguity error.

Only operations with ONLY query params (no path params) avoid this collision — Orval generates `QueryParams` suffix in api.ts but `Params` in types/, so no collision.

## How to apply
When adding a new GET endpoint with path params + filters:
- Either omit query params from the OpenAPI spec and accept them implicitly on the server
- Or rename the operation so the generated names don't collide (operationId change doesn't help — Orval still uses the same naming convention)
- In practice: remove filter query params from any operation that has ≥1 path param
