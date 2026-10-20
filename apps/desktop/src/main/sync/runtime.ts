import { hostname } from 'os'
import { randomUUID } from 'crypto'
import { createClient, isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js'
import type { SyncState, SyncStatus } from '@flowpt/shared'
import { getDb } from '../db/connection'
import { getPractitioner, getSetting, savePractitioner, setSetting } from '../db/settings'
import { logAudit } from '../db/audit'
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
let authOkUntil = 0

const storage = {
  getItem: (k: string): string | null => getSetting(`auth:${k}`),
  setItem: (k: string, v: string): void => setSetting(`auth:${k}`, v),
  removeItem: (k: string): void => {
    getDb().prepare('DELETE FROM settings WHERE key = ?').run(`auth:${k}`)
  }
}

// Release builds ship with the project URL and anon key (both public by design; row-level security
// protects the data). They come from apps/desktop/.env at build time. Dev builds without them
// fall back to values entered in Settings.
const EMBEDDED_URL: string = import.meta.env.MAIN_VITE_SUPABASE_URL ?? ''
const EMBEDDED_KEY: string = import.meta.env.MAIN_VITE_SUPABASE_ANON_KEY ?? ''
const managed = Boolean(EMBEDDED_URL && EMBEDDED_KEY)
const cloudUrl = (): string | null => (managed ? EMBEDDED_URL : getSetting('cloud_url'))

function getClient(): SupabaseClient | null {
  const url = cloudUrl()
  const key = managed ? EMBEDDED_KEY : getSetting('cloud_anon_key')
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
  if (managed) throw new Error('This build connects to FlowPT cloud automatically')
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
  const { data, error } = await c.auth.getSession()
  // Offline with an expired access token: the stored session is still valid, so keep the user in.
  if (!data.session && error && isAuthRetryableFetchError(error) && kvGet(getDb(), 'sync_user')) {
    return { state: 'ready', email: null }
  }
  if (!data.session) return { state: 'signed-out', email: null }
  const email = data.session.user.email ?? null
  const aal = await c.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aal.data?.currentLevel === 'aal2') return { state: 'ready', email }
  return { state: aal.data?.nextLevel === 'aal2' ? 'mfa-needed' : 'mfa-enroll', email }
}

// Gate for every data IPC call: the user must hold a signed-in (MFA-verified) cloud session on a
// linked device. Dev builds with no cloud project configured have no account to gate on.
export async function isSignedIn(): Promise<boolean> {
  if (Date.now() < authOkUntil) return true
  if (!getClient()) return true
  const ok = await computeState()
    .then((s) => s.state === 'ready' && Boolean(kvGet(getDb(), 'sync_user')))
    .catch(() => false)
  authOkUntil = ok ? Date.now() + 5000 : 0
  return ok
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
    managed,
    linked: Boolean(kvGet(getDb(), 'sync_user')),
    url: cloudUrl() ?? '',
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
    const name = user.user_metadata?.name
    if (typeof name === 'string' && name.trim() && !getPractitioner().name) {
      savePractitioner({ ...getPractitioner(), name: name.trim().slice(0, 100) })
      // Backdate the profile so that, on a new device, the cloud copy (with the full business details)
      // wins over this name-only stub, while a brand-new account still uploads it.
      setSetting('practitioner_updated_at', '1970-01-01T00:00:00.000Z')
    }
    logAudit('sync.enabled', 'app', 'app', null)
  }
  syncSoon(500)
}

export async function signUp(
  email: string,
  password: string,
  name: string
): Promise<{ needsConfirmation: boolean }> {
  const clean = typeof name === 'string' ? name.trim().slice(0, 100) : ''
  if (!clean) throw new Error('Your name is required')
  const { data, error } = await need().auth.signUp({
    email,
    password,
    options: { data: { name: clean } }
  })
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
  authOkUntil = 0
  const c = getClient()
  if (c) {
    // The server call fails offline; the local session must be dropped regardless.
    await c.auth.signOut().catch(() => undefined)
    await c.auth.signOut({ scope: 'local' })
  }
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
  if (syncing) return status()
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
    void syncNow()
  }, 60_000)
  t.unref()
}
