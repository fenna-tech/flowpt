// Pure sync engine (see docs/sync-design.md). It has no Electron imports so it can be tested
// against the real server schema with two local databases. `Remote` is the only network seam.
import type Database from 'better-sqlite3-multiple-ciphers'

type Db = Database.Database
export type Row = Record<string, unknown>

export interface Remote {
  upsert(
    table: string,
    rows: Row[],
    opts: { onConflict: string; ignoreDuplicates: boolean }
  ): Promise<void>
  pull(table: string, after: string, limit: number): Promise<Row[]>
  lease(
    deviceId: string,
    count: number,
    minStart: number
  ): Promise<{ start_no: number; end_no: number }>
}

export interface SyncResult {
  pushed: number
  pulled: number
  conflicts: number
  errors: string[]
}

// ---------- key/value (settings table) ----------

export const kvGet = (db: Db, key: string): string | null =>
  (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)
    ?.value ?? null

export const kvSet = (db: Db, key: string, value: string): void => {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}

// ---------- invoice number leases ----------

const LEASE_SIZE = 50
const LEASE_LOW_WATER = 10
const formatNumber = (n: number): string => `INV-${String(n).padStart(4, '0')}`

export function maxLocalInvoiceNo(db: Db): number {
  const r = db
    .prepare(
      "SELECT MAX(CAST(SUBSTR(number, 5) AS INTEGER)) AS n FROM invoices WHERE number LIKE 'INV-%'"
    )
    .get() as { n: number | null }
  return r.n ?? 0
}

// Local-only mode (never signed in) returns null and the caller uses the local counter.
// Signed-in mode must draw from the leased block so devices can never reuse a number.
export function takeInvoiceNumber(db: Db): string | null {
  if (!kvGet(db, 'sync_user')) return null
  const next = Number(kvGet(db, 'inv_next') ?? '0')
  const end = Number(kvGet(db, 'inv_end') ?? '0')
  if (!next || next > end) {
    throw new Error(
      'No invoice numbers are reserved on this device. Connect to the internet, sync once, then try again.'
    )
  }
  kvSet(db, 'inv_next', String(next + 1))
  return formatNumber(next)
}

export async function ensureLease(db: Db, remote: Remote, deviceId: string): Promise<void> {
  const next = Number(kvGet(db, 'inv_next') ?? '0')
  const end = Number(kvGet(db, 'inv_end') ?? '0')
  if (next && end - next + 1 >= LEASE_LOW_WATER) return
  const block = await remote.lease(deviceId, LEASE_SIZE, maxLocalInvoiceNo(db) + 1)
  kvSet(db, 'inv_next', String(block.start_no))
  kvSet(db, 'inv_end', String(block.end_no))
}

// ---------- table specs ----------

interface Spec {
  table: string
  idCol: string // local id column
  cols: string[] // synced data columns (same name locally and remotely)
  json: string[] // JSON text locally, jsonb remotely
  ts: string[] // timestamptz columns (normalized to ISO-Z locally)
  updatedAt: boolean // has a client-maintained updated_at (last-writer-wins)
  insertOnly: boolean
}

// Order matters: parents before children (foreign keys on the server).
const SPECS: Spec[] = [
  {
    table: 'patients',
    idCol: 'id',
    cols: [
      'first_name',
      'last_name',
      'dob',
      'phn',
      'email',
      'phone',
      'address',
      'notes',
      'created_at',
      'updated_at',
      'deleted_at'
    ],
    json: [],
    ts: ['created_at', 'updated_at', 'deleted_at'],
    updatedAt: true,
    insertOnly: false
  },
  {
    table: 'billing_profiles',
    idCol: 'id',
    cols: ['definition', 'created_at', 'updated_at', 'deleted_at'],
    json: ['definition'],
    ts: ['created_at', 'updated_at', 'deleted_at'],
    updatedAt: true,
    insertOnly: false
  },
  {
    table: 'chart_notes',
    idCol: 'id',
    cols: [
      'patient_id',
      'template_id',
      'visit_date',
      'sections',
      'signed_at',
      'signed_by',
      'created_at',
      'updated_at',
      'deleted_at'
    ],
    json: ['sections'],
    ts: ['signed_at', 'created_at', 'updated_at', 'deleted_at'],
    updatedAt: true,
    insertOnly: false
  },
  {
    table: 'note_addenda',
    idCol: 'id',
    cols: ['note_id', 'text', 'author', 'created_at'],
    json: [],
    ts: ['created_at'],
    updatedAt: false,
    insertOnly: true
  },
  {
    table: 'invoices',
    idCol: 'id',
    cols: [
      'number',
      'patient_id',
      'profile_id',
      'status',
      'issue_date',
      'payer_name',
      'policy_number',
      'items',
      'tax_pct',
      'notes',
      'snapshot',
      'paid_at',
      'payment_method',
      'created_at',
      'updated_at',
      'deleted_at'
    ],
    json: ['items', 'snapshot'],
    ts: ['created_at', 'updated_at', 'deleted_at'],
    updatedAt: true,
    insertOnly: false
  },
  {
    table: 'audit_log',
    idCol: 'uid', // remote column is `id`
    cols: ['ts', 'action', 'entity', 'entity_id', 'patient_id', 'actor', 'detail'],
    json: [],
    ts: ['ts'],
    updatedAt: false,
    insertOnly: true
  }
]

