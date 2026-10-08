# 0007. Forgot password

**Date**: 2026-10-06
**Status**: In Progress

## Summary

This lets a user who forgot their password get back into their account on their own. They type their email in the app, receive a 6 digit code by email (sent through Brevo, an email sending service), type the code, then choose a new password and land signed in. The code works once, for 15 minutes, with 5 tries at most, and the API never reveals whether an email has a Noli account. A reset also signs out every other device, through a new version number on the user that every token now carries.

## Requirements

**User stories**:
- As a user who forgot my password, I want to receive a code by email and choose a new password so that I get my account back without contacting anyone.
- As a user whose account may have been taken over, I want a reset to sign out every other device and to be told by email that my password changed, so that an intruder loses access and I notice it.
- As the Noli team, we want the reset flow to give nothing away about who has an account, and to resist guessing and spamming, so that it can't be used to attack users.

**Acceptance criteria** (the contract):
- **AC-1**: `POST /auth/password/forgot` with `{ email }` for an existing account → `200` with `{ message: 'Si un compte existe pour cet email, un code a été envoyé.' }`, and an email in French reaches that address with a 6 digit code valid for 15 minutes. The answer is sent before any database or email work happens.
- **AC-2**: The same call with an email that has no account → the exact same `200` and message, no email sent, and no record created. A malformed email (not an email shape) → `400`, as for any DTO error.
- **AC-3**: A new request cancels every earlier pending or verified request of that user: only the code from the latest email can work, even when two requests arrive at the same moment.
- **AC-4**: Per account limits: a request for the same account within 60 seconds of the previous one, a sixth within one hour, or an eleventh within 24 hours answers the same `200` and message but sends nothing and creates nothing (silently dropped, so the limit never reveals that the account exists). Every request counts, whatever its status.
- **AC-5**: `POST /auth/password/verify-code` with `{ email, code }` and the right code of the latest request, within 15 minutes and under 5 wrong tries → `200` with `{ message: 'Code vérifié', resetToken, expiresAt }`. `resetToken` is an opaque random string valid 10 minutes from verification; `expiresAt` is that moment as an ISO 8601 string.
- **AC-6**: A wrong code, an expired code, a cancelled, verified, or used request, an email with no account, an email with no request, or any invalid input (missing or non string `email` or `code`, a malformed email, a code that is not 6 digits) → `400` with `{ statusCode: 400, code: 'INVALID_OR_EXPIRED_CODE', message: 'Code invalide ou expiré' }`. The answer is identical in every case (no count of tries left).
- **AC-7**: The 5th wrong code cancels the request: even the right code then answers `400 INVALID_OR_EXPIRED_CODE`. Wrong tries sent at the same moment are all counted (no race lets a 6th guess through). Across all of an account's requests, after 15 wrong codes within 24 hours every verify for that account answers `400 INVALID_OR_EXPIRED_CODE` until the oldest of those tries is more than 24 hours old.
- **AC-8**: `POST /auth/password/reset` with `{ resetToken, newPassword }` → `200` with `{ message: 'Mot de passe réinitialisé', accessToken, refreshToken, user }`, the same `user` fields as `POST /auth/login`. The user can log in with the new password and no longer with the old one. `isEmailVerified` becomes `true`.
- **AC-9**: After a reset, every access token and refresh token issued before it answers `401` (on any guarded route, and on `POST /auth/refresh`). The tokens returned by the reset itself work. Tokens issued before this feature shipped keep working until a reset happens on that account (no mass sign out at deploy).
- **AC-10**: A reset token works once: a second `POST /auth/password/reset` with it → `400` with `{ statusCode: 400, code: 'INVALID_OR_EXPIRED_TOKEN', message: 'Session de réinitialisation invalide ou expirée' }`. An expired or unknown token, a token whose request was cancelled by a newer one, an access or refresh token sent as `resetToken`, or a missing or non string `resetToken` → the same `400`.
- **AC-11**: `newPassword` must be a string of 6 to 72 characters, else `400` (default DTO error) and nothing changes.
- **AC-12**: After a successful reset, an email in French tells the user their password was just changed, and what to do if it wasn't them. A failure to send it never fails the reset.
- **AC-13**: Per IP limits: more than 20 calls to `/forgot`, or more than 30 calls to `/verify-code`, from the same IP within one hour → `429` with message `'Trop de tentatives, réessayez plus tard'`. Each route has its own counter, and the image upload limit (spec 0005) is unchanged.
- **AC-14**: Brevo failing or timing out never changes the `/forgot` answer; the failure is logged with the user id (never the code, never the email address). With no Brevo key and `NODE_ENV` exactly `development` or `test`, the code is written to the server log instead, so the flow can be tested end to end. With no Brevo key and any other `NODE_ENV` (including unset), `/forgot` answers `503` with `{ statusCode: 503, code: 'MAIL_UNAVAILABLE', message: 'Service email indisponible' }` for every email.
- **AC-15**: The code and the reset token are never stored in clear: the database holds only HMACs of them (keyed fingerprints that can't be reversed without the secret). Request records disappear by themselves 24 hours after creation.
- **AC-16**: Admin accounts use the same flow, with the same rules.
- **AC-17**: Once `MAIL_DAILY_CAP` reset requests (default 250) have been created across all accounts in the last 24 hours, further `/forgot` calls answer the same `200` but create and send nothing, and an error is logged once per dropped call.
- **AC-18**: The app refuses to boot when `PASSWORD_RESET_SECRET` is missing, shorter than 32 characters, or equal to `JWT_SECRET` or `JWT_REFRESH_SECRET`, or when `BREVO_API_KEY` is set without `MAIL_FROM_EMAIL`. In production with `TRUST_PROXY` unset, it boots with a warning in the log.

## Decision

**Chosen option**: Option 2: Emailed 6 digit code, two steps (verify, then reset), HMAC stored codes and opaque reset tokens, `tokenVersion` session cut, Brevo over its HTTP API.

The user proves they own the email with a short lived code typed in the app; a verified code becomes a 10 minute, single use reset token; the reset bumps a version number that every token carries, which signs out all older sessions.

**Implementation skills**: `nestjs-best-practices` (`kadajett/agent-nestjs-skills`, `.agents/skills/nestjs-best-practices/`) · `email-and-password-best-practices` (`better-auth/skills`, `.agents/skills/email-and-password-best-practices/`, written for Better Auth; only its general reset and password policy advice applies here)

## Feature design

**Module layout**: `src/auth/password-reset/` holds `password-reset.schema.ts`, `password-reset.service.ts`, `password-reset.controller.ts`, and `dto/`. Everything is registered in `AuthModule`, which adds `MongooseModule.forFeature([PasswordReset])` and imports the new `MailModule` (`src/mail/`, no dependency back on auth). `PasswordResetService` uses `UsersService` (already imported by `AuthModule`) for lookups and the `User` model for the atomic password update, and calls a new public `AuthService.issueTokens(user)` that returns `{ accessToken, refreshToken, user }` in the login shape; `login()` is refactored to use it too.

**Data model sketch**:

`password_resets` (new collection, model `PasswordReset`, `timestamps: true`)

| Field | Type | Rule |
|---|---|---|
| `_id` | ObjectId | primary key, generated before hashing (`new Types.ObjectId()`) |
| `userId` | ObjectId → `users._id` | required; index `{ userId: 1, createdAt: -1 }` |
| `codeHash` | string | required, hex HMAC-SHA256(`PASSWORD_RESET_SECRET`, `` `code:${_id}:${code}` ``) |
| `expiresAt` | Date | required, creation + 15 minutes |
| `attempts` | number | default 0, wrong tries on this request, at most 5 |
| `status` | `'pending' \| 'verified' \| 'used' \| 'cancelled'` | default `'pending'` |
| `verifiedAt` | Date \| null | set when the code is accepted |
| `resetTokenHash` | string \| null | hex HMAC-SHA256(`PASSWORD_RESET_SECRET`, `` `token:${token}` ``); sparse unique index |
| `resetTokenExpiresAt` | Date \| null | `verifiedAt` + 10 minutes |
| `usedAt` | Date \| null | set when the password is changed |
| `createdAt`, `updatedAt` | Date | from `timestamps`; TTL index on `createdAt` with `expireAfterSeconds: 86400` (it also serves the global cap count) |

The `code:` and `token:` prefixes keep the two fingerprints in separate spaces under one secret.

`users` (changed): `tokenVersion: number`, default 0, read as 0 when missing (accounts created before this feature), incremented by 1 on every successful reset. Added to the `User` schema class and the user interface.

Relationship: one user has N `password_resets`; only the latest one can ever be verified (AC-3).

**State transitions** (`PasswordReset.status`):
- `pending` → `verified`: right code, before `expiresAt`, under 5 wrong tries, under the 24 hour wrong try cap.
- `pending` → `cancelled`: 5th wrong try, or a newer request for the same user.
- `verified` → `used`: a successful `/reset`.
- `used` → `verified`: only as the rollback when the user update fails right after the claim (see `/reset` step 4).
- `verified` → `cancelled`: a newer request for the same user.
- `used` and `cancelled` are final otherwise. An expired `pending` stays `pending` in the database but is treated as invalid (checks read `expiresAt`), then the TTL index removes it. The reset token may outlive the code window (verified at minute 14, usable until minute 24); that is intended, `/reset` checks `resetTokenExpiresAt` only.

**API surface** (new `PasswordResetController`, `@ApiTags('Auth')`, `@Controller('auth/password')`, all routes public, all `@HttpCode(200)`):

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/auth/password/forgot` | POST | `email`: string (req) | `200 { message }` always | public, IP limited 20/h | `400` malformed email (default DTO error), `429`, `503 MAIL_UNAVAILABLE` |
| `/auth/password/verify-code` | POST | `email`: string (req), `code`: string (req, 6 digits) | `200 { message, resetToken, expiresAt }` | public, IP limited 30/h | `400 INVALID_OR_EXPIRED_CODE` (any failure, including invalid input), `429` |
| `/auth/password/reset` | POST | `resetToken`: string (req), `newPassword`: string (req, 6 to 72 chars) | `200 { message, accessToken, refreshToken, user }` | public (the reset token is the proof) | `400 INVALID_OR_EXPIRED_TOKEN` (bad, missing, or non string token), `400` default DTO error for the password |

**DTOs**: every field `@IsString()`. `email` uses `@Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)` declared so it runs before `@IsEmail()` (class-transformer runs before validation under the global `transform: true`). `code` uses `@Matches(/^\d{6}$/)`. `newPassword` uses `@MinLength(6)` and `@MaxLength(72)` (bcrypt ignores bytes past 72). The `/verify-code` body is validated with a route level `ValidationPipe` whose `exceptionFactory` always throws the `INVALID_OR_EXPIRED_CODE` body; for `/reset`, the `resetToken` check is done in the handler (`typeof resetToken !== 'string'` → `INVALID_OR_EXPIRED_TOKEN`) while `newPassword` keeps the default DTO error. All three errors (`INVALID_OR_EXPIRED_CODE`, `INVALID_OR_EXPIRED_TOKEN`, `MAIL_UNAVAILABLE`) are thrown as `HttpException` with the exact bodies of AC-6, AC-10, AC-14.

**Flows**:

`/forgot` (the request path does no database or email work, so the answer time doesn't depend on the account):
1. Mail unavailable (no `BREVO_API_KEY` and `NODE_ENV` not `development`/`test`) → `503 MAIL_UNAVAILABLE`. This depends on config only.
2. Answer `200` with the generic message, and start `void this.processForgot(email).catch(logError)`.
3. Background, `processForgot`:
   1. Global cap: `countDocuments({ createdAt: { $gt: now - 24h } })` ≥ `MAIL_DAILY_CAP` → log an error (`password reset dropped: daily cap reached`), stop.
   2. Find the user by email (`.lean()`, `_id`, `email`, `firstName`). None → stop.
   3. Limits: `countDocuments({ userId, createdAt: { $gt: now - 1h } })` ≥ 5, or `countDocuments({ userId, createdAt: { $gt: now - 24h } })` ≥ 10, or `findOne({ userId }).sort({ createdAt: -1 })` created under 60 seconds ago → stop (AC-4). Two queries, all statuses count.
   4. Generate the code with `crypto.randomInt(0, 1_000_000)`, padded to 6 digits. Insert the new request first (fresh `_id`, `codeHash`, `expiresAt`).
   5. Then `updateMany({ userId, _id: { $ne: newId }, status: { $in: ['pending', 'verified'] } }, { status: 'cancelled' })`. Inserting before cancelling means two concurrent requests always leave only one live request after both finish (AC-3); the read then write limit checks of step 3 can still let a burst of parallel calls through, which the IP limit bounds (accepted, see Consequences).
   6. `await this.mail.sendPasswordResetCode(...)`; an error is logged with the user id.

`/verify-code`:
1. Find the user by email. Then always run the request query, with the real user id or a fresh `new Types.ObjectId()` for an unknown email: `findOne({ userId }).sort({ createdAt: -1 })`, plus the 24 hour wrong try sum (`aggregate` `$match { userId, createdAt > now - 24h }`, `$group` sum of `attempts`). Always compute the HMAC of the given code. This keeps the database work and the timing the same whether the account exists or not.
2. No user, no request, request not `pending`, `expiresAt` passed, `attempts >= 5`, or the 24 hour sum ≥ 15 → `400 INVALID_OR_EXPIRED_CODE`.
3. Compare the HMAC with `codeHash` using `crypto.timingSafeEqual` (equal length buffers).
4. Match → generate `token = crypto.randomBytes(32).toString('base64url')`, then `findOneAndUpdate({ _id, status: 'pending', attempts: { $lt: 5 }, expiresAt: { $gt: now } }, { status: 'verified', verifiedAt: now, resetTokenHash, resetTokenExpiresAt: now + 10 min })`. No document (a concurrent 5th wrong try or a newer request won) → `400 INVALID_OR_EXPIRED_CODE`. Else answer `200` with `resetToken: token` and `expiresAt: resetTokenExpiresAt.toISOString()`.
5. No match → `findOneAndUpdate({ _id, status: 'pending' }, { $inc: { attempts: 1 } }, { returnDocument: 'after' })`; when `attempts >= 5`, `updateOne({ _id, status: 'pending' }, { status: 'cancelled' })`. Answer `400 INVALID_OR_EXPIRED_CODE`. The atomic `$inc` is what makes AC-7 hold under concurrent tries.

`/reset`:
1. `resetToken` not a string → `400 INVALID_OR_EXPIRED_TOKEN`. Compute `resetTokenHash` and `findOne({ resetTokenHash, status: 'verified', resetTokenExpiresAt: { $gt: now } })`. None → `400 INVALID_OR_EXPIRED_TOKEN`. An access or refresh JWT simply matches no hash.
2. Hash `newPassword` with bcrypt (10 rounds) before claiming anything.
3. Claim: `findOneAndUpdate({ _id, status: 'verified', resetTokenExpiresAt: { $gt: now } }, { status: 'used', usedAt: now })`. No document (used in parallel, or cancelled meanwhile) → `400 INVALID_OR_EXPIRED_TOKEN`.
4. `userModel.findOneAndUpdate({ _id: userId }, { password: hash, isEmailVerified: true, $inc: { tokenVersion: 1 } }, { returnDocument: 'after' })`. If it throws, roll the request back (`updateOne({ _id, status: 'used' }, { status: 'verified', usedAt: null })`) and rethrow (`500`), so the user can retry with the same token. If the user no longer exists → `400 INVALID_OR_EXPIRED_TOKEN` (the request stays `used`, harmless).
5. Answer with `AuthService.issueTokens(updatedUser)`, then start `void this.mail.sendPasswordChanged(...).catch(logError)`.

Hashing is manual in `UsersService` (no `pre('save')` hook), so `findOneAndUpdate` with a precomputed hash is correct.

A user who loses the reset token before using it must ask for a new code (subject to the AC-4 limits). That is intended.

**Session cut** (`tokenVersion`, AC-9):
- `AuthService.issueTokens` (and so login and reset) adds `tv: user.tokenVersion ?? 0` to both payloads.
- `JwtStrategy.validate` compares `(payload.tv ?? 0)` with `(user.tokenVersion ?? 0)` after its existing `findById` (which returns `toObject()`, so the field is visible) and throws `UnauthorizedException` on a mismatch. `JwtPayload` gains `tv?: number`.
- `AuthService.refresh` does the same check inside its existing `try` (which already turns any error into `401`), then signs the new access token with the current version.
- Its `console.log` lines (token, payload, user email on every request) are removed in this feature: they would put email addresses in production logs.

**Email** (new `src/mail/` module, `MailModule` exporting `MailService`):
- `MailService.isAvailable()`, `sendPasswordResetCode(to, firstName, code)`, `sendPasswordChanged(to, firstName)`.
- Transport: `POST https://api.brevo.com/v3/smtp/email` with header `api-key: BREVO_API_KEY`, body `{ sender: { email: MAIL_FROM_EMAIL, name: MAIL_FROM_NAME }, to: [{ email }], subject, htmlContent, textContent }`, `AbortSignal.timeout(10_000)`, plain `fetch` (no SDK, as `stream.client.ts`). A non 2xx answer or a timeout throws; callers log it.
- No key and `NODE_ENV` is `development` or `test`: `Logger.warn` `[mail:dev] password reset code for user <id>: <code>` (and a one line note for the changed email), then resolve. No key otherwise: `isAvailable()` is false, `/forgot` already answered `503`, and `sendPasswordChanged` logs a warning.
- Templates in `src/mail/templates/fr.ts`, one function per email returning `{ subject, html, text }`. Greeting `Bonjour <firstName>,` or `Bonjour,`. Code email subject `Ton code Noli : 123456`; body says it expires in 15 minutes and to ignore the email if the request wasn't theirs. Changed email subject `Ton mot de passe Noli a été modifié`; body says to request a new code right away if it wasn't them. French only; another language later adds a file.
- Logs never contain an email address or a code outside the dev mode above.
- The unawaited sends assume a long running Node process (as today); a serverless host would need a queue.

