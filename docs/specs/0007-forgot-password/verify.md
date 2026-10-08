# Verify: Forgot password · spec 0007 · updated 2026-10-07 (/check verify: FAIL, 2 races open)
_Steps derived from spec 0007 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

Setup: API on port 3099 with `NODE_ENV=development` and no `BREVO_API_KEY`, so codes appear in the server log (`[mail:dev] password reset code for user <id>: <code>`). Use throwaway `@noli.test` accounts and delete them and their `password_resets` afterwards. Run the IP limit step last (it blocks `/forgot` from that IP for an hour, until a restart).

## Commands (API)
- [x] Login a fresh account → both tokens decode with `tv: 0` → AC-9
- [x] `POST /auth/password/forgot` with the email in upper case and spaces → `200`, generic message; one code in the log, one record → AC-1
- [x] Same call with an unknown email → byte identical `200`, no record, no log line → AC-2
- [x] `{ "email": "pas-un-email" }` → `400` → AC-2
- [x] Second request within 60 s → `200`, still one record and one code → AC-4
- [x] Six spaced requests in an hour (or seed `createdAt` values) → only 5 records; eleven in 24 h → only 10 → AC-4
- [x] Wrong code, code `12ab`, missing code, email `x`, unknown email, `email: { "$ne": null }` → all `400` with the exact `INVALID_OR_EXPIRED_CODE` body → AC-6
- [x] Right code → `200`, `resetToken`, `expiresAt` ISO about 10 minutes ahead; record `verified`, no clear token in it → AC-5, AC-15
- [x] Same code again → `400 INVALID_OR_EXPIRED_CODE` → AC-6
- [x] `/reset` with an access token, a refresh token, no token, or an object as `resetToken` → exact `INVALID_OR_EXPIRED_TOKEN` body → AC-10
- [x] `/reset` with a 3 or 73 character password → `400`, request still `verified` → AC-11
- [x] `/reset` with the right token → `200` login shape; `isEmailVerified: true`, `tokenVersion: 1`; old password `401`, new one works → AC-8
- [x] Same token again → `400 INVALID_OR_EXPIRED_TOKEN` → AC-10
- [x] Log shows `password changed email for user <id>` → AC-12
- [x] Old access token on `GET /auth/profile` and old refresh token on `/auth/refresh` → `401`; new pair works → AC-9
- [x] A token signed without `tv` for an untouched account → `200` on `/auth/profile` → AC-9
- [ ] New request on a second account, 5 wrong codes in parallel, then the right one → all `400`, record `cancelled` with `attempts: 5` → AC-7
- [x] Three requests with 5 wrong codes each (seed `createdAt` to skip the 60 s wait) → a 4th request's right code still `400` → AC-7
- [x] A request, then a newer one: the first code `400`, the second `200`; a reset token from the first → `400` → AC-3
- [ ] Two `/forgot` in parallel (after 60 s) → at most one record not `cancelled` → AC-3
- [x] Insert `MAIL_DAILY_CAP` records in the last 24 h (or set `MAIL_DAILY_CAP=1`) → next `/forgot` creates nothing, error `daily cap reached` in the log → AC-17
- [x] 21 `/forgot` calls from one IP → 21st `429` with `Trop de tentatives, réessayez plus tard`; `/verify-code` still answers `400`, not `429` → AC-13
- [x] An admin account (`demo.admin@noli.test`) runs the same flow → AC-16
- [x] Database: `password_resets` has the TTL index on `createdAt` (86400 s), the `{ userId, createdAt }` index, the sparse unique `resetTokenHash` index → AC-15

## Commands (config and boot)
- [x] Start with `PASSWORD_RESET_SECRET` unset, 31 characters, or equal to `JWT_SECRET` → the app refuses to boot → AC-18
- [x] Start with `BREVO_API_KEY` set and `MAIL_FROM_EMAIL` empty → refuses to boot → AC-18
- [x] Start with `NODE_ENV` unset and no Brevo key → `/forgot` answers `503 MAIL_UNAVAILABLE` → AC-14
- [x] `NODE_ENV=production`, no `TRUST_PROXY` → boot warning in the log → AC-18
- [ ] With a real `BREVO_API_KEY` and verified sender: the code email and the changed email arrive in French, subject `Ton code Noli : 123456` → AC-1, AC-12
- [x] With a wrong `BREVO_API_KEY`: `/forgot` still `200`, log `password reset email failed for user <id>: Brevo answered 401`, no address or code in the log → AC-14
- [x] `npm run docs:openapi` lists the three `/auth/password/*` routes → wrap up

## Value sourcing checks
- [x] Email lookup is case and space insensitive (input normalized like `users.email`)
- [x] Per account counts read `password_resets.createdAt` by `userId`; global count reads all records
- [x] `codeHash` changes when the same code is issued on another request (bound to `_id`)
- [ ] Greeting uses `firstName` when set (`Bonjour Awa,`), `Bonjour,` when not
- [x] With `TRUST_PROXY=1` behind a proxy, two clients with different `X-Forwarded-For` get separate IP counters
- [x] `expiresAt` in the verify answer equals `resetTokenExpiresAt` in the record
- [x] `tv` in the reset's new tokens equals the user's `tokenVersion` after the reset

## Acceptance criteria coverage
- AC-1 forgot known, real email · AC-2 unknown, malformed · AC-3 newer request, parallel · AC-4 60 s, hour, day · AC-5 right code · AC-6 uniform errors · AC-7 parallel wrong, 24 h cap · AC-8 reset · AC-9 old tokens, legacy token · AC-10 bad and reused tokens · AC-11 password length · AC-12 changed email · AC-13 IP limits · AC-14 Brevo down, no key outside dev · AC-15 hashes, TTL · AC-16 admin · AC-17 daily cap · AC-18 boot checks
