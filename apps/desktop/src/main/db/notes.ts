import { randomUUID } from 'crypto'
import { BUILTIN_TEMPLATES, type Addendum, type ChartNote, type NoteSection } from '@flowpt/shared'
import { getDb } from './connection'
import { logAudit } from './audit'
import { currentActor } from './settings'

interface Row {
  id: string
  patient_id: string
  template_id: string
  visit_date: string
  sections: string
  signed_at: string | null
  signed_by: string | null
  created_at: string
  updated_at: string
}

interface AddendumRow {
  id: string
  note_id: string
  text: string
  author: string
  created_at: string
}

const toNote = (r: Row, addenda: Addendum[]): ChartNote => ({
  id: r.id,
  patientId: r.patient_id,
  templateId: r.template_id,
  visitDate: r.visit_date,
  sections: JSON.parse(r.sections) as NoteSection[],
  signedAt: r.signed_at,
  signedBy: r.signed_by,
  addenda,
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

function addendaFor(noteId: string): Addendum[] {
  return (
    getDb()
      .prepare('SELECT * FROM note_addenda WHERE note_id = ? ORDER BY created_at, rowid')
      .all(noteId) as AddendumRow[]
  ).map((a) => ({
    id: a.id,
    noteId: a.note_id,
    text: a.text,
    author: a.author,
    createdAt: a.created_at
  }))
}

function getRow(id: string): Row {
  const r = getDb().prepare('SELECT * FROM chart_notes WHERE id = ? AND deleted_at IS NULL').get(id)
  if (!r) throw new Error('Note not found')
  return r as Row
}

function getNote(id: string): ChartNote {
  return toNote(getRow(id), addendaFor(id))
}

export function listNotes(patientId: string): ChartNote[] {
  const db = getDb()
  const notes = (
    db
      .prepare(
        `SELECT * FROM chart_notes WHERE patient_id = ? AND deleted_at IS NULL
         ORDER BY visit_date DESC, created_at DESC`
      )
      .all(patientId) as Row[]
  ).map((r) => toNote(r, addendaFor(r.id)))
  logAudit('notes.view', 'patient', patientId, patientId)
  return notes
}

export function createNote(patientId: string, templateId: string, visitDate: string): ChartNote {
  const template = BUILTIN_TEMPLATES.find((t) => t.id === templateId)
  if (!template) throw new Error('Unknown template')
  const date = cleanDate(visitDate)
  const db = getDb()
  const exists = db
    .prepare('SELECT 1 FROM patients WHERE id = ? AND deleted_at IS NULL')
    .get(patientId)
  if (!exists) throw new Error('Patient not found')

  const id = randomUUID()
  const now = new Date().toISOString()
  const sections = template.sections.map((s) => ({ key: s.key, label: s.label, text: '' }))
  db.transaction(() => {
    db.prepare(
      `INSERT INTO chart_notes (id, patient_id, template_id, visit_date, sections, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, patientId, templateId, date, JSON.stringify(sections), now, now)
    logAudit('note.create', 'note', id, patientId, templateId)
  })()
  return getNote(id)
}

export function updateNote(id: string, visitDate: string, sections: NoteSection[]): ChartNote {
  const row = getRow(id)
  if (row.signed_at) throw new Error('Signed notes cannot be edited. Add an addendum instead.')
  const date = cleanDate(visitDate)
  const clean = cleanSections(sections)
  const db = getDb()
  db.transaction(() => {
    db.prepare(
      `UPDATE chart_notes SET visit_date = ?, sections = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL AND signed_at IS NULL`
    ).run(date, JSON.stringify(clean), new Date().toISOString(), id)
    logAudit('note.update', 'note', id, row.patient_id)
  })()
  return getNote(id)
}

// Signing locks the note permanently (enforced by a DB trigger as well).
export function signNote(id: string): ChartNote {
  const row = getRow(id)
  if (row.signed_at) throw new Error('Note is already signed')
  const now = new Date().toISOString()
  const db = getDb()
  db.transaction(() => {
    db.prepare(
      'UPDATE chart_notes SET signed_at = ?, signed_by = ?, updated_at = ? WHERE id = ?'
    ).run(now, currentActor(), now, id)
    logAudit('note.sign', 'note', id, row.patient_id)
  })()
  return getNote(id)
}

export function addAddendum(id: string, text: string): ChartNote {
  const row = getRow(id)
  if (!row.signed_at) throw new Error('Addenda can only be added to signed notes')
  const body = typeof text === 'string' ? text.trim().slice(0, 50000) : ''
  if (!body) throw new Error('Addendum text is required')
  const addendumId = randomUUID()
  const db = getDb()
  db.transaction(() => {
    db.prepare(
      'INSERT INTO note_addenda (id, note_id, text, author, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(addendumId, id, body, currentActor(), new Date().toISOString())
    logAudit('note.addendum', 'note', id, row.patient_id, addendumId)
  })()
  return getNote(id)
}

// Only unsigned drafts can be deleted (soft delete; a DB trigger blocks signed ones).
export function deleteNote(id: string): void {
  const row = getRow(id)
  if (row.signed_at) throw new Error('Signed notes cannot be deleted')
  const now = new Date().toISOString()
  const db = getDb()
  db.transaction(() => {
    db.prepare('UPDATE chart_notes SET deleted_at = ?, updated_at = ? WHERE id = ?').run(
      now,
      now,
      id
    )
    logAudit('note.delete', 'note', id, row.patient_id)
  })()
}
