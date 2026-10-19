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
  createdAt: string
}

export interface ChartNote {
  id: string
  patientId: string
  templateId: string
  visitDate: string // YYYY-MM-DD
  sections: NoteSection[]
  signedAt: string | null // once set, the note is locked
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
