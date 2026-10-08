# Auth

## Overview

Handles login, token refresh, and route protection. There is no separate registration endpoint here; account creation lives in `POST /users/register` (see [src/users/users.controller.ts](../users/users.controller.ts)), which is why `AuthModule` depends on `UsersModule`.

## Key files

| File | Owns |
|---|---|
| [auth.service.ts](auth.service.ts) | Login (verifies password, issues tokens), refresh (verifies refresh token, issues a new access token) |
| [strategies/jwt.strategy.ts](strategies/jwt.strategy.ts) | Validates the access token's Bearer header, looks the user up by `payload.userId`, and returns the **full Mongoose user document** as `req.user` |
| [guards/jwt-auth.guard.ts](guards/jwt-auth.guard.ts) | Thin wrapper around Passport's `AuthGuard('jwt')` |

## Conventions

- Two separate secrets and lifetimes: `JWT_SECRET`/`JWT_EXPIRATION` for access tokens, `JWT_REFRESH_SECRET`/`JWT_REFRESH_EXPIRATION` for refresh tokens. Both are read via `ConfigService.getOrThrow`, so a missing env var fails at token creation time, not at boot.
- `JwtStrategy.validate` returns the full user (via `UsersService.findById`), so any `@UseGuards(JwtAuthGuard)` handler gets `req.user.role`, `req.user.subscription`, etc, not just the JWT payload. Controllers rely on this to do the admin check described in the root `AGENTS.md`.
- There is no `RolesGuard` or `@Roles()` decorator. Every admin only route repeats the same manual check: `if (req.user.role !== 'admin') throw new ForbiddenException(...)`. If you add a new admin route, follow this same inline pattern for consistency (or introduce a shared guard and update all call sites together).

## Gotchas

- `JwtAuthGuard` and `JwtStrategy` both have `console.log` debug statements on every authenticated request (token validity, payload, user lookup). Noisy in production logs; not required for the guard to function.
- `jwt-auth.guard.ts` still has an earlier, simpler implementation commented out above the current one.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
