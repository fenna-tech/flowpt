import {
  BILLING_PROFILES,
  EMPTY_PRACTITIONER,
  cleanPractitioner,
  findBillingProfile,
  type BillingProfile,
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

export function getPractitioner(): PractitionerProfile {
  const raw = getSetting('practitioner')
  return raw ? { ...EMPTY_PRACTITIONER, ...JSON.parse(raw) } : { ...EMPTY_PRACTITIONER }
}

// Solo practitioner: the practitioner profile name is the acting identity.
export const currentActor = (): string => getPractitioner().name || 'Unknown'

export function savePractitioner(p: PractitionerProfile): PractitionerProfile {
  const clean = cleanPractitioner(p)
  setSetting('practitioner', JSON.stringify(clean))
  setSetting('practitioner_updated_at', new Date().toISOString())
  setSetting('practitioner_dirty', '1')
  return clean
}

export const listProfiles = (): BillingProfile[] => BILLING_PROFILES

export const getProfile = findBillingProfile
