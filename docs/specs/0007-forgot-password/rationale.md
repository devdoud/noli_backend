# 0007. Forgot password: rationale

## Context

Today a Noli user who forgets their password has no way back: the API has login, refresh, and sign up, but nothing to recover an account. On a mobile first product for francophone West Africa, where people change phones often and reuse few passwords, this turns into lost users or new duplicate accounts. The only proof of identity the API holds is the email address given at sign up, and it has never been checked (`isEmailVerified` exists on `User` but is never set).

The API has no email sending at all yet. Whatever is chosen here also becomes the transport for billing emails (feature 4), so it has to be cheap at low volume, simple to run for a one person team, and reliable enough that a code arrives within a minute or two on mobile networks.

Sessions are stateless JWTs: an access token and a refresh token, both signed and never stored. Nothing can revoke them before they expire. A password reset is exactly the moment a user expects intruders to lose access, so the reset has to reach existing tokens somehow.

Recovery flows are a favorite attack surface: they can reveal which emails have accounts, be used to spam people, or be brute forced if the secret is short. The flow is public by nature (the user can't sign in), so every protection has to work without knowing who is calling. Many users share IPs (mobile carriers, cyber cafés), which limits how hard IP limits can be.

## Options considered

### Option 1: Emailed link to a web page

The email carries a long random token in a link to a small web page where the user types the new password.

**Pros**:
- The token is long, so guessing is impossible without attempt counting.
- Works from any device that opens the email.

**Cons**:
- Needs a hosted web page (a new deployable) and its own design, for a mobile app product.
- Mail scanners and link previews can open (and consume) single use links.
- The user leaves the app, then has to come back and sign in.

### Option 2: Emailed 6 digit code, verify then reset, `tokenVersion`, Brevo (chosen)

The email carries a 6 digit code typed in the app. A right code yields a 10 minute single use reset token (an opaque random string, stored hashed); the reset changes the password, bumps a per user `tokenVersion` that every token carries, and returns fresh tokens. Brevo sends the emails over its HTTP API.

**Pros**:
- Everything stays in the app; no web page and no deep links.
- Works when the email is read on another device (the code is typed by hand).
- Two steps tell the user at once whether the code is right, before they type a password.
- `tokenVersion` revokes all older sessions with one integer and no extra query.

**Cons**:
- A 6 digit code is guessable in principle, so it relies on the 5 try limit, the 15 minute expiry, and IP limits.
- One more round trip and one more token type than a single step reset.
- Brevo is a new external dependency with a daily free quota.

### Option 3: Deep link that opens the app

The email carries a link that opens the app on the reset screen with the token.

**Pros**:
- One tap from the email, the smoothest path on the phone that has the app.

**Cons**:
- Needs universal links (iOS) and app links (Android) configured and hosted, a real setup cost.
- Fails when the email is opened on a computer or another phone.
- Same link consumption risk as Option 1.

### Option 4: Stored refresh tokens (session list) instead of `tokenVersion`

Same code flow, but sessions are revoked by storing every refresh token and deleting them at reset.

**Pros**:
- Enables per device session management later (list and sign out one device).

**Cons**:
- A much larger change to auth: storage, rotation, cleanup.
- Access tokens already issued keep working until they expire unless the guard also checks a store.
- Solves a problem the product doesn't have yet.

## Rationale

The code flow fits a mobile app with no web front end: it avoids building and hosting a page (Option 1) or configuring platform deep links (Option 3), and it works whatever device the email is read on, which matters where people share or switch phones. The weakness of a short code is real but well contained by layering: 5 tries per code, 15 minutes, a new request cancels the old code, and per IP limits. One in 200,000 odds per code, with the per email limit of 5 codes an hour, leaves no practical brute force.

Splitting verify and reset costs one route but gives the user immediate feedback on a mistyped code, which on small screens is the common failure. The reset token is an opaque random string stored only as a fingerprint, so it can never be confused with an access token and needs no extra signing setup.

`tokenVersion` was chosen over a session store (Option 4) because the JWT guard already loads the user on every request: comparing one integer adds no query, and it answers the only revocation need the product has today (reset, then the password change of feature 6). Missing values read as 0, so no one is signed out at deploy. A session list stays possible later if per device management becomes a feature.

Brevo was the engineer's pick over Resend, Amazon SES, and SMTP: it is French, has a French interface, and its free tier (about 300 emails a day, no card) covers a launch on a small budget, which matters given that paid services (Cloudflare Stream) are on hold for cost. Its plain HTTP API is called with `fetch`, the pattern `stream.client.ts` already uses, so no SDK is added. Resend was the runner up for developer experience, but its free tier is lower per day and it pushes for a verified domain earlier.

Sending in the background and answering the same message for unknown emails and for silently dropped requests keeps the flow from revealing who has an account, through the content or the timing of answers. The cost is that the API never confirms delivery; the 60 second resend is the user's remedy.
