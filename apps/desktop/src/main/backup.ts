import { BrowserWindow, dialog } from 'electron'
import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from 'crypto'
import { readFile, writeFile } from 'fs/promises'
import { gunzipSync, gzipSync } from 'zlib'
import type { BackupResult } from '@flowpt/shared'
import { getDb } from './db/connection'
import { logAudit } from './db/audit'
import { confirmPin } from './lock'

// File format: MAGIC | salt(16) | iv(12) | gcm tag(16) | ciphertext (gzip'd JSON).
// The key comes from a backup passphrase (scrypt), so a backup restores on any machine; the
// local DB key is tied to this computer's OS keychain and is not portable.
const MAGIC = Buffer.from('FLOWPTBK1')
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }
const MIN_PASSPHRASE = 8

// Insert order respects foreign keys. Credentials and lock state never leave the app.
const TABLES = [
  'patients',
  'chart_notes',
  'note_addenda',
  'billing_profiles',
  'invoices',
  'audit_log'
] as const
const SETTINGS_KEYS = ['practitioner', 'next_invoice_no', 'lock_timeout_min']

interface Payload {
  app: 'flowpt'
  schemaVersion: number
  exportedAt: string
  tables: Record<string, Record<string, unknown>[]>
  settings: Record<string, string>
}

const checkPassphrase = (p: unknown): string => {
  if (typeof p !== 'string' || p.length < MIN_PASSPHRASE) {
    throw new Error(`Backup passphrase must be at least ${MIN_PASSPHRASE} characters`)
  }
  return p
}

function encrypt(plain: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', scryptSync(passphrase, salt, 32, SCRYPT), iv)
  cipher.setAAD(MAGIC)
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body])
}

function decrypt(file: Buffer, passphrase: string): Buffer {
  const head = MAGIC.length + 16 + 12 + 16
  if (file.length < head || !file.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Not a FlowPT backup file')
  }
  const salt = file.subarray(MAGIC.length, MAGIC.length + 16)
  const iv = file.subarray(MAGIC.length + 16, MAGIC.length + 28)
  const tag = file.subarray(MAGIC.length + 28, head)
  try {
    const d = createDecipheriv('aes-256-gcm', scryptSync(passphrase, salt, 32, SCRYPT), iv)
    d.setAAD(MAGIC)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(file.subarray(head)), d.final()])
  } catch {
    throw new Error('Wrong passphrase, or the backup file is corrupted')
  }
}

export function buildBackup(): { payload: Payload; counts: Record<string, number> } {
  const db = getDb()
  const tables: Payload['tables'] = {}
  const counts: Record<string, number> = {}
  for (const t of TABLES) {
    tables[t] = db.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[]
    counts[t] = tables[t].length
  }
  const settings: Record<string, string> = {}
  for (const k of SETTINGS_KEYS) {
    const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as
      { value: string } | undefined
    if (r) settings[k] = r.value
  }
  const schemaVersion = db.pragma('user_version', { simple: true }) as number
  return {
    payload: {
      app: 'flowpt',
      schemaVersion,
      exportedAt: new Date().toISOString(),
      tables,
      settings
    },
    counts
  }
}

export const encryptBackup = (payload: Payload, passphrase: string): Buffer =>
  encrypt(gzipSync(Buffer.from(JSON.stringify(payload))), passphrase)

export function restoreBackup(file: Buffer, passphrase: string): Record<string, number> {
  const payload = JSON.parse(gunzipSync(decrypt(file, passphrase)).toString()) as Payload
  if (payload?.app !== 'flowpt' || typeof payload.tables !== 'object') {
    throw new Error('Not a FlowPT backup file')
  }
  const db = getDb()
  const current = db.pragma('user_version', { simple: true }) as number
  if (payload.schemaVersion > current) {
    throw new Error('This backup is from a newer version of FlowPT. Update the app first.')
  }
  const used = (['patients', 'chart_notes', 'invoices'] as const).some(
    (t) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n > 0
  )
  if (used) throw new Error('Restore is only possible on a fresh install with no patient data')

  const counts: Record<string, number> = {}
  db.transaction(() => {
    for (const t of TABLES) {
      const cols = new Set((db.pragma(`table_info(${t})`) as { name: string }[]).map((c) => c.name))
      for (const row of payload.tables[t] ?? []) {
        // Column names come from the DB schema, never from the file, so they cannot inject SQL.
        // Backups from older versions may lack columns that sync needs; fill them in.
        const data: Record<string, unknown> = { ...row }
        if (t === 'audit_log' && !data.uid) data.uid = randomUUID()
        if (t === 'billing_profiles' && !data.updated_at) data.updated_at = data.created_at
        // `dirty` is never restored: everything restored must upload on the next sync.
        const keys = Object.keys(data).filter(
          (k) => cols.has(k) && k !== 'dirty' && !(t === 'audit_log' && k === 'id')
        )
        db.prepare(
          `INSERT INTO ${t} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`
        ).run(...keys.map((k) => data[k] as string | number | null))
      }
      counts[t] = (payload.tables[t] ?? []).length
    }
    for (const k of SETTINGS_KEYS) {
      if (typeof payload.settings?.[k] === 'string') {
        db.prepare(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        ).run(k, payload.settings[k])
      }
    }
    if (payload.settings?.practitioner) {
      db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run('practitioner_updated_at', new Date().toISOString())
      db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run('practitioner_dirty', '1')
    }
    logAudit('backup.restore', 'app', 'app', null, `from ${payload.exportedAt}`)
  })()
  return counts
}

const parent = (): BrowserWindow | undefined => BrowserWindow.getFocusedWindow() ?? undefined

export async function exportBackup(pin: string, passphrase: string): Promise<BackupResult> {
  confirmPin(pin)
  const secret = checkPassphrase(passphrase)
  const { payload, counts } = buildBackup()
  const file = encryptBackup(payload, secret)
  const opts = {
    title: 'Save encrypted backup',
    defaultPath: `flowpt-backup-${new Date().toLocaleDateString('en-CA')}.flowpt-backup`,
    filters: [{ name: 'FlowPT backup', extensions: ['flowpt-backup'] }]
  }
  const win = parent()
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (res.canceled || !res.filePath) return { saved: false }
  await writeFile(res.filePath, file)
  logAudit('backup.export', 'app', 'app', null, JSON.stringify(counts))
  return { saved: true, path: res.filePath, counts }
}

export async function restoreFromFile(pin: string, passphrase: string): Promise<BackupResult> {
  confirmPin(pin)
  const opts = {
    title: 'Choose a FlowPT backup',
    properties: ['openFile' as const],
    filters: [{ name: 'FlowPT backup', extensions: ['flowpt-backup'] }]
  }
  const win = parent()
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || res.filePaths.length === 0) return { saved: false }
  const counts = restoreBackup(await readFile(res.filePaths[0]), passphrase)
  return { saved: true, path: res.filePaths[0], counts }
}
