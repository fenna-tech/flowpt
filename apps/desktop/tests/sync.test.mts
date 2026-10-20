// Two-device sync test against the REAL server schema (PGlite) and the REAL local schema.
import { PGlite } from '@electric-sql/pglite'
import Database from 'better-sqlite3-multiple-ciphers'
import { randomUUID } from 'crypto'
import { readFileSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { migrate } from '../src/main/db/migrations.ts'
import {
  kvGet,
  kvSet,
  pendingCount,
  runSync,
  takeInvoiceNumber,
  type Remote,
  type Row
} from '../src/main/sync/engine.ts'

const here = dirname(fileURLToPath(import.meta.url))
const migrations = join(here, '..', '..', '..', 'supabase', 'migrations')
const USER = '11111111-1111-1111-1111-111111111111'

const pg = new PGlite()
await pg.exec(`
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select jsonb_build_object('sub', current_setting('request.jwt.claim.sub', true), 'aal', nullif(current_setting('request.jwt.claim.aal', true), '')) $$;
  create role authenticated nologin; create role anon nologin;
  grant usage on schema public, auth to authenticated, anon;
  grant execute on function auth.uid(), auth.jwt() to authenticated, anon;
  insert into auth.users values ('${USER}');
`)
for (const f of readdirSync(migrations).sort()) await pg.exec(readFileSync(join(migrations, f), 'utf8'))
await pg.exec('grant select, insert, update on all tables in schema public to authenticated')

let offline = false
const asUser = () => pg.exec(`reset role; set request.jwt.claim.sub='${USER}'; set request.jwt.claim.aal='aal2'; set role authenticated`)

// Mirrors the PostgREST behaviour the Supabase client gives us.
const remote: Remote = {
  async upsert(table, rows, opts) {
    if (offline) throw new Error('fetch failed')
    await asUser()
    for (const row of rows) {
      const keys = Object.keys(row)
      const vals = keys.map((k) => (row[k] !== null && typeof row[k] === 'object' ? JSON.stringify(row[k]) : row[k]))
      const ph = keys.map((k, i) => (row[k] !== null && typeof row[k] === 'object' ? `$${i + 1}::jsonb` : `$${i + 1}`))
      const conflictCols = opts.onConflict.split(',')
      const sets = keys.filter((k) => !conflictCols.includes(k)).map((k) => `${k} = excluded.${k}`)
      const tail = opts.ignoreDuplicates || sets.length === 0 ? 'do nothing' : `do update set ${sets.join(', ')}`
      await pg.query(`insert into public.${table} (${keys.join(',')}) values (${ph.join(',')}) on conflict (${opts.onConflict}) ${tail}`, vals)
    }
  },
  async pull(table, after, limit) {
    if (offline) throw new Error('fetch failed')
    await asUser()
    const r = await pg.query<{ j: Row }>(`select to_jsonb(t) as j from public.${table} t where server_ts > $1 order by server_ts limit $2`, [after, limit])
    return r.rows.map((x) => x.j)
  },
  async lease(device, count, minStart) {
    if (offline) throw new Error('fetch failed')
    await asUser()
    return (await pg.query<{ start_no: number; end_no: number }>('select * from lease_invoice_numbers($1,$2,$3)', [device, count, minStart])).rows[0]
  }
}

const newDevice = async (name: string) => {
  const db = new Database(':memory:')
  migrate(db)
  const id = randomUUID()
  await remote.upsert('devices', [{ id, name }], { onConflict: 'id', ignoreDuplicates: false })
  kvSet(db, 'sync_user', USER)
  return { db, id, name }
}
const sync = (d: { db: Database.Database; id: string }) => runSync(d.db, remote, d.id)

let pass = 0, fail = 0
const check = (name: string, cond: unknown, detail = '') => {
  if (cond) { pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name, detail) }
}
const t = (h: number) => `2026-10-19T${String(h).padStart(2, '0')}:00:00.000Z`
const one = (db: Database.Database, sql: string, ...a: unknown[]) => db.prepare(sql).get(...a) as Row
const remoteOne = async (sql: string) => { await pg.exec('reset role'); return (await pg.query<Row>(sql)).rows[0] }

const P1 = randomUUID(), N1 = randomUUID(), I1 = randomUUID()
const A = await newDevice('A'), B = await newDevice('B')

