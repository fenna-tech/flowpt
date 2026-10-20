import { hostname } from 'os'
import { randomUUID } from 'crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { SyncState, SyncStatus } from '@flowpt/shared'
import { getDb } from '../db/connection'
import { getSetting, setSetting } from '../db/settings'
import { logAudit } from '../db/audit'
import { isUnlocked } from '../lock'
import { kvGet, kvSet, pendingCount, runSync, type Remote, type Row } from './engine'

// Wires the pure engine to Supabase: configuration, sign-in (+ mandatory TOTP MFA), device registration
// and the background loop. Auth tokens live in the encrypted local DB (settings, `auth:` prefix).

let client: SupabaseClient | null = null
let clientKey = ''
let syncing = false
let lastSyncAt: string | null = null
let lastError: string | null = null
let conflicts = 0
let soonTimer: NodeJS.Timeout | null = null

const storage = {
  getItem: (k: string): string | null => getSetting(`auth:${k}`),
  setItem: (k: string, v: string): void => setSetting(`auth:${k}`, v),
  removeItem: (k: string): void => {
    getDb().prepare('DELETE FROM settings WHERE key = ?').run(`auth:${k}`)
  }
}

function getClient(): SupabaseClient | null {
  const url = getSetting('cloud_url')
  const key = getSetting('cloud_anon_key')
  if (!url || !key) return null
  if (client && clientKey === `${url}|${key}`) return client
  client = createClient(url, key, {
    auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  })
  clientKey = `${url}|${key}`
  return client
}

const need = (): SupabaseClient => {
  const c = getClient()
  if (!c) throw new Error('Cloud sync is not configured')
  return c
}

export function configure(url: string, anonKey: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Enter a valid project URL')
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
    throw new Error('The project URL must start with https://')
  }
  const key = typeof anonKey === 'string' ? anonKey.trim() : ''
  if (!/^[\w.-]{20,2000}$/.test(key)) throw new Error('Enter the project anon (publishable) key')
  setSetting('cloud_url', parsed.origin)
  setSetting('cloud_anon_key', key)
  client = null
}

async function computeState(): Promise<{ state: SyncState; email: string | null }> {
  const c = getClient()
  if (!c) return { state: 'unconfigured', email: null }
  const { data } = await c.auth.getSession()
  if (!data.session) return { state: 'signed-out', email: null }
  const email = data.session.user.email ?? null
  const aal = await c.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aal.data?.currentLevel === 'aal2') return { state: 'ready', email }
  return { state: aal.data?.nextLevel === 'aal2' ? 'mfa-needed' : 'mfa-enroll', email }
}

export async function status(): Promise<SyncStatus> {
  let s: { state: SyncState; email: string | null } = { state: 'signed-out', email: null }
  try {
    s = await computeState()
  } catch (e) {
    lastError = (e as Error).message
  }
  return {
    state: s.state,
    url: getSetting('cloud_url') ?? '',
    email: s.email,
    syncing,
    lastSyncAt,
    lastError,
    pending: pendingCount(getDb()),
    conflicts
  }
}

// After password + TOTP: link this device to the account and register it.
async function finalize(): Promise<void> {
  const c = need()
  const { data } = await c.auth.getSession()
  const user = data.session?.user
  if (!user) throw new Error('Not signed in')
  const db = getDb()
  const linked = kvGet(db, 'sync_user')
  if (linked && linked !== user.id) {
    await c.auth.signOut()
    throw new Error('This device is linked to a different cloud account')
  }
  const deviceId = kvGet(db, 'device_id') ?? randomUUID()
  const { error } = await c
    .from('devices')
    .upsert({ id: deviceId, name: hostname() }, { onConflict: 'id' })
  if (error) throw new Error(error.message)
  kvSet(db, 'device_id', deviceId)
  if (!linked) {
    kvSet(db, 'sync_user', user.id)
    logAudit('sync.enabled', 'app', 'app', null)
  }
  syncSoon(500)
}

export async function signUp(
  email: string,
  password: string
): Promise<{ needsConfirmation: boolean }> {
  const { data, error } = await need().auth.signUp({ email, password })
  if (error) throw new Error(error.message)
  return { needsConfirmation: !data.session }
}