**Rate limiting** (AC-13):
- Move `ThrottlerModule.forRoot` from `MediaModule` to `AppModule` with three named throttlers: `upload` (unchanged), `password-forgot` (`ttl: 3_600_000`, `limit: 20`), `password-verify` (`ttl: 3_600_000`, `limit: 30`). `MediaModule` stops importing and exporting it (the module is global).
- `errorMessage` becomes a function of the execution context: the request path starts with `/auth/password` → `'Trop de tentatives, réessayez plus tard'`, else the current image message.
- Password routes use the stock `ThrottlerGuard` (its default tracker is `req.ip`, its default key includes controller and handler, so the two routes count separately): `/forgot` gets `@UseGuards(ThrottlerGuard)` and `@SkipThrottle({ upload: true, 'password-verify': true })`; `/verify-code` gets `@SkipThrottle({ upload: true, 'password-forgot': true })`; `/reset` has no throttle (its token is 256 random bits).
- Image routes keep `UploadThrottlerGuard` and add `@SkipThrottle({ 'password-forgot': true, 'password-verify': true })` in the shared image route decorator (`src/media/image-route.decorators.ts`), so their limit stays exactly 10 per 10 minutes.
- The per account limits of AC-4, AC-7 and the global cap of AC-17 are not throttlers: they read `password_resets`.

