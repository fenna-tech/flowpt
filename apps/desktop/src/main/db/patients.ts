import { randomUUID } from 'crypto'
import type { Patient, PatientInput } from '@flowpt/shared'
import { getDb } from './connection'

interface Row {
  id: string
  first_name: string
  last_name: string
  dob: string
  phn: string
  email: string
  phone: string
  address: string
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
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const str = (v: unknown, max = 2000): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : ''

// IPC input is untrusted: validate and normalize here.
function clean(input: PatientInput): PatientInput {
  const out: PatientInput = {
    firstName: str(input?.firstName, 100),
    lastName: str(input?.lastName, 100),
    dob: str(input?.dob, 10),
    phn: str(input?.phn, 20).replace(/\D/g, ''),
    email: str(input?.email, 200),
    phone: str(input?.phone, 50),
    address: str(input?.address, 500),
    notes: str(input?.notes, 10000)
  }
  if (!out.firstName || !out.lastName) throw new Error('First and last name are required')
  if (out.dob && !/^\d{4}-\d{2}-\d{2}$/.test(out.dob)) throw new Error('Invalid date of birth')
  if (out.phn && out.phn.length !== 10) throw new Error('BC PHN must be 10 digits')
  return out
}

export function listPatients(search = ''): Patient[] {
  const q = `%${str(search, 100).replace(/[%_\\]/g, '\\$&')}%`
  return (
    getDb()
      .prepare(
        `SELECT * FROM patients WHERE deleted_at IS NULL
         AND (first_name || ' ' || last_name LIKE @q ESCAPE '\\' OR phn LIKE @q ESCAPE '\\')
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
  const p = clean(input)
  const id = randomUUID()
  const now = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO patients (id, first_name, last_name, dob, phn, email, phone, address, notes, created_at, updated_at)
       VALUES (@id, @firstName, @lastName, @dob, @phn, @email, @phone, @address, @notes, @now, @now)`
    )
    .run({ ...p, id, now })
  return getPatient(id)!
}

export function updatePatient(id: string, input: PatientInput): Patient {
  const p = clean(input)
  const res = getDb()
    .prepare(
      `UPDATE patients SET first_name=@firstName, last_name=@lastName, dob=@dob, phn=@phn, email=@email,
       phone=@phone, address=@address, notes=@notes, updated_at=@now WHERE id=@id AND deleted_at IS NULL`
    )
    .run({ ...p, id, now: new Date().toISOString() })
  if (res.changes === 0) throw new Error('Patient not found')
  return getPatient(id)!
}

// Soft delete keeps the record for audit/sync. A hard-purge policy comes later.
export function deletePatient(id: string): void {
  const now = new Date().toISOString()
  getDb().prepare('UPDATE patients SET deleted_at=?, updated_at=? WHERE id=?').run(now, now, id)
}
