# 0009. Custom domain and DNS

**Date**: 2026-10-12
**Status**: In Progress

## Summary

Noli moves to its own domain, `nollli.com`, bought on Hostinger. The API answers at `api.nollli.com` (Render, free automatic HTTPS), the dashboard will live at `admin.nollli.com`, and the bare domain is kept for a future public site. Emails leave from `no-reply@nollli.com` through Brevo, with the DNS records that keep them out of spam, and `support@nollli.com` receives mail at Hostinger. The only code change is in the backend: a `CORS_ORIGINS` variable lets the dashboard call the API, and a `SWAGGER_ENABLED` variable can switch the public docs off on launch day.

## Context

The API is deployed on Render at a `onrender.com` address. The Flutter app, the upcoming dashboard, and the payment and video webhooks would all have to change if that address ever changed (another Render service, another host), and a mobile app update takes days to reach users. A domain the project owns makes the address stable whatever hosts it.

The forgot password emails (spec 0007) currently need a single verified sender address; without a domain with SPF, DKIM and DMARC records (proofs that a server may send for the domain), mailbox providers tend to file them as spam. App stores also expect a contact address and, later, public legal pages on a site the publisher controls.

A web dashboard served from its own origin cannot call the API until the API allows that origin (CORS, the browser rule that blocks calls from another site); the backend enables none today.

Constraints: one person operates everything, so the setup must stay in the dashboards already in use (Hostinger, Render, Brevo) with as few moving parts as possible. DNS changes take minutes to hours to spread, so cutover steps must keep the old address working until the new one is confirmed.

## Requirements

**User stories**:
- As the Noli team, we want the app, the dashboard and the webhooks to use an address we own so that changing hosts never needs an app update.
- As a user, I want Noli emails to land in my inbox, not in spam, and to be able to write to Noli support.
- As an admin, I want the dashboard at its own address to be able to call the API.

**Acceptance criteria** (the contract):
- **AC-1**: `https://api.nollli.com` serves the API with a valid certificate: `GET /` answers `200`, `GET /api/docs` shows Swagger, and `http://api.nollli.com` redirects to HTTPS. The Render `onrender.com` address keeps working (Render always keeps it).
- **AC-2**: The Flutter app's API base URL is `https://api.nollli.com`.
- **AC-3**: KkiaPay's webhook URL is `https://api.nollli.com/billing/webhook` (when the KkiaPay keys exist), and the Cloudflare Stream webhook is registered for `https://api.nollli.com` (when Stream is active).
- **AC-4**: Brevo shows `nollli.com` as an authenticated domain (SPF and DKIM valid), `MAIL_FROM_EMAIL=no-reply@nollli.com` and `MAIL_FROM_NAME=Noli` are set on Render, and a forgot password email sent to a Gmail address arrives in the inbox with SPF, DKIM and DMARC all `PASS` in "Show original".
- **AC-5**: The DNS zone has exactly one SPF record for `nollli.com`, covering both Hostinger mail and Brevo, and a DMARC record `v=DMARC1; p=none; rua=mailto:support@nollli.com`.
- **AC-6**: `support@nollli.com` exists at Hostinger and receives a test message sent from an outside address.
- **AC-7**: With `CORS_ORIGINS=https://admin.nollli.com,http://localhost:5173`, a browser request from either origin gets `Access-Control-Allow-Origin` with that origin (preflight `OPTIONS` answers `204` with methods `GET, POST, PUT, PATCH, DELETE` and headers `Authorization, Content-Type`); a request from any other origin gets no CORS header. With `CORS_ORIGINS` empty or unset, CORS stays off as today, and the mobile app is unaffected either way.
- **AC-8**: With `SWAGGER_ENABLED=false`, `/api/docs` answers `404`; unset or any other value keeps it on (open until the public launch).
- **AC-9**: Nothing in the repo or in the app points to the `onrender.com` address anymore (docs, `HANDOFF.md`, Flutter config), and the domain has auto renewal on and two factor login on the Hostinger account.

## Options considered

### Option 1: Keep the Render address, no domain

**Pros**: nothing to do.
**Cons**: the address belongs to Render, any move breaks the app; emails stay without a domain and land in spam; no place for legal pages.

### Option 2: Subdomains on Hostinger DNS (chosen)

`api` and `admin` as CNAME records to their hosts, mail records at Hostinger, everything managed where the domain was bought.

