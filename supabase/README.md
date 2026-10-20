# FlowPT backend (Supabase)

Schema, RLS and sync functions live in `migrations/`. Design: [`docs/sync-design.md`](../docs/sync-design.md).

## Test the schema (no cloud account needed)
```
npm run test:supabase
```
Runs every migration on an in-process Postgres (PGlite) and checks row-level security, immutability,
last-writer-wins, invoice-number leasing and cursor pulls.

## Create the hosted project (you do this in the Supabase dashboard)
1. New project, **Region: Canada (Central) / `ca-central-1`**. Choose a strong database password and store it in your password manager.
2. Auth settings: enable **MFA (TOTP)** and **MFA (WebAuthn)** (passkeys, used by the web app), set the **Site URL** to `https://flowpt.fenna.tech` and add it (plus `http://localhost:5173` for development) to the redirect allow-list, minimum password length 12, and turn **off** new sign-ups once your own account exists.
3. Apply the schema: install the Supabase CLI, then `supabase login`, `supabase link --project-ref <ref>`, `supabase db push`.
4. Keep the **service role key private**. The app only ever needs the project URL and the **anon (publishable) key**; both go in a local `.env` that is git-ignored.
5. Before any real patient data: complete the legal/compliance items in `docs/sync-design.md` ("Open items").

Do not commit keys, passwords or `.env` files.
