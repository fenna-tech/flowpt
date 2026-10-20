import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

// Runs every migration against an in-process Postgres (PGlite) with a stub of Supabase's auth schema.
const migrations = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const db = new PGlite()
const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'

// Minimal stand-in for Supabase's auth schema and roles.
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select jsonb_build_object('sub', current_setting('request.jwt.claim.sub', true), 'aal', nullif(current_setting('request.jwt.claim.aal', true), '')) $$;
  create role authenticated nologin; create role anon nologin;
  grant usage on schema public, auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
  insert into auth.users values ('${A}'), ('${B}');
`)
for (const f of readdirSync(migrations).sort()) await db.exec(readFileSync(join(migrations, f), 'utf8'))
await db.exec(`grant select, insert, update on all tables in schema public to authenticated;`)

let pass = 0, fail = 0
const as = async (user, aal = 'aal2') => {
  await db.exec(`reset role; set request.jwt.claim.sub = '${user}'; set request.jwt.claim.aal = '${aal}'; set role authenticated;`)
}
const q = async (sql, params) => (await db.query(sql, params)).rows
const ok = async (name, fn) => {
  try { const r = await fn(); if (r === false) throw new Error('assertion false'); pass++; console.log('PASS', name) }
  catch (e) { fail++; console.log('FAIL', name, '-', e.message) }
}
const rejects = async (name, fn, re) => {
  try { await fn(); fail++; console.log('FAIL', name, '- expected error') }
  catch (e) { if (re && !re.test(e.message)) { fail++; console.log('FAIL', name, '- wrong error:', e.message) } else { pass++; console.log('PASS', name, '->', e.message) } }
}

const P1 = 'aaaaaaaa-0000-0000-0000-000000000001'
const N1 = 'bbbbbbbb-0000-0000-0000-000000000001'
const I1 = 'cccccccc-0000-0000-0000-000000000001'
const t0 = '2026-10-19T10:00:00Z', t1 = '2026-10-19T11:00:00Z'

await as(A)
await ok('A inserts patient (owner defaulted)', async () => {
  await q(`insert into patients (id, first_name, last_name, created_at, updated_at) values ($1,'Ann','Lee',$2,$2)`, [P1, t0])
  return (await q(`select owner_id from patients`))[0].owner_id === A
})
await ok('B cannot see A rows', async () => { await as(B); return (await q(`select * from patients`)).length === 0 })
await rejects('B cannot insert rows owned by A', async () => {
  await q(`insert into patients (id, owner_id, first_name, last_name, created_at, updated_at) values (gen_random_uuid(), $1, 'x','y',$2,$2)`, [A, t0])
}, /row-level security/)
await ok('B cannot update A rows (0 affected)', async () => {
  const r = await db.query(`update patients set first_name='Hacked'`); return r.affectedRows === 0
})
await ok('A cannot hard-delete (no delete policy / privilege)', async () => {
  await as(A)
  try { const r = await db.query(`delete from patients`); if (r.affectedRows !== 0) return false } catch { /* permission denied also fine */ }
  return (await q(`select count(*)::int n from patients`))[0].n === 1
})

// notes
await as(A)
await q(`insert into chart_notes (id, patient_id, template_id, visit_date, sections, created_at, updated_at) values ($1,$2,'soap','2026-10-19','[{"key":"s","text":"hi"}]',$3,$3)`, [N1, P1, t0])
await ok('draft note editable', async () => { await q(`update chart_notes set sections='[{"key":"s","text":"edited"}]', updated_at=$2 where id=$1`, [N1, t1]); return true })
await ok('stale write ignored (older updated_at)', async () => {
  await q(`update chart_notes set sections='[{"key":"s","text":"STALE"}]', updated_at=$2 where id=$1`, [N1, t0])
  return (await q(`select sections->0->>'text' t from chart_notes where id=$1`, [N1]))[0].t === 'edited'
})
await q(`update chart_notes set signed_at=$2, signed_by='Dr A', updated_at=$2 where id=$1`, [N1, '2026-10-19T12:00:00Z'])
await rejects('signed note cannot change', () => q(`update chart_notes set sections='[]', updated_at=$2 where id=$1`, [N1, '2026-10-19T13:00:00Z']), /Signed notes/)
await rejects('signed note cannot be soft-deleted', () => q(`update chart_notes set deleted_at=now(), updated_at=$2 where id=$1`, [N1, '2026-10-19T13:00:00Z']), /Signed notes/)
await ok('idempotent re-push keeps server_ts', async () => {
  const before = (await q(`select server_ts::text s from chart_notes where id=$1`, [N1]))[0].s
  await q(`update chart_notes set signed_by='Dr A' where id=$1`, [N1])
  await q(`update chart_notes set updated_at=updated_at where id=$1`, [N1])
  return (await q(`select server_ts::text s from chart_notes where id=$1`, [N1]))[0].s === before
})
await ok('addendum insert ok', async () => { await q(`insert into note_addenda (id, note_id, text, author, created_at) values (gen_random_uuid(), $1,'late','Dr A',$2)`, [N1, t1]); return true })
await ok('clients cannot update addenda (RLS: 0 rows)', async () => (await db.query(`update note_addenda set text='x'`)).affectedRows === 0)
await rejects('addenda trigger blocks even admin updates', async () => { await db.exec('reset role'); await q(`update note_addenda set text='x'`) }, /append-only/)
await as(A)

// invoices
await q(`insert into invoices (id, patient_id, profile_id, issue_date, created_at, updated_at) values ($1,$2,'private','2026-10-19',$3,$3)`, [I1, P1, t0])
await ok('draft invoice editable', async () => { await q(`update invoices set items='[{"d":1}]', updated_at=$2 where id=$1`, [I1, t1]); return true })
await q(`update invoices set status='issued', number='INV-0001', snapshot='{}', updated_at=$2 where id=$1`, [I1, '2026-10-19T12:00:00Z'])
await rejects('issued invoice items locked', () => q(`update invoices set items='[]', updated_at=$2 where id=$1`, [I1, '2026-10-19T13:00:00Z']), /Issued invoices/)
await rejects('issued invoice cannot revert to draft', () => q(`update invoices set status='draft', updated_at=$2 where id=$1`, [I1, '2026-10-19T13:00:00Z']), /Issued invoices/)
await ok('issued -> paid allowed', async () => { await q(`update invoices set status='paid', paid_at='2026-10-20', payment_method='cash', updated_at=$2 where id=$1`, [I1, '2026-10-19T14:00:00Z']); return true })
await q(`update invoices set status='void', updated_at=$2 where id=$1`, [I1, '2026-10-19T15:00:00Z'])
await rejects('void is final', () => q(`update invoices set status='paid', updated_at=$2 where id=$1`, [I1, '2026-10-19T16:00:00Z']), /Void invoices/)
await rejects('duplicate invoice number per owner', async () => {
  await q(`insert into invoices (id, number, patient_id, profile_id, issue_date, status, created_at, updated_at) values (gen_random_uuid(),'INV-0001',$1,'private','2026-10-19','issued',$2,$2)`, [P1, t0])
}, /unique|duplicate/)

// settings / audit
await rejects('settings whitelist blocks pin_hash', () => q(`insert into settings (key, value, updated_at) values ('pin_hash','x',now())`), /check/)
await ok('practitioner setting syncs', async () => { await q(`insert into settings (key, value, updated_at) values ('practitioner','{}',now())`); return true })
await ok('audit insert ok', async () => { await q(`insert into audit_log (id, ts, action, entity, entity_id, actor) values (gen_random_uuid(), now(), 'note.sign','note','x','Dr A')`); return true })
await ok('clients cannot update audit log (RLS: 0 rows)', async () => (await db.query(`update audit_log set action='x'`)).affectedRows === 0)
await rejects('audit trigger blocks even admin updates', async () => { await db.exec('reset role'); await q(`update audit_log set action='x'`) }, /append-only/)
await as(A)

// leases
const [dev1] = await q(`insert into devices (name) values ('Desktop') returning id`)
await ok('lease blocks are contiguous', async () => {
  const a = (await q(`select * from lease_invoice_numbers($1, 50)`, [dev1.id]))[0]
  const b = (await q(`select * from lease_invoice_numbers($1, 10)`, [dev1.id]))[0]
  return a.start_no === 1 && a.end_no === 50 && b.start_no === 51 && b.end_no === 60
})
await ok('other owner has an independent series', async () => {
  await as(B)
  const [d2] = await q(`insert into devices (name) values ('Laptop') returning id`)
  return (await q(`select * from lease_invoice_numbers($1, 5)`, [d2.id]))[0].start_no === 1
})
await rejects('cannot lease on someone else\'s device', async () => { await as(B); await q(`select * from lease_invoice_numbers($1, 5)`, [dev1.id]) }, /Unknown device/)
await rejects('block size capped', async () => { await as(A); await q(`select * from lease_invoice_numbers($1, 1000)`, [dev1.id]) }, /Invalid block size/)
await ok('cannot insert lease rows directly', async () => {
  try { await q(`insert into invoice_number_blocks (device_id, start_no, end_no) values ($1, 999, 1000)`, [dev1.id]); return false } catch { return true }
})

// MFA enforcement
await ok('password-only (aal1) session sees nothing', async () => { await as(A, 'aal1'); return (await q(`select * from patients`)).length === 0 })
await rejects('aal1 session cannot insert', () => q(`insert into patients (id, first_name, last_name, created_at, updated_at) values (gen_random_uuid(),'x','y',now(),now())`), /row-level security/)
await rejects('aal1 session cannot lease numbers', () => q(`select * from lease_invoice_numbers($1, 5)`, [dev1.id]), /MFA required/)
await as(A)
await ok('lease honors the floor', async () => (await q(`select * from lease_invoice_numbers($1, 5, 500)`, [dev1.id]))[0].start_no === 500)
await ok('floor below existing blocks is ignored', async () => (await q(`select * from lease_invoice_numbers($1, 5, 3)`, [dev1.id]))[0].start_no === 505)

// pull by cursor
await ok('pull by server_ts cursor', async () => {
  await as(A)
  const all = await q(`select id from patients where server_ts > '1970-01-01' order by server_ts limit 500`)
  const cur = (await q(`select max(server_ts)::text m from patients`))[0].m
  const none = await q(`select id from patients where server_ts > $1`, [cur])
  return all.length === 1 && none.length === 0
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
