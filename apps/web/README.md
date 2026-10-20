# @flowpt/web

The browser version of FlowPT: patients (with intake fields), chart notes, invoices with the three
funding types, dashboard and settings (invoice font and colour), signed in with email + password and
mandatory TOTP MFA.

```bash
cp apps/web/.env.example apps/web/.env.local   # project URL + anon key, same values as the desktop .env
npm install
npm run dev:web        # or: npm run dev -w @flowpt/web   (http://localhost:5173)
npm run typecheck && npm run lint -w @flowpt/web   # also: build:web
```

Without the two env vars the app shows a "not configured" page instead of the sign-in screen.

## How it is built

The desktop's data layer is local SQLite in the Electron main process, so the web app cannot just
reuse it. Instead the UI is shared and only the backend differs:

- `packages/ui` (`@flowpt/ui`): the React screens, moved out of the desktop renderer. They talk only
  to `window.api` (`FlowptApi` in `packages/shared`). Desktop mounts it with the Electron preload
  bridge; web mounts it with `src/api`.
- `packages/shared`: types plus the logic both backends need, now factored out of the desktop's main
  process: input validation (`rules.ts`), dashboard maths (`dashboard.ts`) and the invoice HTML
  template (`invoiceHtml.ts`, formerly `pdf.ts`).
- `apps/web/src/api`: a cloud-first `FlowptApi` over `@supabase/supabase-js`. No local database and
  no sync engine; every call reads or writes Supabase directly with the signed-in user's session.
  Row-level security, the MFA (aal2) policy and the signed-note / issued-invoice triggers all apply
  server-side exactly as for the desktop.

## Behaviour worth knowing

- **Sign-in:** same states as the desktop (`signed-out`, `mfa-needed`, `mfa-enroll`, `ready`), via
  the shared `CloudOnboarding`/`SyncAuth` screens. The workspace only mounts once the session is aal2.
- **Device + invoice numbers:** after MFA the browser registers a row in `devices` (id kept in
  `localStorage`, per account) and calls `lease_invoice_numbers` with a block of **1** each time an
  invoice is issued. The web app is online-only, so it never holds unused blocks and adds no gaps.
  The RPC always allocates after the highest block anywhere, so numbers a desktop has leased but not
  yet used are skipped (e.g. desktop holds 1-50, first web invoice is INV-0051).
- **Printing:** invoices print through the browser print dialog (Save as PDF is built in) from the
  same HTML the desktop uses, at Letter size with the desktop's margins. There is no silent
  "save to file"; the button reads "Print / save PDF".
- **Settings:** the practitioner profile (including invoice font/colour) is the same `settings` row
  the desktop syncs. Backup/restore is desktop-only and hidden on web; "Cloud sync" becomes "Account".
- **Stale writes:** the server silently ignores updates older than the stored row (last-writer-wins on
  `updated_at`). The web API reads the returned rows and reports "Not saved: a newer version exists"
  instead of pretending it saved. This also surfaces large client clock skew.
- **Search:** patients are fetched and filtered in the browser (name, PHN, parent), the same rules as
  the desktop, which is fine at one practice's scale.

## Passkeys (web only)

Passkeys / security keys are an additional second factor (Supabase's WebAuthn MFA factor, which is
still experimental), not a replacement for MFA: the aal2 requirement and the RLS policies are
unchanged, and any verified factor satisfies them.

- Add one in **Settings > Account > Sign-in verification**, or choose "Use a passkey instead" when
  first setting up MFA. At sign-in, "Use passkey" appears if the account has one.
- Keep the authenticator app as well: the desktop app cannot do WebAuthn (its Electron origin cannot
  hold credentials), so desktop sign-in still needs a TOTP factor. The UI will not let you remove
  your last factor.
- Passkeys are bound to the site's domain. One registered on `localhost` will not work on the
  production hostname; register again there. Changing the domain later orphans existing passkeys.
- **Production domain:** the site is published at `https://flowpt.fenna.tech`, so passkeys should be
  registered there. Treat that hostname as permanent. The `[auth.mfa.web_authn]` block is now in
  `supabase/config.toml` (local dev config).
- **Needs enabling on the hosted project (not done):** Supabase dashboard > Authentication > MFA >
  turn on WebAuthn enrol and verify, and set Site URL / redirect allow-list to
  `https://flowpt.fenna.tech` (and `http://localhost:5173` for dev). I have no access to the project,
  so these are yours to apply. Until then,
  "Add passkey" fails with a server error and TOTP is unaffected.
- Not exercised against a live project or a real authenticator.

## Decisions and open questions

1. **Not yet exercised against a live project.** It typechecks, lints and builds, and the sign-in
   screen renders, but I did not use the Supabase credentials, so the PostgREST calls (embeds,
   upserts, the lease RPC, MFA enrolment) have not run end to end. Please do a first manual pass with
   the real project: sign in + MFA, create a patient, sign a note, issue an invoice, print it.
2. **Supabase Auth URL config (needs your decision):** email confirmation links and password flows
   redirect to the app origin, so the dashboard needs the web URL(s) in *Authentication > URL
   configuration* (site URL and redirect allow-list, e.g. `http://localhost:5173` for dev). No schema
   changes are required.
3. **Audit log is not transactional on web.** The desktop writes audit rows in the same transaction
   as the change. Web writes the change, then a separate `audit_log` insert, so a dropped connection
   in between can lose the entry. Fixing it properly means moving writes into RPCs (a schema change
   I did not make).
4. **Session storage:** supabase-js keeps the session in `localStorage`, so closing the tab does not
   sign out. Consider shorter JWT/session lifetimes or a sign-out-on-idle timer for PHI on shared
   computers.
5. **Compliance:** the sync design's open item still applies. Do not put real patient data in the
   cloud until the privacy/legal review is done; the web app makes the cloud the only copy.
6. **Hosting headers:** deploy with a CSP that allows `connect-src` to the Supabase project (the desktop
   page has a strict CSP; the web `index.html` has none yet, so set it at the host).
7. **Copy:** a few shared strings still say "this device" (onboarding blurb); harmless, could be made
   platform-aware.
8. **Bundle size:** one 730 kB chunk (recharts); code-split the dashboard later if load time matters.
