# Noli Backend

## Stack

- **Language / Runtime**: TypeScript, Node.js
- **Framework**: NestJS 11
- **Key dependencies**: Mongoose (MongoDB), Passport JWT, class-validator, @nestjs/swagger
- **Package manager**: npm

## Build approach

<TBD, set by /scope>

## Commands

```bash
# Install
npm install

# Dev server
npm run start:dev

# Build
npm run build

# Test
npm test
npm run test:e2e
npm run test:cov
```

## Specs

Stored in `docs/specs/`. Format: `docs/specs/NNNN-title.md`. None exist yet.

## Rules

- Every route carries Swagger decorators (`@ApiTags`, `@ApiOperation`, `@ApiResponse`); docs are served at `/api/docs`. Route summaries and descriptions are mostly written in French, matching the product name (Noli).
- Request bodies are validated with `class-validator` DTOs, enforced globally by `ValidationPipe({ whitelist: true, transform: true })` in [src/main.ts](src/main.ts).
- Admin only routes: apply `@UseGuards(JwtAuthGuard)`, then manually check `req.user.role === 'admin'` inside the handler and throw `ForbiddenException`. There is no `RolesGuard`; see [src/auth/AGENTS.md](src/auth/AGENTS.md).
- Passwords are hashed with bcrypt (10 rounds); `User.password` is `select: false` so it must be requested explicitly (`.select('+password')`) to compare it.
- List/search queries use `.lean()`; anything that gets mutated and `.save()`d (e.g. rating a series, updating watch progress) loads the full Mongoose document instead.
- Manual pagination convention: `page`/`limit` query params, `skip = (page - 1) * limit`, response shaped as `{ total, page, limit, ...items }`.
- Tests are Jest, one `*.spec.ts` per service/controller, with the Mongoose `Model` mocked via `getModelToken(<Schema>.name)` rather than hitting a real database.
- Required env vars (see `.env`, not committed): `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRATION`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRATION`, `NODE_ENV`, `PORT`.

## Agent skills

- [nestjs-best-practices](.agents/skills/nestjs-best-practices/): `kadajett/agent-nestjs-skills`, NestJS module/DI/security/performance patterns
- [mongodb-query-optimizer](.agents/skills/mongodb-query-optimizer/): `mongodb/agent-skills`, efficient Mongoose/MongoDB query patterns

Declined: swagger-doc-creator (jeremylongshore/tons-of-skills-marketplace)
MCP servers: MongoDB MCP server (recommended, github.com/mongodb-js/mongodb-mcp-server) — not connected yet, see report

## Context files

- [src/auth/AGENTS.md](src/auth/AGENTS.md): JWT access/refresh token flow, the admin check convention, and guard gotchas

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
