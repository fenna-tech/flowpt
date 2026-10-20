import {
  changedPatientFields,
  cleanPatientInput,
  matchesPatientSearch,
  type Patient,
  type PatientApi
} from '@flowpt/shared'
import { audit, check, fetchAll, nowIso, supabase } from './core'

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

const toColumns = (p: ReturnType<typeof cleanPatientInput>): Record<string, string> => ({
  first_name: p.firstName,
  last_name: p.lastName,
  dob: p.dob,
  phn: p.phn,
  email: p.email,
  phone: p.phone,
  address: p.address,
  parent_names: p.parentNames,
  diagnosis: p.diagnosis,
  notes: p.notes
})

export async function getPatient(id: string): Promise<Patient | null> {
  const r = check(
    await supabase.from('patients').select('*').eq('id', id).is('deleted_at', null).maybeSingle()
  ) as Row | null
  return r ? toPatient(r) : null
}

export const patients: PatientApi = {
  async list(search = '') {
    // A practice is a few hundred patients at most, so filter in the browser: it keeps the same
    // matching rules as the desktop (name, PHN, parent) without PostgREST `or` escaping pitfalls.
    const rows = await fetchAll<Row>((from, to) =>
      supabase
        .from('patients')
        .select('*')
        .is('deleted_at', null)
        .order('last_name')
        .order('first_name')
        .order('id')
        .range(from, to)
    )
    const collator = new Intl.Collator(undefined, { sensitivity: 'base' })
    return rows
      .map(toPatient)
      .filter((p) => matchesPatientSearch(p, search))
      .sort(
        (a, b) =>
          collator.compare(a.lastName, b.lastName) || collator.compare(a.firstName, b.firstName)
      )
  },

  get: getPatient,

  async create(input) {
    const p = cleanPatientInput(input)
    const id = crypto.randomUUID()
    const now = nowIso()
    const row = check(
      await supabase
        .from('patients')
        .insert({ id, ...toColumns(p), created_at: now, updated_at: now })
        .select()
        .single()
    ) as Row
    await audit('patient.create', 'patient', id, id)
    return toPatient(row)
  },

  async update(id, input) {
    const p = cleanPatientInput(input)
    const before = await getPatient(id)
    if (!before) throw new Error('Patient not found')
    const rows = check(
      await supabase
        .from('patients')
        .update({ ...toColumns(p), updated_at: nowIso() })
        .eq('id', id)
        .is('deleted_at', null)
        .select()
    ) as Row[]
    // The server ignores a write older than the stored row (clock skew or a newer edit elsewhere).
    if (rows.length === 0) throw new Error('Not saved: a newer version exists. Reload and retry.')
    await audit('patient.update', 'patient', id, id, changedPatientFields(before, p).join(','))
    return toPatient(rows[0])
  },

  async remove(id) {
    const now = nowIso()
    check(await supabase.from('patients').update({ deleted_at: now, updated_at: now }).eq('id', id))
    await audit('patient.delete', 'patient', id, id)
  }
}