const LOCKED_ERROR =
  /cannot be modified|cannot be deleted|Issued invoices|Void invoices|append-only/i
const OVERLAP_MS = 10_000
const PAGE = 500
const BATCH = 100
const EPOCH = '1970-01-01T00:00:00.000Z'

const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString())

// Run `fn` with the applying flag set so triggers do not mark the writes dirty.
function applying<T>(db: Db, fn: () => T): T {
  return db.transaction(() => {
    db.prepare('UPDATE sync_flags SET applying = 1').run()
    try {
      return fn()
    } finally {
      db.prepare('UPDATE sync_flags SET applying = 0').run()
    }
  })()
}

// Stable stringify so jsonb key reordering does not look like a change.
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

// ---------- push ----------

const toRemote = (spec: Spec, row: Row, deviceId: string): Row => {
  const out: Row = { id: row[spec.idCol] }
  for (const c of spec.cols) {
    const v = row[c]
    out[c] = v != null && spec.json.includes(c) ? JSON.parse(v as string) : (v ?? null)
  }
  if (spec.table === 'audit_log') out.device_id = deviceId
  return out
}

function markClean(db: Db, spec: Spec, row: Row, reset = false): void {
  applying(db, () => {
    // reset: server owns this row now; make the local copy older so the next pull overwrites it.
    const set = reset && spec.updatedAt ? `dirty = 0, updated_at = '${EPOCH}'` : 'dirty = 0'
    const guard = spec.updatedAt && !reset ? ' AND updated_at = ?' : ''
    const args = spec.updatedAt && !reset ? [row[spec.idCol], row.updated_at] : [row[spec.idCol]]
    db.prepare(`UPDATE ${spec.table} SET ${set} WHERE ${spec.idCol} = ?${guard}`).run(...args)
  })
}

async function pushTable(
  db: Db,
  remote: Remote,
  spec: Spec,
  deviceId: string,
  res: SyncResult
): Promise<void> {
  const dirty = db
    .prepare(`SELECT * FROM ${spec.table} WHERE dirty = 1 ORDER BY rowid LIMIT 1000`)
    .all() as Row[]
  const opts = { onConflict: 'id', ignoreDuplicates: spec.insertOnly }

  for (let i = 0; i < dirty.length; i += BATCH) {
    const chunk = dirty.slice(i, i + BATCH)
    try {
      await remote.upsert(
        spec.table,
        chunk.map((r) => toRemote(spec, r, deviceId)),
        opts
      )
      chunk.forEach((r) => markClean(db, spec, r))
      res.pushed += chunk.length
      continue
    } catch {
      // fall through: retry row by row to isolate the offender
    }
    for (const row of chunk) {
      try {
        await remote.upsert(spec.table, [toRemote(spec, row, deviceId)], opts)
        markClean(db, spec, row)
        res.pushed++
      } catch (e) {
        const message = (e as Error).message
        if (LOCKED_ERROR.test(message)) {
          // Server copy is locked/authoritative: server wins, the next pull replaces our draft.
          markClean(db, spec, row, true)
          res.conflicts++
        } else {
          res.errors.push(`${spec.table}: ${message}`)
        }
      }
    }
  }
}

// ---------- pull ----------

