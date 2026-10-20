import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js'

// Shared plumbing for the Supabase-backed implementation of window.api.

const URL_ = import.meta.env.VITE_SUPABASE_URL ?? ''
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export const isConfigured = Boolean(URL_ && KEY)
export const projectUrl = URL_

export const supabase: SupabaseClient = createClient(
  URL_ || 'http://localhost:54321',
  KEY || 'missing-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Email-confirmation links return to the app with the session in the URL hash.
      detectSessionInUrl: true
    }
  }
)

export const nowIso = (): string => new Date().toISOString()

export function check<T>(res: { data: T | null; error: PostgrestError | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

// The server defaults to 1000 rows per request; page through larger result sets.
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: PostgrestError | null }>
): Promise<T[]> {
  const size = 1000
  const out: T[] = []
  for (let from = 0; ; from += size) {
    const rows = (check(await page(from, from + size - 1)) ?? []) as T[]
    out.push(...rows)
    if (rows.length < size) return out
  }
}

export async function userId(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new Error('Not signed in')
  return id
}

// ---------- this browser as a device ----------
// Invoice numbers are leased per registered device, so the browser registers itself once per account.

let registeredFor: string | null = null

export function forgetDevice(): void {
  registeredFor = null
}

export async function deviceId(): Promise<string> {
  const uid = await userId()
  const key = `flowpt.device.${uid}`
  let id: string | null = null
  try {
    id = localStorage.getItem(key)
  } catch {
    // storage blocked: fall through to a fresh id for this page load
  }
  if (!id) id = crypto.randomUUID()
  if (registeredFor !== uid) {
    const { error } = await supabase
      .from('devices')
      .upsert(
        { id, name: `Web (${navigator.platform || 'browser'})`, last_seen_at: nowIso() },
        { onConflict: 'id' }
      )
    if (error) throw new Error(error.message)
    try {
      localStorage.setItem(key, id)
    } catch {
      // ignore
    }
    registeredFor = uid
  }
  return id
}

// ---------- audit ----------

export async function actorName(): Promise<string> {
  const { data } = await supabase.from('settings').select('value').eq('key', 'practitioner')
  try {
    return (JSON.parse(data?.[0]?.value ?? '{}') as { name?: string }).name || 'Unknown'
  } catch {
    return 'Unknown'
  }
}

// Metadata only (field names, template ids): never clinical or identifying content.
// Written right after the change it records; unlike the desktop it is not in the same transaction,
// so a dropped connection can lose the entry (see README).
export async function audit(
  action: string,
  entity: string,
  entityId: string,
  patientId: string | null,
  detail = ''
): Promise<void> {
  const { error } = await supabase.from('audit_log').insert({
    id: crypto.randomUUID(),
    device_id: await deviceId(),
    ts: nowIso(),
    action,
    entity,
    entity_id: entityId,
    patient_id: patientId,
    actor: await actorName(),
    detail
  })
  if (error) console.warn('audit log write failed', error.message)
}
