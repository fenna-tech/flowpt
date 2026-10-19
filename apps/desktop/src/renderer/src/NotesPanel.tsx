import { useCallback, useEffect, useState } from 'react'
import { BUILTIN_TEMPLATES, type ChartNote, type NoteSection } from '@flowpt/shared'

const inputCls = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm'
const today = (): string => new Date().toLocaleDateString('en-CA') // YYYY-MM-DD, local time

function NoteEditor({
  note,
  onSaved,
  onDeleted
}: {
  note: ChartNote
  onSaved: () => void
  onDeleted: () => void
}): React.JSX.Element {
  const [visitDate, setVisitDate] = useState(note.visitDate)
  const [sections, setSections] = useState<NoteSection[]>(note.sections)
  const [status, setStatus] = useState('')
  const dirty =
    visitDate !== note.visitDate || JSON.stringify(sections) !== JSON.stringify(note.sections)
  const templateName = BUILTIN_TEMPLATES.find((t) => t.id === note.templateId)?.name ?? 'Note'

  const save = async (): Promise<void> => {
    try {
      await window.api.notes.update(note.id, visitDate, sections)
      setStatus('')
      onSaved()
    } catch (err) {
      setStatus((err as Error).message)
    }
  }

  const remove = async (): Promise<void> => {
    if (!window.confirm('Delete this note?')) return
    await window.api.notes.remove(note.id)
    onDeleted()
  }

  return (
    <div className="space-y-3 rounded border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium">{templateName}</span>
        <input
          type="date"
          className="rounded border border-slate-300 px-2 py-1 text-sm"
          value={visitDate}
          onChange={(e) => setVisitDate(e.target.value)}
        />
      </div>
      {sections.map((s, i) => (
        <label key={s.key} className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">{s.label}</span>
          <textarea
            className={inputCls}
            rows={3}
            placeholder={
              BUILTIN_TEMPLATES.find((t) => t.id === note.templateId)?.sections.find(
                (x) => x.key === s.key
              )?.hint
            }
            value={s.text}
            onChange={(e) =>
              setSections(sections.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
            }
          />
        </label>
      ))}
      {status && <p className="text-sm text-red-600">{status}</p>}
      <div className="flex gap-2">
        <button
          disabled={!dirty}
          onClick={save}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {dirty ? 'Save note' : 'Saved'}
        </button>
        <button
          onClick={remove}
          className="rounded border border-red-300 px-4 py-1.5 text-sm text-red-600 hover:bg-red-50"
        >
          Delete
        </button>
      </div>
    </div>
  )
}

export function NotesPanel({ patientId }: { patientId: string }): React.JSX.Element {
  const [notes, setNotes] = useState<ChartNote[]>([])
  const [templateId, setTemplateId] = useState(BUILTIN_TEMPLATES[0].id)
  const [error, setError] = useState('')

  const refresh = useCallback(() => window.api.notes.list(patientId).then(setNotes), [patientId])
  useEffect(() => {
    refresh()
  }, [refresh])

  const add = async (): Promise<void> => {
    try {
      setError('')
      await window.api.notes.create(patientId, templateId, today())
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <select
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
        >
          {BUILTIN_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          onClick={add}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700"
        >
          + New note
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {notes.length === 0 && <p className="text-sm text-slate-500">No notes yet.</p>}
      {notes.map((n) => (
        <NoteEditor key={`${n.id}:${n.updatedAt}`} note={n} onSaved={refresh} onDeleted={refresh} />
      ))}
    </div>
  )
}
