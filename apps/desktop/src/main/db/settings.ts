import {
  BILLING_PROFILES,
  DEFAULT_INVOICE_COLOR,
  INVOICE_FONTS,
  PRIVATE_PROFILE,
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
  email: '',
  invoiceFont: 'sans',
  invoiceColor: DEFAULT_INVOICE_COLOR
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
    email: str(p?.email, 200),
    invoiceFont: INVOICE_FONTS.some((f) => f.id === p?.invoiceFont) ? p.invoiceFont : 'sans',
    invoiceColor: /^#[0-9a-f]{6}$/i.test(p?.invoiceColor ?? '')
      ? p.invoiceColor.toLowerCase()
      : DEFAULT_INVOICE_COLOR
  }
  setSetting('practitioner', JSON.stringify(clean))
  setSetting('practitioner_updated_at', new Date().toISOString())
  setSetting('practitioner_dirty', '1')
  return clean
}

export const listProfiles = (): BillingProfile[] => BILLING_PROFILES

// Drafts that reference a retired custom profile fall back to private pay rather than failing.
export function getProfile(id: string): BillingProfile {
  return BILLING_PROFILES.find((p) => p.id === id) ?? PRIVATE_PROFILE
}