**Client IP**: `req.ip`. Behind a hosting proxy that is the proxy's IP, so `main.ts` calls `app.set('trust proxy', Number(TRUST_PROXY))` when `TRUST_PROXY` is set (the number of proxies in front, `1` on most hosts), and logs a warning at boot when it is unset and `NODE_ENV` is `production` (AC-18). Too high a value would let clients fake their IP; set it to the real hop count.

**Boot checks** (AC-18), in `AuthModule` / `MailModule` `onModuleInit` (or a config validation function): `PASSWORD_RESET_SECRET` present, at least 32 characters, different from both JWT secrets; `MAIL_FROM_EMAIL` present when `BREVO_API_KEY` is set. Failing throws, so the app does not start.

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| forgot | mail available | `BREVO_API_KEY` presence and `NODE_ENV` |
| forgot | the user | `email` input, trimmed and lowercased, `users.email` |
| forgot | global count, per account counts, last request time | `password_resets.createdAt`, by `userId` for the per account ones |
| forgot | the code | `crypto.randomInt`, sent by email, never stored |
| forgot | `codeHash` | HMAC-SHA256(`PASSWORD_RESET_SECRET`, `code:_id:code`) |
| forgot | `expiresAt` | server clock + 15 min |
| forgot | email greeting name | `users.firstName`, else none |
| forgot / verify | IP for the limit | `req.ip`, real client IP through `TRUST_PROXY` |
| verify | the request to check | latest `password_resets` for the user, by `createdAt` |
| verify | 24 hour wrong tries | sum of `attempts` over the user's requests created in the last 24 h |
| verify | `resetToken` | `crypto.randomBytes(32)`, base64url, returned once, stored as `resetTokenHash` |
| verify | `expiresAt` | `resetTokenExpiresAt` (`verifiedAt` + 10 min), ISO 8601 |
| reset | the request and user | lookup by `resetTokenHash`, then its `userId` |
| reset | new password hash | bcrypt(`newPassword`, 10) |
| reset | `tv` in the new tokens | `users.tokenVersion` after the `$inc` |
| reset | `user` in the response | the updated user via `issueTokens`: `id`, `email`, `username`, `role`, `subscription` |
| guard / refresh | version to compare | token `tv` (missing → 0) vs `users.tokenVersion` (missing → 0) |
| 429 | message | `errorMessage` function, by request path |

