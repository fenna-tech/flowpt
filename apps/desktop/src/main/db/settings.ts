import { randomUUID } from 'crypto'
import {
  PRIVATE_PROFILE,
  type BillingProfile,
  type BillingProfileInput,
  type PractitionerProfile
} from '@flowpt/shared'
import { getDb } from './connection'

export function getSetting(key: string): string | null {
  const r = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined
  return r?.value ?? null
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, value)
}

const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : ''

const EMPTY_PRACTITIONER: PractitionerProfile = {
  name: '',
  credentials: '',
  businessName: '',
  registrationNo: '',
  gstNumber: '',
  address: '',
  phone: '',
  email: ''
}

export function getPractitioner(): PractitionerProfile {
  const raw = getSetting('practitioner')
  return raw ? { ...EMPTY_PRACTITIONER, ...JSON.parse(raw) } : { ...EMPTY_PRACTITIONER }
}

// Solo practitioner: the practitioner profile name is the acting identity.
export const currentActor = (): string => getPractitioner().name || 'Unknown'

export function savePractitioner(p: PractitionerProfile): PractitionerProfile {
  const clean: PractitionerProfile = {
    name: str(p?.name, 100),
    credentials: str(p?.credentials, 50),
    businessName: str(p?.businessName, 150),
    registrationNo: str(p?.registrationNo, 50),
    gstNumber: str(p?.gstNumber, 50),
    address: str(p?.address, 500),
    phone: str(p?.phone, 50),
    email: str(p?.email, 200)
  }
  setSetting('practitioner', JSON.stringify(clean))
  return clean
}

type Definition = Omit<BillingProfile, 'id' | 'builtin'>

export function listProfiles(): BillingProfile[] {
  const custom = (
    getDb()
      .prepare(
        'SELECT id, definition FROM billing_profiles WHERE deleted_at IS NULL ORDER BY created_at'
      )
      .all() as { id: string; definition: string }[]
  ).map((r) => ({ ...(JSON.parse(r.definition) as Definition), id: r.id, builtin: false }))
  return [PRIVATE_PROFILE, ...custom]
}

// Old drafts may reference a removed profile; fall back to private pay rather than failing.
export function getProfile(id: string): BillingProfile {
  return listProfiles().find((p) => p.id === id) ?? PRIVATE_PROFILE
}

export function saveProfile(input: BillingProfileInput): BillingProfile {
  if (input?.id === PRIVATE_PROFILE.id) throw new Error('The built-in profile cannot be changed')
  const def: Definition = {
    name: str(input?.name, 100),
    payerLabel: str(input?.payerLabel, 50),
    requirePolicyNumber: input?.requirePolicyNumber === true,
    requireServiceCode: input?.requireServiceCode === true,
    defaultTaxPct: Number.isFinite(input?.defaultTaxPct)
      ? Math.min(100, Math.max(0, input.defaultTaxPct))
      : 0,
    footerNote: str(input?.footerNote, 1000)
  }
  if (!def.name) throw new Error('Profile name is required')
  if (!def.payerLabel && (def.requirePolicyNumber || def.requireServiceCode)) {
    throw new Error('A payer label is required when policy numbers or service codes are required')
  }
  const db = getDb()
  if (input.id) {
    const res = db
      .prepare('UPDATE billing_profiles SET definition = ? WHERE id = ? AND deleted_at IS NULL')
      .run(JSON.stringify(def), input.id)
    if (res.changes === 0) throw new Error('Profile not found')
    return { ...def, id: input.id, builtin: false }
  }
  const id = randomUUID()
  db.prepare('INSERT INTO billing_profiles (id, definition, created_at) VALUES (?, ?, ?)').run(
    id,
    JSON.stringify(def),
    new Date().toISOString()
  )
  return { ...def, id, builtin: false }
}

export function removeProfile(id: string): void {
  if (id === PRIVATE_PROFILE.id) throw new Error('The built-in profile cannot be removed')
  getDb()
    .prepare('UPDATE billing_profiles SET deleted_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id)
}