**Pros**: nothing to migrate; one dashboard for the domain, DNS, and the support mailbox; each part of Noli can move host by changing one record.
**Cons**: Hostinger's DNS is slower to update than specialized DNS hosts and has no extra protection; record editing is manual.

### Option 3: DNS moved to Cloudflare

**Pros**: fast propagation, free protections, API to manage records.
**Cons**: name servers to change and propagation to wait for; the orange proxy must stay off in front of Render or certificates clash; a second dashboard to keep secure; nothing Noli needs today.

### Option 4: Everything under the bare domain (`nollli.com/api`, `nollli.com/admin`)

**Pros**: a single address.
**Cons**: needs a reverse proxy in front of Render and the dashboard host, more moving parts and cost; harder to move one part alone.

## Decision

**Chosen option**: Option 2: subdomains (`api`, `admin`, the bare domain kept for later) with DNS at Hostinger, Brevo authenticated on the domain, a Hostinger support mailbox, and two environment variables in the backend (`CORS_ORIGINS`, `SWAGGER_ENABLED`).

## Rationale

Option 2 gives the stable, owned address with the fewest moving parts for a one person operation: Hostinger already holds the domain, Render issues certificates for custom domains on its own, and Brevo only needs a few records. Cloudflare (Option 3) would be the next step if Noli ever needs DNS automation or protection, and moving later only means copying the same records. Subdomains keep each part independent, which matters while the backend, the dashboard and the future site may each change host.

CORS and Swagger switches are environment variables rather than code so that adding the dashboard's real address, or closing the docs at launch, is a setting on Render, not a deploy of new code. DMARC starts at `p=none` because a strict policy published before every sender is proven to pass would send Noli's own codes to spam; reports to the support mailbox show when it is safe to move to `quarantine`.

## Feature design

