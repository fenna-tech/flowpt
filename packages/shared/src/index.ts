export interface Patient {
  id: string
  firstName: string
  lastName: string
  dob: string // YYYY-MM-DD
  phn: string // BC Personal Health Number (10 digits, optional)
  email: string
  phone: string
  address: string
  notes: string
  createdAt: string
  updatedAt: string
}

export type PatientInput = Omit<Patient, 'id' | 'createdAt' | 'updatedAt'>

export interface PatientApi {
  list(search?: string): Promise<Patient[]>
  get(id: string): Promise<Patient | null>
  create(input: PatientInput): Promise<Patient>
  update(id: string, input: PatientInput): Promise<Patient>
  remove(id: string): Promise<void>
}

// ---- Chart notes ----

export interface NoteTemplate {
  id: string
  name: string
  sections: { key: string; label: string; hint?: string }[]
}

// Templates are data so custom/user-defined ones can be added later without code changes.
export const BUILTIN_TEMPLATES: NoteTemplate[] = [
  {
    id: 'soap',
    name: 'SOAP',
    sections: [
      { key: 's', label: 'Subjective', hint: "Patient's reported symptoms and history" },
      { key: 'o', label: 'Objective', hint: 'Observations, measurements, findings' },
      { key: 'a', label: 'Assessment', hint: 'Clinical impression / diagnosis' },
      { key: 'p', label: 'Plan', hint: 'Treatment, follow-up, referrals' }
    ]
  },
  {
    id: 'dap',
    name: 'DAP',
    sections: [
      { key: 'd', label: 'Data' },
      { key: 'a', label: 'Assessment' },
      { key: 'p', label: 'Plan' }
    ]
  },
  { id: 'free', name: 'Free text', sections: [{ key: 'note', label: 'Note' }] }
]

// Each section stores its own label so old notes stay readable if templates change.
export interface NoteSection {
  key: string
  label: string
  text: string
}

// Added after signing; append-only. The original note can never change.
export interface Addendum {
  id: string
  noteId: string
  text: string
  author: string
  createdAt: string
}

export interface ChartNote {
  id: string
  patientId: string
  templateId: string
  visitDate: string // YYYY-MM-DD
  sections: NoteSection[]
  signedAt: string | null // once set, the note is locked
  signedBy: string | null
  addenda: Addendum[]
  createdAt: string
  updatedAt: string
}

export interface NoteApi {
  list(patientId: string): Promise<ChartNote[]>
  create(patientId: string, templateId: string, visitDate: string): Promise<ChartNote>
  update(id: string, visitDate: string, sections: NoteSection[]): Promise<ChartNote>
  sign(id: string): Promise<ChartNote>
  addAddendum(id: string, text: string): Promise<ChartNote>
  remove(id: string): Promise<void> // unsigned drafts only
}

// ---- Audit log (append-only; never contains clinical content) ----

export interface AuditEntry {
  id: number
  ts: string
  action: string // e.g. 'note.sign', 'patient.update'
  entity: string
  entityId: string
  patientId: string | null
  actor: string // practitioner identity at the time
  detail: string // metadata only, e.g. changed field names
}

export interface AuditApi {
  list(patientId: string): Promise<AuditEntry[]>
}

// ---- Billing ----

export interface PractitionerProfile {
  name: string
  credentials: string // e.g. "RMT", "R.Psych"
  businessName: string
  registrationNo: string // college registration number
  gstNumber: string
  address: string
  phone: string
  email: string
}

// Billing profiles are data. 'private' is built in; users add programs/insurers as custom profiles.
export interface BillingProfile {
  id: string
  name: string
  builtin: boolean
  payerLabel: string // '' = billed directly to the patient; otherwise e.g. "Insurer" / "Program"
  requirePolicyNumber: boolean
  requireServiceCode: boolean
  defaultTaxPct: number
  footerNote: string // payment terms / claim instructions printed on the PDF
}

export type BillingProfileInput = Omit<BillingProfile, 'id' | 'builtin'> & { id?: string }

export const PRIVATE_PROFILE: BillingProfile = {
  id: 'private',
  name: 'Private pay (patient)',
  builtin: true,
  payerLabel: '',
  requirePolicyNumber: false,
  requireServiceCode: false,
  defaultTaxPct: 0,
  footerNote: ''
}

export interface LineItem {
  description: string
  code: string // service / fee code, optional unless the profile requires it
  quantity: number
  unitCents: number
}

export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'void'
export const PAYMENT_METHODS = ['cash', 'etransfer', 'card', 'cheque', 'insurer', 'other'] as const

