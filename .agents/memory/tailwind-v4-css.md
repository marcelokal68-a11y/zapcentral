---
name: Tailwind v4 CSS setup
description: This project uses Tailwind v4 (@tailwindcss/vite). CSS syntax is different from v3 — use @import not @tailwind directives, @theme inline for token mapping.
---

# Tailwind v4 CSS conventions

## Rule
- Use `@import "tailwindcss"` at the top (NOT `@tailwind base; @tailwind components; @tailwind utilities;`)
- Map CSS variables to Tailwind color tokens via `@theme inline { --color-border: hsl(var(--border)); ... }`
- Never use `@apply border-border` — instead write `border-color: hsl(var(--border))` inside a bare `* {}` rule in `@layer base`
- CSS custom properties go in `@layer base { :root { ... } }`

## Why
`@tailwind` directives were removed in Tailwind v4. The new approach uses CSS `@import` and `@theme` at-rules. `@apply border-border` fails because `border-border` is a generated utility class that requires the token to be in `@theme`; the base-layer `* { @apply border-border }` pattern must be replaced with a direct CSS rule.

## Reference
See `artifacts/mockup-sandbox/src/index.css` as the canonical working example for this project.