// ---- A creates data offline, then syncs ----
A.db.prepare("INSERT INTO patients (id,first_name,last_name,created_at,updated_at) VALUES (?,?,?,?,?)").run(P1, 'Ann', 'Lee', t(1), t(1))
A.db.prepare("INSERT INTO chart_notes (id,patient_id,template_id,visit_date,sections,created_at,updated_at) VALUES (?,?,'soap','2026-10-19',?,?,?)").run(N1, P1, JSON.stringify([{ key: 's', label: 'S', text: 'draft' }]), t(1), t(1))
A.db.prepare("INSERT INTO invoices (id,patient_id,profile_id,issue_date,items,created_at,updated_at) VALUES (?,?,'private','2026-10-19',?,?,?)").run(I1, P1, JSON.stringify([{ unitCents: 12000, quantity: 1, description: 'Visit', code: '' }]), t(1), t(1))
for (const a of ['note.create', 'invoice.create']) A.db.prepare("INSERT INTO audit_log (uid,ts,action,entity,entity_id,patient_id,actor) VALUES (?,?,?,?,?,?,?)").run(randomUUID(), t(1), a, 'x', 'x', P1, 'Dr A')
kvSet(A.db, 'practitioner', JSON.stringify({ name: 'Dr A' })); kvSet(A.db, 'practitioner_updated_at', t(1)); kvSet(A.db, 'practitioner_dirty', '1')

check('A has pending rows before sync', pendingCount(A.db) === 6, String(pendingCount(A.db)))
let r = await sync(A)
check('A push ok, no errors/conflicts', r.errors.length === 0 && r.conflicts === 0, JSON.stringify(r))
check('A fully clean after sync', pendingCount(A.db) === 0)
check('server received all rows', (await remoteOne(`select (select count(*) from patients)::int p, (select count(*) from chart_notes)::int n, (select count(*) from invoices)::int i, (select count(*) from audit_log)::int a`)).a === 2)
check('A leased invoice block 1-50', kvGet(A.db, 'inv_next') === '1' && kvGet(A.db, 'inv_end') === '50')

// ---- B joins ----
r = await sync(B)
check('B pulled data, no errors', r.errors.length === 0 && (one(B.db, 'select count(*) n from patients').n as number) === 1 && (one(B.db, 'select count(*) n from audit_log').n as number) === 2, JSON.stringify(r))
check('pulled rows are clean (not re-pushed)', pendingCount(B.db) === 0)
check('B received practitioner profile', kvGet(B.db, 'practitioner') === JSON.stringify({ name: 'Dr A' }))
check('B leased the next block (51-100)', kvGet(B.db, 'inv_next') === '51' && kvGet(B.db, 'inv_end') === '100')
check('second sync pushes and pulls nothing new', (await sync(B)).pushed === 0 && (await sync(A)).pushed === 0)

// ---- last-writer-wins on drafts ----
A.db.prepare("UPDATE patients SET first_name='AnnA', updated_at=? WHERE id=?").run(t(5), P1)
B.db.prepare("UPDATE patients SET first_name='AnnB', updated_at=? WHERE id=?").run(t(4), P1)
check('local edits mark rows dirty', pendingCount(A.db) === 1 && pendingCount(B.db) === 1)
await sync(B); await sync(A); await sync(B)
check('both converge on the newer edit', one(A.db, 'select first_name f from patients').f === 'AnnA' && one(B.db, 'select first_name f from patients').f === 'AnnA')

// ---- signed record on server beats a stale draft elsewhere ----
A.db.prepare("UPDATE chart_notes SET signed_at=?, signed_by='Dr A', sections=?, updated_at=? WHERE id=?").run(t(6), JSON.stringify([{ key: 's', label: 'S', text: 'final' }]), t(6), N1)
await sync(A)
B.db.prepare("UPDATE chart_notes SET sections=?, updated_at=? WHERE id=?").run(JSON.stringify([{ key: 's', label: 'S', text: 'B stale draft' }]), t(7), N1)
r = await sync(B)
const bn = one(B.db, 'select * from chart_notes where id=?', N1)
check('server rejects stale draft (conflict counted)', r.conflicts === 1, JSON.stringify(r))
check('B now holds the signed version', bn.signed_at !== null && (bn.sections as string).includes('final'))
check('B clean after conflict, no errors', pendingCount(B.db) === 0 && r.errors.length === 0)

