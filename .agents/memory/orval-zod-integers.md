---
name: Orval + Zod v3 integers
description: Orval v8 generates zod.int() for OpenAPI type:integer response fields, which doesn't exist in Zod v3. Fix by using type:number in component schemas.
---

# Orval v8 + Zod v3 — integer fields in response schemas

## Rule
Use `type: number` (NOT `type: integer`) for all fields inside `components/schemas` (response bodies). Only use `type: integer` for path and query parameters.

## Why
Orval v8 maps OpenAPI `type: integer` to `zod.int()` in response object schemas. `zod.int()` does not exist in Zod v3 — it's a Zod v4-only method. Zod v3 uses `z.number().int()` instead. For path/query params, Orval correctly generates `zod.coerce.number().int()` which works fine.

## How to apply
- In `openapi.yaml`, all `id`, `tenantId`, `count`, `maxAgents`, etc. in component schemas → `type: number`
- Path params like `{tenantId}` can stay as `type: integer` (Orval uses coerce for params)
- Query params with integer values (page, limit) can also stay as `type: integer`
