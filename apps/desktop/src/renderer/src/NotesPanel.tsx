import { useCallback, useEffect, useState } from 'react'
import { BUILTIN_TEMPLATES, type ChartNote, type NoteSection } from '@flowpt/shared'

const inputCls = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm'
const today = (): string => new Date().toLocaleDateString('en-CA') // YYYY-MM-DD, local time
const fmt = (iso: string): string => new Date(iso).toLocaleString()
const msg = (err: unknown): string =>
  (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function NoteEditor({
  note,
  onChanged
}: {
  note: ChartNote
  onChanged: () => void
}): React.JSX.Element {
  const [visitDate, setVisitDate] = useState(note.visitDate)
  const [sections, setSections] = useState<NoteSection[]>(note.sections)
  const [addendum, setAddendum] = useState('')
  const [status, setStatus] = useState('')
  const locked = note.signedAt !== null
  const template = BUILTIN_TEMPLATES.find((t) => t.id === note.templateId)
  const dirty =
    visitDate !== note.visitDate || JSON.stringify(sections) !== JSON.stringify(note.sections)

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
      setStatus('')
      onChanged()
    } catch (err) {
      setStatus(msg(err))
    }
  }

  const save = (): Promise<void> => run(() => window.api.notes.update(note.id, visitDate, sections))

  const sign = (): Promise<void> => {
    if (!window.confirm('Sign this note? It will be locked and can only be amended by addenda.'))
      return Promise.resolve()
    return run(async () => {
      if (dirty) await window.api.notes.update(note.id, visitDate, sections)
      await window.api.notes.sign(note.id)
    })
  }

  const remove = (): Promise<void> => {
    if (!window.confirm('Delete this draft note?')) return Promise.resolve()
    return run(() => window.api.notes.remove(note.id))
  }

  const addAddendum = (): Promise<void> =>
    run(async () => {
      await window.api.notes.addAddendum(note.id, addendum)
      setAddendum('')
    })

  return (
    <div className="space-y-3 rounded border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium">
          {template?.name ?? 'Note'}
        </span>
        <input
          type="date"
          disabled={locked}
          className="rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50"
          value={visitDate}
          onChange={(e) => setVisitDate(e.target.value)}
        />
        {locked ? (
          <span className="ml-auto rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">
            Signed {fmt(note.signedAt!)}
            {note.signedBy ? ` by ${note.signedBy}` : ''}
          </span>
        ) : (
          <span className="ml-auto rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
            Draft
          </span>
        )}
      </div>

      {sections.map((s, i) => (
        <label key={s.key} className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">{s.label}</span>
          <textarea
            className={`${inputCls} disabled:bg-slate-50`}
            rows={3}
            disabled={locked}
            placeholder={template?.sections.find((x) => x.key === s.key)?.hint}
            value={s.text}
            onChange={(e) =>
              setSections(sections.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
            }
          />
        </label>
      ))}

      {note.addenda.length > 0 && (
        <div className="space-y-2 border-t border-slate-200 pt-3">
          <h4 className="text-sm font-medium text-slate-700">Addenda</h4>
          {note.addenda.map((a) => (
            <div key={a.id} className="rounded bg-slate-50 p-2 text-sm">
              <div className="mb-1 text-xs text-slate-500">
                {fmt(a.createdAt)}
                {a.author ? ` · ${a.author}` : ''}
              </div>
              <div className="whitespace-pre-wrap">{a.text}</div>
            </div>
          ))}
        </div>
      )}

      {status && <p className="text-sm text-red-600">{status}</p>}

      {locked ? (
        <div className="space-y-2 border-t border-slate-200 pt-3">
          <textarea
            className={inputCls}
            rows={2}
            placeholder="Add an addendum (cannot be edited or removed once saved)"
            value={addendum}
            onChange={(e) => setAddendum(e.target.value)}
          />
          <button
            disabled={!addendum.trim()}
            onClick={addAddendum}
            className="rounded bg-slate-700 px-4 py-1.5 text-sm text-white hover:bg-slate-800 disabled:opacity-40"
          >
            Add addendum
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            disabled={!dirty}
            onClick={save}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {dirty ? 'Save draft' : 'Saved'}
          </button>
          <button
            onClick={sign}
            className="rounded bg-green-700 px-4 py-1.5 text-sm text-white hover:bg-green-800"
          >
            Sign &amp; lock
          </button>
          <button
            onClick={remove}
            className="rounded border border-red-300 px-4 py-1.5 text-sm text-red-600 hover:bg-red-50"
          >
            Delete draft
          </button>
        </div>
      )}
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
      setError(msg(err))
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
        <NoteEditor
          key={`${n.id}:${n.updatedAt}:${n.addenda.length}`}
          note={n}
          onChanged={refresh}
        />
      ))}
    </div>
  )
}