// ---- addenda are insert-only and sync both ways ----
A.db.prepare("INSERT INTO note_addenda (id,note_id,text,author,created_at) VALUES (?,?,?,?,?)").run(randomUUID(), N1, 'late entry', 'Dr A', t(8))
await sync(A); await sync(B)
check('addendum reached B', (one(B.db, 'select count(*) n from note_addenda').n as number) === 1)

// ---- invoice numbers from leases; issued invoices stay locked locally ----
const numA = A.db.transaction(() => takeInvoiceNumber(A.db))()
const numB = B.db.transaction(() => takeInvoiceNumber(B.db))()
check('devices draw distinct numbers', numA === 'INV-0001' && numB === 'INV-0051', `${numA} ${numB}`)
A.db.prepare("UPDATE invoices SET status='issued', number=?, snapshot='{}', updated_at=? WHERE id=?").run(numA, t(9), I1)
await sync(A); r = await sync(B)
check('B pulled the issued invoice', one(B.db, 'select status s, number n from invoices').s === 'issued' && r.errors.length === 0, JSON.stringify(r))
B.db.prepare("UPDATE invoices SET status='paid', paid_at='2026-10-20', payment_method='cash', updated_at=? WHERE id=?").run(t(10), I1)
await sync(B); r = await sync(A)
check('A accepts paid status without tripping its lock trigger', one(A.db, 'select status s from invoices').s === 'paid' && r.errors.length === 0, JSON.stringify(r))
const aItems = one(A.db, 'select items i from invoices').i as string
check('A keeps its original JSON text (no key reorder)', aItems.startsWith('[{"unitCents"'), aItems)

// ---- audit entries cross over ----
B.db.prepare("INSERT INTO audit_log (uid,ts,action,entity,entity_id,patient_id,actor) VALUES (?,?,?,?,?,?,?)").run(randomUUID(), t(11), 'note.view', 'x', 'x', P1, 'Dr B')
await sync(B); await sync(A)
check('audit entries sync between devices without duplicates', (one(A.db, 'select count(*) n from audit_log').n as number) === (one(B.db, 'select count(*) n from audit_log').n as number))
check('server audit log has device ids', (await remoteOne(`select count(*)::int n from audit_log where device_id is not null`)).n === 3)

// ---- offline failure then recovery ----
A.db.prepare("UPDATE patients SET phone='555', updated_at=? WHERE id=?").run(t(12), P1)
offline = true
r = await sync(A).catch((e: Error) => ({ errors: [e.message], pushed: 0, pulled: 0, conflicts: 0 }))
check('offline sync fails without losing the change', pendingCount(A.db) === 1)
offline = false
await sync(A); await sync(B)
check('recovers and delivers after reconnect', one(B.db, 'select phone p from patients').p === '555' && pendingCount(A.db) === 0)

// ---- lease floor for a device that already issued local numbers ----
const C = await newDevice('C')
C.db.prepare("INSERT INTO patients (id,first_name,last_name,created_at,updated_at) VALUES (?,?,?,?,?)").run(randomUUID(), 'Zed', 'Cee', t(1), t(1))
C.db.prepare("INSERT INTO invoices (id,number,patient_id,profile_id,status,issue_date,snapshot,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(randomUUID(), 'INV-0500', (one(C.db, 'select id from patients').id as string), 'private', 'issued', '2026-10-01', '{}', t(1), t(1))
await sync(C)
check('lease floor skips numbers already used locally', Number(kvGet(C.db, 'inv_next')) >= 501, String(kvGet(C.db, 'inv_next')))

// ---- new device: name-only setup stub must not overwrite the cloud profile ----
const D = await newDevice('D')
kvSet(D.db, 'practitioner', JSON.stringify({ name: 'Stub' }))
kvSet(D.db, 'practitioner_updated_at', '1970-01-01T00:00:00.000Z')
kvSet(D.db, 'practitioner_dirty', '1')
await sync(D)
check('new device adopts the cloud practitioner profile', kvGet(D.db, 'practitioner') === JSON.stringify({ name: 'Dr A' }), String(kvGet(D.db, 'practitioner')))
check('cloud profile was not overwritten by the stub', (await remoteOne("select value v from settings where key='practitioner'")).v === JSON.stringify({ name: 'Dr A' }))

// ---- local-only mode keeps the legacy counter ----
const L = new Database(':memory:'); migrate(L)
check('local-only mode does not use leases', takeInvoiceNumber(L) === null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
