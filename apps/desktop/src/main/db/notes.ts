import { randomUUID } from 'crypto'
import { BUILTIN_TEMPLATES, type ChartNote, type NoteSection } from '@flowpt/shared'
import { getDb } from './connection'

interface Row {
  id: string
  patient_id: string
  template_id: string
  visit_date: string
  sections: string
  created_at: string
  updated_at: string
}

const toNote = (r: Row): ChartNote => ({
  id: r.id,
  patientId: r.patient_id,
  templateId: r.template_id,
  visitDate: r.visit_date,
  sections: JSON.parse(r.sections) as NoteSection[],
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// IPC input is untrusted: validate and normalize here.
function cleanSections(sections: unknown): NoteSection[] {
  if (!Array.isArray(sections) || sections.length > 50) throw new Error('Invalid note sections')
  return sections.map((s) => ({
    key: String(s?.key ?? '').slice(0, 50),
    label: String(s?.label ?? '').slice(0, 100),
    text: String(s?.text ?? '').slice(0, 50000)
  }))
}

function cleanDate(d: unknown): string {
  if (typeof d !== 'string' || !DATE_RE.test(d)) throw new Error('Invalid visit date')
  return d
}

export function listNotes(patientId: string): ChartNote[] {
  return (
    getDb()
      .prepare(
        `SELECT * FROM chart_notes WHERE patient_id = ? AND deleted_at IS NULL
         ORDER BY visit_date DESC, created_at DESC`
      )
      .all(patientId) as Row[]
  ).map(toNote)
}

function getNote(id: string): ChartNote {
  const r = getDb().prepare('SELECT * FROM chart_notes WHERE id = ? AND deleted_at IS NULL').get(id)
  if (!r) throw new Error('Note not found')
  return toNote(r as Row)
}

export function createNote(patientId: string, templateId: string, visitDate: string): ChartNote {
  const template = BUILTIN_TEMPLATES.find((t) => t.id === templateId)
  if (!template) throw new Error('Unknown template')
  const date = cleanDate(visitDate)
  const exists = getDb()
    .prepare('SELECT 1 FROM patients WHERE id = ? AND deleted_at IS NULL')
    .get(patientId)
  if (!exists) throw new Error('Patient not found')

  const id = randomUUID()
  const now = new Date().toISOString()
  const sections = template.sections.map((s) => ({ key: s.key, label: s.label, text: '' }))
  getDb()
    .prepare(
      `INSERT INTO chart_notes (id, patient_id, template_id, visit_date, sections, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, patientId, templateId, date, JSON.stringify(sections), now, now)
  return getNote(id)
}

export function updateNote(id: string, visitDate: string, sections: NoteSection[]): ChartNote {
  const res = getDb()
    .prepare(
      `UPDATE chart_notes SET visit_date = ?, sections = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`
    )
    .run(
      cleanDate(visitDate),
      JSON.stringify(cleanSections(sections)),
      new Date().toISOString(),
      id
    )
  if (res.changes === 0) throw new Error('Note not found')
  return getNote(id)
}

// Soft delete keeps the record for audit/sync and records-retention rules.
export function deleteNote(id: string): void {
  const now = new Date().toISOString()
  getDb()
    .prepare('UPDATE chart_notes SET deleted_at = ?, updated_at = ? WHERE id = ?')
    .run(now, now, id)
}
