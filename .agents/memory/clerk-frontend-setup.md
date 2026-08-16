---
name: Clerk frontend setup
description: Clerk in the React/Vite app requires @clerk/shared as an explicit dep; publishableKey must use publishableKeyFromHost, never raw env var.
---

# Clerk frontend wiring (React + Vite)

## Rule
1. `@clerk/shared` must be in `artifacts/app/package.json` dependencies — it is NOT pulled in automatically by `@clerk/react`.
2. Always compute publishable key as:
   ```ts
   import { publishableKeyFromHost } from "@clerk/shared/keys";
   const clerkPubKey = publishableKeyFromHost(
     window.location.hostname,
     import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
   );
   ```
3. `proxyUrl` must be unconditional: `import.meta.env.VITE_CLERK_PROXY_URL ?? ""`
4. Sign-in/up route paths: exactly `"/sign-in/*?"` and `"/sign-up/*?"` (with optional `?`)
5. WouterRouter base: `import.meta.env.BASE_URL.replace(/\/$/, "")` — set ONCE in App.tsx, never repeated in pages

## Why
Using raw `import.meta.env.VITE_CLERK_PUBLISHABLE_KEY` directly breaks multi-domain setups (production custom domains). `publishableKeyFromHost` resolves the correct key for the actual request hostname. `@clerk/shared` is not hoisted in this pnpm workspace — it must be declared explicitly.
