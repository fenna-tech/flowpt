import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import type { PasskeyApi, SyncApi, SyncState, SyncStatus } from '@flowpt/shared'
import { deviceId, forgetDevice, isConfigured, projectUrl, supabase } from './core'

// Account sign-in for the web app: email + password, then mandatory TOTP MFA (AAL2). The same flow
// as the desktop's runtime.ts, without the local database. "Ready" additionally means this browser
// is registered as a device, which invoice-number leasing needs.

let lastError: string | null = null

async function computeState(): Promise<{ state: SyncState; email: string | null }> {
  if (!isConfigured) return { state: 'unconfigured', email: null }
  const { data, error } = await supabase.auth.getSession()
  if (!data.session) {
    if (error && isAuthRetryableFetchError(error)) throw error
    return { state: 'signed-out', email: null }
  }
  const email = data.session.user.email ?? null
  const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aal.data?.currentLevel === 'aal2') return { state: 'ready', email }
  // A passkey sign-in is the second factor too; the database accepts it (migration
  // 20261020000100_passkey_satisfies_mfa.sql), so do not ask for an authenticator code.
  const methods = (aal.data?.currentAuthenticationMethods ?? []) as ({ method?: string } | string)[]
  if (methods.some((m) => (typeof m === 'string' ? m : m.method) === 'passkey')) {
    return { state: 'ready', email }
  }
  return { state: aal.data?.nextLevel === 'aal2' ? 'mfa-needed' : 'mfa-enroll', email }
}

async function status(): Promise<SyncStatus> {
  let s: { state: SyncState; email: string | null } = { state: 'signed-out', email: null }
  let linked = false
  try {
    s = await computeState()
    if (s.state === 'ready') {
      await deviceId()
      linked = true
    }
    lastError = null
  } catch (e) {
    lastError = (e as Error).message
  }
  return {
    state: s.state,
    managed: true,
    linked,
    url: projectUrl,
    email: s.email,
    syncing: false,
    lastSyncAt: null,
    lastError,
    pending: 0,
    conflicts: 0
  }
}

const stateAfter = async (): Promise<SyncState> => {
  const { state } = await computeState()
  if (state === 'ready') await deviceId()
  return state
}

// Passkeys are bound to this site's domain (the project's Relying Party ID): one registered on
// localhost will not work on the production hostname.
const passkeys: PasskeyApi = {
  async list() {
    const { data, error } = await supabase.auth.passkey.list()
    if (error) throw new Error(error.message)
    return (data ?? []).map((p) => ({
      id: p.id,
      name: p.friendly_name ?? '',
      createdAt: p.created_at,
      lastUsedAt: p.last_used_at ?? null
    }))
  },

  async register(name) {
    const { data, error } = await supabase.auth.registerPasskey()
    if (error) throw new Error(error.message)
    const friendlyName = name.trim().slice(0, 120)
    if (data && friendlyName) {
      await supabase.auth.passkey.update({ passkeyId: data.id, friendlyName })
    }
  },

  async signIn() {
    const { error } = await supabase.auth.signInWithPasskey()
    if (error) throw new Error(error.message)
    return { state: await stateAfter() }
  },

  async remove(passkeyId) {
    const { error } = await supabase.auth.passkey.delete({ passkeyId })
    if (error) throw new Error(error.message)
  }
}

export const sync: SyncApi = {
  passkeys,
  status,

  async configure() {
    throw new Error('This build connects to FlowPT cloud automatically')
  },

  async signUp(email, password, name) {
    const clean = typeof name === 'string' ? name.trim().slice(0, 100) : ''
    if (!clean) throw new Error('Your name is required')
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name: clean }, emailRedirectTo: window.location.origin }
    })
    if (error) throw new Error(error.message)
    return { needsConfirmation: !data.session }
  },

  async signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)
    return { state: await stateAfter() }
  },

  async verifyMfa(code) {
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) throw new Error(error.message)
    const factor = data.totp[0]
    if (!factor) throw new Error('No authenticator is enrolled')
    const res = await supabase.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: String(code).trim()
    })
    if (res.error) throw new Error(res.error.message)
    return { state: await stateAfter() }
  },

  async enrollMfa() {
    // Half-finished enrolments block new ones; clear them first.
    const { data: factors } = await supabase.auth.mfa.listFactors()
    for (const f of factors?.all ?? []) {
      if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `FlowPT web ${new Date().toISOString().slice(0, 10)}`
    })
    if (error) throw new Error(error.message)
    return { factorId: data.id, qrSvg: data.totp.qr_code, secret: data.totp.secret }
  },

  async confirmMfa(factorId, code) {
    const res = await supabase.auth.mfa.challengeAndVerify({ factorId, code: String(code).trim() })
    if (res.error) throw new Error(res.error.message)
    return { state: await stateAfter() }
  },

  async signOut() {
    forgetDevice()
    await supabase.auth.signOut().catch(() => undefined)
    await supabase.auth.signOut({ scope: 'local' })
  },

  // Nothing to sync: every change is already saved to the cloud.
  syncNow: status
}
