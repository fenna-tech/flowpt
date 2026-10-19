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