function applyRow(db: Db, spec: Spec, remoteRow: Row): void {
  const id = remoteRow.id as string
  const local = db.prepare(`SELECT * FROM ${spec.table} WHERE ${spec.idCol} = ?`).get(id) as
    Row | undefined

  const values: Row = {}
  for (const c of spec.cols) {
    const v = remoteRow[c]
    values[c] = spec.ts.includes(c)
      ? iso(v)
      : spec.json.includes(c)
        ? v == null
          ? null
          : JSON.stringify(v)
        : (v ?? null)
  }

  if (local) {
    if (spec.insertOnly) {
      if (local.dirty === 1)
        applying(db, () =>
          db.prepare(`UPDATE ${spec.table} SET dirty = 0 WHERE ${spec.idCol} = ?`).run(id)
        )
      return
    }
    if (local.dirty === 1 && !((values.updated_at as string) > (local.updated_at as string))) return // local is newer: keep and push
    const same = spec.cols.every((c) =>
      spec.json.includes(c)
        ? canonical(local[c] == null ? null : JSON.parse(local[c] as string)) ===
          canonical(remoteRow[c] ?? null)
        : (local[c] ?? null) === (values[c] ?? null)
    )
    // Keep the local JSON text when it is semantically identical: jsonb reorders keys, and a
    // textual change to a locked row (issued invoice, signed note) would trip its trigger.
    for (const c of spec.json) {
      if (
        local[c] != null &&
        canonical(JSON.parse(local[c] as string)) === canonical(remoteRow[c] ?? null)
      ) {
        values[c] = local[c]
      }
    }
    if (same) {
      if (local.dirty === 1)
        applying(db, () =>
          db.prepare(`UPDATE ${spec.table} SET dirty = 0 WHERE ${spec.idCol} = ?`).run(id)
        )
      return
    }
  }

  const cols = [spec.idCol, ...spec.cols, 'dirty']
  const sql = `INSERT INTO ${spec.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
    ON CONFLICT(${spec.idCol}) DO UPDATE SET ${[...spec.cols, 'dirty'].map((c) => `${c} = excluded.${c}`).join(', ')}`
  applying(db, () =>
    db.prepare(sql).run(id, ...spec.cols.map((c) => values[c] as string | number | null), 0)
  )
}

async function pullTable(
  db: Db,
  remote: Remote,
  table: string,
  apply: (row: Row) => void,
  res: SyncResult
): Promise<void> {
  const key = `cursor:${table}`
  const saved = kvGet(db, key)
  let after = saved ? new Date(Date.parse(saved) - OVERLAP_MS).toISOString() : EPOCH
  let newest = saved ?? ''

  for (;;) {
    const rows = await remote.pull(table, after, PAGE)
    for (const row of rows) {
      try {
        apply(row)
        res.pulled++
      } catch (e) {
        res.errors.push(`${table}: ${(e as Error).message}`)
      }
    }
    if (rows.length === 0) break
    const last = iso(rows[rows.length - 1].server_ts)!
    if (last > newest) newest = last
    after = last
    if (rows.length < PAGE) break
  }
  if (newest) kvSet(db, key, newest)
}

// ---------- practitioner profile (settings) ----------

async function pushPractitioner(db: Db, remote: Remote, res: SyncResult): Promise<void> {
  if (kvGet(db, 'practitioner_dirty') !== '1') return
  const value = kvGet(db, 'practitioner')
  if (!value) return
  const updatedAt = kvGet(db, 'practitioner_updated_at') ?? new Date().toISOString()
  try {
    await remote.upsert('settings', [{ key: 'practitioner', value, updated_at: updatedAt }], {
      onConflict: 'owner_id,key',
      ignoreDuplicates: false
    })
    kvSet(db, 'practitioner_dirty', '0')
    res.pushed++
  } catch (e) {
    res.errors.push(`settings: ${(e as Error).message}`)
  }
}

function applySetting(db: Db, row: Row): void {
  if (row.key !== 'practitioner') return
  const remoteAt = iso(row.updated_at)!
  const localAt = kvGet(db, 'practitioner_updated_at') ?? EPOCH
  const dirty = kvGet(db, 'practitioner_dirty') === '1'
  if (dirty && remoteAt <= localAt) return
  kvSet(db, 'practitioner', row.value as string)
  kvSet(db, 'practitioner_updated_at', remoteAt)
  kvSet(db, 'practitioner_dirty', '0')
}

// ---------- entry points ----------

export function pendingCount(db: Db): number {
  let n = kvGet(db, 'practitioner_dirty') === '1' ? 1 : 0
  for (const s of SPECS) {
    n += (db.prepare(`SELECT COUNT(*) AS n FROM ${s.table} WHERE dirty = 1`).get() as { n: number })
      .n
  }
  return n
}

export async function runSync(db: Db, remote: Remote, deviceId: string): Promise<SyncResult> {
  const res: SyncResult = { pushed: 0, pulled: 0, conflicts: 0, errors: [] }
  for (const spec of SPECS) await pushTable(db, remote, spec, deviceId, res)
  await pushPractitioner(db, remote, res)
  for (const spec of SPECS)
    await pullTable(db, remote, spec.table, (r) => applyRow(db, spec, r), res)
  await pullTable(db, remote, 'settings', (r) => applySetting(db, r), res)
  await ensureLease(db, remote, deviceId)
  return res
}
