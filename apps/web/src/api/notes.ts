import {
  BUILTIN_TEMPLATES,
  cleanAddendum,
  cleanSections,
  cleanVisitDate,
  type Addendum,
  type ChartNote,
  type NoteApi,
  type NoteSection
} from '@flowpt/shared'
import { actorName, audit, check, nowIso, supabase } from './core'
import { getPatient } from './patients'

interface AddendumRow {
  id: string
  note_id: string
  text: string
  author: string
  created_at: string
}

interface Row {
  id: string
  patient_id: string
  template_id: string
  visit_date: string
  sections: NoteSection[]
  signed_at: string | null
  signed_by: string | null
  created_at: string
  updated_at: string
  note_addenda?: AddendumRow[]
}

const SELECT = '*, note_addenda(*)'

const toNote = (r: Row): ChartNote => ({
  id: r.id,
  patientId: r.patient_id,
  templateId: r.template_id,
  visitDate: r.visit_date,
  sections: r.sections,
  signedAt: r.signed_at,
  signedBy: r.signed_by,
  addenda: (r.note_addenda ?? [])
    .map<Addendum>((a) => ({
      id: a.id,
      noteId: a.note_id,
      text: a.text,
      author: a.author,
      createdAt: a.created_at
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

async function getRow(id: string): Promise<Row> {
  const r = check(
    await supabase
      .from('chart_notes')
      .select(SELECT)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()
  ) as Row | null
  if (!r) throw new Error('Note not found')
  return r
}

export const notes: NoteApi = {
  async list(patientId) {
    const rows = check(
      await supabase
        .from('chart_notes')
        .select(SELECT)
        .eq('patient_id', patientId)
        .is('deleted_at', null)
        .order('visit_date', { ascending: false })
        .order('created_at', { ascending: false })
    ) as Row[]
    void audit('notes.view', 'patient', patientId, patientId)
    return rows.map(toNote)
  },

  async create(patientId, templateId, visitDate) {
    const template = BUILTIN_TEMPLATES.find((t) => t.id === templateId)
    if (!template) throw new Error('Unknown template')
    const date = cleanVisitDate(visitDate)
    if (!(await getPatient(patientId))) throw new Error('Patient not found')
    const id = crypto.randomUUID()
    const now = nowIso()
    const row = check(
      await supabase
        .from('chart_notes')
        .insert({
          id,
          patient_id: patientId,
          template_id: templateId,
          visit_date: date,
          sections: template.sections.map((s) => ({ key: s.key, label: s.label, text: '' })),
          created_at: now,
          updated_at: now
        })
        .select(SELECT)
        .single()
    ) as Row
    await audit('note.create', 'note', id, patientId, templateId)
    return toNote(row)
  },

  async update(id, visitDate, sections) {
    const row = await getRow(id)
    if (row.signed_at) throw new Error('Signed notes cannot be edited. Add an addendum instead.')
    const rows = check(
      await supabase
        .from('chart_notes')
        .update({
          visit_date: cleanVisitDate(visitDate),
          sections: cleanSections(sections),
          updated_at: nowIso()
        })
        .eq('id', id)
        .is('signed_at', null)
        .is('deleted_at', null)
        .select(SELECT)
    ) as Row[]
    if (rows.length === 0) throw new Error('Not saved: a newer version exists. Reload and retry.')
    await audit('note.update', 'note', id, row.patient_id)
    return toNote(rows[0])
  },

  // Signing locks the note permanently (a server trigger enforces it as well).
  async sign(id) {
    const row = await getRow(id)
    if (row.signed_at) throw new Error('Note is already signed')
    const now = nowIso()
    const rows = check(
      await supabase
        .from('chart_notes')
        .update({ signed_at: now, signed_by: await actorName(), updated_at: now })
        .eq('id', id)
        .is('signed_at', null)
        .select(SELECT)
    ) as Row[]
    if (rows.length === 0) throw new Error('Not signed: a newer version exists. Reload and retry.')
    await audit('note.sign', 'note', id, row.patient_id)
    return toNote(rows[0])
  },

  async addAddendum(id, text) {
    const row = await getRow(id)
    if (!row.signed_at) throw new Error('Addenda can only be added to signed notes')
    const body = cleanAddendum(text)
    const addendumId = crypto.randomUUID()
    check(
      await supabase.from('note_addenda').insert({
        id: addendumId,
        note_id: id,
        text: body,
        author: await actorName(),
        created_at: nowIso()
      })
    )
    await audit('note.addendum', 'note', id, row.patient_id, addendumId)
    return toNote(await getRow(id))
  },

  // Only unsigned drafts can be deleted (soft delete; a server trigger blocks signed ones).
  async remove(id) {
    const row = await getRow(id)
    if (row.signed_at) throw new Error('Signed notes cannot be deleted')
    const now = nowIso()
    check(
      await supabase.from('chart_notes').update({ deleted_at: now, updated_at: now }).eq('id', id)
    )
    await audit('note.delete', 'note', id, row.patient_id)
  }
}