export async function signIn(email: string, password: string): Promise<SyncState> {
  const { error } = await need().auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
  const { state } = await computeState()
  if (state === 'ready') await finalize()
  return state
}

export async function verifyMfa(code: string): Promise<SyncState> {
  const c = need()
  const { data, error } = await c.auth.mfa.listFactors()
  if (error) throw new Error(error.message)
  const factor = data.totp[0]
  if (!factor) throw new Error('No authenticator is enrolled')
  const res = await c.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: String(code).trim()
  })
  if (res.error) throw new Error(res.error.message)
  await finalize()
  return 'ready'
}

export async function enrollMfa(): Promise<{ factorId: string; qrSvg: string; secret: string }> {
  const c = need()
  // Half-finished enrolments block new ones; clear them first.
  const { data: factors } = await c.auth.mfa.listFactors()
  for (const f of factors?.all ?? []) {
    if (f.status === 'unverified') await c.auth.mfa.unenroll({ factorId: f.id })
  }
  const { data, error } = await c.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `FlowPT ${hostname()}`
  })
  if (error) throw new Error(error.message)
  return { factorId: data.id, qrSvg: data.totp.qr_code, secret: data.totp.secret }
}

export async function confirmMfa(factorId: string, code: string): Promise<SyncState> {
  const res = await need().auth.mfa.challengeAndVerify({ factorId, code: String(code).trim() })
  if (res.error) throw new Error(res.error.message)
  await finalize()
  return 'ready'
}

export async function signOut(): Promise<void> {
  const c = getClient()
  if (c) await c.auth.signOut()
  logAudit('sync.signout', 'app', 'app', null)
}

// ---------- Remote backed by supabase-js ----------

function supabaseRemote(c: SupabaseClient, ownerId: string): Remote {
  return {
    async upsert(table, rows, opts) {
      // settings upserts conflict on (owner_id, key), so the owner must be in the payload.
      const payload = table === 'settings' ? rows.map((r) => ({ owner_id: ownerId, ...r })) : rows
      const { error } = await c.from(table).upsert(payload, opts)
      if (error) throw new Error(error.message)
    },
    async pull(table, after, limit) {
      const { data, error } = await c
        .from(table)
        .select('*')
        .gt('server_ts', after)
        .order('server_ts', { ascending: true })
        .limit(limit)
      if (error) throw new Error(error.message)
      return (data ?? []) as Row[]
    },
    async lease(deviceId, count, minStart) {
      const { data, error } = await c.rpc('lease_invoice_numbers', {
        p_device: deviceId,
        p_count: count,
        p_min_start: minStart
      })
      if (error) throw new Error(error.message)
      const block = (data as { start_no: number; end_no: number }[])[0]
      if (!block) throw new Error('Lease failed')
      return block
    }
  }
}

export async function syncNow(): Promise<SyncStatus> {
  if (syncing || !isUnlocked()) return status()
  const c = getClient()
  const db = getDb()
  const deviceId = kvGet(db, 'device_id')
  if (!c || !deviceId || !kvGet(db, 'sync_user')) return status()
  syncing = true
  try {
    const { state } = await computeState()
    if (state !== 'ready') {
      lastError =
        state === 'signed-out'
          ? 'Signed out. Sign in to resume syncing.'
          : 'Finish MFA to resume syncing.'
    } else {
      const { data } = await c.auth.getSession()
      const res = await runSync(db, supabaseRemote(c, data.session!.user.id), deviceId)
      conflicts += res.conflicts
      lastSyncAt = new Date().toISOString()
      lastError = res.errors[0] ?? null
    }
  } catch (e) {
    lastError = (e as Error).message
  } finally {
    syncing = false
  }
  return status()
}

export function syncSoon(delayMs = 5000): void {
  if (soonTimer) clearTimeout(soonTimer)
  soonTimer = setTimeout(() => void syncNow(), delayMs)
  soonTimer.unref()
}

export function startSyncLoop(): void {
  const t = setInterval(() => {
    if (isUnlocked()) void syncNow()
  }, 60_000)
  t.unref()
}