export interface Invoice {
  id: string
  number: string | null // assigned when issued
  patientId: string
  profileId: string
  status: InvoiceStatus
  issueDate: string
  payerName: string
  policyNumber: string
  items: LineItem[]
  taxPct: number
  notes: string
  subtotalCents: number
  taxCents: number
  totalCents: number
  paidAt: string | null
  paymentMethod: string
  createdAt: string
  updatedAt: string
}

export interface InvoiceInput {
  profileId: string
  issueDate: string
  payerName: string
  policyNumber: string
  items: LineItem[]
  taxPct: number
  notes: string
}

export const lineTotalCents = (i: LineItem): number => Math.round(i.quantity * i.unitCents)

export function computeTotals(
  items: LineItem[],
  taxPct: number
): { subtotalCents: number; taxCents: number; totalCents: number } {
  const subtotalCents = items.reduce((sum, i) => sum + lineTotalCents(i), 0)
  const taxCents = Math.round((subtotalCents * taxPct) / 100)
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents }
}

export const formatMoney = (cents: number): string =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100)

export interface InvoiceApi {
  list(patientId: string): Promise<Invoice[]>
  create(patientId: string, profileId: string): Promise<Invoice>
  update(id: string, input: InvoiceInput): Promise<Invoice>
  issue(id: string): Promise<Invoice>
  markPaid(id: string, method: string, paidDate: string): Promise<Invoice>
  void(id: string): Promise<Invoice>
  remove(id: string): Promise<void> // drafts only
  exportPdf(id: string): Promise<{ saved: boolean; path?: string }>
}

export interface SettingsApi {
  getPractitioner(): Promise<PractitionerProfile>
  savePractitioner(p: PractitionerProfile): Promise<PractitionerProfile>
  listProfiles(): Promise<BillingProfile[]>
  saveProfile(p: BillingProfileInput): Promise<BillingProfile>
  removeProfile(id: string): Promise<void>
}

// ---- App lock ----

export type LockStatus = 'setup' | 'locked' | 'unlocked'
export const LOCK_TIMEOUT_OPTIONS = [1, 5, 10, 15, 30, 60] as const // minutes

export interface LockApi {
  status(): Promise<LockStatus>
  setup(name: string, pin: string): Promise<void> // first run: creates identity + PIN
  unlock(pin: string): Promise<{ ok: boolean; retryAfterSec?: number }>
  lock(): Promise<void>
  activity(): void // renderer reports user activity to defer auto-lock
  getTimeout(): Promise<number>
  setTimeout(minutes: number): Promise<void>
  changePin(oldPin: string, newPin: string): Promise<void>
  onChange(cb: (status: LockStatus) => void): () => void
}

// ---- Dashboard ----

export interface OutstandingInvoice {
  id: string
  number: string
  patientId: string
  patientName: string
  issueDate: string
  totalCents: number
  daysOutstanding: number
}

export interface MonthlyRevenue {
  month: string // YYYY-MM
  invoicedCents: number // by invoice date (issued + paid)
  collectedCents: number // by payment date (paid)
}

export interface DashboardData {
  outstanding: OutstandingInvoice[]
  outstandingCents: number
  over30Count: number
  collectedThisMonthCents: number
  collectedYtdCents: number
  invoicedYtdCents: number
  months: MonthlyRevenue[] // last 12 months, oldest first
}

export interface DashboardApi {
  get(): Promise<DashboardData>
}

// ---- Encrypted backup ----

export interface BackupResult {
  saved: boolean
  path?: string
  counts?: Record<string, number>
}

export interface BackupApi {
  // `pin` re-confirms the app PIN; `passphrase` encrypts the file and is needed to restore it.
  exportTo(pin: string, passphrase: string): Promise<BackupResult>
  restoreFrom(pin: string, passphrase: string): Promise<BackupResult>
}

// ---- Cloud sync ----

export type SyncState = 'unconfigured' | 'signed-out' | 'mfa-needed' | 'mfa-enroll' | 'ready'

export interface SyncStatus {
  state: SyncState
  managed: boolean // true when the cloud project is built into this app (no manual setup)
  linked: boolean // this device has been linked to a cloud account
  url: string
  email: string | null
  syncing: boolean
  lastSyncAt: string | null
  lastError: string | null
  pending: number // local changes not yet uploaded
  conflicts: number // drafts replaced by a locked server copy since launch
}

export interface SyncApi {
  status(): Promise<SyncStatus>
  configure(url: string, anonKey: string): Promise<void>
  signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }>
  signIn(email: string, password: string): Promise<{ state: SyncState }>
  verifyMfa(code: string): Promise<{ state: SyncState }>
  enrollMfa(): Promise<{ factorId: string; qrSvg: string; secret: string }>
  confirmMfa(factorId: string, code: string): Promise<{ state: SyncState }>
  signOut(): Promise<void>
  syncNow(): Promise<SyncStatus>
}