**Key invariants**:
- After any set of `/forgot` calls completes, a user has at most one `pending` or `verified` request, the newest.
- `attempts` never lets a 6th comparison succeed on a request; an account never gets more than 15 wrong comparisons in 24 hours.
- A request reaches `used` at most once for good; a reset token changes the password at most once.
- The code and the reset token exist in clear only in memory, in the email or the response, and (dev mode only) in the dev log.
- `/forgot` and `/verify-code` give the same answer and do the same request path work whether or not the email has an account.
- A token whose `tv` differs from the user's `tokenVersion` is always refused.

**Security model**: All three routes are public. Ownership is proven by the emailed code (`/verify-code`), then by the reset token (`/reset`); nothing else grants a reset. Admin accounts follow the same rules (AC-16); a compromised admin mailbox therefore means a compromised admin account, accepted for now (see Consequences). Personal data involved: email address and password hash (personal data, no special compliance regime). Audit trail: the `password_resets` records (24 h) plus logs of each request, verify failure, drop, and reset, by user id.

**Configuration required**:
- `BREVO_API_KEY`: Brevo transactional API key (Brevo dashboard, SMTP & API, API keys). Empty → dev log mode in `development`/`test`, `503` elsewhere.
- `MAIL_FROM_EMAIL`: sender address, verified in Brevo. Required when `BREVO_API_KEY` is set.
- `MAIL_FROM_NAME`: sender name, default `Noli`.
- `MAIL_DAILY_CAP`: maximum reset requests per 24 hours across all accounts, default `250` (under Brevo's free daily quota, leaving room for the changed emails).
- `PASSWORD_RESET_SECRET`: at least 32 random characters, different from the JWT secrets; keys both HMACs. A generated value is added to your local `.env`.
- `TRUST_PROXY`: number of proxies in front of the API in production (see Client IP).
- Prerequisite: a free Brevo account with the sender address verified.

**Critical test scenarios**:
- Happy path: forgot → code in the dev log → verify → reset → login works with the new password, fails with the old one, `isEmailVerified` true, changed email logged, verifies **AC-1**, **AC-5**, **AC-8**, **AC-12**.
- Session cut: a token pair taken before the reset gets `401` on `GET /auth/profile` and on `/auth/refresh`; the new pair works; an untouched account's old token still works, verifies **AC-9**.
- Unknown email and limits: unknown email answers like a known one and writes nothing; requests at 0 s and 30 s create one record; 6 spaced requests in an hour create 5; parallel `/forgot` calls leave one live request; the global cap drops and logs, verifies **AC-2**, **AC-3**, **AC-4**, **AC-17**.
- Guessing: 5 wrong codes sent at once, then the right code → all `400`, request `cancelled`; 15 wrong codes across three requests block the account's verify for 24 hours; invalid inputs give the same body, verifies **AC-6**, **AC-7**.
- Replay: reset token used twice; token from a request cancelled by a newer `/forgot`; an access token and a refresh token sent as `resetToken`; `/verify-code` with the same code after a reset → all `400` with the right code, verifies **AC-3**, **AC-10**.
- Partial failure: the user update throws after the claim → `500`, request back to `verified`, the same token then works, verifies **AC-8**, **AC-10**.
- Mail: `fetch` rejecting → `/forgot` still `200`, error logged without email or code; `NODE_ENV` unset without key → `503 MAIL_UNAVAILABLE`, verifies **AC-14**.
- IP limits: 21st `/forgot` → `429` with the French message, `/verify-code` counter independent, 11th image upload still `429` at 10 and the 10th still passes, verifies **AC-13**.
- Storage and boot: records hold no 6 digit string and no token; TTL index on `createdAt`; boot fails with a short or reused secret; deleted user holding a valid token is refused, verifies **AC-15**, **AC-18**.

## Build plan

Tracer Bullet: a thin working thread end to end first (request, code in the log, verify, reset), then the safety layers, then the real email and the limits.

1. [x] Thin thread: `PasswordReset` schema with its indexes, `PASSWORD_RESET_SECRET` with its boot check, DTOs, `PasswordResetController` with the three routes (`@HttpCode(200)`), `PasswordResetService` with the basic flows, a `MailService` that only has the dev log mode, `AuthService.issueTokens` used by login and reset, satisfies **AC-1**, **AC-5**, **AC-8**, **AC-11**, **AC-15**, **AC-16**, **AC-18**.
2. [x] Session cut: `tokenVersion` on `User`, `tv` in both tokens, checks in `JwtStrategy` and `AuthService.refresh`, `$inc` on reset, removal of the `JwtStrategy` debug logs, satisfies **AC-9**.
3. [x] Hardening the flow: background `/forgot` processing, insert then cancel, per account and global limits, same work path for unknown emails, uniform `INVALID_OR_EXPIRED_CODE` and `INVALID_OR_EXPIRED_TOKEN` errors, atomic attempts, 24 hour wrong try cap, hash before claim with rollback, satisfies **AC-2**, **AC-3**, **AC-4**, **AC-6**, **AC-7**, **AC-10**, **AC-17**.
4. [x] Real email: Brevo HTTP client in `MailModule`, French templates, unawaited sends with logging, `503 MAIL_UNAVAILABLE` outside dev without a key, `MAIL_FROM_EMAIL` boot check, changed email, env lines in `.env` (empty Brevo values for you to fill), satisfies **AC-1**, **AC-12**, **AC-14**, **AC-18**.
5. [x] IP limits and wrap up: `ThrottlerModule.forRoot` moved to `AppModule` with the two new throttlers and the path based message, `@SkipThrottle` on password and image routes, `TRUST_PROXY` in `main.ts` with its production warning, Swagger decorators (French summaries), OpenAPI regenerated, a `docs/api-reference.md` section for the flow, then the live check with a real Brevo key, satisfies **AC-13**, **AC-18**, and all ACs live.

## Consequences

**Positive**:
- Users recover their account alone; the support burden of "I forgot my password" disappears.
- `tokenVersion` gives the API its first way to revoke sessions; feature 6 (password change) and a future "sign out everywhere" reuse it as is.
- The `MailModule` is ready for feature 4 (billing emails) with no new provider decision.
- `isEmailVerified` finally carries real meaning for users who reset.

**Negative / tradeoffs**:
- Griefing is possible: someone who knows a user's email can keep cancelling their code with a new request each minute, or burn their wrong tries, and block their reset for up to 24 hours. Every attempt limit has this effect; the per IP limits slow it, and it never gives the attacker access. Accepted for now.
- Parallel `/forgot` bursts can slip a few requests past the per account limits (read then write checks); the per IP limit and the global cap bound the damage. Accepted.
- A new external dependency (Brevo) with a free daily quota (about 300 emails a day as of this writing; check the current plan). The global cap protects it, but once reached, legitimate users get no code until the window rolls.
- Every guarded request now compares `tv`; it reuses the user lookup the guard already does, but a bug there signs everyone out. The "untouched accounts keep working" test is the safety net.
- Throttler counters live in memory: they reset on restart and are per instance. Several instances would need a shared store.
- Without a domain, emails come from a single verified address and are more likely to land in spam.
- The unawaited sends mean the API never knows if an email left, and they need a long running process (no serverless).
- A compromised admin mailbox leads to a compromised admin account through this flow; stronger admin protection (second factor) would be its own feature.

**Neutral**:
- Moving `ThrottlerModule.forRoot` from `MediaModule` to `AppModule` touches the image upload wiring; its existing tests must stay green.
- New env vars on every environment (`.env`, the host).
- Login's response is unchanged, but it now goes through `issueTokens` and carries `tv`.

## Follow-up

- [ ] The `brevo` Agent Skill (`okou-ai/okou-skills@brevo`) failed to install from here (the installer asked an interactive question). Run `npx skills add okou-ai/okou-skills@brevo` yourself if you still want it.
- [ ] Connect the official Brevo MCP server (github.com/brevo/brevo-mcp-server) once you have a key; it helps read send logs during `/check verify`.
- [ ] `email-and-password-best-practices` and the Brevo choice are not yet in `AGENTS.md`: `/sync` should add the mail conventions to a new `src/mail/AGENTS.md` (pointer from root) and the reset and `tokenVersion` rules to `src/auth/AGENTS.md`.
- [ ] Feature 6 (Profile Editing): a password change there must also bump `tokenVersion` (returning new tokens for the current session) and send the changed email.
- [ ] Feature 7 (Google and Apple sign in): decide what `/forgot` does for an account that has no password.
- [ ] A domain for the sender address, with SPF and DKIM in Brevo, before launch.
- [ ] Sign up still accepts any length above 6 characters with no maximum; align it with the 72 character cap (and decide a stronger shared password policy) as its own change.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
