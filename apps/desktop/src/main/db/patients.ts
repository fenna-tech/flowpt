import { randomUUID } from 'crypto'
import {
  changedPatientFields,
  cleanPatientInput,
  str,
  type Patient,
  type PatientInput
} from '@flowpt/shared'
import { getDb } from './connection'
import { logAudit } from './audit'

interface Row {
  id: string
  first_name: string
  last_name: string
  dob: string
  phn: string
  email: string
  phone: string
  address: string
  parent_names: string
  diagnosis: string
  notes: string
  created_at: string
  updated_at: string
}

const toPatient = (r: Row): Patient => ({
  id: r.id,
  firstName: r.first_name,
  lastName: r.last_name,
  dob: r.dob,
  phn: r.phn,
  email: r.email,
  phone: r.phone,
  address: r.address,
  parentNames: r.parent_names,
  diagnosis: r.diagnosis,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export function listPatients(search = ''): Patient[] {
  const q = `%${str(search, 100).replace(/[%_\\]/g, '\\$&')}%`
  return (
    getDb()
      .prepare(
        `SELECT * FROM patients WHERE deleted_at IS NULL
         AND (first_name || ' ' || last_name LIKE @q ESCAPE '\\' OR phn LIKE @q ESCAPE '\\'
              OR parent_names LIKE @q ESCAPE '\\')
         ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE`
      )
      .all({ q }) as Row[]
  ).map(toPatient)
}

export function getPatient(id: string): Patient | null {
  const r = getDb()
    .prepare('SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL')
    .get(id) as Row | undefined
  return r ? toPatient(r) : null
}

export function createPatient(input: PatientInput): Patient {
  const p = cleanPatientInput(input)
  const id = randomUUID()
  const now = new Date().toISOString()
  const db = getDb()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO patients (id, first_name, last_name, dob, phn, email, phone, address, parent_names, diagnosis, notes, created_at, updated_at)
       VALUES (@id, @firstName, @lastName, @dob, @phn, @email, @phone, @address, @parentNames, @diagnosis, @notes, @now, @now)`
    ).run({ ...p, id, now })
    logAudit('patient.create', 'patient', id, id)
  })()
  return getPatient(id)!
}

export function updatePatient(id: string, input: PatientInput): Patient {
  const p = cleanPatientInput(input)
  const before = getPatient(id)
  if (!before) throw new Error('Patient not found')
  const changed = changedPatientFields(before, p)
  const db = getDb()
  db.transaction(() => {
    db.prepare(
      `UPDATE patients SET first_name=@firstName, last_name=@lastName, dob=@dob, phn=@phn, email=@email,
       phone=@phone, address=@address, parent_names=@parentNames, diagnosis=@diagnosis, notes=@notes, updated_at=@now WHERE id=@id AND deleted_at IS NULL`
    ).run({ ...p, id, now: new Date().toISOString() })
    logAudit('patient.update', 'patient', id, id, changed.join(','))
  })()
  return getPatient(id)!
}

// Soft delete keeps the record for audit/sync. A hard-purge policy comes later.
export function deletePatient(id: string): void {
  const now = new Date().toISOString()
  const db = getDb()
  db.transaction(() => {
    db.prepare('UPDATE patients SET deleted_at=?, updated_at=? WHERE id=?').run(now, now, id)
    logAudit('patient.delete', 'patient', id, id)
  })()
}
