# FlowPT sync design

Decisions (confirmed): **custom lightweight sync** over **Supabase (ca-central-1)**, **server-readable** data
(TLS in transit, encryption at rest, row-level security). Desktop stays offline-first: the local encrypted
SQLite DB is the working copy; the cloud is the shared copy and the backup.

## Why this is simple for FlowPT
- All ids are client-generated UUIDs, so offline creates never collide.
- Records are soft-deleted (`deleted_at`), never removed.
- The riskiest data is already immutable: signed notes, issued invoices, addenda and the audit log
  cannot change after the fact. Only **drafts** can be edited concurrently, and a solo practitioner
  rarely edits one draft on two devices at once.

## Protocol
1. **Auth.** Supabase Auth (email + password, MFA required). The app PIN is local only and never synced.
2. **Push (device to cloud).** Each local table gets a `dirty` flag set by a trigger on insert/update.
   The sync worker upserts dirty rows (`on conflict (id)`) in dependency order: patients, notes,
   addenda, billing profiles, invoices, settings, audit. A row is marked clean after the server accepts it.
3. **Pull (cloud to device).** Per table, fetch `server_ts > cursor - 10s ordered by server_ts limit 500`,
   repeating until empty. The overlap window covers transactions that commit late; applying a row is
   idempotent, so re-fetching is harmless. The cursor is stored locally per table.
4. **Apply.** A pulled row replaces the local one if its `updated_at` is newer, or the local row is clean.
   Locally dirty rows with a newer `updated_at` are kept and pushed (see conflicts).
5. **When.** On launch (once signed in), on a 60 s timer, and after local writes (debounced 5 s). Offline
   is normal: failures retry with backoff and never block the UI. Sync runs only while signed in.

## Conflict policy
| Data | Rule |
|---|---|
| Drafts (notes, invoices, patients, profiles) | **Last writer wins** by `updated_at` (server ignores older writes). |
| Signed note / issued invoice on server, stale draft on device | **Server wins**; the device's draft is replaced and the user is told. |
| Addenda, audit entries | Insert-only, no conflicts. |
| Deletes | Soft delete is just another update (last writer wins), except on locked records, which cannot be deleted. |
| Invoice numbers | **Leased in blocks** (`lease_invoice_numbers`, default 50 per device). A device issues numbers from its block offline, so two devices can never reuse a number. Gaps are expected. |

The same immutability rules run on the server (triggers), so a buggy or old client cannot corrupt locked records.

## Security model
- Every table has `owner_id = auth.uid()` with row-level security. There are no DELETE policies, so a client
  cannot hard-delete anything. `settings` only accepts the `practitioner` key (credentials never leave the device).
- Audit entries are generated on the device and uploaded; the server rejects updates. Clinical content never goes in the audit log.
- Supabase holds the data readable by the service (needed for future AI, search, password reset). Field-level
  encryption of note text can be added later without a protocol change.
- **Account recovery:** because the cloud copy is readable, a forgotten password is recoverable via Supabase; sign in again and re-sync.

## Client work (next steps)
1. Local migration: `dirty` flags and triggers; `sync_state` (per-table cursor, device id, leased invoice block).
2. Local `audit_log` ids become UUIDs so entries can be uploaded.
3. Replace the local `next_invoice_no` counter with leased blocks.
4. Sync worker in the Electron main process (uses `@supabase/supabase-js`; tokens stored via `safeStorage`).
5. Sign-in screen + MFA enrolment before first sync; "Sync status" indicator.

## Open items needing a decision outside the code
- **Legal/compliance review.** Confirm with Supabase and a BC privacy lawyer how PIPA / the *E-Health Act* / college rules
  apply, whether a data-processing agreement is available for `ca-central-1`, and whether Supabase's BAA/HIPAA terms
  (US law, paid plans) cover that region. Do not put real patient data in the cloud until this is settled.
- **Retention and erasure.** Clients cannot hard-delete; retention periods and patient-erasure requests are an admin process.
- **Multi-user clinics.** Schema is one account per practitioner. Staff access means adding `practice_id` + membership roles later.