**DNS records at Hostinger** (zone `nollli.com`; exact target values come from each provider's screen):

| Type | Name | Value | Purpose |
|---|---|---|---|
| CNAME | `api` | the Render service host (`<service>.onrender.com`) | API (AC-1) |
| CNAME | `admin` | the dashboard host's target (when chosen) | dashboard |
| TXT | `@` | one SPF record, e.g. `v=spf1 include:_spf.mail.hostinger.com include:spf.brevo.com ~all` (merge with any existing SPF, never two) | mail sending (AC-5) |
| TXT or CNAME | as given by Brevo (`brevo-code`, `mail._domainkey` or similar) | as given by Brevo | Brevo domain proof and DKIM (AC-4) |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:support@nollli.com` | DMARC (AC-5) |
| MX | `@` | Hostinger mail servers (set up by Hostinger when the mailbox is created) | support mailbox (AC-6) |

The bare domain and `www` stay parked until the public site exists.

**Backend changes** (`src/main.ts`):
- `CORS_ORIGINS`: split on commas, trim, drop empty entries. Non empty list → `app.enableCors({ origin: list, methods: ['GET','POST','PUT','PATCH','DELETE'], allowedHeaders: ['Authorization','Content-Type'], credentials: false, maxAge: 600 })`. Empty or unset → no CORS call (current behavior). Exact match only, no wildcards.
- `SWAGGER_ENABLED`: `'false'` → skip `SwaggerModule.setup` (so `/api/docs` answers `404`); anything else → set it up as today. `npm run docs:openapi` keeps working (it builds the document without serving it).

**Value sourcing**:
| Action | Value | Source |
|---|---|---|
| API address | `api.nollli.com` | decided here; CNAME to the Render host shown in Render's Custom Domains screen |
| certificate | TLS for `api.nollli.com` | issued by Render once the CNAME resolves |
| sender | `no-reply@nollli.com`, `Noli` | decided here; `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME` on Render |
| DKIM and domain proof values | records | Brevo, Senders & Domains, Authenticate the domain |
| SPF includes | Hostinger and Brevo mechanisms | each provider's documentation screen at setup time |
| DMARC reports address | `support@nollli.com` | decided here |
| allowed browser origins | list | `CORS_ORIGINS` env var |
| Swagger on or off | flag | `SWAGGER_ENABLED` env var |
| app base URL | `https://api.nollli.com` | Flutter config in `noli_app` |

**Key invariants**:
- Exactly one SPF TXT record on `nollli.com`.
- CORS never uses `*` and never allows credentials (tokens travel in the `Authorization` header).
- The `onrender.com` address stays reachable; it is no longer referenced, not removed.

**Security model**: The domain account controls the API address and the email identity: two factor login on Hostinger, auto renewal on, owner details hidden if offered. CORS only names the dashboard and local development origins; it is not an access control (the JWT and the admin role check stay the gate). Swagger exposes no data, only the route list already public in the repo, and can be switched off without a deploy.

**Configuration required**:
- `CORS_ORIGINS` (Render): `https://admin.nollli.com` once the dashboard exists; locally, the dashboard dev server origin.
- `SWAGGER_ENABLED` (Render): unset for now; `false` at the public launch.
- `MAIL_FROM_EMAIL=no-reply@nollli.com`, `MAIL_FROM_NAME=Noli` (Render) after the Brevo domain is authenticated, plus `BREVO_API_KEY`.

**Critical test scenarios**:
- Happy path: `curl -I https://api.nollli.com/` → `200`, valid certificate; Swagger loads; the app logs in through the new address, verifies **AC-1**, **AC-2**.
- Email: forgot password to a Gmail address → inbox, SPF, DKIM, DMARC `PASS`; mail to `support@` arrives, verifies **AC-4**, **AC-5**, **AC-6**.
- CORS: preflight from `https://admin.nollli.com` → allowed; from `https://evil.example` → no header; `CORS_ORIGINS` unset → no header at all, verifies **AC-7**.
- Swagger switch: `SWAGGER_ENABLED=false` → `/api/docs` `404`, verifies **AC-8**.

## Build plan

Tracer Bullet: first the API on its address end to end (DNS, certificate, the app calling it), then email, then the CORS and Swagger switches, then the cleanup.

1. [x] API address: in Render, Settings, Custom Domains, add `api.nollli.com`; at Hostinger add the `api` CNAME; wait for Render to verify and issue the certificate; check AC-1, satisfies **AC-1**
2. [ ] Point the app and the webhooks: Flutter base URL to `https://api.nollli.com`; KkiaPay and Stream webhook URLs when those services are live, satisfies **AC-2**, **AC-3**
3. [ ] Email: create `support@nollli.com` at Hostinger (MX); authenticate `nollli.com` in Brevo (domain proof and DKIM records); one merged SPF record; DMARC `p=none`; set the sender variables on Render; send a forgot password test, satisfies **AC-4**, **AC-5**, **AC-6**
4. [ ] Backend switches: `CORS_ORIGINS` and `SWAGGER_ENABLED` in `src/main.ts`, documented in `.env` (empty values) and in `docs/api-reference.md`; tests for both; deploy, satisfies **AC-7**, **AC-8**
5. [ ] Cleanup and safety: replace the Render address in the docs, `../noli_dashboard/HANDOFF.md` and the app; auto renewal and two factor login on Hostinger; then, after two to four weeks of clean DMARC reports, move DMARC to `p=quarantine`, satisfies **AC-9**, **AC-5**

## Consequences

**Positive**:
- One stable address for the app, the dashboard and every webhook; changing hosts becomes a DNS edit.
- Emails sent from an authenticated domain, far less likely to land in spam; a real support address for users and the stores.
- The dashboard can call the API, and the docs can be closed at launch, both without new code.

**Negative / tradeoffs**:
- A yearly renewal to keep paying; an expired domain cuts the app, the emails and the payments at once.
- DNS edits are manual in Hostinger's panel and take time to spread; mistakes (two SPF records, a typo in DKIM) silently send emails to spam.
- The `onrender.com` address stays reachable and cannot be turned off.
- Hostinger becomes a critical account: whoever controls it controls the API address and the email identity.

**Neutral**:
- Hostinger's mailbox offer may have limits (storage, number of boxes); enough for one support address.
- The public site, the legal pages and the account deletion page stay in the scope's Deferred list; the bare domain is ready for them.

## Follow-up

- [ ] When the dashboard host is chosen (in `noli_dashboard`), add its `admin` CNAME and put `https://admin.nollli.com` in `CORS_ORIGINS`.
- [ ] Public site and legal pages (privacy policy, terms, account deletion) on the bare domain, required before publishing the app (scope Deferred list).
- [ ] Feature 7 (Sign in with Apple): register `nollli.com` and `no-reply@nollli.com` in Apple's private email relay settings to reach users with hidden emails.
- [ ] Move DMARC from `p=none` to `p=quarantine` once reports are clean.
